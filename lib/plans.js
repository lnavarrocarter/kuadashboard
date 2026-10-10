'use strict';
/**
 * lib/plans.js
 * KUA plans as seen by the desktop app: which features and limits apply.
 * Mirrors src/entitlements.js of the control plane (private repo
 * lnavarrocarter/kua-control-plane): same plan names and features, plus the
 * limits enforced locally. lib/logAutoRefresh.test.js pins both.
 *
 * The plan comes from the linked KUA account (lib/account/account.js,
 * GET /api/me of the control plane, cached for offline use). KUA_PLAN
 * (free | pro | team) overrides it for development only: the packaged desktop
 * app (KUA_PACKAGED=1, set by electron/main.js) ignores it.
 *
 * Free keeps every local feature that reads and changes clusters and clouds.
 * Pro and Team add what works on its own or for an agent: the Advisor, agents
 * through MCP (and future AI context), scheduled background work, more KUApps.
 */

const MB = 1024 * 1024;

const PLANS = Object.freeze({
  free: Object.freeze({
    plan: 'free',
    features: Object.freeze({ advisor: false, logAutoRefresh: false, teamSharing: false, sso: false, agents: false, scheduledTasks: false }),
    limits: Object.freeze({ logCacheMaxMb: 256, logRefreshMinMinutes: null, advisorScanMinHours: null, kuaApps: 3 }),
  }),
  pro: Object.freeze({
    plan: 'pro',
    features: Object.freeze({ advisor: true, logAutoRefresh: true, teamSharing: false, sso: false, agents: true, scheduledTasks: true }),
    limits: Object.freeze({ logCacheMaxMb: 2048, logRefreshMinMinutes: 15, advisorScanMinHours: 6, kuaApps: null }),
  }),
  team: Object.freeze({
    plan: 'team',
    features: Object.freeze({ advisor: true, logAutoRefresh: true, teamSharing: true, sso: true, agents: true, scheduledTasks: true }),
    limits: Object.freeze({ logCacheMaxMb: 20480, logRefreshMinMinutes: 1, advisorScanMinHours: 1, kuaApps: null }),
  }),
});

const REFRESH_CHOICES = [1, 5, 15, 30, 60];
// Scheduled Advisor analysis (lib/advisor/scheduler.js), in hours. A local limit:
// the control plane sells the Advisor feature, KUA decides how often it runs.
const ADVISOR_SCAN_CHOICES = [1, 6, 12, 24];

/** Current plan: { plan, source, features, limits }. */
/** Plan of the linked KUA account (cached entitlements), or null. */
function accountPlan() {
  try { return require('./account/account').getAccount().cachedPlan(); } catch { return null; }
}

/**
 * Current plan: { plan, source, features, limits }.
 * Order: KUA_PLAN (a local override, for development), the linked KUA
 * account, Free. The account is only read for the real environment.
 */
function getPlan(env = process.env, { account = env === process.env ? accountPlan : () => null } = {}) {
  const requested = env.KUA_PACKAGED === '1' ? '' : String(env.KUA_PLAN || '').trim().toLowerCase();
  if (PLANS[requested]) return { ...PLANS[requested], source: 'env' };
  const fromAccount = account();
  if (PLANS[fromAccount]) return { ...PLANS[fromAccount], source: 'account' };
  return { ...PLANS.free, source: 'default' };
}

/** Error answered by the API when a plan does not include something. */
function planError(message, required) {
  return Object.assign(new Error(message), { code: 'PLAN_REQUIRED', required, statusCode: 403 });
}

/**
 * Validates an automatic refresh interval for the plan.
 * @returns the minutes to store (null = off); throws PLAN_REQUIRED or a 400 error
 */
function checkRefreshMinutes(minutes, plan = getPlan()) {
  if (minutes === null || minutes === 0 || minutes === 'off') return null;
  const value = Number(minutes);
  if (!REFRESH_CHOICES.includes(value)) throw Object.assign(new Error(`refreshMinutes must be one of ${REFRESH_CHOICES.join(', ')} or null`), { statusCode: 400 });
  if (!plan.features.logAutoRefresh) throw planError('Automatic refresh of cached logs is part of the Pro and Team plans', 'pro');
  if (value < plan.limits.logRefreshMinMinutes) {
    throw planError(`The ${plan.plan} plan refreshes every ${plan.limits.logRefreshMinMinutes} minutes at most`, 'team');
  }
  return value;
}

/**
 * Validates a scheduled Advisor interval for the plan.
 * @returns the hours to store; throws PLAN_REQUIRED or a 400 error
 */
function checkAdvisorScanHours(hours, plan = getPlan()) {
  const value = Number(hours);
  if (!ADVISOR_SCAN_CHOICES.includes(value)) throw Object.assign(new Error(`intervalHours must be one of ${ADVISOR_SCAN_CHOICES.join(', ')}`), { statusCode: 400 });
  if (!plan.features.advisor) throw planError('Scheduled Advisor analysis is part of the Pro and Team plans', 'pro');
  if (value < plan.limits.advisorScanMinHours) throw planError(`The ${plan.plan} plan analyses every ${plan.limits.advisorScanMinHours} hours at most`, 'team');
  return value;
}

/** The next plan up that has a feature, for the upgrade message. */
function requiredPlanFor(feature) {
  return ['pro', 'team'].find(name => PLANS[name].features[feature]) || 'pro';
}

/** Throws PLAN_REQUIRED when the plan does not include a feature. */
function requireFeature(feature, message, plan = getPlan()) {
  if (!plan.features[feature]) throw planError(message, requiredPlanFor(feature));
}

/**
 * Throws PLAN_REQUIRED when creating one more KUA Application would pass the
 * plan limit. Applications created before keep working: only new ones count.
 */
function checkKuaAppLimit(currentCount, plan = getPlan()) {
  const limit = plan.limits.kuaApps;
  if (limit == null || currentCount < limit) return;
  throw Object.assign(planError(`The ${plan.plan} plan includes up to ${limit} KUA Applications; this computer has ${currentCount}`, 'pro'), { limit, current: currentCount });
}

/** Validates a cache budget for the plan; returns bytes. */
function checkCacheBudgetMb(mb, plan = getPlan()) {
  const value = Math.round(Number(mb));
  if (!Number.isFinite(value) || value < 64) throw Object.assign(new Error('The cache budget must be at least 64 MB'), { statusCode: 400 });
  if (value > plan.limits.logCacheMaxMb) {
    // The next plan up, or none when the plan already is the largest.
    const next = { free: 'pro', pro: 'team' }[plan.plan] || null;
    throw planError(`The ${plan.plan} plan allows up to ${plan.limits.logCacheMaxMb} MB of log cache`, next);
  }
  return value * MB;
}

/**
 * Requests per day of an automatic refresh: one sync per interval, each with
 * at least one page (CloudWatch: one FilterLogEvents call per page of up to
 * 1 MB; Kubernetes: one log read per container).
 */
function refreshRequestsPerDay(minutes, pagesPerSync = 1) {
  if (!minutes) return 0;
  return Math.ceil((24 * 60) / minutes) * Math.max(1, pagesPerSync);
}

/**
 * Advisor report as the plan allows it. Without the advisor feature (Free)
 * only the counts are returned: how many checks pass and how many findings
 * per category and severity, never which resources or how to fix them.
 */
function gateAdvisor(report, plan = getPlan()) {
  if (!report || report.error || plan.features.advisor) return report;
  const findings = report.findings || [];
  return {
    locked: true,
    required: 'pro',
    generatedAt: report.generatedAt,
    scope: report.scope,
    categories: report.categories,
    summary: report.summary,
    totals: {
      findings: findings.length,
      high: findings.filter(finding => finding.severity === 'high').length,
      medium: findings.filter(finding => finding.severity === 'medium').length,
      low: findings.filter(finding => finding.severity === 'low').length,
    },
    findings: [],
    unavailable: [],
  };
}

module.exports = { PLANS, REFRESH_CHOICES, ADVISOR_SCAN_CHOICES, getPlan, planError, requireFeature, checkKuaAppLimit, checkRefreshMinutes, checkAdvisorScanHours, checkCacheBudgetMb, refreshRequestsPerDay, gateAdvisor };
