'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createExecCredentials, installAsyncExecAuth, execOf, runPlugin } = require('./kubeExecCredentials');

const EXEC = { command: 'aws', args: ['eks', 'get-token', '--cluster-name', 'dev'] };
const credential = (token, expirationTimestamp) => ({ kind: 'ExecCredential', status: { token, ...(expirationTimestamp ? { expirationTimestamp } : {}) } });

function fakeRun(results) {
  const calls = [];
  const run = async exec => {
    calls.push(exec);
    const next = results.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  return { run, calls };
}

test('runs the plugin once and keeps the credential until it expires', async () => {
  let clock = Date.parse('2026-10-04T10:00:00Z');
  const { run, calls } = fakeRun([credential('a', '2026-10-04T10:15:00Z'), credential('b', '2026-10-04T10:30:00Z')]);
  const credentials = createExecCredentials({ run, now: () => clock });

  assert.equal((await credentials.get(EXEC)).status.token, 'a');
  clock += 5 * 60 * 1000;
  assert.equal((await credentials.get(EXEC)).status.token, 'a');
  assert.equal(calls.length, 1);

  clock = Date.parse('2026-10-04T10:16:00Z');
  assert.equal((await credentials.get(EXEC)).status.token, 'b');
  assert.equal(calls.length, 2);
});

test('concurrent requests share one run of the plugin', async () => {
  const { run, calls } = fakeRun([credential('a', '2099-01-01T00:00:00Z')]);
  const credentials = createExecCredentials({ run });

  const tokens = await Promise.all([1, 2, 3, 4].map(() => credentials.get(EXEC)));

  assert.deepEqual(tokens.map(c => c.status.token), ['a', 'a', 'a', 'a']);
  assert.equal(calls.length, 1);
});

test('renews in the background during the last minute and keeps answering with the current one', async () => {
  let clock = Date.parse('2026-10-04T10:14:30Z');
  const { run, calls } = fakeRun([credential('a', '2026-10-04T10:15:00Z'), credential('b', '2026-10-04T10:30:00Z')]);
  const credentials = createExecCredentials({ run, now: () => clock });
  clock = Date.parse('2026-10-04T10:00:00Z');
  await credentials.get(EXEC);
  clock = Date.parse('2026-10-04T10:14:30Z');

  assert.equal((await credentials.get(EXEC)).status.token, 'a');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 2);
  assert.equal((await credentials.get(EXEC)).status.token, 'b');
});

test('a failure is remembered for a while instead of running the plugin on every request', async () => {
  let clock = 1000;
  const { run, calls } = fakeRun([new Error('The SSO session has expired'), credential('a', '2099-01-01T00:00:00Z')]);
  const credentials = createExecCredentials({ run, now: () => clock });

  await assert.rejects(credentials.get(EXEC), /SSO session has expired/);
  await assert.rejects(credentials.get(EXEC), /SSO session has expired/);
  assert.equal(calls.length, 1);

  clock += 16 * 1000;
  assert.equal((await credentials.get(EXEC)).status.token, 'a');
  assert.equal(calls.length, 2);
});

test('a credential without expiry is kept for a few minutes', async () => {
  let clock = 0;
  const { run, calls } = fakeRun([credential('a'), credential('b')]);
  const credentials = createExecCredentials({ run, now: () => clock });

  await credentials.get(EXEC);
  clock = 5 * 60 * 1000;
  assert.equal((await credentials.get(EXEC)).status.token, 'a');
  clock = 11 * 60 * 1000;
  assert.equal((await credentials.get(EXEC)).status.token, 'b');
  assert.equal(calls.length, 2);
});

test('warm loads the current user credential ahead of the first request', async () => {
  const { run, calls } = fakeRun([credential('a', '2099-01-01T00:00:00Z')]);
  const credentials = createExecCredentials({ run });

  credentials.warm({ getCurrentUser: () => ({ name: 'dev', exec: EXEC }) });
  credentials.warm({ getCurrentUser: () => ({ name: 'token-user', token: 'static' }) });
  assert.equal((await credentials.get(EXEC)).status.token, 'a');
  assert.equal(calls.length, 1);
});

test('the installed authenticator sets the bearer token, certificate and key from the credential', async () => {
  const target = {};
  const status = { token: 't', clientCertificateData: 'cert', clientKeyData: 'key' };
  installAsyncExecAuth({ get: async () => ({ status }) }, { target });

  const opts = { headers: {} };
  await target.applyAuthentication({ name: 'dev', exec: EXEC }, opts);
  assert.deepEqual(opts, { headers: { Authorization: 'Bearer t' }, cert: 'cert', key: 'key' });

  const untouched = { headers: {} };
  await target.applyAuthentication({ name: 'plain', token: 'x' }, untouched);
  assert.deepEqual(untouched, { headers: {} });
  await assert.rejects(target.applyAuthentication({ name: 'bad', exec: {} }, {}), /No command/);
});

test('reads the exec section of a user and its legacy auth-provider form', () => {
  assert.equal(execOf({ exec: EXEC }), EXEC);
  assert.equal(execOf({ authProvider: { config: { exec: EXEC } } }), EXEC);
  assert.equal(execOf({ token: 'x' }), null);
  assert.equal(execOf(null), null);
});

test('runPlugin passes the env of the exec section and parses the ExecCredential', async () => {
  const exec = {
    command: process.execPath,
    args: ['-e', 'process.stdout.write(JSON.stringify({ status: { token: process.env.KUA_TEST_TOKEN } }))'],
    env: [{ name: 'KUA_TEST_TOKEN', value: 'from-env' }],
  };
  assert.equal((await runPlugin(exec)).status.token, 'from-env');
  await assert.rejects(runPlugin({ command: process.execPath, args: ['-e', 'process.stderr.write("expired"); process.exit(1)'] }), /expired/);
});

test('a missing gke-gcloud-auth-plugin falls back to the gcloud access token', async () => {
  const { runPlugin } = require('./kubeExecCredentials');
  const calls = [];
  const execFileImpl = (file, args, opts, cb) => {
    calls.push(file);
    if (/gke-gcloud-auth-plugin/.test(file)) return cb(Object.assign(new Error(`spawn ${file} ENOENT`), { code: 'ENOENT' }), '', '');
    cb(null, JSON.stringify({ credential: { access_token: 'ya29.x', token_expiry: '2026-10-10T07:00:00Z' } }), '');
  };
  const credential = await runPlugin({ command: 'gke-gcloud-auth-plugin.exe', args: [] }, { execFileImpl });
  assert.equal(credential.kind, 'ExecCredential');
  assert.equal(credential.status.token, 'ya29.x');
  assert.equal(credential.status.expirationTimestamp, '2026-10-10T07:00:00Z');
  assert.match(calls[1], /^gcloud/);
});

test('without the plugin and without gcloud the error says how to install it', async () => {
  const { runPlugin } = require('./kubeExecCredentials');
  const execFileImpl = (file, args, opts, cb) => cb(Object.assign(new Error(`spawn ${file} ENOENT`), { code: 'ENOENT' }), '', '');
  await assert.rejects(runPlugin({ command: 'gke-gcloud-auth-plugin', args: [] }, { execFileImpl }), /gcloud components install gke-gcloud-auth-plugin/);
});

test('other missing plugins keep their own error', async () => {
  const { runPlugin } = require('./kubeExecCredentials');
  const execFileImpl = (file, args, opts, cb) => cb(Object.assign(new Error(`spawn ${file} ENOENT`), { code: 'ENOENT' }), '', '');
  await assert.rejects(runPlugin({ command: 'aws', args: ['eks', 'get-token'] }, { execFileImpl }), /spawn aws ENOENT/);
});
