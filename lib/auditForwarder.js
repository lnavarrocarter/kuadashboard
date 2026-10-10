'use strict';
/**
 * lib/auditForwarder.js
 * Sends a copy of every audit entry to an external destination the company
 * controls (a SIEM or log collector HTTPS endpoint), so the record does not live
 * only on this computer. Part of the Team plan (lib/plans.js auditForwarding).
 *
 * - POST of a JSON array of entries, with an optional bearer token. The token
 *   is stored encrypted (lib/crypto.js) and never returned to the UI.
 * - Only HTTPS, except http://localhost and 127.0.0.1 for a local collector.
 * - Batches every 5 s (or 50 entries); a failure keeps the queue and retries
 *   with backoff up to 5 minutes. The queue holds 5000 entries; older ones are
 *   dropped and counted, never silently.
 */

const MAX_QUEUE = 5000;
const BATCH = 50;
const TICK_MS = 5000;
const MAX_BACKOFF_MS = 5 * 60 * 1000;
const TIMEOUT_MS = 10000;

function validUrl(raw) {
  let url;
  try { url = new URL(String(raw || '')); } catch { return false; }
  if (url.username || url.password) return false;
  if (url.protocol === 'https:') return true;
  return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
}

function createAuditForwarder({
  settings,                 // { get(): forward | null, save(forward) }
  plan = () => require('./plans').getPlan(),
  secrets = {
    encrypt: value => require('./crypto').encrypt(value, require('./credentialStore').resolvePassphrase()),
    decrypt: value => require('./crypto').decrypt(value, require('./credentialStore').resolvePassphrase()),
  },
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
  timers = { setInterval, clearInterval },
}) {
  let queue = [];
  let dropped = 0;
  let failures = 0;
  let nextAttemptAt = 0;
  let sending = false;
  let lastSuccessAt = null;
  let lastError = null;
  let timer = null;

  const config = () => settings.get() || { enabled: false, url: '', token: null };
  const allowed = () => !!plan().features.auditForwarding;
  const active = () => config().enabled && allowed() && validUrl(config().url);

  function status() {
    const { enabled, url, token } = config();
    return { enabled: !!enabled, url: url || '', hasToken: !!token, allowed: allowed(), pending: queue.length, dropped, lastSuccessAt, lastError };
  }

  /** { enabled, url, token? } — a token of '' removes it, undefined keeps it. */
  function configure({ enabled, url, token } = {}) {
    const current = config();
    const next = { ...current };
    if (url !== undefined) {
      if (url && !validUrl(url)) throw Object.assign(new Error('The destination must be an HTTPS URL without credentials (http is accepted only for localhost)'), { statusCode: 400 });
      next.url = String(url || '');
    }
    if (token !== undefined) next.token = token ? secrets.encrypt(String(token)) : null;
    if (enabled !== undefined) {
      if (enabled && !allowed()) {
        const { planError } = require('./plans');
        throw Object.assign(planError('Forwarding the audit log to an external destination is part of the Team plan', 'team'), { feature: 'auditForwarding' });
      }
      if (enabled && !next.url) throw Object.assign(new Error('Set the destination URL first'), { statusCode: 400 });
      next.enabled = !!enabled;
    }
    settings.save(next);
    if (!next.enabled) queue = [];
    return status();
  }

  function enqueue(entry) {
    if (!active()) return;
    queue.push(entry);
    if (queue.length > MAX_QUEUE) {
      dropped += queue.length - MAX_QUEUE;
      queue = queue.slice(-MAX_QUEUE);
    }
  }

  async function post(entries) {
    const { url, token } = config();
    const headers = { 'Content-Type': 'application/json', 'X-KUA-Source': 'kuadashboard' };
    if (token) headers.Authorization = `Bearer ${secrets.decrypt(token)}`;
    const response = await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(entries), signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) throw new Error(`The destination answered HTTP ${response.status}`);
  }

  /** Sends one batch when due. Returns the number of entries sent. */
  async function flush({ force = false } = {}) {
    if (sending || !queue.length || !active()) return 0;
    if (!force && now() < nextAttemptAt) return 0;
    sending = true;
    const batch = queue.slice(0, BATCH);
    try {
      await post(batch);
      queue = queue.slice(batch.length);
      failures = 0;
      nextAttemptAt = 0;
      lastSuccessAt = new Date(now()).toISOString();
      lastError = null;
      return batch.length;
    } catch (err) {
      failures += 1;
      nextAttemptAt = now() + Math.min(MAX_BACKOFF_MS, 5000 * 2 ** (failures - 1));
      lastError = String(err.message || err).slice(0, 300);
      return 0;
    } finally {
      sending = false;
    }
  }

  /** Sends a test event (not written to the audit log) to check URL and token. */
  async function test() {
    if (!validUrl(config().url)) throw Object.assign(new Error('Set a valid destination URL first'), { statusCode: 400 });
    await post([{ id: 'kua-test', timestamp: new Date(now()).toISOString(), level: 'info', category: 'system', action: 'audit.forwarding.test', resource: '', details: {}, context: '' }]);
    return { ok: true };
  }

  function start() {
    if (timer) return;
    timer = timers.setInterval(() => { flush().catch(() => {}); }, TICK_MS);
    timer.unref?.();
  }

  function stop() {
    if (timer) timers.clearInterval(timer);
    timer = null;
  }

  return { status, configure, enqueue, flush, test, start, stop };
}

module.exports = { createAuditForwarder, validUrl };
