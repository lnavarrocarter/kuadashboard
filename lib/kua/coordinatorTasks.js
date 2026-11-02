'use strict';
/**
 * lib/kua/coordinatorTasks.js
 * The KUApps task coordinator in the background task manager (#330).
 *
 * The coordinator runs in the renderer (frontend/src/lib/taskCoordinator.js, #326) and sends
 * its events here in batches (POST /api/system/tasks/kuapps/coordinators/events). Each application with
 * activity gets one aggregated task, `kuapps.coordinator.<applicationId>`, in the existing
 * registry (lib/backgroundTaskRegistry.js), not one task per reload. The task is retired after
 * 10 minutes without events, or when the renderer says the application was closed.
 *
 * The drill-down joins the coordinator runs with the backend task journal (#325) by runId, so
 * each run shows the requests, reconciliations and AWS calls it caused, and a write run shows
 * what the action catalog (#329) declares it writes and invalidates.
 *
 * Privacy: opaque application ids, task keys, run ids, timings and counters only. Error
 * messages are not accepted. Nothing is persisted and nothing leaves this computer.
 */

const { ACTIONS } = require('./actionCatalog');

const IDLE_MS = 10 * 60 * 1000;
const WINDOW_MS = 15 * 60 * 1000;
const MAX_RUNS = 100;
const MAX_EVENTS_PER_BATCH = 500;
const APPLICATION_ID = /^[a-z0-9][a-z0-9_-]{0,59}$/i;
const KEY = /^[a-z0-9][a-z0-9._:-]{0,79}$/i;
const RUN_ID = /^[a-z0-9][a-z0-9-]{0,39}$/i;
const PART = /^[a-z0-9][a-z0-9._-]{0,39}$/i;
const EVENT_TYPES = new Set(['queued', 'started', 'deduplicated', 'coalesced', 'cancelled', 'stale', 'completed', 'failed']);
const KINDS = new Set(['read', 'write', 'cloud-read']);
// Outcomes a run can end with; `deduplicated` and `coalesced` are requests that did not run.
const FINAL = new Set(['completed', 'cancelled', 'stale', 'failed']);
const SLOW_FACTOR = 3;
const MIN_SAMPLES = 5;

function percentile(sorted, fraction) {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1)];
}

function cleanEvent(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const type = String(raw.type || '');
  const key = String(raw.key || '');
  const at = Date.parse(raw.at);
  if (!EVENT_TYPES.has(type) || !KEY.test(key) || !Number.isFinite(at)) return null;
  const event = { at, type, key };
  if (KINDS.has(raw.kind)) event.kind = raw.kind;
  if (raw.trigger === 'invalidation') event.trigger = 'invalidation';
  if (RUN_ID.test(String(raw.runId || ''))) event.runId = raw.runId;
  if (Number.isFinite(raw.durationMs) && raw.durationMs >= 0) event.durationMs = Math.round(raw.durationMs);
  if (Number.isInteger(raw.writes) && raw.writes > 0) event.writes = Math.min(raw.writes, 10000);
  for (const field of ['invalidates', 'parts']) {
    if (Array.isArray(raw[field])) event[field] = raw[field].map(String).filter(part => PART.test(part)).slice(0, 20);
  }
  return event;
}

function cleanCount(value) {
  return Number.isInteger(value) && value >= 0 ? Math.min(value, 10000) : 0;
}

function createCoordinatorTasks({ registry, journal = null, now = () => Date.now(), idleMs = IDLE_MS, windowMs = WINDOW_MS, maxRuns = MAX_RUNS } = {}) {
  if (!registry || typeof registry.register !== 'function') throw new TypeError('A background task registry is required');
  const coordinators = new Map();

  function taskId(applicationId) {
    return `kuapps.coordinator.${applicationId}`;
  }

  function open(applicationId) {
    let coordinator = coordinators.get(applicationId);
    if (coordinator) return coordinator;
    coordinator = {
      applicationId,
      runs: new Map(), // runId → run, oldest first
      requests: [], // { at, type } of deduplicated requests and coalesced writes, for the rates
      depths: [], // { at, queuedWrites }
      lastEventAt: now(),
      reading: 0,
      queuedWrites: 0,
      writing: false,
      batch: { total: 0, done: 0 },
      cancelRequested: false, // the state shown until the reads stop
      cancelPending: false, // delivered to the renderer once
      lastError: null,
      task: null,
    };
    coordinator.task = registry.register({
      id: taskId(applicationId),
      name: 'KUApps task coordinator',
      type: 'coordinator',
      provider: 'kua',
      controls: {
        cancel: {
          run: () => {
            coordinator.cancelRequested = true;
            coordinator.cancelPending = true;
            coordinator.task.update({ state: 'cancellation_requested' });
          },
          available: () => coordinator.reading > 0,
        },
      },
    });
    coordinators.set(applicationId, coordinator);
    return coordinator;
  }

  function close(applicationId) {
    const coordinator = coordinators.get(applicationId);
    if (!coordinator) return;
    coordinator.task.unregister();
    coordinators.delete(applicationId);
  }

  function prune(coordinator) {
    const from = now() - windowMs;
    while (coordinator.requests.length && coordinator.requests[0].at < from) coordinator.requests.shift();
    while (coordinator.depths.length && coordinator.depths[0].at < from) coordinator.depths.shift();
    while (coordinator.runs.size > maxRuns) coordinator.runs.delete(coordinator.runs.keys().next().value);
  }

  function apply(coordinator, event) {
    if (event.type === 'deduplicated' || event.type === 'coalesced') {
      coordinator.requests.push({ at: event.at, type: event.type, writes: event.writes || 0 });
      return;
    }
    if (!event.runId) return;
    let run = coordinator.runs.get(event.runId);
    if (!run) {
      run = { runId: event.runId, key: event.key, kind: event.kind || 'read', trigger: 'user', queuedAt: event.at, startedAt: null, finishedAt: null, outcome: 'queued', durationMs: null, invalidates: [] };
      coordinator.runs.set(event.runId, run);
    }
    if (event.kind) run.kind = event.kind;
    if (event.invalidates) run.invalidates = event.invalidates;
    if (event.trigger) run.trigger = event.trigger;
    if (event.type === 'started') { run.startedAt = event.at; run.outcome = 'running'; }
    if (event.type === 'queued' && run.kind === 'write') coordinator.batch.total += 1;
    if (FINAL.has(event.type)) {
      run.finishedAt = event.at;
      run.outcome = event.type;
      if (event.durationMs != null) run.durationMs = event.durationMs;
      if (run.kind === 'write') coordinator.batch.done += 1;
      if (event.type === 'failed') coordinator.lastError = 'task_failed';
      if (event.type === 'completed') coordinator.lastError = null;
    }
  }

  function refreshTask(coordinator) {
    const { reading, queuedWrites, writing, batch } = coordinator;
    const busy = reading > 0 || queuedWrites > 0 || writing;
    if (!busy) {
      coordinator.batch = { total: 0, done: 0 };
      coordinator.cancelRequested = false;
    }
    const last = [...coordinator.runs.values()].reverse().find(run => run.finishedAt);
    coordinator.task.update({
      state: coordinator.cancelRequested && busy ? 'cancellation_requested' : busy ? 'running' : 'idle',
      startedAt: busy ? new Date(Math.min(...[...coordinator.runs.values()].filter(run => run.outcome === 'running' || run.outcome === 'queued').map(run => run.queuedAt), now())).toISOString() : null,
      lastRunAt: last ? new Date(last.startedAt || last.queuedAt).toISOString() : null,
      lastFinishedAt: last ? new Date(last.finishedAt).toISOString() : null,
      lastRunStatus: last ? last.outcome : null,
      progress: busy && batch.total ? batch.done / batch.total : null,
      errorCode: coordinator.lastError,
      // Plain counts; the panel words them in the user's language.
      summary: { reading, queuedWrites, writing: writing ? 1 : 0 },
    });
  }

  /**
   * One batch from the renderer: { applicationId, events, state: { reading, queuedWrites, writing }, closed }.
   * Returns { cancel } so the renderer aborts its reads after a cancel from the panel.
   */
  function ingest(body = {}) {
    const applicationId = String(body.applicationId || '');
    if (!APPLICATION_ID.test(applicationId)) throw Object.assign(new Error('Invalid application id'), { statusCode: 400, code: 'INVALID_APPLICATION' });
    if (body.closed === true) {
      close(applicationId);
      return { cancel: false };
    }
    const events = (Array.isArray(body.events) ? body.events.slice(0, MAX_EVENTS_PER_BATCH) : []).map(cleanEvent).filter(Boolean);
    const coordinator = open(applicationId);
    const state = body.state && typeof body.state === 'object' ? body.state : {};
    for (const event of events) apply(coordinator, event);
    coordinator.reading = cleanCount(state.reading);
    coordinator.queuedWrites = cleanCount(state.queuedWrites);
    coordinator.writing = state.writing === true;
    coordinator.depths.push({ at: now(), queuedWrites: coordinator.queuedWrites + (coordinator.writing ? 1 : 0) });
    coordinator.lastEventAt = now();
    const cancel = coordinator.cancelPending;
    coordinator.cancelPending = false;
    prune(coordinator);
    refreshTask(coordinator);
    return { cancel };
  }

  /** Retires the coordinators without events for idleMs; the panel never grows without limit. */
  function sweep() {
    const limit = now() - idleMs;
    for (const coordinator of [...coordinators.values()]) {
      if (coordinator.lastEventAt < limit) close(coordinator.applicationId);
    }
  }

  function journalByRun(applicationId) {
    if (!journal) return new Map();
    const byRun = new Map();
    for (const entry of journal.list({ applicationId, since: now() - windowMs }).entries) {
      if (!entry.runId) continue;
      const totals = byRun.get(entry.runId) || { requests: 0, reconciles: 0, awsCalls: 0 };
      totals.requests += 1;
      totals.reconciles += entry.reconciles;
      totals.awsCalls += entry.awsCalls;
      byRun.set(entry.runId, totals);
    }
    return byRun;
  }

  /** The drill-down of one application: its last runs, with journal counters, and 15-minute metrics. */
  function detail(applicationId) {
    const coordinator = coordinators.get(String(applicationId || ''));
    if (!coordinator) return null;
    prune(coordinator);
    const from = now() - windowMs;
    const work = journalByRun(coordinator.applicationId);
    const runs = [...coordinator.runs.values()];
    const durationsByKey = new Map();
    for (const run of runs) {
      if (run.outcome !== 'completed' || run.durationMs == null || run.queuedAt < from) continue;
      if (!durationsByKey.has(run.key)) durationsByKey.set(run.key, []);
      durationsByKey.get(run.key).push(run.durationMs);
    }
    const byKey = [...durationsByKey].map(([key, durations]) => {
      const sorted = durations.sort((left, right) => left - right);
      return { key, runs: sorted.length, p50Ms: percentile(sorted, 0.5), p95Ms: percentile(sorted, 0.95) };
    }).sort((left, right) => right.runs - left.runs || left.key.localeCompare(right.key));
    // A run is slow against the p95 of the other runs of its key, so it never hides itself.
    const p95Without = run => {
      const others = runs.filter(other => other !== run && other.key === run.key && other.outcome === 'completed' && other.durationMs != null)
        .map(other => other.durationMs).sort((left, right) => left - right);
      return others.length >= MIN_SAMPLES ? percentile(others, 0.95) : null;
    };

    // Two failures in a row of the same key flag the second one.
    const lastOutcome = new Map();
    const views = runs.map(run => {
      const flags = [];
      const p95 = run.durationMs != null ? p95Without(run) : null;
      if (p95 != null && run.durationMs > SLOW_FACTOR * p95) flags.push('slow');
      if (run.outcome === 'failed' && lastOutcome.get(run.key) === 'failed') flags.push('repeated-failure');
      if (FINAL.has(run.outcome)) lastOutcome.set(run.key, run.outcome);
      const action = run.kind === 'write' ? ACTIONS[run.key] : null;
      return {
        runId: run.runId,
        key: run.key,
        kind: run.kind,
        trigger: run.trigger,
        outcome: run.outcome,
        queuedAt: new Date(run.queuedAt).toISOString(),
        durationMs: run.durationMs,
        ...(work.get(run.runId) || { requests: 0, reconciles: 0, awsCalls: 0 }),
        ...(action ? { stores: action.stores, revision: action.revision } : {}),
        invalidates: run.invalidates,
        flags,
      };
    }).reverse();

    const recent = runs.filter(run => run.queuedAt >= from);
    const requests = coordinator.requests.filter(request => request.at >= from);
    const deduplicated = requests.filter(request => request.type === 'deduplicated').length;
    const coalescedWrites = requests.filter(request => request.type === 'coalesced').reduce((sum, request) => sum + request.writes, 0);
    const writes = recent.filter(run => run.kind === 'write');
    const writeWork = writes.map(run => work.get(run.runId) || { reconciles: 0 });
    const untracked = journal ? journal.list({ applicationId: coordinator.applicationId, since: from }).summary.untracked : null;
    return {
      applicationId: coordinator.applicationId,
      taskId: taskId(coordinator.applicationId),
      windowMinutes: Math.round(windowMs / 60000),
      runs: views,
      metrics: {
        requested: recent.length + deduplicated,
        executed: recent.filter(run => run.startedAt != null).length,
        deduplicated,
        cancelled: recent.filter(run => run.outcome === 'cancelled' || run.outcome === 'stale').length,
        failed: recent.filter(run => run.outcome === 'failed').length,
        // Writes whose reloads were merged into one: N writes, one reload.
        coalescedWrites,
        maxQueueDepth: Math.max(0, ...coordinator.depths.map(depth => depth.queuedWrites)),
        reconcilesPerWrite: writes.length ? Math.round(writeWork.reduce((sum, item) => sum + item.reconciles, 0) / writes.length * 100) / 100 : null,
        awsCalls: recent.reduce((sum, run) => sum + (work.get(run.runId)?.awsCalls || 0), 0),
        untracked,
        byKey,
      },
    };
  }

  let timer = null;
  function start(intervalMs = 60 * 1000) {
    if (timer) return;
    timer = setInterval(sweep, intervalMs);
    timer.unref?.();
  }
  function stop() {
    clearInterval(timer);
    timer = null;
  }

  return { ingest, detail, sweep, start, stop, taskId };
}

module.exports = { createCoordinatorTasks, IDLE_MS, WINDOW_MS };
