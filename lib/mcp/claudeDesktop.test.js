'use strict';
// "Install in Claude Desktop" and the kua.mcpb manifest (#306).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { mcpbPath, openCommand, openMcpb } = require('./claudeDesktop');

const ROOT = path.join(__dirname, '..', '..');

test('kua.mcpb is found next to the app or in the repository, and opened with the default program', () => {
  assert.equal(mcpbPath('/opt/KUA/resources/app.asar'), path.join('/opt/KUA/resources/app.asar.unpacked', 'mcpb', 'dist', 'kua.mcpb'));
  assert.equal(mcpbPath(ROOT), path.join(ROOT, 'mcpb', 'dist', 'kua.mcpb'));
  assert.deepEqual(openCommand('/x/kua.mcpb', 'darwin'), { command: 'open', args: ['/x/kua.mcpb'] });
  assert.deepEqual(openCommand('C:/x/kua.mcpb', 'win32'), { command: 'explorer.exe', args: ['C:/x/kua.mcpb'] });
  assert.deepEqual(openCommand('/x/kua.mcpb', 'linux'), { command: 'xdg-open', args: ['/x/kua.mcpb'] });
});

test('opening resolves once the program starts, and a missing bundle or program is a clear error', async () => {
  const calls = [];
  const spawnImpl = (command, args, options) => {
    calls.push({ command, args, options });
    const child = new EventEmitter();
    child.unref = () => { child.unrefd = true; };
    setImmediate(() => (command === 'missing-program' ? child.emit('error', Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' })) : child.emit('spawn')));
    return child;
  };
  const opened = await openMcpb({ rootDir: '/opt/KUA/resources/app.asar', platform: 'darwin', spawnImpl, exists: () => true });
  assert.equal(opened.mode, 'mcpb');
  assert.equal(calls[0].command, 'open');
  assert.equal(calls[0].options.detached, true);
  await assert.rejects(openMcpb({ rootDir: ROOT, spawnImpl, exists: () => false }), { code: 'MCPB_MISSING' });
  const failing = (command, args, options) => spawnImpl('missing-program', args, options);
  await assert.rejects(openMcpb({ rootDir: ROOT, platform: 'linux', spawnImpl: failing, exists: () => true }), { code: 'OPEN_FAILED' });
});

test('the mcpb manifest starts the plugin launcher with the bundled Node, and its address is optional', async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'mcpb', 'manifest.json'), 'utf8'));
  assert.equal(manifest.manifest_version, '0.3');
  assert.equal(manifest.name, 'kua');
  assert.equal(manifest.server.type, 'node');
  assert.equal(manifest.server.entry_point, 'server/index.mjs');
  assert.deepEqual(manifest.server.mcp_config.args, ['${__dirname}/server/index.mjs']);
  assert.equal(manifest.user_config.kua_url.required, false);
  assert.equal(manifest.server.mcp_config.env.KUA_URL, '${user_config.kua_url}', 'an empty value is dropped by the launcher');
  const { manifestFor } = await import(path.join(ROOT, 'mcpb', 'build.mjs'));
  assert.equal(manifestFor(manifest, '2.0.0').version, '2.0.0');
  assert.ok(fs.existsSync(path.join(ROOT, 'plugins', 'kua', 'server', 'launcher.mjs')), 'the server it ships');
});
