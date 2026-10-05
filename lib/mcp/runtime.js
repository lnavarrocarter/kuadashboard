'use strict';
/**
 * lib/mcp/runtime.js
 * Where the KUA instances running on this computer listen, so the MCP server
 * finds the right one without KUA_URL: the installed app (7190), development
 * (7192) or any other port.
 *
 * Each backend writes ~/.kuadashboard/run/kua-<port>.json when it listens and
 * removes it when it stops. The folder is the same for every KUA of the user
 * (the data directory is not: Electron keeps its data in userData), and a
 * file left by a KUA that crashed is dropped when its process is gone.
 *
 * Shared by server.js (CommonJS) and mcp/server.mjs (ESM import), so the MCP
 * server of the installed app reads it from app.asar.unpacked (lib/mcp/**).
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DEFAULT_URL = 'http://localhost:7190';

/** KUA_RUN_DIR moves it (tests that start a real server). */
function runDir({ homeDir = os.homedir(), env = process.env } = {}) {
  return env.KUA_RUN_DIR || path.join(homeDir, '.kuadashboard', 'run');
}

/** process.kill(pid, 0) tests a process without signalling it; EPERM means it exists. */
function processAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (err) { return err.code === 'EPERM'; }
}

/**
 * Records this instance. Returns unregister(), which only removes the file
 * while it still belongs to this process (a newer KUA may own the port now).
 */
function registerInstance({ port, version, packaged = false, pid = process.pid, dir = runDir(), fileSystem = fs, now = () => Date.now() }) {
  const file = path.join(dir, `kua-${port}.json`);
  const record = { app: 'kua', url: `http://localhost:${port}`, port: Number(port), pid, version, packaged, startedAt: new Date(now()).toISOString() };
  fileSystem.mkdirSync(dir, { recursive: true });
  fileSystem.writeFileSync(file, JSON.stringify(record, null, 2));
  return function unregister() {
    try {
      const current = JSON.parse(fileSystem.readFileSync(file, 'utf8'));
      if (current.pid === pid) fileSystem.rmSync(file, { force: true });
    } catch { /* already gone */ }
  };
}

/** Instances whose process is alive, newest first; files of dead processes are removed. */
function listInstances({ dir = runDir(), fileSystem = fs, isAlive = processAlive } = {}) {
  let names = [];
  try { names = fileSystem.readdirSync(dir).filter(name => /^kua-\d+\.json$/.test(name)); } catch { return []; }
  const instances = [];
  for (const name of names) {
    const file = path.join(dir, name);
    let record = null;
    try { record = JSON.parse(fileSystem.readFileSync(file, 'utf8')); } catch { /* unreadable: treated as stale */ }
    if (record?.app === 'kua' && record.url && isAlive(record.pid)) instances.push(record);
    else { try { fileSystem.rmSync(file, { force: true }); } catch { /* not ours to remove */ } }
  }
  return instances.sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
}

/** GET /api/health of a candidate URL: the KUA version when it answers as KUA, otherwise null. */
async function probeKua(url, { fetchImpl = globalThis.fetch, timeoutMs = 1500 } = {}) {
  try {
    const response = await fetchImpl(new URL('/api/health', url), { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return null;
    const body = await response.json();
    return body?.ok ? { version: body.version || null } : null;
  } catch { return null; }
}

/**
 * Where the MCP server should read KUA: KUA_URL when set, else the newest
 * running instance that answers, else the installed app's default port.
 * `reachable` is false when nothing answered (KUA closed).
 */
async function resolveKua({ env = process.env, instances = () => listInstances(), probe = probeKua } = {}) {
  if (env.KUA_URL) {
    const found = await probe(env.KUA_URL);
    return { url: env.KUA_URL, source: 'env', reachable: !!found, version: found?.version || null };
  }
  for (const instance of instances()) {
    const found = await probe(instance.url);
    if (found) return { url: instance.url, source: 'running', reachable: true, version: found.version || instance.version || null };
  }
  const found = await probe(DEFAULT_URL);
  return { url: DEFAULT_URL, source: 'default', reachable: !!found, version: found?.version || null };
}

module.exports = { runDir, registerInstance, listInstances, probeKua, resolveKua, processAlive, DEFAULT_URL };
