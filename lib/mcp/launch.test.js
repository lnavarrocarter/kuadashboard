'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { mcpLaunch } = require('./launch');

test('installed app runs the unpacked server with its own executable in Node mode, with forward slashes on Windows', () => {
  const launch = mcpLaunch({
    execPath: 'C:\\Users\\me\\AppData\\Local\\Programs\\KuaDashboard\\KuaDashboard.exe',
    electron: '31.7.7',
    rootDir: 'C:\\Users\\me\\AppData\\Local\\Programs\\KuaDashboard\\resources\\app.asar',
    port: '7190',
    platform: 'win32',
  });
  assert.deepEqual(launch, {
    packaged: true,
    // Pasted into bash, unquoted backslashes disappear (C:\Users\me → C:Usersme, #133).
    command: 'C:/Users/me/AppData/Local/Programs/KuaDashboard/KuaDashboard.exe',
    args: ['C:/Users/me/AppData/Local/Programs/KuaDashboard/resources/app.asar.unpacked/mcp/server.mjs'],
    env: { ELECTRON_RUN_AS_NODE: '1' },
  });
});

test('macOS app bundle uses the unpacked path inside Resources', () => {
  const launch = mcpLaunch({
    execPath: '/Applications/KuaDashboard.app/Contents/MacOS/KuaDashboard',
    electron: '31.7.7',
    rootDir: '/Applications/KuaDashboard.app/Contents/Resources/app.asar',
    platform: 'darwin',
  });
  assert.equal(launch.args[0], '/Applications/KuaDashboard.app/Contents/Resources/app.asar.unpacked/mcp/server.mjs');
});

test('repository runs with node and no KUA_URL: the server finds the running KUA on any port', () => {
  const launch = mcpLaunch({ execPath: '/usr/bin/node', rootDir: '/home/me/kuadashboard', platform: 'linux' });
  assert.deepEqual(launch, {
    packaged: false,
    command: 'node',
    args: ['/home/me/kuadashboard/mcp/server.mjs'],
    env: {},
  });
});

test('repository on Windows uses forward slashes too', () => {
  const launch = mcpLaunch({ execPath: 'C:\\Program Files\\nodejs\\node.exe', rootDir: 'C:\\Users\\me\\.dev\\kuadashboard', platform: 'win32' });
  assert.deepEqual(launch.args, ['C:/Users/me/.dev/kuadashboard/mcp/server.mjs']);
  assert.equal(launch.command, 'node');
});
