'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { mcpLaunch } = require('./launch');

test('installed app runs the unpacked server with its own executable in Node mode', () => {
  const launch = mcpLaunch({
    execPath: 'C:\\Users\\me\\AppData\\Local\\Programs\\KuaDashboard\\KuaDashboard.exe',
    electron: '31.7.7',
    rootDir: 'C:\\Users\\me\\AppData\\Local\\Programs\\KuaDashboard\\resources\\app.asar',
    port: '7190',
    platform: 'win32',
  });
  assert.deepEqual(launch, {
    packaged: true,
    command: 'C:\\Users\\me\\AppData\\Local\\Programs\\KuaDashboard\\KuaDashboard.exe',
    args: ['C:\\Users\\me\\AppData\\Local\\Programs\\KuaDashboard\\resources\\app.asar.unpacked\\mcp\\server.mjs'],
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

test('repository runs with node and passes KUA_URL when the port is not the default', () => {
  const launch = mcpLaunch({ execPath: '/usr/bin/node', rootDir: '/home/me/kuadashboard', port: 7192, platform: 'linux' });
  assert.deepEqual(launch, {
    packaged: false,
    command: 'node',
    args: ['/home/me/kuadashboard/mcp/server.mjs'],
    env: { KUA_URL: 'http://localhost:7192' },
  });
});
