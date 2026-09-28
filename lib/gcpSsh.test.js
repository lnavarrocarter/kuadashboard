'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  KEY_TTL_MS, posixUsername, pruneExpiredKeys, metadataKeyLine, sshHost, prepareGcpSsh,
} = require('./gcpSsh');

const NOW = Date.parse('2026-09-28T12:00:00Z');
const KEYS = { public: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPUB kua-ephemeral', private: '-----BEGIN OPENSSH PRIVATE KEY-----\nx\n-----END OPENSSH PRIVATE KEY-----' };

function vm({ status = 'RUNNING', natIP = '34.1.2.3', metadata = {} } = {}) {
  return {
    name: 'test-vm', status,
    networkInterfaces: [{ networkIP: '10.128.0.5', accessConfigs: natIP ? [{ natIP }] : [] }],
    metadata: { fingerprint: 'fp-1', items: [], ...metadata },
  };
}

// Fake GCP REST: routes by URL, records calls
function fakeGcp({ instance = vm(), project = { commonInstanceMetadata: { items: [] } }, email = 'nacho.navarro@example.com', osLoginUser = 'nacho_navarro_example_com', osLoginKeys = {} } = {}) {
  const calls = [];
  const fetchJson = async (url, method = 'GET', body) => {
    calls.push({ url, method, body });
    if (url.includes('tokeninfo')) return { email };
    if (url.includes('/loginProfile')) return { posixAccounts: [{ username: osLoginUser, primary: true }], sshPublicKeys: osLoginKeys };
    if (url.includes(':importSshPublicKey')) return { loginProfile: { posixAccounts: [{ username: osLoginUser, primary: true }] } };
    if (url.endsWith('/setMetadata')) return { name: 'op-meta', status: 'RUNNING' };
    if (/\/instances\/[^/]+$/.test(url)) return instance;
    if (/\/projects\/[^/]+$/.test(url)) return project;
    throw new Error(`unexpected ${method} ${url}`);
  };
  const waits = [];
  const waitZoneOperation = async (zone, op) => { waits.push({ zone, op: op.name }); };
  return { calls, waits, deps: { fetchJson, waitZoneOperation, now: () => NOW, getKeyPair: () => KEYS } };
}

const AUTH_LOCAL = { accessToken: 'ya29.x', projectId: 'ncaicloud', credentials: {} };
const REQ = { authCtx: AUTH_LOCAL, project: 'ncaicloud', zone: 'us-central1-a', name: 'test-vm' };

// ── Helpers ──────────────────────────────────────────────────────────────────

test('derives a POSIX username from the account email', () => {
  assert.equal(posixUsername('Nacho.Navarro@gmail.com'), 'nacho_navarro');
  assert.equal(posixUsername('1234@x.com'), 'u1234');
  assert.equal(posixUsername('kua-sa@p.iam.gserviceaccount.com'), 'kua_sa');
});

test('metadata key line matches exactly the google-ssh format gcloud writes', () => {
  // Compute answers setMetadata with "Internal error" when the google-ssh JSON has
  // extra fields or an ISO timestamp with milliseconds / Z.
  const line = metadataKeyLine('nacho', KEYS.public, 'nacho@x.com', NOW + KEY_TTL_MS + 705);
  assert.equal(line, 'nacho:ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPUB google-ssh {"userName":"nacho@x.com","expireOn":"2026-09-29T12:00:00+0000"}');
  assert.deepEqual(Object.keys(JSON.parse(line.split('google-ssh ')[1])), ['userName', 'expireOn']);
});

test('prunes expired google-ssh keys (KUA or gcloud) and keeps permanent and valid ones', () => {
  const expired = metadataKeyLine('a', KEYS.public, 'a@x', NOW - 1000);
  const valid = metadataKeyLine('b', KEYS.public, 'b@x', NOW + 1000);
  const manual = 'ops:ssh-rsa AAAAB3Nza ops@laptop';
  const gcloudExpired = 'c:ssh-ed25519 AAAA google-ssh {"userName":"c@x","expireOn":"2020-01-01T00:00:00+0000"}';
  const broken = 'd:ssh-ed25519 AAAA google-ssh {not json}';
  assert.deepEqual(pruneExpiredKeys([expired, manual, valid, gcloudExpired, broken, ''].join('\n'), NOW), [manual, valid, broken]);
});

test('chooses the external IP, or the internal one when asked', () => {
  assert.equal(sshHost(vm()), '34.1.2.3');
  assert.equal(sshHost(vm(), 'internal'), '10.128.0.5');
  assert.throws(() => sshHost(vm({ natIP: null })), /no external IP/);
});

// ── prepareGcpSsh ────────────────────────────────────────────────────────────

test('metadata mode: adds an expiring key with the instance fingerprint and waits for the operation', async () => {
  const oldKey = metadataKeyLine('old', KEYS.public, 'old@x', NOW - 60_000);
  const instance = vm({ metadata: { items: [{ key: 'startup-script', value: 'echo hi' }, { key: 'ssh-keys', value: `ops:ssh-rsa AAAA ops\n${oldKey}` }] } });
  const gcp = fakeGcp({ instance });
  const res = await prepareGcpSsh(REQ, gcp.deps);

  assert.equal(res.mode, 'metadata');
  assert.equal(res.username, 'nacho_navarro');
  assert.equal(res.host, '34.1.2.3');
  assert.equal(res.privateKey, KEYS.private);
  assert.equal(res.expiresAt, NOW + KEY_TTL_MS);

  const set = gcp.calls.find(c => c.url.endsWith('/setMetadata'));
  assert.equal(set.body.fingerprint, 'fp-1');
  assert.deepEqual(set.body.items[0], { key: 'startup-script', value: 'echo hi' });   // other metadata kept
  const sshKeys = set.body.items.find(i => i.key === 'ssh-keys').value.split('\n');
  assert.equal(sshKeys[0], 'ops:ssh-rsa AAAA ops');                                   // manual key kept
  assert.ok(!sshKeys.some(l => l.startsWith('old:')));                                 // expired KUA key pruned
  assert.match(sshKeys.at(-1), /^nacho_navarro:ssh-ed25519 /);
  assert.deepEqual(gcp.waits, [{ zone: 'us-central1-a', op: 'op-meta' }]);
});

test('OS Login mode (instance metadata): imports the key with an expiration, no metadata change', async () => {
  const gcp = fakeGcp({ instance: vm({ metadata: { items: [{ key: 'enable-oslogin', value: 'TRUE' }] } }) });
  const res = await prepareGcpSsh(REQ, gcp.deps);
  assert.equal(res.mode, 'oslogin');
  assert.equal(res.username, 'nacho_navarro_example_com');
  const imp = gcp.calls.find(c => c.url.includes(':importSshPublicKey'));
  assert.match(imp.url, /users\/nacho\.navarro%40example\.com:importSshPublicKey\?projectId=ncaicloud/);
  assert.equal(imp.body.key, KEYS.public);
  assert.equal(imp.body.expirationTimeUsec, String((NOW + KEY_TTL_MS) * 1000));
  assert.ok(!gcp.calls.some(c => c.url.endsWith('/setMetadata')));
});

test('OS Login enabled at project level is detected', async () => {
  const gcp = fakeGcp({ project: { commonInstanceMetadata: { items: [{ key: 'enable-oslogin', value: 'true' }] } } });
  assert.equal((await prepareGcpSsh(REQ, gcp.deps)).mode, 'oslogin');
});

test('instance-level enable-oslogin=FALSE overrides the project setting', async () => {
  const gcp = fakeGcp({
    instance: vm({ metadata: { items: [{ key: 'enable-oslogin', value: 'FALSE' }] } }),
    project: { commonInstanceMetadata: { items: [{ key: 'enable-oslogin', value: 'TRUE' }] } },
  });
  assert.equal((await prepareGcpSsh(REQ, gcp.deps)).mode, 'metadata');
});

test('service-account profiles use client_email without calling tokeninfo', async () => {
  const gcp = fakeGcp();
  const res = await prepareGcpSsh({ ...REQ, authCtx: { credentials: { client_email: 'kua-sa@p.iam.gserviceaccount.com' } } }, gcp.deps);
  assert.equal(res.username, 'kua_sa');
  assert.ok(!gcp.calls.some(c => c.url.includes('tokeninfo')));
});

test('refuses stopped VMs and VMs without an external IP (unless internal is chosen)', async () => {
  await assert.rejects(prepareGcpSsh(REQ, fakeGcp({ instance: vm({ status: 'TERMINATED' }) }).deps), err => err.code === 409 && /TERMINATED/.test(err.message));
  await assert.rejects(prepareGcpSsh(REQ, fakeGcp({ instance: vm({ natIP: null }) }).deps), /no external IP/);
  const res = await prepareGcpSsh({ ...REQ, addressType: 'internal' }, fakeGcp({ instance: vm({ natIP: null }) }).deps);
  assert.equal(res.host, '10.128.0.5');
});

// ── Console session contract ─────────────────────────────────────────────────

test('console contract validates gcp-ssh targets', async () => {
  const { validateSession } = await import('../frontend/src/shared/consoleSession.mjs');
  const ok = validateSession({ provider: 'gcp', transport: 'ssh', profileId: 'local:ncaicloud', target: { name: 'test-vm', zone: 'us-central1-a', addressType: 'external' } });
  assert.equal(ok.capability.path, '/ws/gcp-ssh');
  assert.deepEqual(ok.session.target, { name: 'test-vm', zone: 'us-central1-a', addressType: 'external' });
  assert.throws(() => validateSession({ provider: 'gcp', transport: 'ssh', profileId: 'p', target: { name: 'test-vm' } }), /target.zone/);
  assert.throws(() => validateSession({ provider: 'gcp', transport: 'ssh', profileId: 'p', target: { name: 'vm;rm', zone: 'us-central1-a' } }), /Invalid GCP instance name/);
  assert.throws(() => validateSession({ provider: 'gcp', transport: 'ssh', profileId: 'p', target: { name: 'vm', zone: 'us-central1' } }), /Invalid GCP zone/);
});

// ── Key reuse ────────────────────────────────────────────────────────────────

const { REFRESH_MARGIN_MS, metadataKeyExpiry } = require('./gcpSsh');

test('finds the current expiry of the account key in ssh-keys (permanent = Infinity)', () => {
  const line = metadataKeyLine('nacho_navarro', KEYS.public, 'x@y', NOW + 5000);
  assert.equal(metadataKeyExpiry(line, KEYS.public, 'nacho_navarro'), Date.parse('2026-09-28T12:00:05Z'));
  assert.equal(metadataKeyExpiry(`nacho_navarro:${KEYS.public}`, KEYS.public, 'nacho_navarro'), Infinity);
  assert.equal(metadataKeyExpiry(line, KEYS.public, 'someone_else'), null);
  assert.equal(metadataKeyExpiry('ops:ssh-rsa AAAAOTHER ops', KEYS.public, 'ops'), null);
});

test('metadata: reconnecting while the key is valid reuses it without touching the VM', async () => {
  const line = metadataKeyLine('nacho_navarro', KEYS.public, 'nacho.navarro@example.com', NOW + 5 * 60 * 60 * 1000);
  const gcp = fakeGcp({ instance: vm({ metadata: { items: [{ key: 'ssh-keys', value: line }] } }) });
  const res = await prepareGcpSsh(REQ, gcp.deps);
  assert.equal(res.reused, true);
  assert.equal(res.expiresAt, NOW + 5 * 60 * 60 * 1000);
  assert.equal(res.privateKey, KEYS.private);
  assert.ok(!gcp.calls.some(c => c.url.endsWith('/setMetadata')));
});

test('metadata: a key about to expire is renewed in place (one line per key)', async () => {
  const soon = metadataKeyLine('nacho_navarro', KEYS.public, 'nacho.navarro@example.com', NOW + REFRESH_MARGIN_MS - 1000);
  const gcp = fakeGcp({ instance: vm({ metadata: { items: [{ key: 'ssh-keys', value: `ops:ssh-rsa AAAA ops\n${soon}` }] } }) });
  const res = await prepareGcpSsh(REQ, gcp.deps);
  assert.equal(res.reused, false);
  const value = gcp.calls.find(c => c.url.endsWith('/setMetadata')).body.items.find(i => i.key === 'ssh-keys').value.split('\n');
  assert.equal(value.length, 2);
  assert.equal(value[0], 'ops:ssh-rsa AAAA ops');
  assert.equal(value[1], metadataKeyLine('nacho_navarro', KEYS.public, 'nacho.navarro@example.com', NOW + KEY_TTL_MS));
});

test('OS Login: a valid key in the login profile is reused without importing again', async () => {
  const gcp = fakeGcp({
    instance: vm({ metadata: { items: [{ key: 'enable-oslogin', value: 'TRUE' }] } }),
    osLoginKeys: { fp1: { key: KEYS.public, expirationTimeUsec: String((NOW + 3 * 60 * 60 * 1000) * 1000) } },
  });
  const res = await prepareGcpSsh(REQ, gcp.deps);
  assert.equal(res.reused, true);
  assert.equal(res.username, 'nacho_navarro_example_com');
  assert.ok(!gcp.calls.some(c => c.url.includes(':importSshPublicKey')));
});

test('OS Login: an expiring key is re-imported with a new expiration', async () => {
  const gcp = fakeGcp({
    instance: vm({ metadata: { items: [{ key: 'enable-oslogin', value: 'TRUE' }] } }),
    osLoginKeys: { fp1: { key: KEYS.public, expirationTimeUsec: String((NOW + 60_000) * 1000) } },
  });
  const res = await prepareGcpSsh(REQ, gcp.deps);
  assert.equal(res.reused, false);
  assert.equal(gcp.calls.find(c => c.url.includes(':importSshPublicKey')).body.expirationTimeUsec, String((NOW + KEY_TTL_MS) * 1000));
});

// ── Persistent key vault ─────────────────────────────────────────────────────

test('key vault keeps one encrypted key per account and survives a new instance', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { createSshKeyVault } = require('./gcpSshKeys');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kua-sshkeys-'));
  try {
    const file = path.join(dir, 'keys.enc');
    let generated = 0;
    const opts = { file, passphrase: () => 'test-pass', generate: email => ({ public: `ssh-ed25519 PUB${++generated} ${email}`, private: `PRIV${generated}` }) };
    const vault = createSshKeyVault(opts);
    const a1 = vault.getOrCreate('a@x.com');
    const a2 = vault.getOrCreate('a@x.com');
    const b = vault.getOrCreate('b@x.com');
    assert.equal(a1.created, true);
    assert.equal(a2.created, false);
    assert.equal(a2.private, a1.private);
    assert.notEqual(b.private, a1.private);
    assert.equal(generated, 2);

    const raw = fs.readFileSync(file, 'utf8');
    assert.ok(!raw.includes('PRIV1'), 'private keys must not be stored in plain text');
    assert.equal(createSshKeyVault(opts).getOrCreate('a@x.com').private, 'PRIV1');   // persisted

    assert.equal(vault.forget('a@x.com'), true);
    assert.equal(vault.getOrCreate('a@x.com').private, 'PRIV3');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
