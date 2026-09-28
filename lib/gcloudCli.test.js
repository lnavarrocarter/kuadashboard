'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createGcloudCli, CONFIG_LIST_ARGS } = require('./gcloudCli');

const CONFIGS_JSON = JSON.stringify([
  { name: 'default', is_active: false, properties: { core: { project: 'homelab' } } },
  { name: 'ncaicloud', is_active: true, properties: { core: { project: 'ncaicloud', account: 'me@x.com' }, compute: { region: 'us-central1' } } },
]);

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
    'auth print-access-token': () => 'ya29.token\n',
  });
  const cli = createGcloudCli({ exec });
  const results = await Promise.all(Array.from({ length: 50 }, async () => {
    const configs = await cli.listConfigs();
    assert.ok(configs.some(c => c.name === 'ncaicloud'));
    return cli.getAccessToken('ncaicloud');
  }));
  assert.ok(results.every(t => t === 'ya29.token'));
  assert.equal(calls.filter(c => c === CONFIG_LIST_ARGS).length, 1);
  assert.equal(calls.filter(c => c.startsWith('auth print-access-token')).length, 1);
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
  const { exec, calls } = fakeExec({ 'auth print-access-token': args => `token-${args.split('=')[1]}-${++n}` });
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
  const { exec } = fakeExec({ 'auth print-access-token': () => '  \n' });
  const cli = createGcloudCli({ exec });
  await assert.rejects(cli.getAccessToken('x'), /No access token returned/);
});

test('invalidate drops cached configs and tokens', async () => {
  const { exec, calls } = fakeExec({
    'config configurations list': () => CONFIGS_JSON,
    'auth print-access-token': () => 'tok',
  });
  const cli = createGcloudCli({ exec });
  await cli.listConfigs();
  await cli.getAccessToken('ncaicloud');
  cli.invalidate();
  await cli.listConfigs();
  await cli.getAccessToken('ncaicloud');
  assert.equal(calls.length, 4);
});
