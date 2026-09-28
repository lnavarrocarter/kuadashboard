'use strict';

// SSH into Compute Engine VMs from the KUA console, without configuring keys.
//
// KUA keeps one ed25519 key per Google account (lib/gcpSshKeys.js, encrypted at
// rest, like gcloud's ~/.ssh/google_compute_engine) and makes Google trust it
// with a sliding expiration, the same way `gcloud compute ssh` does:
//   - OS Login enabled (instance or project metadata `enable-oslogin=TRUE`):
//     the public key lives in the caller's OS Login profile
//   - otherwise: in the instance's `ssh-keys` metadata as a google-ssh line
//     with `expireOn`, which the guest agent honours
// Reconnecting reuses the key: if the VM/profile already trusts it for at least
// REFRESH_MARGIN_MS more, nothing is changed; otherwise its expiration is
// renewed (the old line for that key is replaced, expired google-ssh lines are
// pruned). The private key is only used by the backend, never sent to the UI.

const KEY_TTL_MS = 24 * 60 * 60 * 1000;
const REFRESH_MARGIN_MS = 60 * 60 * 1000;
const COMPUTE = 'https://compute.googleapis.com/compute/v1';

function metadataValue(metadata, key) {
  return (metadata?.items || []).find(i => i.key === key)?.value;
}

function isTrue(value) {
  return String(value || '').trim().toUpperCase() === 'TRUE';
}

/** POSIX-safe login derived from an email, as gcloud does for metadata keys. */
function posixUsername(email) {
  let user = String(email || 'kua').split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '_');
  if (!/^[a-z_]/.test(user)) user = `u${user}`;
  return user.slice(0, 32);
}

/**
 * Drop google-ssh keys whose expireOn is in the past (the guest agent already
 * ignores them, whether KUA or gcloud added them); keep every other line,
 * including permanent keys added by hand.
 */
function pruneExpiredKeys(sshKeys, now) {
  return String(sshKeys || '').split('\n').filter(line => {
    if (line.trim() === '') return false;
    const json = line.match(/google-ssh (\{.*\})\s*$/);
    if (!json) return true;
    try {
      const expireOn = Date.parse(JSON.parse(json[1]).expireOn);
      return !(expireOn <= now);
    } catch { return true; }
  });
}

/** The base64 blob of an OpenSSH public key ("ssh-ed25519 <blob> [comment]"). */
function keyBlob(publicKey) {
  return String(publicKey || '').trim().split(/\s+/)[1] || '';
}

/**
 * Current expiration of `publicKey` in an ssh-keys value: a timestamp, Infinity
 * for a permanent (non google-ssh) line, or null when the key is not present.
 */
function metadataKeyExpiry(sshKeys, publicKey, username) {
  const blob = keyBlob(publicKey);
  let best = null;
  for (const line of String(sshKeys || '').split('\n')) {
    const [user, ...rest] = line.split(':');
    if (user !== username || keyBlob(rest.join(':')) !== blob) continue;
    const json = line.match(/google-ssh (\{.*\})\s*$/);
    let expiry = Infinity;
    if (json) {
      try { expiry = Date.parse(JSON.parse(json[1]).expireOn); } catch { expiry = null; }
    }
    if (expiry != null && (best == null || expiry > best)) best = expiry;
  }
  return best;
}

/** gcloud's expireOn format: 2026-09-28T04:49:36+0000 (no milliseconds, +0000). */
function formatExpireOn(ms) {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, '+0000');
}

function metadataKeyLine(username, publicKey, email, expiresAt) {
  const [type, blob] = publicKey.trim().split(/\s+/);
  // Exactly the shape gcloud writes: Compute rejects extra fields or other
  // timestamp formats in the google-ssh JSON with an opaque "Internal error".
  return `${username}:${type} ${blob} google-ssh {"userName":"${email}","expireOn":"${formatExpireOn(expiresAt)}"}`;
}

/** Pick the address to connect to. Throws a clear error when there is none. */
function sshHost(instance, addressType = 'external') {
  const nic = instance.networkInterfaces?.[0] || {};
  const external = nic.accessConfigs?.find(a => a.natIP)?.natIP;
  const internal = nic.networkIP;
  if (addressType === 'internal') {
    if (!internal) throw Object.assign(new Error('The VM has no internal IP.'), { code: 400 });
    return internal;
  }
  if (!external) {
    throw Object.assign(new Error('The VM has no external IP. Connect with the internal IP (requires VPN/VPC access) or add an external IP.'), { code: 400 });
  }
  return external;
}

/**
 * Resolve the identity behind the auth context: the gcloud account for local
 * configs (via tokeninfo) or the service account's client_email.
 */
async function callerEmail(authCtx, fetchJson) {
  if (authCtx.credentials?.client_email) return authCtx.credentials.client_email;
  const token = authCtx.accessToken || (await (await authCtx.auth.getClient()).getAccessToken()).token;
  const info = await fetchJson(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`);
  if (!info?.email) throw Object.assign(new Error('Could not determine the Google account for SSH (token has no email scope).'), { code: 400 });
  return info.email;
}

const OS_LOGIN = 'https://oslogin.googleapis.com/v1';

function primaryPosixUser(loginProfile) {
  const accounts = loginProfile?.posixAccounts || [];
  const account = accounts.find(a => a.primary) || accounts[0];
  if (!account?.username) throw Object.assign(new Error('OS Login returned no POSIX account for this user.'), { code: 403 });
  return account.username;
}

/**
 * Prepare an SSH connection to a VM, reusing the account's KUA key.
 * @param {object} deps
 *   fetchJson(url, method?, body?) → parsed JSON (authenticated with the profile)
 *   waitZoneOperation(zone, operation) → resolves when the operation is DONE
 *   getKeyPair(email) → { public, private } persistent key for that account
 * @returns {{ host, port, username, privateKey, mode, expiresAt, reused }}
 */
async function prepareGcpSsh({ authCtx, project, zone, name, addressType = 'external' }, {
  fetchJson, rawFetchJson, waitZoneOperation, now = () => Date.now(),
  getKeyPair = email => require('./gcpSshKeys').getSshKeyVault().getOrCreate(email),
}) {
  if (!project) throw Object.assign(new Error('GCP_PROJECT_ID is required'), { code: 400 });
  const instanceUrl = `${COMPUTE}/projects/${project}/zones/${zone}/instances/${name}`;
  const instance = await fetchJson(instanceUrl);
  if (instance.status !== 'RUNNING') {
    throw Object.assign(new Error(`The VM is ${instance.status}; start it before connecting.`), { code: 409 });
  }
  const host = sshHost(instance, addressType);

  let osLogin = metadataValue(instance.metadata, 'enable-oslogin');
  if (osLogin === undefined) {
    const projectInfo = await fetchJson(`${COMPUTE}/projects/${project}`);
    osLogin = metadataValue(projectInfo.commonInstanceMetadata, 'enable-oslogin');
  }

  const email = await callerEmail(authCtx, rawFetchJson || fetchJson);
  const keys = getKeyPair(email);
  const t = now();
  const expiresAt = t + KEY_TTL_MS;

  if (isTrue(osLogin)) {
    const userPath = `${OS_LOGIN}/users/${encodeURIComponent(email)}`;
    const projectQuery = `projectId=${encodeURIComponent(project)}`;
    const profile = await fetchJson(`${userPath}/loginProfile?${projectQuery}`);
    const blob = keyBlob(keys.public);
    const existing = Object.values(profile.sshPublicKeys || {}).find(k => keyBlob(k.key) === blob);
    const existingExpiry = existing
      ? (existing.expirationTimeUsec ? Number(existing.expirationTimeUsec) / 1000 : Infinity)
      : null;
    if (existingExpiry != null && existingExpiry - t > REFRESH_MARGIN_MS) {
      return { host, port: 22, username: primaryPosixUser(profile), privateKey: keys.private, mode: 'oslogin', expiresAt: existingExpiry, reused: true };
    }
    const res = await fetchJson(`${userPath}:importSshPublicKey?${projectQuery}`, 'POST', {
      key: keys.public, expirationTimeUsec: String(expiresAt * 1000),
    });
    return { host, port: 22, username: primaryPosixUser(res.loginProfile), privateKey: keys.private, mode: 'oslogin', expiresAt, reused: false };
  }

  const username = posixUsername(email);
  const current = metadataValue(instance.metadata, 'ssh-keys');
  const currentExpiry = metadataKeyExpiry(current, keys.public, username);
  if (currentExpiry != null && currentExpiry - t > REFRESH_MARGIN_MS) {
    return { host, port: 22, username, privateKey: keys.private, mode: 'metadata', expiresAt: currentExpiry, reused: true };
  }
  // Renew: drop expired google-ssh lines and any previous line for this key
  const blob = keyBlob(keys.public);
  const lines = pruneExpiredKeys(current, t).filter(line => {
    const [user, ...rest] = line.split(':');
    return !(user === username && keyBlob(rest.join(':')) === blob);
  });
  lines.push(metadataKeyLine(username, keys.public, email, expiresAt));
  const items = (instance.metadata?.items || []).filter(i => i.key !== 'ssh-keys');
  const operation = await fetchJson(`${instanceUrl}/setMetadata`, 'POST', {
    fingerprint: instance.metadata?.fingerprint,
    items: [...items, { key: 'ssh-keys', value: lines.join('\n') }],
  });
  await waitZoneOperation(zone, operation);
  return { host, port: 22, username, privateKey: keys.private, mode: 'metadata', expiresAt, reused: false };
}

module.exports = {
  KEY_TTL_MS,
  REFRESH_MARGIN_MS,
  keyBlob,
  metadataKeyExpiry,
  posixUsername,
  pruneExpiredKeys,
  formatExpireOn,
  metadataKeyLine,
  sshHost,
  prepareGcpSsh,
};
