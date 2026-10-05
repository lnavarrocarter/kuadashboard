'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { verifyMcp, installMcp, installSteps, cmdArg, runCli } = require('./clientSetup');

const SERVER = path.join(__dirname, '..', '..', 'mcp', 'server.mjs');
const LAUNCH = { command: 'C:/Programs/KuaDashboard/KuaDashboard.exe', args: ['C:/Programs/KuaDashboard/resources/app.asar.unpacked/mcp/server.mjs'], env: { ELECTRON_RUN_AS_NODE: '1' } };

test('install replaces a previous "kua" entry of Claude Code and Codex at user scope', () => {
  assert.deepEqual(installSteps('claude', LAUNCH), [
    { args: ['mcp', 'remove', 'kua', '--scope', 'user'], optional: true },
    { args: ['mcp', 'add', 'kua', '--scope', 'user', '-e', 'ELECTRON_RUN_AS_NODE=1', '--', LAUNCH.command, ...LAUNCH.args] },
  ]);
  assert.deepEqual(installSteps('codex', LAUNCH)[1], { args: ['mcp', 'add', 'kua', '--env', 'ELECTRON_RUN_AS_NODE=1', '--', LAUNCH.command, ...LAUNCH.args] });
  assert.throws(() => installSteps('cursor', LAUNCH), /Unknown client/);
});

test('installMcp ignores a missing previous entry and reports a failed add', async () => {
  const calls = [];
  const run = async (program, args) => { calls.push([program, args[1]]); return args[1] === 'remove' ? { code: 1, output: 'No MCP server named kua' } : { code: 0, output: 'Added kua' }; };
  assert.deepEqual(await installMcp({ client: 'claude', launch: LAUNCH, run }), { client: 'claude', name: 'kua', output: 'Added kua' });
  assert.deepEqual(calls, [['claude', 'remove'], ['claude', 'add']]);

  const failing = async (_program, args) => (args[1] === 'add' ? { code: 1, output: 'invalid scope' } : { code: 0, output: '' });
  await assert.rejects(installMcp({ client: 'codex', launch: LAUNCH, run: failing }), err => err.code === 'INSTALL_FAILED' && /invalid scope/.test(err.message));
  await assert.rejects(installMcp({ client: 'x', launch: LAUNCH, run }), err => err.code === 'UNKNOWN_CLIENT');
});

test('cmd.exe arguments are quoted, and quotes or % are refused instead of escaped', () => {
  assert.equal(cmdArg('C:/Users/Ana María/app.exe'), '"C:/Users/Ana María/app.exe"');
  assert.throws(() => cmdArg('a"b'), err => err.code === 'UNSAFE_ARGUMENT');
  assert.throws(() => cmdArg('%PATH%'), err => err.code === 'UNSAFE_ARGUMENT');
});

test('verify starts the real MCP server and reaches KUA through it', async () => {
  const kua = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/health') return res.end(JSON.stringify({ ok: true, app: 'kua', version: '1.17.0' }));
    if (req.url === '/api/cloud/envs/profiles') return res.end(JSON.stringify([{ id: 'p1', name: 'prod', provider: 'aws' }, { id: 'p2', name: 'analytics', provider: 'gcp' }]));
    res.statusCode = 404;
    res.end('{}');
  });
  await new Promise(resolve => kua.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${kua.address().port}`;
  try {
    const result = await verifyMcp({ launch: { command: process.execPath, args: [SERVER], env: { KUA_URL: url } } });
    assert.equal(result.ok, true, result.error);
    assert.ok(result.tools >= 10);
    assert.equal(result.profiles, 2);
    assert.deepEqual(result.kua, { url, source: 'env', reachable: true, version: '1.17.0' });
  } finally {
    kua.close();
  }
});

test('verify explains a server that cannot start or a KUA that is closed', async () => {
  const missing = await verifyMcp({ launch: { command: path.join(__dirname, 'no-such-program'), args: [], env: {} } });
  assert.equal(missing.ok, false);
  assert.match(missing.error, /was not found on this computer|could not start/);

  const closed = await verifyMcp({ launch: { command: process.execPath, args: [SERVER], env: { KUA_URL: 'http://127.0.0.1:1' } } });
  assert.equal(closed.ok, false);
  assert.equal(closed.kua.reachable, false);
  assert.match(closed.error, /KUA is not reachable at http:\/\/127\.0\.0\.1:1/);
});

test('runCli on Windows checks the program with `where` and keeps its name unquoted for cmd.exe', async () => {
  const spawned = [];
  const fakeSpawn = found => (command, args, options) => {
    spawned.push({ command, args, shell: !!options.shell });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    setImmediate(() => child.emit('close', command === 'where' ? (found ? 0 : 1) : 0));
    return child;
  };
  await runCli('claude', ['mcp', 'add', 'kua', '--', 'C:/Program Files/KUA/KuaDashboard.exe'], { spawnImpl: fakeSpawn(true), platform: 'win32' });
  assert.deepEqual(spawned, [
    { command: 'where', args: ['claude'], shell: false },
    { command: 'claude "mcp" "add" "kua" "--" "C:/Program Files/KUA/KuaDashboard.exe"', args: [], shell: true },
  ]);
  await assert.rejects(runCli('codex', ['mcp', 'list'], { spawnImpl: fakeSpawn(false), platform: 'win32' }), err => err.code === 'CLI_NOT_FOUND');
  await assert.rejects(runCli('claude & calc', [], { spawnImpl: fakeSpawn(true), platform: 'win32' }), err => err.code === 'UNSAFE_ARGUMENT');
});
