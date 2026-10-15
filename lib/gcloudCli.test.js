'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createGcloudCli, CONFIG_LIST_ARGS } = require('./gcloudCli');

const CONFIGS_JSON = JSON.stringify([
  { name: 'default', is_active: false, properties: { core: { project: 'homelab' } } },
  { name: 'ncaicloud', is_active: true, properties: { core: { project: 'ncaicloud', account: 'me@x.com' }, compute: { region: 'us-central1' } } },
]);

// config-helper output: the token and when it expires (1 h from now by default)
const credential = (token, expiry = new Date(Date.now() + 60 * 60 * 1000).toISOString()) =>
  JSON.stringify({ credential: { access_token: token, token_expiry: expiry } });

// Fake CLI: counts calls per command and resolves after a tick
function fakeExec(handlers) {
  const calls = [];
  const exec = async args => {
    calls.push(args);
    await new Promise(r => setImmediate(r));
    for (const [prefix, handler] of Object.entries(handlers)) {
      if (args.startsWith(prefix)) return handler(args);
    }
    throw new Error(`unexpected gcloud ${args}`);
  };
  return { exec, calls };
}

test('parses configurations with project, account and region', async () => {
  const { exec } = fakeExec({ 'config configurations list': () => CONFIGS_JSON });
  const cli = createGcloudCli({ exec });
  assert.deepEqual(await cli.listConfigs(), [
    { name: 'default', project: 'homelab', account: null, region: null, isActive: false },
    { name: 'ncaicloud', project: 'ncaicloud', account: 'me@x.com', region: 'us-central1', isActive: true },
  ]);
});

test('50 concurrent requests share one config listing and one token call (the "config not found" bug)', async () => {
  const { exec, calls } = fakeExec({
    'config configurations list': () => CONFIGS_JSON,
    'config config-helper': () => credential('ya29.token'),
  });
  const cli = createGcloudCli({ exec });
  const results = await Promise.all(Array.from({ length: 50 }, async () => {
    const configs = await cli.listConfigs();
    assert.ok(configs.some(c => c.name === 'ncaicloud'));
    return cli.getAccessToken('ncaicloud');
  }));
  assert.ok(results.every(t => t === 'ya29.token'));
  assert.equal(calls.filter(c => c === CONFIG_LIST_ARGS).length, 1);
  assert.equal(calls.filter(c => c.startsWith('config config-helper')).length, 1);
});

test('caches until the TTL expires; force bypasses the cache', async () => {
  let t = 0;
  const { exec, calls } = fakeExec({ 'config configurations list': () => CONFIGS_JSON });
  const cli = createGcloudCli({ exec, now: () => t, configTtlMs: 1000 });
  await cli.listConfigs();
  await cli.listConfigs();
  assert.equal(calls.length, 1);
  t = 1500;
  await cli.listConfigs();
  assert.equal(calls.length, 2);
  await cli.listConfigs({ force: true });
  assert.equal(calls.length, 3);
});

test('tokens are cached per configuration and refreshed after their TTL', async () => {
  let t = 0;
  let n = 0;
  const { exec, calls } = fakeExec({ 'config config-helper': args => credential(`token-${args.split('--configuration=')[1]}-${++n}`) });
  const cli = createGcloudCli({ exec, now: () => t, tokenTtlMs: 1000 });
  assert.equal(await cli.getAccessToken('a'), 'token-a-1');
  assert.equal(await cli.getAccessToken('a'), 'token-a-1');
  assert.equal(await cli.getAccessToken('b'), 'token-b-2');
  t = 2000;
  assert.equal(await cli.getAccessToken('a'), 'token-a-3');
  assert.equal(calls.length, 3);
});

test('a CLI timeout is reported as a gcloud failure (503), not as a missing config, and is not cached', async () => {
  let fail = true;
  const { exec, calls } = fakeExec({
    'config configurations list': () => {
      if (fail) throw Object.assign(new Error('Command failed'), { killed: true });
      return CONFIGS_JSON;
    },
  });
  const cli = createGcloudCli({ exec });
  await assert.rejects(cli.listConfigs(), err => err.code === 503 && /timed out/.test(err.message));
  fail = false;
  assert.equal((await cli.listConfigs()).length, 2);
  assert.equal(calls.length, 2);
});

test('empty token output is an error', async () => {
  const { exec } = fakeExec({ 'config config-helper': () => '  \n' });
  const cli = createGcloudCli({ exec });
  await assert.rejects(cli.getAccessToken('x'), /No access token returned/);
});

test('invalidate drops cached configs and tokens', async () => {
  const { exec, calls } = fakeExec({
    'config configurations list': () => CONFIGS_JSON,
    'config config-helper': () => credential('tok'),
  });
  const cli = createGcloudCli({ exec });
  await cli.listConfigs();
  await cli.getAccessToken('ncaicloud');
  cli.invalidate();
  await cli.listConfigs();
  await cli.getAccessToken('ncaicloud');
  assert.equal(calls.length, 4);
});

test('a token close to its expiry is kept only until shortly before it, or not at all', async () => {
  let clock = Date.parse('2026-10-15T03:00:00Z');
  let expiry = '2026-10-15T03:20:00Z';
  let n = 0;
  const { exec, calls } = fakeExec({ 'config config-helper': () => credential(`tok-${++n}`, expiry) });
  const cli = createGcloudCli({ exec, now: () => clock });
  assert.equal(await cli.getAccessToken('ncaicloud'), 'tok-1');
  clock += 10 * 60 * 1000;
  assert.equal(await cli.getAccessToken('ncaicloud'), 'tok-1', 'still 10 min left');
  clock += 6 * 60 * 1000;
  expiry = '2026-10-15T03:18:00Z';
  assert.equal(await cli.getAccessToken('ncaicloud'), 'tok-2', 'within 5 min of expiry: asks gcloud again');
  assert.equal(await cli.getAccessToken('ncaicloud'), 'tok-3', 'a token about to expire is not kept');
  assert.equal(calls.length, 3);
});

test('invalidateToken drops only that configuration\'s token', async () => {
  let n = 0;
  const { exec } = fakeExec({ 'config config-helper': args => credential(`${args.split('--configuration=')[1]}-${++n}`) });
  const cli = createGcloudCli({ exec });
  await cli.getAccessToken('a');
  await cli.getAccessToken('b');
  cli.invalidateToken('a');
  assert.equal(await cli.getAccessToken('a'), 'a-3');
  assert.equal(await cli.getAccessToken('b'), 'b-2');
});
