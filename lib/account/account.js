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
const { version: APP_VERSION } = require('../../package.json');

const DEFAULT_CONTROL_PLANE_URL = 'https://api.kuadashboard.navarrocarter.com';
const PENDING_LOGIN_MS = 10 * 60 * 1000;
const OFFLINE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
const REFRESH_EVERY_MS = 6 * 60 * 60 * 1000;
// Light check of the session and the account revision (/api/ping).
const PING_EVERY_MS = 90 * 1000;
const KEYRING_SERVICE = 'kuadashboard';
const KEYRING_ACCOUNT = 'kua-account-session';

function resolveDataDir() {
  return process.env.KUA_DATA_DIR || path.join(os.homedir(), '.kuadashboard');
}

/** Secret storage: OS keychain, or a file encrypted with the KUA passphrase. */
function createSecretStore({ dataDir, fileSystem = fs, account = KEYRING_ACCOUNT, fileName = 'account.session' } = {}) {
  const file = path.join(dataDir, fileName);
  function keychain() {
    try {
      const { Entry } = require('@napi-rs/keyring');
      return new Entry(KEYRING_SERVICE, account);
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

/**
 * This computer as the account sees it (its list of signed-in devices). The id
 * is an opaque hash of the computer, user and system: the same for every KUA of
 * this user on this computer (development, installed app), so signing in again
 * replaces the session instead of adding one. It carries no hardware data.
 */
/**
 * This computer's Ed25519 signing key. The private key lives in the OS
 * keychain (like the session); the account service only knows the public key.
 * Everything KUA stores in the cloud is signed with it.
 */
function createDeviceKey({ store }) {
  let loaded = null;
  function load() {
    if (loaded) return loaded;
    let pem = store.get();
    if (!pem) {
      pem = crypto.generateKeyPairSync('ed25519').privateKey.export({ format: 'pem', type: 'pkcs8' });
      store.set(pem);
    }
    const privateKey = crypto.createPrivateKey(pem);
    const publicKey = crypto.createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).subarray(ED25519_SPKI_PREFIX.length).toString('base64url');
    loaded = { privateKey, publicKey };
    return loaded;
  }
  return {
    publicKey: () => load().publicKey,
    sign: message => crypto.sign(null, Buffer.from(message), load().privateKey).toString('base64url'),
  };
}

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const backupMessage = ({ userId, sha256, signedAt }) => `kua-backup-v1\n${userId}\n${sha256}\n${signedAt}`;
// Team shared space: the member's computer signs what it publishes, the team (KMS) countersigns.
const teamPublishMessage = ({ userId, teamId, appKey, sha256, signedAt }) => `kua-team-publish-v1\n${userId}\n${teamId}\n${appKey}\n${sha256}\n${signedAt}`;
const teamCounterMessage = ({ teamId, itemId, version, sha256 }) => `kua-team-v1\n${teamId}\n${itemId}\n${version}\n${sha256}`;
// A synced version also binds the application and its number (no replay of an old one).
const syncMessage = ({ userId, syncId, version, sha256, signedAt }) => `kua-sync-v1\n${userId}\n${syncId}\n${version}\n${sha256}\n${signedAt}`;

/** Checks a downloaded backup: the bytes, signed by the key that comes with them. */
function verifyBackup({ text, headers, userId, ownKey, uploadedHere, messageFor = (sha256, signedAt) => backupMessage({ userId, sha256, signedAt }) }) {
  const sha256 = crypto.createHash('sha256').update(text).digest('hex');
  const signature = headers.get('x-backup-signature');
  const signedAt = headers.get('x-backup-signed-at');
  const publicKey = headers.get('x-backup-public-key');
  if (!signature || !signedAt || !publicKey) throw new AccountError('This backup is not signed: KUA only restores signed backups.', 400, 'UNSIGNED_BACKUP');
  if (headers.get('x-backup-sha256') && headers.get('x-backup-sha256') !== sha256) throw new AccountError('The backup does not match its checksum.', 400, 'BACKUP_TAMPERED');
  // A backup this computer made must carry this computer's key.
  if (uploadedHere && publicKey !== ownKey) throw new AccountError('This backup was made here but carries another key.', 400, 'BACKUP_TAMPERED');
  let key;
  try { key = crypto.createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(publicKey, 'base64url')]), format: 'der', type: 'spki' }); } catch { key = null; }
  const valid = key && crypto.verify(null, Buffer.from(messageFor(sha256, signedAt)), key, Buffer.from(signature, 'base64url'));
  if (!valid) throw new AccountError('The backup signature is not valid: it was changed after it was signed.', 400, 'BACKUP_TAMPERED');
}

function deviceInfo(deviceKey) {
  let user = '';
  try { user = os.userInfo().username; } catch { /* no user name */ }
  const id = crypto.createHash('sha256').update(['kua-device', os.hostname(), user, process.platform, os.homedir()].join('|')).digest('base64url').slice(0, 32);
  return { id, name: os.hostname(), platform: process.platform, arch: process.arch, appVersion: APP_VERSION, ...(deviceKey ? { publicKey: deviceKey.publicKey() } : {}) };
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
  // Where the device signing key lives (keychain, or the encrypted file).
  keyStore = createSecretStore({ dataDir, account: 'kua-device-key', fileName: 'device.key' }),
  fileSystem = fs,
  now = () => Date.now(),
  log = console,
} = {}) {
  const base = controlPlaneUrl.replace(/\/$/, '');
  const deviceKey = createDeviceKey({ store: keyStore });
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
  let pingTimer = null;

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

  async function call(pathname, { method = 'GET', body, rawBody, headers = {}, token, timeoutMs = 20000, raw = false } = {}) {
    let response;
    try {
      response = await fetchImpl(`${base}${pathname}`, {
        method,
        headers: { Accept: 'application/json', ...(body || rawBody ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
        body: rawBody ?? (body ? JSON.stringify(body) : undefined),
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
      if (CLIENT_ERRORS.has(response.status)) throw Object.assign(new AccountError(message, response.status, data?.code), { details: data });
      throw new AccountError(message, 502, data?.code);
    }
    if (raw) return { text, headers: response.headers };
    return data;
  }

  function requireToken() {
    const token = secretStore.get();
    if (!token) throw new AccountError('Sign in to your KUA account first.', 401, 'SIGNED_OUT');
    return token;
  }

  // Cloud backups of sanitized KUAAppBundle documents (Pro and Team plans).
  /** Registers this computer's key once for a session that signed in before keys existed. */
  async function ensureDeviceKey() {
    const publicKey = deviceKey.publicKey();
    if (!cache?.user || cache.keyRegistered === publicKey) return;
    try {
      await call('/api/devices/key', { method: 'POST', token: requireToken(), body: { publicKey } });
      writeCache({ ...cache, keyRegistered: publicKey, keyConflict: false });
    } catch (err) {
      if (err.code === 'DEVICE_KEY_SET') writeCache({ ...cache, keyConflict: true });
      throw err;
    }
  }

  /**
   * Synced applications: numbered versions signed by the computer that saved
   * them. put() sends the version it started from; another computer's newer
   * version answers 409 SYNC_CONFLICT (with error.details.current).
   */
  const sync = {
    list: async () => call('/api/sync', { token: requireToken() }),
    versions: async syncId => call(`/api/sync/${encodeURIComponent(syncId)}/versions`, { token: requireToken() }),
    put: async (syncId, bundle, baseVersion, { name } = {}) => {
      const token = requireToken();
      await ensureDeviceKey();
      const rawBody = JSON.stringify(bundle);
      const signedAt = new Date(now()).toISOString();
      const sha256 = crypto.createHash('sha256').update(rawBody).digest('hex');
      const signature = deviceKey.sign(syncMessage({ userId: cache.user.id, syncId, version: baseVersion + 1, sha256, signedAt }));
      return call(`/api/sync/${encodeURIComponent(syncId)}`, {
        method: 'PUT', token, rawBody, timeoutMs: 60000,
        headers: { 'X-KUA-Base-Version': String(baseVersion), 'X-KUA-Signature': signature, 'X-KUA-Signed-At': signedAt, ...(name ? { 'X-Sync-Name': encodeURIComponent(name).slice(0, 300) } : {}) },
      });
    },
    // Verified like a backup, with the version number in the signed message.
    download: async (syncId, version) => {
      const { text, headers } = await call(`/api/sync/${encodeURIComponent(syncId)}${version ? `?version=${version}` : ''}`, { token: requireToken(), timeoutMs: 60000, raw: true });
      const got = Number(headers.get('x-sync-version'));
      verifyBackup({ text, headers, userId: cache?.user?.id, messageFor: (sha256, signedAt) => syncMessage({ userId: cache?.user?.id, syncId, version: got, sha256, signedAt }) });
      return { version: got, bundle: JSON.parse(text) };
    },
    remove: async syncId => call(`/api/sync/${encodeURIComponent(syncId)}`, { method: 'DELETE', token: requireToken() }),
  };

  /**
   * The team's shared space (Team plan). The team's public key is pinned the
   * first time this KUA sees the team: a different key for the same team is
   * refused, so the account service cannot swap it silently.
   */
  function teamKeyFor(team) {
    if (!team?.id || !team.publicKey) return null;
    const pinned = cache?.teamKeys?.[team.id];
    if (!pinned && cache) writeCache({ ...cache, teamKeys: { ...(cache.teamKeys || {}), [team.id]: team.publicKey } });
    if (pinned && pinned !== team.publicKey) throw new AccountError('The team signing key changed: KUA does not trust the new one.', 400, 'TEAM_KEY_CHANGED');
    return pinned || team.publicKey;
  }
  function verifyTeamContent({ text, headers, teamId, teamKey, itemId }) {
    const version = Number(headers.get('x-team-item-version'));
    const owner = headers.get('x-team-owner');
    const appKey = headers.get('x-team-app-key');
    // The member's computer signed it…
    verifyBackup({ text, headers, userId: owner, messageFor: (sha256, signedAt) => teamPublishMessage({ userId: owner, teamId, appKey, sha256, signedAt }) });
    // …and the team countersigned it.
    const sha256 = crypto.createHash('sha256').update(text).digest('hex');
    const teamSignature = headers.get('x-team-signature');
    let valid = false;
    try { valid = !!teamSignature && crypto.verify(null, Buffer.from(teamCounterMessage({ teamId, itemId, version, sha256 })), crypto.createPublicKey(teamKey), Buffer.from(teamSignature, 'base64url')); } catch { valid = false; }
    if (!valid) throw new AccountError('The team signature is not valid: it was changed after the team signed it.', 400, 'BACKUP_TAMPERED');
    return { version, bundle: JSON.parse(text) };
  }

  const team = {
    get: async () => call('/api/team', { token: requireToken() }),
    catalog: async () => {
      const result = await call('/api/team/catalog', { token: requireToken() });
      teamKeyFor(result.team);
      return result;
    },
    publish: async (teamId, appKey, bundle) => {
      const token = requireToken();
      await ensureDeviceKey();
      const rawBody = JSON.stringify(bundle);
      const signedAt = new Date(now()).toISOString();
      const sha256 = crypto.createHash('sha256').update(rawBody).digest('hex');
      const signature = deviceKey.sign(teamPublishMessage({ userId: cache.user.id, teamId, appKey, sha256, signedAt }));
      return call(`/api/team/catalog/${encodeURIComponent(appKey)}`, { method: 'PUT', token, rawBody, timeoutMs: 60000, headers: { 'X-KUA-Signature': signature, 'X-KUA-Signed-At': signedAt } });
    },
    unpublish: async appKey => call(`/api/team/catalog/${encodeURIComponent(appKey)}`, { method: 'DELETE', token: requireToken() }),
    content: async (teamInfo, itemId) => {
      const teamKey = teamKeyFor(teamInfo);
      const { text, headers } = await call(`/api/team/catalog/${encodeURIComponent(itemId)}/content`, { token: requireToken(), timeoutMs: 60000, raw: true });
      return verifyTeamContent({ text, headers, teamId: teamInfo.id, teamKey, itemId });
    },
    update: async (itemId, changes) => call(`/api/team/catalog/${encodeURIComponent(itemId)}`, { method: 'PATCH', token: requireToken(), body: changes }),
    backups: async itemId => call(`/api/team/catalog/${encodeURIComponent(itemId)}/backups`, { token: requireToken() }),
    backupNow: async itemId => call(`/api/team/catalog/${encodeURIComponent(itemId)}/backups`, { method: 'POST', token: requireToken(), body: {} }),
    backupContent: async (teamInfo, itemId, backupId) => {
      const teamKey = teamKeyFor(teamInfo);
      const { text, headers } = await call(`/api/team/catalog/${encodeURIComponent(itemId)}/backups/${encodeURIComponent(backupId)}`, { token: requireToken(), timeoutMs: 60000, raw: true });
      return verifyTeamContent({ text, headers, teamId: teamInfo.id, teamKey, itemId });
    },
    setPermissions: async (userId, canImport) => call(`/api/team/members/${encodeURIComponent(userId)}/permissions`, { method: 'PATCH', token: requireToken(), body: { canImport } }),
  };

  const backups = {
    list: async () => call('/api/backups', { token: requireToken() }),
    // Signed by this computer: the exact bytes sent, the account and the time.
    create: async bundle => {
      const token = requireToken();
      await ensureDeviceKey();
      const rawBody = JSON.stringify(bundle);
      const signedAt = new Date(now()).toISOString();
      const sha256 = crypto.createHash('sha256').update(rawBody).digest('hex');
      const signature = deviceKey.sign(backupMessage({ userId: cache.user.id, sha256, signedAt }));
      const backup = await call('/api/backups', { method: 'POST', token, rawBody, headers: { 'X-KUA-Signature': signature, 'X-KUA-Signed-At': signedAt }, timeoutMs: 60000 });
      // Remember what this computer uploaded: restoring it later requires this computer's key.
      if (backup?.id && cache) writeCache({ ...cache, uploadedBackups: [...(cache.uploadedBackups || []), backup.id].slice(-1000) });
      return backup;
    },
    // Verified before it is used: a changed backup is never restored.
    download: async id => {
      const { text, headers } = await call(`/api/backups/${encodeURIComponent(id)}`, { token: requireToken(), timeoutMs: 60000, raw: true });
      verifyBackup({ text, headers, userId: cache?.user?.id, ownKey: deviceKey.publicKey(), uploadedHere: (cache?.uploadedBackups || []).includes(id) });
      return JSON.parse(text);
    },
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
    const result = await call('/auth/desktop/token', { method: 'POST', body: { code, code_verifier: login.verifier, device: deviceInfo(deviceKey) } });
    const store = secretStore.set(result.token);
    const signingKey = deviceKey.publicKey();
    writeCache({ user: result.user, entitlements: result.entitlements, keyRegistered: signingKey, fetchedAt: now(), sessionExpiresAt: result.expiresAt, tokenStore: store });
    return status();
  }

  /** Reads the account again (plan changes after checkout or in the portal). */
  async function refresh() {
    const token = secretStore.get();
    if (!token) { writeCache(null); return status(); }
    try {
      const me = await call('/api/me', { token });
      writeCache({ ...(cache || {}), user: me.user, entitlements: me.entitlements, notices: me.notices || [], trial: me.trial || null, fetchedAt: now() });
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
      // Billing notices (trial ending, payment failed, cancellation…) and the trial, from the account.
      notices: linked ? cache.notices || [] : [],
      trial: linked ? cache.trial || null : null,
      // Another signing key is registered for this session: signing in again fixes it.
      keyConflict: linked && cache.keyConflict === true,
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

  /**
   * The light check every 90 seconds (one read in the account service): a
   * session signed out from the portal ends here too, and a new revision
   * (plan, subscription, trial or grant changed) reads the account again.
   */
  async function ping() {
    const token = secretStore.get();
    if (!cache?.user || !token) return status();
    try {
      const { rev } = await call('/api/ping', { token, timeoutMs: 10000 });
      if (rev !== cache.rev) {
        await refresh();
        if (cache) writeCache({ ...cache, rev });
      }
      // A computer signed in before signing keys existed registers its key once.
      if (cache?.user && !cache.keyConflict && cache.keyRegistered !== deviceKey.publicKey()) await ensureDeviceKey().catch(err => log.warn?.('[account] device key:', err.message));
    } catch (err) {
      if (err.code === 'SIGNED_OUT') { secretStore.clear(); writeCache(null); log.warn?.('[account] signed out by the account service'); }
      else if (err.code !== 'OFFLINE') throw err;
    }
    return status();
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
    pingTimer = setInterval(() => ping().catch(err => log.warn?.('[account] ping:', err.message)), PING_EVERY_MS);
    pingTimer.unref?.();
  }

  function stopAutoRefresh() { clearInterval(timer); clearInterval(pingTimer); timer = null; pingTimer = null; }

  /** Account revision last seen by ping: it changes when something synced changed. */
  const revision = () => cache?.rev ?? null;

  return { startLogin, completeLogin, refresh, restore, ping, revision, logout, sync, team, backups, checkout: body => billing('checkout', body), portal: () => billing('portal'), status, cachedPlan, startAutoRefresh, stopAutoRefresh };
}

let shared = null;
function getAccount() {
  if (!shared) shared = createAccount();
  return shared;
}

module.exports = { createAccount, getAccount, createSecretStore, resolveDataDir, AccountError, DEFAULT_CONTROL_PLANE_URL, OFFLINE_GRACE_MS };
