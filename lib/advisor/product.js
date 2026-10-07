'use strict';
/**
 * lib/advisor/product.js
 * Product lens for a KUApps application: are its objectives defined and met,
 * does it have an owner, a release path and enough telemetry to know how
 * users are served. The technical lens (security, infrastructure,
 * architecture, development) lives in the provider overviews; this one only
 * looks at the application as a product. Pure: no I/O.
 */

const { check, buildReport, PRODUCT_CATEGORIES } = require('./core');
const { DEFAULT_THRESHOLDS } = require('../apm/database');

const STALE_MS = 24 * 60 * 60 * 1000;
const PROD_RE = /^(prod|production|prd|live)$/i;
const FAILED_RUNS = new Set(['failed', 'budget_exhausted']);

const DOCS = {
  slo: 'https://sre.google/workbook/implementing-slos/',
  errorBudget: 'https://sre.google/workbook/error-budget-policy/',
  ownership: 'https://sre.google/workbook/how-sre-relates/',
  environments: 'https://12factor.net/dev-prod-parity',
  journeys: 'https://sre.google/workbook/implementing-slos/#modeling-user-journeys',
  telemetry: 'https://sre.google/sre-book/monitoring-distributed-systems/#xref_monitoring_golden-signals',
  dependencies: 'https://sre.google/sre-book/addressing-cascading-failures/',
};

const RULES = {
  sloBreached: { id: 'product.slo_breached', category: 'product', severity: 'high', docs: DOCS.errorBudget },
  noTelemetry: { id: 'product.no_telemetry', category: 'product', severity: 'high', docs: DOCS.telemetry },
  defaultSlos: { id: 'product.default_slos', category: 'product', severity: 'medium', docs: DOCS.slo },
  noOwner: { id: 'product.no_owner', category: 'product', severity: 'medium', docs: DOCS.ownership },
  noStaging: { id: 'product.no_staging', category: 'product', severity: 'medium', docs: DOCS.environments },
  noJourneys: { id: 'product.no_architecture', category: 'product', severity: 'medium', docs: DOCS.journeys },
  noResources: { id: 'product.no_resources', category: 'product', severity: 'medium', docs: DOCS.telemetry },
  staleTelemetry: { id: 'product.stale_telemetry', category: 'product', severity: 'medium', docs: DOCS.telemetry },
  noEnvironment: { id: 'product.no_environment', category: 'product', severity: 'low', docs: DOCS.environments },
  partialTelemetry: { id: 'product.partial_telemetry', category: 'product', severity: 'low', docs: DOCS.telemetry },
  // Structure meets Observability (#172): a confirmed dependency whose target fails in its logs.
  fragileDependency: { id: 'product.fragile_dependency', category: 'product', severity: 'medium', docs: DOCS.dependencies },
  resourceLogRateHigh: { id: 'product.resource_log_rate_high', category: 'product', severity: 'high', docs: DOCS.telemetry },
  resourceRecurringLogErrors: { id: 'product.resource_recurring_log_errors', category: 'product', severity: 'medium', docs: DOCS.telemetry },
  resourceLogsUncached: { id: 'product.resource_logs_uncached', category: 'product', severity: 'low', docs: DOCS.telemetry },
  resourceLogsScopeUnavailable: { id: 'product.resource_logs_scope_unavailable', category: 'product', severity: 'low', docs: DOCS.telemetry },
};

const METRIC_LABELS = {
  errorRatePercent: 'Error rate', logErrorRatePercent: 'Log error rate', recurringSignatureGrowthPercent: 'Recurring signature growth',
  durationMs: 'Duration', readyPodsPercent: 'Ready pods', restartDelta: 'Restarts',
};

function round(value) {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : value;
}

function summarizeErrorBudget({ metrics = [], thresholds = {}, logHealth = {}, from = null, to = null } = {}) {
  const targetPercent = thresholds.errorRatePercent;
  if (!Number.isFinite(Number(targetPercent)) || Number(targetPercent) <= 0) return { from, to, objectives: [] };
  const byName = new Map(metrics.map(metric => [metric.metricName, Number(metric.sum)]));
  const invocations = byName.get('invocations_observed');
  const errors = byName.get('errors_observed');
  const rates = [];
  if (Number.isFinite(invocations) && invocations > 0 && Number.isFinite(errors)) {
    rates.push({ source: 'apm', errorRatePercent: errors / invocations * 100 });
  }
  if (logHealth.errorRatePercent != null && Number.isFinite(Number(logHealth.errorRatePercent))) {
    rates.push({ source: 'logs', errorRatePercent: Number(logHealth.errorRatePercent) });
  }
  return {
    from,
    to,
    objectives: rates.map(({ source, errorRatePercent }) => {
      const burnRate = errorRatePercent / Number(targetPercent);
      return {
        source,
        errorRatePercent,
        targetPercent: Number(targetPercent),
        burnRate,
        consumedPercent: burnRate * 100,
        remainingPercent: Math.max(0, 100 - burnRate * 100),
      };
    }),
  };
}

function technicalResourceType(kind) {
  const normalized = String(kind || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return ({
    cloudrun: 'gcp-cloud-run', cloudsql: 'gcp-cloud-sql', persistentvolumeclaim: 'pvc',
    securitygroup: 'security-group', elasticip: 'elastic-ip',
  })[normalized] || normalized;
}

function summarizeTechnicalFindings(reports = [], memberships = []) {
  const findings = new Map();
  let analyzedAt = null;
  for (const source of reports) {
    if (!source.report || !Array.isArray(source.report.findings)) continue;
    if (!analyzedAt || source.capturedAt > analyzedAt) analyzedAt = source.capturedAt;
    for (const finding of source.report.findings) {
      const resources = [];
      for (const affected of finding.resources || []) {
        const type = technicalResourceType(affected.kind);
        const matches = memberships.filter(member => {
          if (member.provider !== source.provider || member.resourceType !== type || member.displayName !== affected.name) return false;
          if (source.scopeId && member.scopeId && member.scopeId !== source.scopeId) return false;
          if (source.location && member.location && member.location !== source.location) return false;
          if (affected.namespace && !String(member.nativeIdentifier || '').includes(affected.namespace)) return false;
          return true;
        });
        if (matches.length === 1) resources.push({
          id: matches[0].id, provider: matches[0].provider, resourceType: matches[0].resourceType,
          name: matches[0].displayName, namespace: affected.namespace || null, detail: affected.detail || null,
        });
      }
      if (!resources.length) continue;
      const key = `${source.provider}:${finding.id}`;
      const existing = findings.get(key) || {
        id: finding.id, category: finding.category, severity: finding.severity, resources: [],
      };
      const seen = new Set(existing.resources.map(resource => resource.id));
      existing.resources.push(...resources.filter(resource => !seen.has(resource.id)));
      findings.set(key, existing);
    }
  }
  const filtered = [...findings.values()].map(finding => ({ ...finding, count: finding.resources.length }));
  return { analyzedAt, findings: filtered };
}

function crossRecommendations(errorBudget = {}, technical = {}) {
  const overBudget = (errorBudget.objectives || []).filter(objective => objective.burnRate > 1);
  const highRisk = (technical.findings || []).filter(finding => finding.severity === 'high');
  const recommendations = [];
  if (overBudget.length) recommendations.push({ id: 'error_budget_burning', sources: overBudget.map(item => item.source) });
  if (highRisk.length) recommendations.push({ id: 'registered_technical_risk', resources: highRisk.flatMap(finding => finding.resources.map(resource => resource.name)) });
  if (overBudget.length && highRisk.length) recommendations.push({
    id: 'error_budget_and_technical_risk',
    resources: [...new Set(highRisk.flatMap(finding => finding.resources.map(resource => resource.name)))],
  });
  return recommendations;
}

function summarizeResourceLogs(signals = []) {
  const resources = new Map();
  for (const signal of signals) {
    const current = resources.get(signal.resourceId) || {
      id: signal.resourceId,
      name: signal.resourceName,
      events: 0,
      errors: 0,
      errorThreshold: signal.errorThreshold,
      recurringErrors: new Map(),
      severeKeywords: new Map(),
    };
    current.events += Number(signal.last24h?.events) || 0;
    current.errors += Number(signal.last24h?.errors) || 0;
    for (const error of signal.recurringErrors || []) {
      current.recurringErrors.set(error.signature, (current.recurringErrors.get(error.signature) || 0) + (Number(error.occurrences) || 0));
    }
    for (const [keyword, count] of Object.entries(signal.severeKeywords || {})) {
      current.severeKeywords.set(keyword, (current.severeKeywords.get(keyword) || 0) + (Number(count) || 0));
    }
    resources.set(signal.resourceId, current);
  }
  return [...resources.values()].map(resource => {
    const errorRatePercent = resource.events ? (resource.errors / resource.events) * 100 : null;
    return {
      ...resource,
      errorRatePercent,
      errorRateHigh: errorRatePercent != null && resource.errorThreshold != null && errorRatePercent > resource.errorThreshold,
      recurringErrorCount: resource.recurringErrors.size,
      severeKeywordCount: [...resource.severeKeywords.values()].reduce((sum, count) => sum + count, 0),
    };
  });
}

/**
 * @param application KUApps application (lib/apm/database.js _application)
 * @param overview    getOverview() + { health, latestRun }
 * @param siblings    other applications of the same profile (to find a non-prod stage)
 */
function adviseProduct({ application, overview = {}, siblings = [], dependencies = [], resourceLogs = [], uncachedLogResources = [], unavailableLogScopeResources = [], now = Date.now() } = {}) {
  const results = [];
  const app = application || {};
  const appRef = detail => ({ kind: 'Application', name: app.name, ...(detail ? { detail } : {}) });
  const metrics = overview.metrics || [];
  const resources = (overview.resources || []).reduce((sum, row) => sum + (row.enabled || 0), 0);
  const thresholds = app.thresholds || {};

  results.push(check(RULES.sloBreached, (overview.health?.signals || []).map(signal => ({
    kind: 'Objective',
    name: METRIC_LABELS[signal.metric] || signal.metric,
    detail: `${round(signal.value)} vs ${signal.comparison === 'minimum' ? '≥' : '≤'} ${signal.threshold}`,
  }))));

  results.push(check(RULES.noResources, resources ? [] : [appRef()]));
  if (resources) {
    const reason = !app.pollingEnabled ? 'polling disabled' : !metrics.length ? 'no metrics in 24h' : null;
    results.push(check(RULES.noTelemetry, reason ? [appRef(reason)] : []));
    const run = overview.latestRun;
    const finished = Date.parse(run?.finishedAt || run?.startedAt || '');
    const stale = app.pollingEnabled && run && (FAILED_RUNS.has(run.status) || (Number.isFinite(finished) && now - finished > STALE_MS));
    results.push(check(RULES.staleTelemetry, stale ? [appRef(run.errorMessage || run.status || null)] : []));
    results.push(check(RULES.partialTelemetry, metrics.filter(metric => metric.quality === 'partial').map(metric => ({ kind: 'Metric', name: metric.metricName }))));
  }

  const keys = Object.keys(DEFAULT_THRESHOLDS);
  const allDefault = keys.every(key => thresholds[key] === DEFAULT_THRESHOLDS[key]);
  const noneSet = keys.every(key => thresholds[key] == null);
  results.push(check(RULES.defaultSlos, allDefault || noneSet ? [appRef(noneSet ? 'no objectives' : 'KUA defaults')] : []));

  results.push(check(RULES.noOwner, app.team ? [] : [appRef()]));
  results.push(check(RULES.noEnvironment, app.environment ? [] : [appRef()]));
  if (PROD_RE.test(app.environment || '')) {
    const preProd = siblings.some(other => other.id !== app.id && other.name === app.name && other.environment && !PROD_RE.test(other.environment));
    results.push(check(RULES.noStaging, preProd ? [] : [appRef(app.environment)]));
  }
  const errorLimit = Number(thresholds.errorRatePercent ?? DEFAULT_THRESHOLDS.errorRatePercent);
  results.push(check(RULES.fragileDependency, dependencies
    .filter(item => Number(item.targetErrorRatePercent) >= errorLimit)
    .map(item => ({ kind: 'Dependency', name: `${item.source} → ${item.target}`, detail: `${round(item.targetErrorRatePercent)}% errors (logs, 24h)` }))));

  const logSummaries = summarizeResourceLogs(resourceLogs);
  results.push(check(RULES.resourceLogRateHigh, logSummaries.filter(resource => resource.errorRateHigh)
    .map(resource => ({
      kind: 'Resource', name: resource.name,
      detail: `${round(resource.errorRatePercent)}% errors vs ${resource.errorThreshold}% objective (24h)`,
    }))));
  results.push(check(RULES.resourceRecurringLogErrors, logSummaries
    .filter(resource => resource.recurringErrorCount || resource.severeKeywordCount)
    .map(resource => ({
      kind: 'Resource', name: resource.name,
      detail: [
        resource.recurringErrorCount ? `${resource.recurringErrorCount} recurring error signature(s)` : '',
        resource.severeKeywordCount ? `${resource.severeKeywordCount} severe log signal(s)` : '',
      ].filter(Boolean).join('; '),
    }))));
  results.push(check(RULES.resourceLogsUncached, uncachedLogResources.map(resource => ({
    kind: 'Resource', name: resource.name, detail: resource.kind || resource.type || '',
  }))));
  results.push(check(RULES.resourceLogsScopeUnavailable, unavailableLogScopeResources.map(resource => ({
    kind: 'Resource', name: resource.name, detail: resource.kind || resource.type || '',
  }))));

  const architectures = app.architectureProjectIds?.length || (app.architectureProjectId ? 1 : 0);
  results.push(check(RULES.noJourneys, architectures ? [] : [appRef()]));

  const report = buildReport(results, { categories: PRODUCT_CATEGORIES, scope: { provider: app.provider || null, applicationId: app.id || null }, now });
  report.errorBudget = summarizeErrorBudget({
    metrics,
    thresholds,
    logHealth: overview.logHealth,
    from: overview.from ?? now - 24 * 60 * 60 * 1000,
    to: overview.to ?? now,
  });
  return report;
}

module.exports = {
  adviseProduct, RULES, summarizeErrorBudget, summarizeResourceLogs,
  summarizeTechnicalFindings, crossRecommendations,
};
