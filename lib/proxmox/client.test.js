'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createProxmoxClient, normalizeFingerprint, parseProxmoxUrl, readServerCertificate } = require('./client');

const TOKEN = { tokenId: 'kua@pve!audit', tokenSecret: '00000000-1111-2222-3333-444444444444' };

// A throwaway self-signed certificate for 127.0.0.1, made at test time (no key in the repository).
function selfSigned() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kua-pve-'));
  const result = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(dir, 'key.pem'), '-out', path.join(dir, 'cert.pem'),
    '-days', '2', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], { encoding: 'utf8' });
  if (result.status !== 0) return null;
  const pair = { key: fs.readFileSync(path.join(dir, 'key.pem')), cert: fs.readFileSync(path.join(dir, 'cert.pem')) };
  fs.rmSync(dir, { recursive: true, force: true });
  return { ...pair, fingerprint: normalizeFingerprint(new crypto.X509Certificate(pair.cert).fingerprint256) };
}

const certificate = selfSigned();
const skip = certificate ? false : 'openssl is not available';

async function proxmoxServer(handler) {
  const seen = [];
  const server = https.createServer({ key: certificate.key, cert: certificate.cert }, (req, res) => {
    seen.push({ url: req.url, authorization: req.headers.authorization });
    handler(req, res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { url: `https://127.0.0.1:${server.address().port}`, seen, close: () => new Promise(resolve => server.close(resolve)) };
}

const json = (res, status, data) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify({ data })); };

test('URLs, fingerprints and token ids are validated', () => {
  assert.deepEqual(parseProxmoxUrl('https://pve.lan:8006'), { origin: 'https://pve.lan:8006', hostname: 'pve.lan', port: 8006 });
  assert.equal(parseProxmoxUrl('https://pve.lan').port, 8006);
  for (const bad of ['http://pve.lan:8006', 'https://root:pw@pve.lan:8006', 'https://pve.lan:8006/api2', 'not a url']) {
    assert.throws(() => parseProxmoxUrl(bad), { kind: 'invalid_profile' });
  }
  assert.equal(normalizeFingerprint('ab'.repeat(32)), Array(32).fill('AB').join(':'));
  assert.equal(normalizeFingerprint('ab:cd'), null);
  assert.throws(() => createProxmoxClient({ url: 'https://pve.lan:8006', tokenId: 'root', tokenSecret: 'x' }), { kind: 'invalid_profile' });
  assert.throws(() => createProxmoxClient({ url: 'https://pve.lan:8006', tokenId: TOKEN.tokenId }), /secret/);
  assert.throws(() => createProxmoxClient({ url: 'https://pve.lan:8006', ...TOKEN, fingerprint: 'abc' }), /SHA-256/);
});

test('a pinned fingerprint reaches a self-signed server with the API token', { skip }, async () => {
  const server = await proxmoxServer((_req, res) => json(res, 200, { version: '8.2.4' }));
  try {
    const client = createProxmoxClient({ url: server.url, ...TOKEN, fingerprint: certificate.fingerprint });
    assert.deepEqual(await client.get('/version'), { version: '8.2.4' });
    assert.equal(server.seen[0].url, '/api2/json/version');
    assert.equal(server.seen[0].authorization, `PVEAPIToken=${TOKEN.tokenId}=${TOKEN.tokenSecret}`);
  } finally { await server.close(); }
});

test('a different certificate is refused before the token is sent', { skip }, async () => {
  const server = await proxmoxServer((_req, res) => json(res, 200, {}));
  try {
    const client = createProxmoxClient({ url: server.url, ...TOKEN, fingerprint: 'AA'.repeat(32) });
    await assert.rejects(client.get('/version'), error => error.kind === 'tls' && error.code === 'FINGERPRINT_MISMATCH' && error.fingerprint === certificate.fingerprint);
    assert.deepEqual(server.seen, [], 'nothing reached the server');
  } finally { await server.close(); }
});

test('without a pin or a CA a self-signed certificate is a TLS error; its own CA is trusted', { skip }, async () => {
  const server = await proxmoxServer((_req, res) => json(res, 200, { ok: 1 }));
  try {
    await assert.rejects(createProxmoxClient({ url: server.url, ...TOKEN }).get('/version'), { kind: 'tls' });
    assert.deepEqual(await createProxmoxClient({ url: server.url, ...TOKEN, ca: certificate.cert.toString() }).get('/version'), { ok: 1 });
  } finally { await server.close(); }
});

test('the server certificate is read without credentials', { skip }, async () => {
  const server = await proxmoxServer((_req, res) => json(res, 200, {}));
  try {
    const read = await readServerCertificate(server.url);
    assert.equal(read.fingerprint, certificate.fingerprint);
    assert.equal(read.subject, 'localhost');
    assert.equal(read.trusted, false);
    assert.deepEqual(server.seen, []);
  } finally { await server.close(); }
});

test('answers are classified and a network error or a 5xx is retried once', async () => {
  const answers = [];
  const get = async () => { const next = answers.shift(); if (next instanceof Error) throw next; return next; };
  const client = createProxmoxClient({ url: 'https://pve.lan:8006', ...TOKEN, fingerprint: 'AB'.repeat(32) }, { get, sleep: async () => {} });
  const cases = [[401, 'invalid_token'], [403, 'forbidden'], [404, 'not_found'], [595, 'node_down']];
  for (const [status, kind] of cases) {
    answers.push({ status, body: '' });
    await assert.rejects(client.get('/x'), { kind });
  }
  answers.push(Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }), { status: 200, body: JSON.stringify({ data: [1] }) });
  assert.deepEqual(await client.get('/x'), [1]);
  answers.push({ status: 503, body: '' }, { status: 503, body: '' });
  await assert.rejects(client.get('/x'), { kind: 'unreachable' });
  assert.equal(answers.length, 0, 'retried exactly once');
  answers.push({ status: 200, body: '<html>' });
  await assert.rejects(client.get('/x'), { kind: 'invalid_response' });
  answers.push(Object.assign(new Error('no such host'), { code: 'ENOTFOUND' }));
  await assert.rejects(client.get('/x'), { kind: 'unreachable' });
  assert.equal(answers.length, 0, 'an unknown host is not retried');
});
