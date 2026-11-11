'use strict';

// Invoked only by --kua-smoke-test in CI. No dashboard, credential vault,
// protocol registration or production update request is started.
async function run() {
  const { app } = require('electron');
  const assert = require('node:assert/strict');
  const fs = require('node:fs');
  const path = require('node:path');
  const http = require('node:http');
  const temporary = process.env.KUA_PACKAGED_SMOKE_DATA;
  assert.equal(typeof temporary, 'string', 'Launch the smoke test through its runner');
  fs.mkdirSync(temporary, { recursive: true });
  app.setPath('userData', temporary);
  await app.whenReady();
  assert.equal(app.isPackaged, true, 'Smoke test must run in the actual package');
  const manifest = require('../package.json');
  assert.equal(app.getVersion(), manifest.version);
  const Database = require('better-sqlite3');
  const database = new Database(':memory:');
  assert.equal(database.prepare('select 42 as value').get().value, 42);
  database.close();
  assert.equal(typeof require('ssh2').Client, 'function', 'SSH JavaScript fallback must load');
  assert.equal(typeof require('bunyan').createLogger, 'function', 'Logging fallback must load');
  const yaml = require('js-yaml');
  const updateConfig = yaml.load(fs.readFileSync(path.join(process.resourcesPath, 'app-update.yml'), 'utf8'));
  assert.equal(updateConfig.provider, 'github');
  assert.equal(updateConfig.owner, 'lnavarrocarter');
  assert.equal(updateConfig.repo, 'kuadashboard');

  let checks = 0;
  const server = http.createServer((req, res) => {
    checks++;
    if (!req.url.split('?')[0].endsWith('.yml')) {
      res.writeHead(500).end('Unexpected download');
      return;
    }
    const extension = process.platform === 'darwin' ? 'zip' : process.platform === 'win32' ? 'exe' : 'AppImage';
    res.setHeader('Content-Type', 'text/yaml');
    res.end(yaml.dump({ version: '99.0.0', files: [{ url: `smoke.${extension}`, sha512: Buffer.alloc(64).toString('base64'), size: 1 }], path: `smoke.${extension}`, sha512: Buffer.alloc(64).toString('base64'), releaseDate: new Date().toISOString() }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.logger = null;
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    // An unpacked Linux directory has no APPIMAGE variable; the real runtime
    // and updater still exercise their complete metadata-checking path.
    autoUpdater.forceDevUpdateConfig = true;
    autoUpdater.setFeedURL({ provider: 'generic', url: `http://127.0.0.1:${server.address().port}` });
    const result = await autoUpdater.checkForUpdates();
    assert.equal(result.updateInfo.version, '99.0.0');
    assert.equal(result.downloadPromise, null);
    assert.equal(checks, 1);
    const evidence = { platform: process.platform, arch: process.arch, electron: process.versions.electron, node: process.versions.node, sqlite: true, updater: 'metadata-check-passed', version: manifest.version };
    if (process.env.KUA_PACKAGED_SMOKE_RESULT) fs.writeFileSync(process.env.KUA_PACKAGED_SMOKE_RESULT, JSON.stringify(evidence));
    console.log(JSON.stringify(evidence));
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
  app.exit(0);
}
module.exports = { run };
