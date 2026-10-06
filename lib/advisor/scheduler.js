'use strict';
/**
 * lib/advisor/scheduler.js
 * Scheduled Advisor analysis (Pro: every 6 h at most, Team: every hour), so
 * the posture history and its alerts (lib/advisor/posture.js) keep moving
 * while nobody has the overview open.
 *
 * A scheduled run calls the same KUA route the overview calls, on this
 * computer (loopback), so it records exactly what an interactive scan would:
 * same checks, same acceptances, no alert flapping between the two.
 *
 *   aws:<profileId>:<region>           GET /api/cloud/aws/overview/advisor?refresh=1   free control-plane APIs
 *   gcp:<profileId>:<projectId>        GET /api/cloud/gcp/overview?force=1            ~20 list calls; Storage and
 *                                                                                      Secret Manager lists are billed
 *                                                                                      (fractions of a cent)
 *   kubernetes:<context>:<namespace>   GET /api/overview?namespace=                   the cluster; only while that
 *                                                                                      context is the active one
 *   product:<applicationId>            GET /api/architecture/applications/:id/advisor no cloud call
 */

const { getPlan, checkAdvisorScanHours } = require('../plans');

const HOUR_MS = 60 * 60 * 1000;
const TICK_MS = 5 * 60 * 1000;
const FIRST_TICK_MS = 60 * 1000;

/** History scope key → what to call. Ids and contexts may contain ':' (local:prod, EKS ARNs). */
function parseScope(scope = '') {
  const [kind, ...rest] = String(scope).split(':');
  if (kind === 'product') return rest.length ? { kind, applicationId: rest.join(':') } : null;
  if (rest.length < 2) return null;
  const tail = rest.pop();
  const head = rest.join(':');
  if (!head) return null;
  if (kind === 'aws') return { kind, profileId: head, region: tail };
  if (kind === 'gcp') return { kind, profileId: head, projectId: tail };
  if (kind === 'kubernetes') return { kind, context: head, namespace: tail || 'all' };
  return null;
}

class ScheduleStore {
  /** @param {import('better-sqlite3').Database} db  the APM database (migration 20) */
  constructor(db, { now = () => Date.now() } = {}) {
    this.now = now;
    this.st = {
      all: db.prepare('SELECT * FROM kua_advisor_schedules ORDER BY created_at'),
      get: db.prepare('SELECT * FROM kua_advisor_schedules WHERE scope_key = ?'),
      upsert: db.prepare(`INSERT INTO kua_advisor_schedules (scope_key, interval_hours, created_at) VALUES (?, ?, ?)
        ON CONFLICT(scope_key) DO UPDATE SET interval_hours = excluded.interval_hours`),
      remove: db.prepare('DELETE FROM kua_advisor_schedules WHERE scope_key = ?'),
      ran: db.prepare('UPDATE kua_advisor_schedules SET last_run_at = ?, last_status = ?, last_error = ? WHERE scope_key = ?'),
      status: db.prepare('UPDATE kua_advisor_schedules SET last_status = ?, last_error = ? WHERE scope_key = ?'),
    };
  }

  _row(row) {
    if (!row) return null;
    const next = row.last_run_at ? row.last_run_at + row.interval_hours * HOUR_MS : null;
    return {
      scope: row.scope_key,
      intervalHours: row.interval_hours,
      lastRunAt: row.last_run_at ? new Date(row.last_run_at).toISOString() : null,
      nextRunAt: next ? new Date(next).toISOString() : null,
      lastStatus: row.last_status || null,
      lastError: row.last_error || null,
    };
  }

  list() { return this.st.all.all().map(row => this._row(row)); }
  get(scope) { return this._row(this.st.get.get(scope)); }

  set(scope, intervalHours) {
    if (!parseScope(scope)) throw Object.assign(new Error('A valid Advisor scope is required'), { statusCode: 400 });
    this.st.upsert.run(scope, intervalHours, this.now());
    return this.get(scope);
  }

  remove(scope) { return this.st.remove.run(scope).changes > 0; }
  ran(scope, status, error = null) { this.st.ran.run(this.now(), status, error, scope); }
  // A run that did not happen (KUA not on that context): keep the due time.
  skipped(scope, reason) { this.st.status.run('skipped', reason, scope); }
}

/**
 * @param options.schedules  ScheduleStore
 * @param options.request    (path, headers) => Promise — a request to this KUA (loopback)
 * @param options.application id => { profileId } | null (KUApps applications)
 * @param options.currentContext () => the active Kubernetes context
 */
function createAdvisorScheduler({ schedules, request, application = () => null, currentContext = () => null, plan = getPlan, now = () => Date.now(), log = console, task = null } = {}) {
  let timer = null;
  let firstTimer = null;
  let running = null;

  /** The call that analyses a scope, or why it cannot run now. */
  function callFor(scope) {
    const target = parseScope(scope);
    if (!target) return { skip: 'unknown scope' };
    if (target.kind === 'aws') return { path: '/api/cloud/aws/overview/advisor?refresh=1', headers: { 'X-Profile-Id': target.profileId } };
    if (target.kind === 'gcp') return { path: '/api/cloud/gcp/overview?force=1', headers: { 'X-Profile-Id': target.profileId } };
    if (target.kind === 'kubernetes') {
      if (currentContext() !== target.context) return { skip: 'context not active' };
      return { path: `/api/overview?namespace=${encodeURIComponent(target.namespace)}`, headers: {} };
    }
    const app = application(target.applicationId);
    if (!app) return { skip: 'application not found' };
    return { path: `/api/architecture/applications/${encodeURIComponent(target.applicationId)}/advisor`, headers: { 'X-Profile-Id': app.profileId } };
  }

  /** Runs the schedules that are due, one at a time. */
  async function tick() {
    if (running) return running;
    running = (async () => {
      const current = plan();
      if (!current.features.advisor) return [];
      const ran = [];
      for (const schedule of schedules.list()) {
        // A plan that lowered its limit stretches the interval instead of breaking it.
        const hours = Math.max(schedule.intervalHours, current.limits.advisorScanMinHours || schedule.intervalHours);
        const last = schedule.lastRunAt ? Date.parse(schedule.lastRunAt) : 0;
        if (last && now() - last < hours * HOUR_MS) continue;
        const call = callFor(schedule.scope);
        if (call.skip) { schedules.skipped(schedule.scope, call.skip); continue; }
        try {
          const body = await request(call.path, call.headers);
          const advisor = body?.advisor !== undefined ? body.advisor : body;
          if (advisor?.error) schedules.ran(schedule.scope, 'error', String(advisor.error).slice(0, 500));
          else schedules.ran(schedule.scope, 'ok');
          ran.push(schedule.scope);
        } catch (err) {
          schedules.ran(schedule.scope, 'error', String(err.message || err).slice(0, 500));
          log.warn?.(`[advisor] scheduled analysis of ${schedule.scope}: ${err.message}`);
        }
      }
      return ran;
    })().finally(() => { running = null; });
    return running;
  }

  return {
    tick,
    callFor,
    /** Validates the interval for the plan and stores it. */
    set: (scope, intervalHours) => schedules.set(scope, checkAdvisorScanHours(intervalHours, plan())),
    remove: scope => schedules.remove(scope),
    list: () => schedules.list(),
    get: scope => schedules.get(scope),
    start({ task: runTask = task } = {}) {
      if (timer) return;
      const run = () => (runTask ? runTask.run(() => tick()) : tick()).catch(() => {});
      firstTimer = setTimeout(run, FIRST_TICK_MS);
      timer = setInterval(run, TICK_MS);
      firstTimer.unref?.();
      timer.unref?.();
    },
    stop() { clearTimeout(firstTimer); clearInterval(timer); timer = null; firstTimer = null; },
  };
}

/** request() against this KUA on the loopback address. */
function loopbackRequest(port, { fetchImpl = globalThis.fetch, timeoutMs = 120000 } = {}) {
  return async (path, headers = {}) => {
    const response = await fetchImpl(`http://127.0.0.1:${port}${path}`, { headers: { Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(timeoutMs) });
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    if (!response.ok) throw new Error(body?.error || `KUA answered ${response.status}`);
    return body;
  };
}

module.exports = { createAdvisorScheduler, ScheduleStore, loopbackRequest, parseScope, TICK_MS };
