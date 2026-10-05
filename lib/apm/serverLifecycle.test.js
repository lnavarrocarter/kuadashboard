'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { SCHEMA_VERSION } = require('./database');

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

function waitForOutput(stream, text, child, stderr) {
  return new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(new Error(`Server startup timed out: ${stderr()}`)), 10000);
    stream.on('data', chunk => {
      output += chunk.toString();
      if (output.includes(text)) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      reject(new Error(`Server exited during startup (${code ?? signal}): ${stderr()}`));
    });
  });
}

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Server did not exit after SIGTERM')), 7000);
    child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal });
    });
  });
}

// Windows has no catchable SIGTERM: child.kill() terminates the process immediately,
// so a graceful shutdown cannot be observed there.
test('server reports SQLite health and closes cleanly on SIGTERM', {
  skip: process.platform === 'win32' && 'SIGTERM cannot be handled by Node on Windows',
}, async () => {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'kua-apm-server-'));
  const runDirectory = path.join(dataDirectory, 'run');
  const port = await availablePort();
  let child;
  let stderr = '';

  try {
    child = spawn(process.execPath, ['server.js'], {
      cwd: path.join(__dirname, '..', '..'),
      env: {
        ...process.env,
        PORT: String(port),
        KUA_DATA_DIR: dataDirectory,
        KUA_RUN_DIR: runDirectory,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });

    await waitForOutput(child.stdout, 'KuaDashboard running', child, () => stderr);
    const response = await fetch(`http://127.0.0.1:${port}/api/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      app: 'kua',
      version: require('../../package.json').version,
      status: 'healthy',
      apm: { ready: true, schemaVersion: SCHEMA_VERSION, journalMode: 'wal' },
      apmScheduler: { running: true, activeScopes: 0, intervalMinutes: 30 },
    });
    // While it runs, the MCP server can find it (lib/mcp/runtime.js)…
    const instanceFile = path.join(runDirectory, `kua-${port}.json`);
    assert.equal(JSON.parse(fs.readFileSync(instanceFile, 'utf8')).url, `http://localhost:${port}`);

    const exitPromise = waitForExit(child);
    child.kill('SIGTERM');
    assert.deepEqual(await exitPromise, { code: 0, signal: null });
    child = null;
    // …and a clean shutdown removes the record.
    assert.equal(fs.existsSync(instanceFile), false);

    assert.equal(fs.existsSync(path.join(dataDirectory, 'apm-observability.sqlite3')), true);
    assert.equal(fs.existsSync(path.join(dataDirectory, 'apm-observability.sqlite3-wal')), false);
  } finally {
    if (child?.exitCode === null) child.kill('SIGKILL');
    fs.rmSync(dataDirectory, { recursive: true, force: true });
  }
});
