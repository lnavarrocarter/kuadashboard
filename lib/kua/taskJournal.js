'use strict';
/**
 * lib/kua/taskJournal.js
 * What each KUApps request costs (#325): a bounded in-memory journal of the
 * Observability and KUApps API requests, with the task that asked for them
 * (X-KUA-Task: <key>;<runId>, sent by the UI) and the work they did inside the
 * backend: registry reconciliations, AWS SDK calls, log history reads and
 * topology analyses. It is the baseline for the task coordinator (#326) and
 * the source of its view in the background task manager (#330).
 *
 * Attribution follows lib/usage/awsMeter.js: an AsyncLocalStorage context per
 * request, inherited by the work it starts. countTaskWork() is a no-op outside
 * a journaled request, so call sites never need to know whether one is open.
 *
 * Privacy: only route patterns, opaque application ids, task keys, timings and
 * counters. Never ARNs, resource or profile names, query strings or bodies.
 * Nothing is persisted and nothing leaves this computer.
 */

const { AsyncLocalStorage } = require('node:async_hooks');

const DEFAULT_CAPACITY = 500;
const UNTRACKED = 'untracked';
const TASK_KEY = /^[a-z0-9][a-z0-9._:-]{0,79}$/i;
const RUN_ID = /^[a-z0-9][a-z0-9-]{0,39}$/i;
const COUNTERS = ['reconciles', 'awsCalls', 'logHistoryReads', 'topologyAnalyses', 'topologyAnalysisMs'];
// Path segments that follow these names are ids, and are replaced when Express
// did not report the matched route pattern.
const ID_AFTER = new Set(['applications', 'edges', 'relationships', 'resources', 'scopes', 'views', 'changes',
  'items', 'backups', 'cloud-backups', 'members', 'sync', 'metrics']);

const context = new AsyncLocalStorage();

/** X-KUA-Task header → { task, runId }; anything malformed is untracked. */
function parseTaskHeader(value) {
  const [key = '', runId = ''] = String(value || '').split(';').map(part => part.trim());
  if (!TASK_KEY.test(key)) return { task: UNTRACKED, runId: null };
  return { task: key, runId: RUN_ID.test(runId) ? runId : null };
}

function normalizePath(pathname = '') {
  const segments = String(pathname).split('?')[0].split('/');
  return segments.map((segment, index) => (index > 0 && ID_AFTER.has(segments[index - 1]) && segment ? ':id' : segment)).join('/');
}

function applicationIdFrom(req) {
  const fromParams = req.params?.applicationId;
  if (typeof fromParams === 'string' && fromParams) return fromParams.slice(0, 80);
  const match = /\/applications\/([^/?]+)/.exec(req.originalUrl || '');
  return match ? decodeURIComponent(match[1]).slice(0, 80) : null;
}

function percentile(sorted, fraction) {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1)];
}

/** Adds to a counter of the request being journaled, if any. */
function countTaskWork(counter, amount = 1) {
  const store = context.getStore();
  if (!store || !COUNTERS.includes(counter) || !Number.isFinite(amount)) return;
  store.counters[counter] += amount;
}

/** Runs a synchronous step and adds its duration in ms to the given counter. */
function timeTaskWork(counter, fn) {
  if (!context.getStore()) return fn();
  const startedAt = performance.now();
  try {
    return fn();
  } finally {
    countTaskWork(counter, Math.round(performance.now() - startedAt));
  }
}

function createTaskJournal({ capacity = DEFAULT_CAPACITY, now = () => Date.now() } = {}) {
  const size = Math.max(1, Math.floor(capacity));
  const entries = [];
  let sequence = 0;

  function record(entry) {
    entries.push(entry);
    if (entries.length > size) entries.shift();
  }

  /** Express middleware: journals every request below the path it is mounted on. */
  function middleware(req, res, next) {
    const startedAt = now();
    const started = performance.now();
    const { task, runId } = parseTaskHeader(req.get('X-KUA-Task'));
    const store = { counters: Object.fromEntries(COUNTERS.map(counter => [counter, 0])) };
    let done = false;
    const finish = aborted => {
      if (done) return;
      done = true;
      record({
        seq: ++sequence,
        at: new Date(startedAt).toISOString(),
        durationMs: Math.round(performance.now() - started),
        method: req.method,
        route: req.route?.path ? `${req.baseUrl}${req.route.path}` : normalizePath(`${req.baseUrl}${req.path}`),
        status: aborted ? null : res.statusCode,
        aborted,
        applicationId: applicationIdFrom(req),
        task,
        runId,
        ...store.counters,
      });
    };
    res.once('finish', () => finish(false));
    res.once('close', () => finish(!res.writableFinished));
    context.run(store, next);
  }

  /**
   * Entries (oldest first) plus a summary per task key and per route.
   * @param filter.applicationId only that application's requests
   * @param filter.since ISO date or epoch ms: only requests started after it
   * @param filter.limit at most this many of the newest entries (default and max: capacity)
   */
  function list({ applicationId = null, since = null, limit = size } = {}) {
    const sinceMs = since == null || since === '' ? null : (Number.isFinite(Number(since)) ? Number(since) : Date.parse(since));
    const max = Math.max(1, Math.min(size, Number.parseInt(limit, 10) || size));
    const selected = entries.filter(entry => (!applicationId || entry.applicationId === applicationId)
      && (sinceMs == null || Number.isNaN(sinceMs) || Date.parse(entry.at) > sinceMs)).slice(-max);
    return {
      generatedAt: new Date(now()).toISOString(),
      capacity: size,
      entries: selected,
      summary: {
        requests: selected.length,
        untracked: selected.filter(entry => entry.task === UNTRACKED).length,
        ...Object.fromEntries(COUNTERS.map(counter => [counter, selected.reduce((sum, entry) => sum + entry[counter], 0)])),
        byTask: summarize(selected, entry => entry.task),
        byRoute: summarize(selected, entry => `${entry.method} ${entry.route}`),
      },
    };
  }

  function clear() {
    entries.length = 0;
  }

  return { middleware, list, clear };
}

function summarize(entries, keyOf) {
  const groups = new Map();
  for (const entry of entries) {
    const key = keyOf(entry);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }
  return [...groups].map(([key, group]) => {
    const durations = group.map(entry => entry.durationMs).sort((left, right) => left - right);
    return {
      key,
      requests: group.length,
      p50Ms: percentile(durations, 0.5),
      p95Ms: percentile(durations, 0.95),
      maxMs: durations.at(-1),
      ...Object.fromEntries(COUNTERS.map(counter => [counter, group.reduce((sum, entry) => sum + entry[counter], 0)])),
    };
  }).sort((left, right) => right.requests - left.requests || left.key.localeCompare(right.key));
}

module.exports = { createTaskJournal, countTaskWork, timeTaskWork, parseTaskHeader, normalizePath, UNTRACKED, COUNTERS };
