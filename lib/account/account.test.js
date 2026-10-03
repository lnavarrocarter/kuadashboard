'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const express = require('express');
const { createAccount } = require('./account');
const { getPlan } = require('../plans');
const { createAccountRouter } = require('../../routes/account');

/** Minimal control plane: desktop start, token exchange (PKCE), me, logout, checkout, portal. */
async function fakeControlPlane() {
  const state = { codes: new Map(), sessions: new Map(), plan: 'free', calls: [] };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { state.calls.push({ method: req.method, path: req.path, auth: req.get('Authorization') || null, body: req.body }); next(); });
  app.get('/auth/desktop/start', (req, res) => {
    // Stands in for Google: sign the user in and hand a one-time code to the loopback callback.
    const code = crypto.randomBytes(16).toString('hex');
    state.codes.set(code, req.query.code_challenge);
    const target = new URL(req.query.redirect_uri);
    target.searchParams.set('code', code);
    target.searchParams.set('state', req.query.state);
    res.redirect(target.toString());
  });
  app.post('/auth/desktop/token', (req, res) => {
    const challenge = state.codes.get(req.body.code);
    state.codes.delete(req.body.code);
    if (!challenge || crypto.createHash('sha256').update(req.body.code_verifier).digest('base64url') !== challenge) return res.status(400).json({ error: 'Invalid or expired sign-in code' });
    const token = crypto.randomBytes(16).toString('hex');
    state.sessions.set(token, 'u1');
    res.json({ token, expiresAt: '2099-01-01T00:00:00.000Z', user: { id: 'u1', email: 'ana@example.com', name: 'Ana' }, entitlements: { plan: state.plan } });
  });
  const auth = (req, res, next) => (state.sessions.has((req.get('Authorization') || '').slice(7)) ? next() : res.status(401).json({ error: 'Authentication required' }));
  app.get('/api/me', auth, (_req, res) => res.json({ user: { id: 'u1', email: 'ana@example.com', name: 'Ana' }, entitlements: { plan: state.plan }, notices: state.notices || [] }));
  app.get('/api/ping', auth, (_req, res) => res.json({ rev: state.rev || 0 }));
  app.post('/auth/logout', (req, res) => { state.sessions.delete((req.get('Authorization') || '').slice(7)); res.status(204).end(); });
  app.post('/api/billing/checkout', auth, (req, res) => res.status(201).json({ url: `https://polar.example/checkout/${req.body.plan}-${req.body.interval}`, provider: 'polar' }));
  app.post('/api/billing/portal', auth, (_req, res) => res.json({ url: 'https://polar.example/portal', provider: 'polar' }));
  app.get('/api/backups', auth, (_req, res) => res.json({ enabled: state.plan !== 'free', items: [] }));
  app.post('/api/backups', auth, (req, res) => state.plan === 'free'
    ? res.status(403).json({ error: 'Cloud backups need a Pro or Team plan', code: 'PLAN_REQUIRED' })
    : res.status(201).json({ id: 'b1', applicationName: req.body.application.name }));
  app.delete('/api/backups/:id', auth, (_req, res) => res.status(204).end());
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { state, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => server.close(resolve)) };
}

function memorySecrets() {
  let value = null;
  return { get: () => value, set: token => { value = token; return 'keychain'; }, clear: () => { value = null; }, peek: () => value };
}

async function signIn(account) {
  const { url } = account.startLogin({ callbackUrl: 'http://127.0.0.1:7190/api/account/callback' });
  const response = await fetch(url, { redirect: 'manual' });
  const back = new URL(response.headers.get('location'));
  return account.completeLogin({ code: back.searchParams.get('code'), state: back.searchParams.get('state') });
}

test('sign-in with PKCE links the account, keeps the token out of the status and gives the plan', async () => {
  const cp = await fakeControlPlane();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kua-account-'));
  const secrets = memorySecrets();
  try {
    const account = createAccount({ dataDir, controlPlaneUrl: cp.url, secretStore: secrets, log: { warn() {} } });
    assert.equal(account.status().linked, false);
    assert.equal(account.cachedPlan(), null);

    const { url } = account.startLogin({ callbackUrl: 'http://127.0.0.1:7190/api/account/callback' });
    const start = new URL(url);
    assert.equal(start.pathname, '/auth/desktop/start');
    // The device it sends when signing in (shown in the list of signed-in devices of the account).
    const deviceOf = () => cp.state.calls.find(c => c.path === '/auth/desktop/token')?.body?.device;
    assert.match(start.searchParams.get('code_challenge'), /^[A-Za-z0-9_-]{43}$/);
    assert.equal(start.searchParams.get('redirect_uri'), 'http://127.0.0.1:7190/api/account/callback');

    const status = await signIn(account);
    assert.equal(status.linked, true);
    assert.deepEqual(status.user, { email: 'ana@example.com', name: 'Ana', picture: null });
    assert.equal(status.plan, 'free');
    assert.ok(secrets.peek(), 'token stored in the secret store');
    const device = deviceOf();
    assert.match(device.id, /^[A-Za-z0-9_-]{32}$/);
    assert.deepEqual({ ...device, id: undefined }, { id: undefined, name: os.hostname(), platform: process.platform, arch: process.arch, appVersion: require('../../package.json').version });
    assert.equal(JSON.stringify(status).includes(secrets.peek()), false, 'the token never reaches the UI');
    assert.equal(fs.readFileSync(path.join(dataDir, 'account.json'), 'utf8').includes(secrets.peek()), false, 'nor the cache file');

    // The account decides the plan unless KUA_PLAN overrides it.
    cp.state.plan = 'pro';
    assert.equal((await account.refresh()).plan, 'pro');
    assert.deepEqual([getPlan({}, { account: () => account.cachedPlan() }).plan, getPlan({}, { account: () => account.cachedPlan() }).source], ['pro', 'account']);
    assert.equal(getPlan({ KUA_PLAN: 'team' }, { account: () => account.cachedPlan() }).source, 'env');

    const checkout = await account.checkout({ plan: 'team', interval: 'year' });
    assert.equal(checkout.url, 'https://polar.example/checkout/team-year');
    assert.equal(cp.state.calls.find(c => c.path === '/api/billing/checkout').body.client, 'desktop');
    assert.equal((await account.portal()).url, 'https://polar.example/portal');

    // A KUA restart reads the cached plan without calling the service.
    const restarted = createAccount({ dataDir, controlPlaneUrl: cp.url, secretStore: secrets });
    assert.equal(restarted.cachedPlan(), 'pro');

    const out = await account.logout();
    assert.equal(out.linked, false);
    assert.equal(secrets.peek(), null);
    assert.ok(cp.state.calls.some(c => c.path === '/auth/logout' && c.auth?.startsWith('Bearer ')));
    await assert.rejects(account.checkout({ plan: 'pro', interval: 'month' }), err => err.code === 'SIGNED_OUT');
  } finally {
    await cp.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('the plan lasts 7 days offline; an expired session or a foreign sign-in are rejected', async () => {
  const cp = await fakeControlPlane();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kua-account-'));
  let now = Date.UTC(2026, 9, 3);
  try {
    const secrets = memorySecrets();
    cp.state.plan = 'team';
    const account = createAccount({ dataDir, controlPlaneUrl: cp.url, secretStore: secrets, now: () => now, log: { warn() {} } });
    await signIn(account);
    now += 6 * 24 * 3600 * 1000;
    assert.equal(account.cachedPlan(), 'team', 'still team after 6 days offline');
    now += 2 * 24 * 3600 * 1000;
    assert.equal(account.cachedPlan(), null, 'back to free after 7 days without reaching the account');
    assert.equal(account.status().stale, true);

    cp.state.sessions.clear(); // session expired or revoked on the server
    assert.equal((await account.refresh()).linked, false);
    assert.equal(secrets.peek(), null);

    await assert.rejects(account.completeLogin({ code: 'x', state: 'never-started' }), /not started in this KUA/);
    // A started sign-in whose service is unreachable reports it as offline.
    const offline = createAccount({ dataDir, controlPlaneUrl: 'http://127.0.0.1:1', secretStore: memorySecrets() });
    const { state } = offline.startLogin({ callbackUrl: 'http://127.0.0.1:7190/api/account/callback' });
    await assert.rejects(offline.completeLogin({ code: 'x', state }), err => err.code === 'OFFLINE');
  } finally {
    await cp.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('the account routes sign in through the loopback callback and validate checkout', async () => {
  const cp = await fakeControlPlane();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kua-account-'));
  const account = createAccount({ dataDir, controlPlaneUrl: cp.url, secretStore: memorySecrets(), log: { warn() {} } });
  const app = express();
  app.use(express.json());
  let port = 0;
  app.use('/api/account', createAccountRouter({ account: () => account, port: () => port }));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
  const base = `http://127.0.0.1:${port}/api/account`;
  try {
    const login = await (await fetch(`${base}/login`, { method: 'POST' })).json();
    assert.ok(new URL(login.url).searchParams.get('redirect_uri').startsWith(`http://127.0.0.1:${port}/api/account/callback`));
    // The browser follows the control plane redirect to this KUA's callback.
    const page = await fetch(login.url);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /ana@example\.com is linked to this KUA/);
    const status = await (await fetch(base)).json();
    assert.equal(status.linked, true);

    const bad = await fetch(`${base}/checkout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan: 'gold' }) });
    assert.equal(bad.status, 400);
    const good = await (await fetch(`${base}/checkout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan: 'pro', interval: 'month' }) })).json();
    assert.equal(good.url, 'https://polar.example/checkout/pro-month');

    const failed = await fetch(`${base}/callback?code=x&state=unknown`);
    assert.equal(failed.status, 400);
    assert.match(await failed.text(), /Sign-in did not complete/);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await cp.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('a sign-in started before a KUA restart completes after it', async () => {
  const cp = await fakeControlPlane();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kua-account-'));
  try {
    const secrets = memorySecrets();
    const before = createAccount({ dataDir, controlPlaneUrl: cp.url, secretStore: secrets, log: { warn() {} } });
    const { url } = before.startLogin({ callbackUrl: 'http://127.0.0.1:7190/api/account/callback' });
    const pendingFile = path.join(dataDir, 'account.pending.json');
    assert.ok(fs.existsSync(pendingFile), 'kept on disk while the user is in the browser');

    // KUA restarts (update, nodemon) before Google returns.
    const after = createAccount({ dataDir, controlPlaneUrl: cp.url, secretStore: secrets, log: { warn() {} } });
    const back = new URL((await fetch(url, { redirect: 'manual' })).headers.get('location'));
    const status = await after.completeLogin({ code: back.searchParams.get('code'), state: back.searchParams.get('state') });
    assert.equal(status.linked, true);
    assert.equal(fs.existsSync(pendingFile), false, 'removed once used');
    await assert.rejects(after.completeLogin({ code: back.searchParams.get('code'), state: back.searchParams.get('state') }), /not started in this KUA/);
  } finally {
    await cp.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('a session kept in the keychain is restored by a KUA without a cached account', async () => {
  const cp = await fakeControlPlane();
  const first = fs.mkdtempSync(path.join(os.tmpdir(), 'kua-account-'));
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'kua-account-')); // e.g. Electron's data dir
  const secrets = memorySecrets(); // the OS keychain is shared by every KUA of the user
  try {
    cp.state.plan = 'pro';
    await signIn(createAccount({ dataDir: first, controlPlaneUrl: cp.url, secretStore: secrets, log: { warn() {} } }));

    const electron = createAccount({ dataDir: other, controlPlaneUrl: cp.url, secretStore: secrets, log: { warn() {} } });
    assert.equal(electron.status().linked, false, 'no cache in this data dir yet');
    const restored = await electron.restore();
    assert.equal(restored.linked, true);
    assert.equal(restored.user.email, 'ana@example.com');
    assert.equal(restored.plan, 'pro');

    // Offline: the token stays in the keychain and is restored when the service is back.
    const offline = createAccount({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'kua-account-')), controlPlaneUrl: 'http://127.0.0.1:1', secretStore: secrets, log: { warn() {} } });
    assert.equal((await offline.restore()).linked, false);
    assert.ok(secrets.peek(), 'not signed out because the service was unreachable');

    // A revoked session is cleared instead of retried forever.
    cp.state.sessions.clear();
    const revoked = createAccount({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'kua-account-')), controlPlaneUrl: cp.url, secretStore: secrets, log: { warn() {} } });
    assert.equal((await revoked.restore()).linked, false);
    assert.equal(secrets.peek(), null);
  } finally {
    await cp.close();
    fs.rmSync(first, { recursive: true, force: true });
    fs.rmSync(other, { recursive: true, force: true });
  }
});

test('cloud backups use the keychain session and keep the plan errors of the account service', async () => {
  const cp = await fakeControlPlane();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kua-account-'));
  try {
    const account = createAccount({ dataDir, controlPlaneUrl: cp.url, secretStore: memorySecrets(), log: { warn() {} } });
    await assert.rejects(account.backups.list(), err => err.code === 'SIGNED_OUT');
    await signIn(account);
    assert.equal((await account.backups.list()).enabled, false);
    await assert.rejects(account.backups.create({ application: { name: 'Orders' } }), err => err.statusCode === 403 && err.code === 'PLAN_REQUIRED');
    cp.state.plan = 'pro';
    assert.deepEqual(await account.backups.create({ application: { name: 'Orders' } }), { id: 'b1', applicationName: 'Orders' });
    assert.equal(await account.backups.remove('b1'), null);
    assert.ok(cp.state.calls.filter(c => c.path.startsWith('/api/backups')).every(c => c.auth?.startsWith('Bearer ')));
  } finally { await cp.close(); fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('ping: a new account revision reads the plan and notices again; a session closed in the portal unlinks KUA', async () => {
  const cp = await fakeControlPlane();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kua-account-'));
  const secrets = memorySecrets();
  try {
    const account = createAccount({ dataDir, controlPlaneUrl: cp.url, secretStore: secrets, log: { warn() {} } });
    await signIn(account);
    await account.ping();
    const meCalls = () => cp.state.calls.filter(c => c.path === '/api/me').length;
    const before = meCalls();
    await account.ping();
    assert.equal(meCalls(), before, 'same revision: no account read');

    cp.state.plan = 'pro';
    cp.state.notices = [{ type: 'payment_failed' }];
    cp.state.rev = 2;
    const status = await account.ping();
    assert.equal(status.plan, 'pro');
    assert.deepEqual(status.notices, [{ type: 'payment_failed' }]);
    assert.equal(meCalls(), before + 1);

    cp.state.sessions.clear(); // signed out from the portal
    const signedOut = await account.ping();
    assert.equal(signedOut.linked, false);
    assert.equal(secrets.peek(), null, 'the token leaves the keychain');
  } finally { await cp.close(); fs.rmSync(dataDir, { recursive: true, force: true }); }
});
