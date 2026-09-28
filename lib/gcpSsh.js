'use strict';

// SSH into Compute Engine VMs from the KUA console, without stored keys.
//
// For every connection KUA generates an ephemeral ed25519 key pair and makes
// Google trust it for a short time, the same way `gcloud compute ssh` does:
//   - OS Login enabled (instance or project metadata `enable-oslogin=TRUE`):
//     import the public key into the caller's OS Login profile with an
//     expiration; the POSIX username comes back from the API
//   - otherwise: add the key to the instance's `ssh-keys` metadata with a
//     google-ssh `expireOn`, which the guest agent honours; expired google-ssh
//     keys (already ignored by the agent) are pruned from the metadata
// The private key never leaves the backend process and is not persisted.

const { utils } = require('ssh2');

const KEY_TTL_MS = 30 * 60 * 1000;
const COMPUTE = 'https://compute.googleapis.com/compute/v1';
const KUA_KEY_COMMENT = 'kua-ephemeral';

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

/**
 * Prepare an SSH connection to a VM.
 * @param {object} deps
 *   fetchJson(url, method?, body?) → parsed JSON (authenticated with the profile)
 *   waitZoneOperation(zone, operation) → resolves when the operation is DONE
 * @returns {{ host, port, username, privateKey, mode, expiresAt }}
 */
async function prepareGcpSsh({ authCtx, project, zone, name, addressType = 'external' }, { fetchJson, rawFetchJson, waitZoneOperation, now = () => Date.now(), generateKeyPair = () => utils.generateKeyPairSync('ed25519', { comment: KUA_KEY_COMMENT }) }) {
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
  const keys = generateKeyPair();
  const expiresAt = now() + KEY_TTL_MS;

  if (isTrue(osLogin)) {
    const res = await fetchJson(
      `https://oslogin.googleapis.com/v1/users/${encodeURIComponent(email)}:importSshPublicKey?projectId=${encodeURIComponent(project)}`,
      'POST',
      { key: keys.public, expirationTimeUsec: String(expiresAt * 1000) },
    );
    const accounts = res.loginProfile?.posixAccounts || [];
    const account = accounts.find(a => a.primary) || accounts[0];
    if (!account?.username) throw Object.assign(new Error('OS Login returned no POSIX account for this user.'), { code: 403 });
    return { host, port: 22, username: account.username, privateKey: keys.private, mode: 'oslogin', expiresAt };
  }

  const username = posixUsername(email);
  const items = (instance.metadata?.items || []).filter(i => i.key !== 'ssh-keys');
  const lines = pruneExpiredKeys(metadataValue(instance.metadata, 'ssh-keys'), now());
  lines.push(metadataKeyLine(username, keys.public, email, expiresAt));
  const operation = await fetchJson(`${instanceUrl}/setMetadata`, 'POST', {
    fingerprint: instance.metadata?.fingerprint,
    items: [...items, { key: 'ssh-keys', value: lines.join('\n') }],
  });
  await waitZoneOperation(zone, operation);
  return { host, port: 22, username, privateKey: keys.private, mode: 'metadata', expiresAt };
}

module.exports = {
  KEY_TTL_MS,
  posixUsername,
  pruneExpiredKeys,
  formatExpireOn,
  metadataKeyLine,
  sshHost,
  prepareGcpSsh,
};
