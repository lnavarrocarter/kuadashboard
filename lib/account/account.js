'use strict';
/**
 * lib/account/account.js
 * Links KUA Desktop to a KUA account (control plane, private repo lnavarrocarter/kua-control-plane):
 *
 *   sign-in   the system browser opens /auth/desktop/start; Google returns
 *             to the control plane, which sends a one-time code to this
 *             KUA (http://127.0.0.1:<port>/api/account/callback). The code
 *             and its PKCE verifier are exchanged for a session token.
 *   token     kept in the OS keychain (an encrypted file when there is none),
 *             never sent to the UI.
 *   plan      the account entitlements, cached in <data dir>/account.json so
 *             KUA keeps the plan offline for 7 days; refreshed every 6 hours.
 *   billing   checkout and portal URLs to open in the browser.
 *
 * Profiles, keys, kubeconfigs and logs never go to the control plane.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DEFAULT_CONTROL_PLANE_URL = 'https://api.kuadashboard.navarrocarter.com';
const PENDING_LOGIN_MS = 10 * 60 * 1000;
const OFFLINE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
const REFRESH_EVERY_MS = 6 * 60 * 60 * 1000;
const KEYRING_SERVICE = 'kuadashboard';
const KEYRING_ACCOUNT = 'kua-account-session';

function resolveDataDir() {
  return process.env.KUA_DATA_DIR || path.join(os.homedir(), '.kuadashboard');
}

/** Session token storage: OS keychain, or a file encrypted with the KUA passphrase. */
function createSecretStore({ dataDir, fileSystem = fs } = {}) {
  const file = path.join(dataDir, 'account.session');
  function keychain() {
    try {
      const { Entry } = require('@napi-rs/keyring');
      return new Entry(KEYRING_SERVICE, KEYRING_ACCOUNT);
    } catch { return null; }
  }
  return {
    get() {
      const entry = keychain();
      try { const value = entry?.getPassword(); if (value) return value; } catch { /* fall back */ }
      if (!fileSystem.existsSync(file)) return null;
      const { decrypt } = require('../crypto');
      const { resolvePassphrase } = require('../credentialStore');
      try { return decrypt(fileSystem.readFileSync(file, 'utf8'), resolvePassphrase()); } catch { return null; }
    },
    set(token) {
      const entry = keychain();
      try {
        entry.setPassword(token);
        if (entry.getPassword() === token) return 'keychain';
      } catch { /* fall back to the encrypted file */ }
      const { encrypt } = require('../crypto');
      const { resolvePassphrase } = require('../credentialStore');
      fileSystem.mkdirSync(dataDir, { recursive: true });
      fileSystem.writeFileSync(file, encrypt(token, resolvePassphrase()), { mode: 0o600 });
      return 'file';
    },
    clear() {
      try { keychain()?.deletePassword(); } catch { /* not stored there */ }
      try { fileSystem.rmSync(file, { force: true }); } catch { /* nothing to remove */ }
    },
  };
}

const CLIENT_ERRORS = new Set([400, 403, 404, 409, 413]);

class AccountError extends Error {
  constructor(message, statusCode = 400, code) { super(message); this.statusCode = statusCode; this.code = code; }
}

/**
 * @param options.fetchImpl   fetch (injectable for tests)
 * @param options.secretStore { get, set, clear }
 */
function createAccount({
  dataDir = resolveDataDir(),
  controlPlaneUrl = process.env.KUA_CONTROL_PLANE_URL || DEFAULT_CONTROL_PLANE_URL,
  fetchImpl = globalThis.fetch,
  secretStore = createSecretStore({ dataDir }),
  fileSystem = fs,
  now = () => Date.now(),
  log = console,
} = {}) {
  const base = controlPlaneUrl.replace(/\/$/, '');
  const cacheFile = path.join(dataDir, 'account.json');
  // Sign-ins in progress (state → { verifier, createdAt }). Kept on disk too, so a
  // KUA restart while the user is in the browser (an update, nodemon in development)
  // does not lose them. They last 10 minutes and are used once.
  const pendingFile = path.join(dataDir, 'account.pending.json');
  const pending = new Map(Object.entries(readPending()));

  function readPending() {
    try { return JSON.parse(fileSystem.readFileSync(pendingFile, 'utf8')) || {}; } catch { return {}; }
  }

  function savePending() {
    for (const [key, value] of pending) if (now() - value.createdAt > PENDING_LOGIN_MS) pending.delete(key);
    try {
      if (!pending.size) { fileSystem.rmSync(pendingFile, { force: true }); return; }
      fileSystem.mkdirSync(dataDir, { recursive: true });
      fileSystem.writeFileSync(pendingFile, JSON.stringify(Object.fromEntries(pending)), { mode: 0o600 });
    } catch (err) { log.warn?.('[account] pending sign-ins:', err.message); }
  }
  let timer = null;

  function readCache() {
    try { return JSON.parse(fileSystem.readFileSync(cacheFile, 'utf8')); } catch { return null; }
  }
  let cache = readCache();

  function writeCache(next) {
    cache = next;
    if (!next) { try { fileSystem.rmSync(cacheFile, { force: true }); } catch { /* nothing cached */ } return; }
    fileSystem.mkdirSync(dataDir, { recursive: true });
    fileSystem.writeFileSync(cacheFile, JSON.stringify(next, null, 2));
  }

  async function call(pathname, { method = 'GET', body, token, timeoutMs = 20000 } = {}) {
    let response;
    try {
      response = await fetchImpl(`${base}${pathname}`, {
        method,
        headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new AccountError(`The KUA account service is not reachable (${err.cause?.code || err.name}).`, 502, 'OFFLINE');
    }
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    if (!response.ok) {
      const message = data?.error || `KUA account service answered ${response.status}`;
      if (response.status === 401) throw new AccountError(message, 401, 'SIGNED_OUT');
      // Answers about the request itself (plan, quota, validation, not found) keep their status and code.
      if (CLIENT_ERRORS.has(response.status)) throw new AccountError(message, response.status, data?.code);
      throw new AccountError(message, 502, data?.code);
    }
    return data;
  }

  function requireToken() {
    const token = secretStore.get();
    if (!token) throw new AccountError('Sign in to your KUA account first.', 401, 'SIGNED_OUT');
    return token;
  }

  // Plans granted without payment; the control plane only answers administrators.
  const admin = {
    accounts: async (email = '') => call(`/api/admin/accounts${email ? `?${new URLSearchParams({ email })}` : ''}`, { token: requireToken() }),
    grant: async (userId, body) => call(`/api/admin/accounts/${encodeURIComponent(userId)}/grant`, { method: 'PUT', token: requireToken(), body }),
    revoke: async userId => call(`/api/admin/accounts/${encodeURIComponent(userId)}/grant`, { method: 'DELETE', token: requireToken() }),
  };

  // Cloud backups of sanitized KUAAppBundle documents (Pro and Team plans).
  const backups = {
    list: async () => call('/api/backups', { token: requireToken() }),
    create: async bundle => call('/api/backups', { method: 'POST', token: requireToken(), body: bundle, timeoutMs: 60000 }),
    download: async id => call(`/api/backups/${encodeURIComponent(id)}`, { token: requireToken(), timeoutMs: 60000 }),
    remove: async id => call(`/api/backups/${encodeURIComponent(id)}`, { method: 'DELETE', token: requireToken() }),
  };

  /** Browser URL that starts the sign-in; callbackUrl is this KUA's /api/account/callback. */
  function startLogin({ callbackUrl }) {
    const verifier = crypto.randomBytes(48).toString('base64url');
    const state = crypto.randomBytes(24).toString('base64url');
    pending.set(state, { verifier, createdAt: now() });
    savePending();
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const url = `${base}/auth/desktop/start?${new URLSearchParams({ redirect_uri: callbackUrl, code_challenge: challenge, state })}`;
    return { url, state };
  }

  /** Exchanges the one-time code that came back to the callback. */
  async function completeLogin({ code, state }) {
    // Another process may have started it (the file is the source of truth across restarts).
    for (const [key, value] of Object.entries(readPending())) if (!pending.has(key)) pending.set(key, value);
    const login = pending.get(String(state || ''));
    pending.delete(String(state || ''));
    savePending();
    if (!login || now() - login.createdAt > PENDING_LOGIN_MS) throw new AccountError('This sign-in expired or was not started in this KUA. Start it again from Help & Options → Account.');
    const result = await call('/auth/desktop/token', { method: 'POST', body: { code, code_verifier: login.verifier } });
    const store = secretStore.set(result.token);
    writeCache({ user: result.user, entitlements: result.entitlements, admin: result.admin === true, fetchedAt: now(), sessionExpiresAt: result.expiresAt, tokenStore: store });
    return status();
  }

  /** Reads the account again (plan changes after checkout or in the portal). */
  async function refresh() {
    const token = secretStore.get();
    if (!token) { writeCache(null); return status(); }
    try {
      const me = await call('/api/me', { token });
      writeCache({ ...(cache || {}), user: me.user, entitlements: me.entitlements, admin: me.admin === true, fetchedAt: now() });
    } catch (err) {
      if (err.code === 'SIGNED_OUT') { secretStore.clear(); writeCache(null); }
      else throw err;
    }
    return status();
  }

  async function logout() {
    const token = secretStore.get();
    if (token) { try { await call('/auth/logout', { method: 'POST', token }); } catch (err) { log.warn?.('[account] logout:', err.message); } }
    secretStore.clear();
    writeCache(null);
    return status();
  }

  async function billing(kind, body = {}) {
    const token = requireToken();
    const pathname = kind === 'checkout' ? '/api/billing/checkout' : '/api/billing/portal';
    const result = await call(pathname, { method: 'POST', token, body: { ...body, client: 'desktop' } });
    return { url: result.url, provider: result.provider || null };
  }

  /** Plan name from the account while the cached entitlements are fresh enough (7 days offline). */
  function cachedPlan() {
    if (!cache?.entitlements?.plan || !cache.fetchedAt) return null;
    return now() - cache.fetchedAt <= OFFLINE_GRACE_MS ? cache.entitlements.plan : null;
  }

  /** What the UI may see: never the token. */
  function status() {
    const linked = !!cache?.user;
    return {
      linked,
      user: linked ? { email: cache.user.email, name: cache.user.name, picture: cache.user.picture || null } : null,
      plan: cachedPlan(),
      entitlements: linked ? cache.entitlements : null,
      // Administrators of the KUA service see the Admin section (the server checks again).
      admin: linked && cache.admin === true,
      fetchedAt: cache?.fetchedAt || null,
      stale: linked && !cachedPlan(),
      controlPlaneUrl: base,
    };
  }

  /**
   * The session lives in the OS keychain, shared by every KUA of this user;
   * account.json is per data directory (dev, Electron, another install) and can
   * be missing. With a token but no cached account, rebuild it from the account
   * service. Offline, the session stays in the keychain and is restored later.
   */
  let restoring = null;
  async function restore() {
    if (cache?.user || !secretStore.get()) return status();
    if (!restoring) {
      restoring = refresh()
        .catch(err => { log.warn?.('[account] restore:', err.message); return status(); })
        .finally(() => { restoring = null; });
    }
    return restoring;
  }

  function startAutoRefresh() {
    if (timer) return;
    const run = () => {
      const task = cache?.user ? refresh() : restore();
      task.catch(err => log.warn?.('[account] refresh:', err.message));
    };
    run();
    timer = setInterval(run, REFRESH_EVERY_MS);
    timer.unref?.();
  }

  function stopAutoRefresh() { clearInterval(timer); timer = null; }

  return { startLogin, completeLogin, refresh, restore, logout, backups, admin, checkout: body => billing('checkout', body), portal: () => billing('portal'), status, cachedPlan, startAutoRefresh, stopAutoRefresh };
}

let shared = null;
function getAccount() {
  if (!shared) shared = createAccount();
  return shared;
}

module.exports = { createAccount, getAccount, createSecretStore, AccountError, DEFAULT_CONTROL_PLANE_URL, OFFLINE_GRACE_MS };
