'use strict';
// The launcher of the Claude Code plugin (plugins/kua/server/launcher.mjs, #305).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { recordLaunch } = require('./runtime');

const LAUNCHER = path.join(__dirname, '..', '..', 'plugins', 'kua', 'server', 'launcher.mjs');
const launcher = import(LAUNCHER);
const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kua-plugin-'));

/** Runs the launcher, sends JSON-RPC lines and returns the answers by id. */
function run({ runDir, messages }) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [LAUNCHER], { env: { ...process.env, KUA_RUN_DIR: runDir }, stdio: ['pipe', 'pipe', 'pipe'] });
    const answers = new Map();
    let buffer = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('the launcher did not answer')); }, 10000);
    child.stdout.on('data', chunk => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const message = JSON.parse(buffer.slice(0, index));
        buffer = buffer.slice(index + 1);
        answers.set(message.id, message);
        if (answers.size === messages.filter(item => item.id !== undefined).length) { clearTimeout(timer); child.kill(); resolve(answers); }
      }
    });
    for (const message of messages) child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
  });
}

test('the recorded launch is read, and a program that is gone counts as no KUA', async () => {
  const { readLaunch } = await launcher;
  const dir = tempDir();
  assert.equal(readLaunch({ dir }), null);
  const program = path.join(dir, 'KuaDashboard');
  fs.writeFileSync(program, '');
  recordLaunch({ launch: { command: program, args: ['server.mjs'], env: {} }, version: '2.0.0', packaged: true, dir });
  assert.equal(readLaunch({ dir }).command, program);
  fs.rmSync(program);
  assert.equal(readLaunch({ dir }), null, 'KUA was uninstalled');
  recordLaunch({ launch: { command: 'node', args: ['/repo/mcp/server.mjs'], env: {} }, version: '2.0.0', dir });
  assert.equal(readLaunch({ dir }).command, 'node', 'a command from PATH is not checked on disk');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('without KUA it still speaks MCP: no tools, and an instruction to install and open KUA', async () => {
  const { answerWithoutKua, NOT_INSTALLED } = await launcher;
  const init = answerWithoutKua({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
  assert.equal(init.result.instructions, NOT_INSTALLED);
  assert.deepEqual(answerWithoutKua({ id: 2, method: 'tools/list' }).result, { tools: [] });
  assert.equal(answerWithoutKua({ id: 3, method: 'tools/call' }).error.message, NOT_INSTALLED);
  assert.equal(answerWithoutKua({ method: 'notifications/initialized' }), null);

  const dir = tempDir();
  const answers = await run({ runDir: dir, messages: [{ id: 1, method: 'initialize', params: {} }, { method: 'notifications/initialized' }, { id: 2, method: 'tools/list' }] });
  assert.match(answers.get(1).result.instructions, /Install KuaDashboard/);
  assert.deepEqual(answers.get(2).result.tools, []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('with a recorded launch it runs that MCP server with stdio passed through', async () => {
  const dir = tempDir();
  // A stand-in for KUA's server: answers initialize with its own name and the env it got.
  const server = path.join(dir, 'server.mjs');
  fs.writeFileSync(server, `
    import { createInterface } from 'node:readline'
    createInterface({ input: process.stdin }).on('line', line => {
      const message = JSON.parse(line)
      if (message.id !== undefined) process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { serverInfo: { name: 'kua-real' }, env: process.env.KUA_TEST_ENV } }) + '\\n')
    })
  `);
  recordLaunch({ launch: { command: process.execPath, args: [server], env: { KUA_TEST_ENV: 'from-record' } }, version: '2.0.0', packaged: true, dir });
  const answers = await run({ runDir: dir, messages: [{ id: 7, method: 'initialize', params: {} }] });
  assert.equal(answers.get(7).result.serverInfo.name, 'kua-real');
  assert.equal(answers.get(7).result.env, 'from-record');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the plugin and the marketplace point at the launcher', () => {
  const root = path.join(__dirname, '..', '..');
  const marketplace = JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin', 'marketplace.json'), 'utf8'));
  const entry = marketplace.plugins.find(plugin => plugin.name === 'kua');
  const pluginDir = path.join(root, entry.source);
  const manifest = JSON.parse(fs.readFileSync(path.join(pluginDir, '.claude-plugin', 'plugin.json'), 'utf8'));
  assert.equal(manifest.name, entry.name, 'entry and manifest names match');
  assert.equal(manifest.version, require(path.join(root, 'package.json')).version, 'the plugin follows the KUA version');
  const mcp = JSON.parse(fs.readFileSync(path.join(pluginDir, '.mcp.json'), 'utf8'));
  assert.deepEqual(mcp.mcpServers.kua.args, ['${CLAUDE_PLUGIN_ROOT}/server/launcher.mjs']);
  assert.ok(fs.existsSync(path.join(pluginDir, 'server', 'launcher.mjs')));
  assert.ok(fs.existsSync(path.join(pluginDir, 'skills', 'kua', 'SKILL.md')));
});

test('KUA copies its plugin to a local marketplace that Claude Code can install from', () => {
  const { claudePluginDir, pluginSourceDir, syncClaudePlugin } = require('./claudePlugin');
  const root = path.join(__dirname, '..', '..');
  const runDir = path.join(tempDir(), 'run');
  const target = claudePluginDir({ dir: runDir });
  assert.equal(path.basename(target), 'claude-plugin');
  assert.equal(pluginSourceDir('/opt/KUA/resources/app.asar'), '/opt/KUA/resources/app.asar.unpacked');
  assert.equal(pluginSourceDir(root), root);

  fs.mkdirSync(path.join(target, 'plugins', 'kua'), { recursive: true });
  fs.writeFileSync(path.join(target, 'plugins', 'kua', 'stale.txt'), 'from an older KUA');
  assert.equal(syncClaudePlugin({ sourceDir: root, targetDir: target }), target);
  assert.ok(fs.existsSync(path.join(target, '.claude-plugin', 'marketplace.json')));
  assert.ok(fs.existsSync(path.join(target, 'plugins', 'kua', 'server', 'launcher.mjs')));
  assert.ok(!fs.existsSync(path.join(target, 'plugins', 'kua', 'stale.txt')), 'files of an older plugin are gone');
  assert.throws(() => syncClaudePlugin({ sourceDir: path.join(root, 'nope'), targetDir: target }), { code: 'PLUGIN_MISSING' });
  fs.rmSync(path.dirname(runDir), { recursive: true, force: true });
});

test('an empty or unfilled KUA_URL is dropped so the server finds KUA by itself', async () => {
  const { serverEnv } = await launcher;
  assert.equal(serverEnv({ KUA_URL: '' }).KUA_URL, undefined);
  assert.equal(serverEnv({ KUA_URL: '${user_config.kua_url}' }).KUA_URL, undefined);
  assert.equal(serverEnv({ KUA_URL: 'http://localhost:7192' }).KUA_URL, 'http://localhost:7192');
  assert.deepEqual(serverEnv({ A: '1' }, { B: '2' }), { A: '1', B: '2' });
});
