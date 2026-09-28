'use strict';

// Background polling of GCP resource states for the state history.
//
// Off by default: runs only for profiles whose poll settings are enabled
// (lib/stateHistory.js). A 1-minute tick checks which profiles are due by their
// own interval; each run lists the selected resource types with the same
// listers the UI uses (one list call per type) and records changes with
// source 'poll', then applies the retention cleanup.

const TICK_MS = 60 * 1000;

function createGcpStatePoller({
  history,
  resolveAuth,
  sources,                 // routes/gcp STATE_SOURCES
  recordStates,            // (profileId, projectId, type, rows, source) → void
  now = () => Date.now(),
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  log = console,
}) {
  let timer = null;
  const running = new Set();

  function isDue(settings) {
    if (!settings.lastRunAt) return true;
    return now() - Date.parse(settings.lastRunAt) >= settings.intervalMinutes * 60 * 1000;
  }

  /** Poll one profile now. Returns { profileId, types, error }. */
  async function runProfile(profileId, settings = history.getPollSettings('gcp', profileId)) {
    if (running.has(profileId)) return { profileId, skipped: true };
    running.add(profileId);
    const types = [];
    let error = null;
    try {
      const authCtx = await resolveAuth(profileId);
      if (!authCtx.projectId) throw new Error('GCP_PROJECT_ID is required');
      for (const type of settings.resourceTypes) {
        const source = sources[type];
        if (!source) continue;
        try {
          const rows = await source.list(authCtx);
          recordStates(profileId, authCtx.projectId, type, rows, 'poll');
          types.push({ type, count: rows.length });
        } catch (err) {
          // One API disabled/forbidden must not stop the other types
          error = `${type}: ${String(err.message || err).split('\n')[0].slice(0, 200)}`;
          types.push({ type, error: error });
        }
      }
      history.cleanup('gcp', profileId);
    } catch (err) {
      error = String(err.message || err).split('\n')[0].slice(0, 300);
    } finally {
      history.markPollRun('gcp', profileId, error);
      running.delete(profileId);
    }
    return { profileId, types, error };
  }

  async function tick() {
    let enabled = [];
    try { enabled = history.listEnabledPollSettings('gcp'); } catch (err) { log.warn?.('[gcp-poller]', err.message); return []; }
    const due = enabled.filter(isDue);
    return Promise.all(due.map(s => runProfile(s.profileId, s)));
  }

  function start() {
    if (timer) return;
    timer = setIntervalFn(() => { tick().catch(err => log.warn?.('[gcp-poller]', err.message)); }, TICK_MS);
    timer.unref?.();
  }

  function stop() {
    if (timer) clearIntervalFn(timer);
    timer = null;
  }

  return { start, stop, tick, runProfile, isDue };
}

/** API reads per poll run, for showing the cost of a setting in the UI. */
function pollCallsPerDay({ enabled, intervalMinutes, resourceTypes }) {
  if (!enabled) return 0;
  return Math.ceil((24 * 60) / intervalMinutes) * resourceTypes.length;
}

module.exports = { createGcpStatePoller, pollCallsPerDay, TICK_MS };
