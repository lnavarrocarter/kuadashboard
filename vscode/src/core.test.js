'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createKuaStatus } = require('./kuaStatus');
const { createMcpProvider, editorLaunch } = require('./mcpProvider');
const { withKuaServer } = require('./mcpJson');
const { dashboardTarget, launchKey, statusBar } = require('./presentation');

const LAUNCH = { command: '/Applications/KuaDashboard.app/Contents/MacOS/KuaDashboard', args: ['/Applications/KuaDashboard.app/Contents/Resources/app.asar.unpacked/mcp/server.mjs'], env: { ELECTRON_RUN_AS_NODE: '1' } };

function fakeFetch(routes) {
  const calls = [];
  const fetchImpl = async url => {
    calls.push(String(url));
    const body = routes[new URL(url).pathname];
    return body === undefined ? { ok: false, json: async () => ({}) } : { ok: true, json: async () => body };
  };
  return { calls, fetchImpl };
}

test('the running KUA is read with its plan, agent access and MCP launch', async () => {
  const { calls, fetchImpl } = fakeFetch({ '/api/system/plan': { plan: 'pro' }, '/api/kua-apps/agent-access': { enabled: true, writes: false }, '/api/system/mcp': LAUNCH });
  const seen = [];
  const kua = createKuaStatus({
    resolveKua: async ({ env }) => { seen.push(env); return { url: 'http://localhost:7190', reachable: true, version: '2.0.0', source: 'running' }; },
    listInstances: () => [{ url: 'http://localhost:7190', packaged: true }],
    fetchImpl,
  });
  assert.deepEqual(await kua.read(), {
    reachable: true, url: 'http://localhost:7190', version: '2.0.0', source: 'running', packaged: true,
    plan: 'pro', agents: { enabled: true, writes: false }, launch: LAUNCH,
  });
  assert.deepEqual(seen, [{}], 'no KUA_URL unless one is configured');
  assert.equal(calls.length, 3);
});

test('a configured URL is used, a closed KUA is not asked anything, and a missing field is null', async () => {
  const { calls, fetchImpl } = fakeFetch({ '/api/system/plan': { plan: 'free' } });
  const seen = [];
  const resolveKua = async ({ env }) => { seen.push(env); return { url: env.KUA_URL, reachable: env.KUA_URL.endsWith('7192'), version: null, source: 'env' }; };
  const closed = await createKuaStatus({ configuredUrl: () => 'http://localhost:7000', resolveKua, listInstances: () => [], fetchImpl }).read();
  assert.deepEqual(closed, { reachable: false, url: 'http://localhost:7000', version: null, source: 'env', packaged: null, plan: null, agents: null, launch: null });
  assert.deepEqual(calls, []);
  const open = await createKuaStatus({ configuredUrl: () => ' http://localhost:7192 ', resolveKua, listInstances: () => [], fetchImpl }).read();
  assert.deepEqual([open.plan, open.agents, open.launch], ['free', null, null]);
  assert.deepEqual(seen, [{ KUA_URL: 'http://localhost:7000' }, { KUA_URL: 'http://localhost:7192' }]);
});

test('the editor runs KUA development launches with its own Node, and passes a configured URL', () => {
  assert.deepEqual(editorLaunch(LAUNCH), { command: LAUNCH.command, args: LAUNCH.args, env: LAUNCH.env });
  assert.deepEqual(editorLaunch({ command: 'node', args: ['/repo/mcp/server.mjs'], env: {} }, { execPath: '/vscode/Code Helper', configuredUrl: 'http://localhost:7192' }), {
    command: '/vscode/Code Helper', args: ['/repo/mcp/server.mjs'], env: { ELECTRON_RUN_AS_NODE: '1', KUA_URL: 'http://localhost:7192' },
  });
  assert.equal(editorLaunch(null), null);
});

test('the provider offers one KUA server while a launch is known, none before', () => {
  class McpStdioServerDefinition { constructor(label, command, args, env, version) { Object.assign(this, { label, command, args, env, version }); } }
  let launch = null;
  const provider = createMcpProvider({ vscode: { McpStdioServerDefinition }, currentLaunch: () => launch, onDidChange: 'event' });
  assert.equal(provider.onDidChangeMcpServerDefinitions, 'event');
  assert.deepEqual(provider.provideMcpServerDefinitions(), []);
  launch = { ...LAUNCH, version: '2.0.0' };
  const [server] = provider.provideMcpServerDefinitions();
  assert.deepEqual({ ...server }, { label: 'KUA', command: LAUNCH.command, args: LAUNCH.args, env: LAUNCH.env, version: '2.0.0' });
  assert.equal(provider.resolveMcpServerDefinition(server), server);
});

test('mcp.json gets servers.kua and keeps other servers, inputs and comments', () => {
  const created = JSON.parse(withKuaServer('', LAUNCH));
  assert.deepEqual(created, { servers: { kua: { type: 'stdio', command: LAUNCH.command, args: LAUNCH.args, env: LAUNCH.env } } });
  const existing = '{\n  // team servers\n  "inputs": [],\n  "servers": {\n    "github": { "type": "http", "url": "https://api.githubcopilot.com/mcp/" },\n    "kua": { "type": "stdio", "command": "old" },\n  }\n}\n';
  const updated = withKuaServer(existing, { command: 'node', args: ['/repo/mcp/server.mjs'], env: {} });
  assert.match(updated, /\/\/ team servers/);
  assert.match(updated, /"github"/);
  assert.doesNotMatch(updated, /"old"/);
  assert.match(updated, /\/repo\/mcp\/server\.mjs/);
  assert.doesNotMatch(updated, /"env"/, 'an empty env is left out');
  assert.throws(() => withKuaServer('{ "servers": ', LAUNCH), { code: 'INVALID_JSON' });
  assert.throws(() => withKuaServer('{ "servers": [] }', LAUNCH), { code: 'INVALID_JSON' });
  assert.throws(() => withKuaServer('[]', LAUNCH), { code: 'INVALID_JSON' });
});

test('the status bar says whether KUA runs and whether agents are allowed', () => {
  assert.equal(statusBar(null).text, '$(sync~spin) KUA');
  assert.deepEqual([statusBar({ reachable: false }).text, statusBar({ reachable: false }).warning], ['$(debug-disconnect) KUA', true]);
  const on = statusBar({ reachable: true, url: 'http://localhost:7190', version: '2.0.0', plan: 'pro', agents: { enabled: true, writes: true } });
  assert.equal(on.text, '$(server) KUA');
  assert.match(on.tooltip, /KUA 2\.0\.0 at http:\/\/localhost:7190\nPlan: pro\nAgents can read and propose/);
  const off = statusBar({ reachable: true, url: 'u', version: '2.0.0', agents: { enabled: false, writes: false } });
  assert.deepEqual([off.text, off.warning], ['$(circle-slash) KUA', true]);
});

test('Open dashboard goes to the desktop app, or to the browser for a KUA run from the repository', () => {
  const packaged = { reachable: true, url: 'http://localhost:7190', packaged: true };
  const dev = { reachable: true, url: 'http://localhost:7192', packaged: false };
  assert.deepEqual(dashboardTarget(packaged), { kind: 'app', uri: 'kua://open' });
  assert.deepEqual(dashboardTarget(dev, { params: { view: 'kuapps', app: 'a 1', tab: 'review', other: 'x' } }), { kind: 'browser', uri: 'http://localhost:7192/?view=kuapps&app=a+1&tab=review' });
  assert.deepEqual(dashboardTarget(packaged, { openIn: 'browser' }).kind, 'browser');
  assert.deepEqual(dashboardTarget(dev, { openIn: 'app' }).kind, 'app');
  assert.deepEqual(dashboardTarget({ reachable: false }), { kind: 'app', uri: 'kua://open' }, 'a closed app is started');
});

test('the server definition changes when KUA starts, stops or changes version', () => {
  const base = { launch: LAUNCH, version: '2.0.0', reachable: true };
  assert.equal(launchKey(base), launchKey({ ...base }));
  assert.notEqual(launchKey(base), launchKey({ ...base, version: '2.1.0' }));
  assert.equal(launchKey({ reachable: false, launch: null }), '');
});
