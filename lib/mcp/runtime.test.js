'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { registerInstance, listInstances, resolveKua, probeKua, readLaunch, recordLaunch, DEFAULT_URL } = require('./runtime');

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kua-run-'));

test('a running KUA records where it listens and removes the record when it stops', () => {
  const dir = tempDir();
  const unregister = registerInstance({ port: 7192, version: '1.17.0', pid: process.pid, dir, now: () => Date.parse('2026-10-05T10:00:00Z') });
  assert.deepEqual(listInstances({ dir }), [{ app: 'kua', url: 'http://localhost:7192', port: 7192, pid: process.pid, version: '1.17.0', packaged: false, startedAt: '2026-10-05T10:00:00.000Z' }]);
  unregister();
  assert.deepEqual(listInstances({ dir }), []);
});

test('unregister leaves a newer KUA that took the same port alone', () => {
  const dir = tempDir();
  const unregister = registerInstance({ port: 7190, version: '1', pid: 111, dir });
  registerInstance({ port: 7190, version: '2', pid: 222, dir });
  unregister();
  assert.equal(listInstances({ dir, isAlive: () => true })[0].pid, 222);
});

test('instances of processes that are gone are dropped; the newest comes first', () => {
  const dir = tempDir();
  registerInstance({ port: 7190, version: '1', pid: 1, dir, now: () => 1000 });
  registerInstance({ port: 7192, version: '1', pid: 2, dir, now: () => 3000 });
  registerInstance({ port: 7199, version: '1', pid: 3, dir, now: () => 2000 });
  fs.writeFileSync(path.join(dir, 'kua-7200.json'), 'not json');
  const alive = new Set([2, 3]);
  assert.deepEqual(listInstances({ dir, isAlive: pid => alive.has(pid) }).map(i => i.port), [7192, 7199]);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['kua-7192.json', 'kua-7199.json']);
  assert.deepEqual(listInstances({ dir: path.join(dir, 'missing') }), []);
});

test('resolveKua: KUA_URL first, then the newest instance that answers, then the default port', async () => {
  const answers = { 'http://localhost:7192': { version: '1.17.0' }, 'http://custom:9000': { version: '1.16.0' } };
  const probe = async url => answers[url] || null;
  const instances = () => [{ url: 'http://localhost:7300', version: 'x' }, { url: 'http://localhost:7192', version: '1.17.0' }];

  assert.deepEqual(await resolveKua({ env: { KUA_URL: 'http://custom:9000' }, instances, probe }), { url: 'http://custom:9000', source: 'env', reachable: true, version: '1.16.0' });
  assert.deepEqual(await resolveKua({ env: {}, instances, probe }), { url: 'http://localhost:7192', source: 'running', reachable: true, version: '1.17.0' });
  assert.deepEqual(await resolveKua({ env: {}, instances: () => [], probe }), { url: DEFAULT_URL, source: 'default', reachable: false, version: null });
});

test('probeKua accepts only an answering KUA', async () => {
  const reply = body => async () => new Response(JSON.stringify(body), { status: 200 });
  assert.deepEqual(await probeKua('http://localhost:7190', { fetchImpl: reply({ ok: true, app: 'kua', version: '1.17.0' }) }), { version: '1.17.0' });
  assert.equal(await probeKua('http://localhost:7190', { fetchImpl: reply({ status: 'other app' }) }), null);
  assert.equal(await probeKua('http://localhost:7190', { fetchImpl: async () => new Response('', { status: 404 }) }), null);
  assert.equal(await probeKua('http://localhost:7190', { fetchImpl: async () => { throw new TypeError('fetch failed'); } }), null);
});

test('the MCP launch is kept after KUA stops, and a development KUA does not replace the installed app', () => {
  const dir = tempDir();
  const installed = path.join(dir, 'KuaDashboard');
  fs.writeFileSync(installed, '');
  const app = { command: installed, args: ['/app/app.asar.unpacked/mcp/server.mjs'], env: { ELECTRON_RUN_AS_NODE: '1' } };
  const dev = { command: 'node', args: ['/repo/mcp/server.mjs'], env: {} };
  assert.equal(readLaunch({ dir }), null);
  assert.equal(recordLaunch({ launch: dev, version: '2.0.0', dir }), true, 'nothing recorded yet');
  assert.equal(readLaunch({ dir }).command, 'node');
  assert.equal(recordLaunch({ launch: app, version: '2.0.0', packaged: true, dir, now: () => 1000 }), true);
  assert.equal(recordLaunch({ launch: dev, version: '2.1.0', dir }), false, 'the installed app wins');
  assert.deepEqual(readLaunch({ dir }), { ...app, version: '2.0.0', packaged: true, writtenAt: new Date(1000).toISOString() });
  fs.rmSync(installed);
  assert.equal(recordLaunch({ launch: dev, version: '2.1.0', dir }), true, 'an uninstalled app no longer blocks it');
  assert.equal(recordLaunch({ launch: null, version: '1', dir }), false);
  fs.writeFileSync(path.join(dir, 'mcp-launch.json'), '{ broken');
  assert.equal(readLaunch({ dir }), null);
  fs.rmSync(dir, { recursive: true, force: true });
});
