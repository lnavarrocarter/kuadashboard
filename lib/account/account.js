'use strict';
/**
 * lib/account/account.js
 * Links KUA Desktop to a KUA account (control plane, cloud/control-plane):
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

// The run.app URL until api.kuadashboard.navarrocarter.com serves HTTPS (#33).
const DEFAULT_CONTROL_PLANE_URL = 'https://kua-control-plane-306971032277.us-central1.run.app';
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
  const pending = new Map(); // state → { verifier, createdAt }
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

  async function call(pathname, { method = 'GET', body, token } = {}) {
    let response;
    try {
      response = await fetchImpl(`${base}${pathname}`, {
        method,
        headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(20000),
      });
    } catch (err) {
      throw new AccountError(`The KUA account service is not reachable (${err.cause?.code || err.name}).`, 502, 'OFFLINE');
    }
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    if (!response.ok) throw new AccountError(data?.error || `KUA account service answered ${response.status}`, response.status === 401 ? 401 : 502, response.status === 401 ? 'SIGNED_OUT' : undefined);
    return data;
  }

  /** Browser URL that starts the sign-in; callbackUrl is this KUA's /api/account/callback. */
  function startLogin({ callbackUrl }) {
    for (const [key, value] of pending) if (now() - value.createdAt > PENDING_LOGIN_MS) pending.delete(key);
    const verifier = crypto.randomBytes(48).toString('base64url');
    const state = crypto.randomBytes(24).toString('base64url');
    pending.set(state, { verifier, createdAt: now() });
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const url = `${base}/auth/desktop/start?${new URLSearchParams({ redirect_uri: callbackUrl, code_challenge: challenge, state })}`;
    return { url, state };
  }

  /** Exchanges the one-time code that came back to the callback. */
  async function completeLogin({ code, state }) {
    const login = pending.get(String(state || ''));
    pending.delete(String(state || ''));
    if (!login || now() - login.createdAt > PENDING_LOGIN_MS) throw new AccountError('This sign-in expired or was not started in this KUA. Start it again from Help & Options → Account.');
    const result = await call('/auth/desktop/token', { method: 'POST', body: { code, code_verifier: login.verifier } });
    const store = secretStore.set(result.token);
    writeCache({ user: result.user, entitlements: result.entitlements, fetchedAt: now(), sessionExpiresAt: result.expiresAt, tokenStore: store });
    return status();
  }

  /** Reads the account again (plan changes after checkout or in the portal). */
  async function refresh() {
    const token = secretStore.get();
    if (!token) { writeCache(null); return status(); }
    try {
      const me = await call('/api/me', { token });
      writeCache({ ...(cache || {}), user: me.user, entitlements: me.entitlements, fetchedAt: now() });
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
    const token = secretStore.get();
    if (!token) throw new AccountError('Sign in to your KUA account first.', 401, 'SIGNED_OUT');
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
      fetchedAt: cache?.fetchedAt || null,
      stale: linked && !cachedPlan(),
      controlPlaneUrl: base,
    };
  }

  function startAutoRefresh() {
    if (timer) return;
    const run = () => { if (cache?.user) refresh().catch(err => log.warn?.('[account] refresh:', err.message)); };
    run();
    timer = setInterval(run, REFRESH_EVERY_MS);
    timer.unref?.();
  }

  function stopAutoRefresh() { clearInterval(timer); timer = null; }

  return { startLogin, completeLogin, refresh, logout, checkout: body => billing('checkout', body), portal: () => billing('portal'), status, cachedPlan, startAutoRefresh, stopAutoRefresh };
}

let shared = null;
function getAccount() {
  if (!shared) shared = createAccount();
  return shared;
}

module.exports = { createAccount, getAccount, createSecretStore, AccountError, DEFAULT_CONTROL_PLANE_URL, OFFLINE_GRACE_MS };
