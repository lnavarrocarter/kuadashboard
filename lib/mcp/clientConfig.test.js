'use strict';
// Gemini CLI, Cursor, Windsurf and Kiro: KUA's entry in their MCP files (#307, #213).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { configFile, configStatus, installInConfig, uninstallFromConfig } = require('./clientConfig');

const LAUNCH = { command: '/Applications/KuaDashboard.app/Contents/MacOS/KuaDashboard', args: ['/Applications/KuaDashboard.app/Contents/Resources/app.asar.unpacked/mcp/server.mjs'], env: { ELECTRON_RUN_AS_NODE: '1' } };
const home = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kua-agents-'));
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));

test('each agent has its file in the home folder', () => {
  assert.equal(configFile('gemini', { home: '/h' }), path.join('/h', '.gemini', 'settings.json'));
  assert.equal(configFile('cursor', { home: '/h' }), path.join('/h', '.cursor', 'mcp.json'));
  assert.equal(configFile('windsurf', { home: '/h' }), path.join('/h', '.codeium', 'windsurf', 'mcp_config.json'));
  assert.equal(configFile('kiro', { home: '/h', env: {} }), path.join('/h', '.kiro', 'settings', 'mcp.json'));
  assert.equal(configFile('kiro', { home: '/h', env: { KIRO_HOME: '/k' } }), path.join('/k', 'settings', 'mcp.json'), 'KIRO_HOME moves ~/.kiro');
  assert.throws(() => configFile('zed', { home: '/h' }), { code: 'UNKNOWN_CLIENT' });
});

test('a missing file is created with only KUA', () => {
  const dir = home();
  for (const client of ['gemini', 'cursor', 'windsurf', 'kiro']) {
    const { file } = installInConfig({ client, launch: LAUNCH, home: dir });
    assert.deepEqual(read(file), { mcpServers: { kua: { command: LAUNCH.command, args: LAUNCH.args, env: LAUNCH.env } } });
  }
  assert.deepEqual(installInConfig({ client: 'cursor', launch: { command: 'node', args: ['/repo/mcp/server.mjs'], env: {} }, home: dir }).mode, 'config');
  assert.deepEqual(read(configFile('cursor', { home: dir })).mcpServers.kua, { command: 'node', args: ['/repo/mcp/server.mjs'] }, 'replaced, and an empty env is left out');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('other servers and settings stay as they were after installing and uninstalling', () => {
  const dir = home();
  const file = configFile('gemini', { home: dir });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const original = { theme: 'GitHub', selectedAuthType: 'oauth-personal', mcpServers: { github: { httpUrl: 'https://example.test/mcp' }, kua: { command: 'old' } } };
  fs.writeFileSync(file, JSON.stringify(original));
  installInConfig({ client: 'gemini', launch: LAUNCH, home: dir });
  const installed = read(file);
  assert.equal(installed.theme, 'GitHub');
  assert.deepEqual(installed.mcpServers.github, original.mcpServers.github);
  assert.equal(installed.mcpServers.kua.command, LAUNCH.command);
  assert.equal(uninstallFromConfig({ client: 'gemini', home: dir }).removed, true);
  assert.deepEqual(read(file), { theme: 'GitHub', selectedAuthType: 'oauth-personal', mcpServers: { github: original.mcpServers.github } });
  assert.equal(uninstallFromConfig({ client: 'gemini', home: dir }).removed, false, 'nothing to remove the second time');
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['settings.json'], 'no temporary file left behind');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('an invalid file is never rewritten, and the status says which agents have KUA', () => {
  const dir = home();
  const cursor = configFile('cursor', { home: dir });
  fs.mkdirSync(path.dirname(cursor), { recursive: true });
  fs.writeFileSync(cursor, '{ "mcpServers": { // a comment\n } }');
  assert.throws(() => installInConfig({ client: 'cursor', launch: LAUNCH, home: dir }), { code: 'INVALID_CONFIG' });
  assert.equal(fs.readFileSync(cursor, 'utf8'), '{ "mcpServers": { // a comment\n } }');
  fs.writeFileSync(cursor, '{ "mcpServers": [] }');
  assert.throws(() => installInConfig({ client: 'cursor', launch: LAUNCH, home: dir }), { code: 'INVALID_CONFIG' });
  fs.writeFileSync(cursor, '');
  installInConfig({ client: 'windsurf', launch: LAUNCH, home: dir });
  assert.deepEqual(configStatus({ home: dir }).map(({ client, present, added }) => [client, present, added]), [
    ['gemini', false, false],
    ['cursor', true, false],
    ['windsurf', true, true],
    ['kiro', false, false],
  ]);
  fs.writeFileSync(cursor, 'nope');
  assert.equal(configStatus({ home: dir }).find(item => item.client === 'cursor').error, 'INVALID_CONFIG');
  fs.rmSync(dir, { recursive: true, force: true });
});
