'use strict';
/**
 * lib/logAutoRefresh.js
 * Automatic refresh of cached log groups and Kubernetes workloads (#91):
 * every group with an interval is synced for its newest events only
 * (syncGroup latestOnly: no history backfill) while KUA runs. Pro and Team
 * plans only (lib/plans.js); the plan's minimum interval always applies.
 *
 * One group at a time, never Logs Insights, and nothing when the cache
 * reached its budget. CloudWatch FilterLogEvents has no per-request charge;
 * Kubernetes reads go through the API server.
 */

const { getPlan } = require('./plans');
const { runWithUsageContext } = require('./usage/awsMeter');

const TICK_MS = 30 * 1000;
// Newest events only: a few pages for CloudWatch; Kubernetes reads one page per container.
const PAGES = { aws: 5, kubernetes: 200 };

class FilterCommand { constructor(input) { this.input = input; } }

const providerOf = target => {
  if (String(target.profileId).startsWith('k8s:')) return 'kubernetes';
  if (String(target.logGroup).startsWith('gcp:')) return 'gcp';
  if (String(target.logGroup).startsWith('vercel:')) return 'vercel';
  return 'aws';
};

/**
 * @param options.cache      log cache (refreshTargets, syncGroup, usage)
 * @param options.clientFor  async (profileId, region) => FilterLogEvents-compatible client
 * @param options.plan       () => current plan
 */
function createAutoRefresh({ cache, clientFor, syncFor = null, plan = getPlan, now = () => Date.now(), log = console, tickMs = TICK_MS }) {
  let timer = null;
  let taskHandle = null;
  let running = false;
  const last = new Map(); // scope key → { at, status, inserted, error }

  const keyOf = target => `${target.profileId}\u0000${target.region}\u0000${target.logGroup}`;

  /** Interval actually used: the group's, raised to the plan minimum. */
  function effectiveMinutes(target, active = plan()) {
    return Math.max(target.refreshMinutes, active.limits.logRefreshMinMinutes || target.refreshMinutes);
  }

  function due(target, active) {
    const minutes = effectiveMinutes(target, active);
    const retryAt = last.get(keyOf(target))?.retryAt || 0;
    return now() >= retryAt && (!target.lastSyncAt || now() - target.lastSyncAt >= minutes * 60000);
  }

  /** One pass: syncs the groups that are due, one after another. */
  async function tick() {
    if (running) return { skipped: 'running' };
    const active = plan();
    if (!active.features.logAutoRefresh) return { skipped: 'plan' };
    running = true;
    const synced = [];
    try {
      await cache.ready();
      for (const target of cache.refreshTargets().filter(item => due(item, active))) {
        const { bytes, budgetBytes } = cache.usage();
        if (bytes >= budgetBytes) {
          last.set(keyOf(target), { at: now(), status: 'budget' });
          break;
        }
        try {
          const provider = providerOf(target);
          // Attributed in "Spent by KUA" to the group's profile (lib/usage).
          const result = await runWithUsageContext({ profileId: target.profileId, feature: 'log-refresh' }, async () => {
            if (syncFor && ['gcp', 'vercel'].includes(provider)) return syncFor({ ...target, provider, latestOnly: true });
            const client = await clientFor(target.profileId, target.region);
            return cache.syncGroup({
              profileId: target.profileId, region: target.region, logGroup: target.logGroup,
              client, FilterLogEventsCommand: FilterCommand, maxPages: PAGES[provider], latestOnly: true,
            });
          });
          last.set(keyOf(target), { at: now(), status: result.status, inserted: result.inserted });
          synced.push({ logGroup: target.logGroup, inserted: result.inserted });
        } catch (err) {
          const retrySeconds = Number(err.retryAfter);
          const retryAt = Number.isFinite(retrySeconds) && retrySeconds > 0
            ? now() + Math.min(retrySeconds, 24 * 60 * 60) * 1000
            : null;
          last.set(keyOf(target), { at: now(), status: 'error', error: err.message, retryAt });
          log.warn?.(`[log-refresh] ${target.logGroup}: ${err.message}`);
        }
      }
    } finally {
      running = false;
    }
    return { synced };
  }

  function start({ task = null } = {}) {
    if (timer) return;
    if (task) taskHandle = task;
    timer = setInterval(() => {
      const run = task ? task.run(() => tick()) : tick();
      run.catch(err => log.warn?.('[log-refresh]', err.message));
    }, tickMs);
    timer.unref?.();
  }

  function stop() {
    clearInterval(timer);
    timer = null;
  }

  function pause() {
    clearInterval(timer);
    timer = null;
  }

  function resume() { start({ task: taskHandle }); }

  /** Last automatic refresh of a group, and when the next one is due. */
  function statusOf({ profileId, region, logGroup, refreshMinutes, lastSyncAt }) {
    if (!refreshMinutes) return null;
    const active = plan();
    const minutes = effectiveMinutes({ refreshMinutes }, active);
    const previous = last.get(keyOf({ profileId, region, logGroup })) || null;
    return {
      minutes,
      active: active.features.logAutoRefresh,
      nextAt: Math.max((lastSyncAt || now()) + minutes * 60000, previous?.retryAt || 0),
      last: previous,
    };
  }

  return { start, stop, pause, resume, health: () => ({ running: !!timer }), tick, statusOf, effectiveMinutes };
}

let shared = null;
function getAutoRefresh() {
  if (!shared) {
    const { getLogCache } = require('./awsLogCache');
    const { logClientFor } = require('./logScanRunner');
    const cache = getLogCache();
    const { createLogProviderSync } = require('./logProviderSync');
    shared = createAutoRefresh({ cache, clientFor: logClientFor, syncFor: createLogProviderSync({ cache }) });
  }
  return shared;
}

module.exports = { createAutoRefresh, getAutoRefresh, PAGES, TICK_MS };
