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

const providerOf = profileId => (String(profileId).startsWith('k8s:') ? 'kubernetes' : 'aws');

/**
 * @param options.cache      log cache (refreshTargets, syncGroup, usage)
 * @param options.clientFor  async (profileId, region) => FilterLogEvents-compatible client
 * @param options.plan       () => current plan
 */
function createAutoRefresh({ cache, clientFor, plan = getPlan, now = () => Date.now(), log = console, tickMs = TICK_MS }) {
  let timer = null;
  let running = false;
  const last = new Map(); // scope key → { at, status, inserted, error }

  const keyOf = target => `${target.profileId}\u0000${target.region}\u0000${target.logGroup}`;

  /** Interval actually used: the group's, raised to the plan minimum. */
  function effectiveMinutes(target, active = plan()) {
    return Math.max(target.refreshMinutes, active.limits.logRefreshMinMinutes || target.refreshMinutes);
  }

  function due(target, active) {
    const minutes = effectiveMinutes(target, active);
    return !target.lastSyncAt || now() - target.lastSyncAt >= minutes * 60000;
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
          const client = await clientFor(target.profileId, target.region);
          // Attributed in "Spent by KUA" to the group's profile (lib/usage).
          const result = await runWithUsageContext({ profileId: target.profileId, feature: 'log-refresh' }, () => cache.syncGroup({
            profileId: target.profileId, region: target.region, logGroup: target.logGroup,
            client, FilterLogEventsCommand: FilterCommand, maxPages: PAGES[providerOf(target.profileId)], latestOnly: true,
          }));
          last.set(keyOf(target), { at: now(), status: result.status, inserted: result.inserted });
          synced.push({ logGroup: target.logGroup, inserted: result.inserted });
        } catch (err) {
          last.set(keyOf(target), { at: now(), status: 'error', error: err.message });
          log.warn?.(`[log-refresh] ${target.logGroup}: ${err.message}`);
        }
      }
    } finally {
      running = false;
    }
    return { synced };
  }

  function start() {
    if (timer) return;
    timer = setInterval(() => { tick().catch(err => log.warn?.('[log-refresh]', err.message)); }, tickMs);
    timer.unref?.();
  }

  function stop() {
    clearInterval(timer);
    timer = null;
  }

  /** Last automatic refresh of a group, and when the next one is due. */
  function statusOf({ profileId, region, logGroup, refreshMinutes, lastSyncAt }) {
    if (!refreshMinutes) return null;
    const active = plan();
    const minutes = effectiveMinutes({ refreshMinutes }, active);
    return {
      minutes,
      active: active.features.logAutoRefresh,
      nextAt: (lastSyncAt || now()) + minutes * 60000,
      last: last.get(keyOf({ profileId, region, logGroup })) || null,
    };
  }

  return { start, stop, tick, statusOf, effectiveMinutes };
}

let shared = null;
function getAutoRefresh() {
  if (!shared) {
    const { getLogCache } = require('./awsLogCache');
    const { logClientFor } = require('./logScanRunner');
    shared = createAutoRefresh({ cache: getLogCache(), clientFor: logClientFor });
  }
  return shared;
}

module.exports = { createAutoRefresh, getAutoRefresh, PAGES };
