'use strict';
/**
 * lib/dataStorage.js
 * Disk usage of KUA's local data directory (KUA_DATA_DIR or ~/.kuadashboard):
 * every file with its size, and for each SQLite database its pages, free
 * space, journal mode and per-table rows (and bytes when dbstat is available).
 * Read-only: databases are opened with `readonly` and nothing is modified.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const KNOWN_FILES = {
  'apm-observability.sqlite3': { id: 'apm', label: 'APM observability' },
  'architecture.sqlite3': { id: 'architecture', label: 'Architecture' },
  'aws-cost-cache.json': { id: 'awsCostCache', label: 'AWS cost cache' },
  'audit.log': { id: 'audit', label: 'Audit log' },
};

function resolveDataDir() {
  return process.env.KUA_DATA_DIR || path.join(os.homedir(), '.kuadashboard');
}

function fileKind(name) {
  if (/\.sqlite3?-wal$/.test(name)) return 'sqlite-wal';
  if (/\.sqlite3?-shm$/.test(name)) return 'sqlite-shm';
  if (/\.(sqlite3?|db)$/.test(name)) return 'sqlite';
  if (name.endsWith('.json')) return 'json';
  if (name.endsWith('.log')) return 'log';
  return 'other';
}

function statSafe(file, fileSystem) {
  try { return fileSystem.statSync(file); } catch { return null; }
}

// Sizes of every file under the directory (one level of subfolders is summed).
function listFiles(dir, fileSystem) {
  let entries;
  try { entries = fileSystem.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  return entries.map(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const inner = listFiles(full, fileSystem);
      return {
        name: `${entry.name}/`, kind: 'folder', files: inner.length,
        bytes: inner.reduce((sum, f) => sum + f.bytes, 0),
        modifiedAt: inner.reduce((max, f) => Math.max(max, f.modifiedAt || 0), 0) || null,
      };
    }
    const stat = statSafe(full, fileSystem);
    return { name: entry.name, kind: fileKind(entry.name), bytes: stat?.size || 0, modifiedAt: stat ? stat.mtimeMs : null, ...(KNOWN_FILES[entry.name] || {}) };
  }).sort((a, b) => b.bytes - a.bytes);
}

function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function inspectSqlite(file, { Database, fileSystem }) {
  const name = path.basename(file);
  const size = suffix => statSafe(file + suffix, fileSystem)?.size || 0;
  const base = { name, ...(KNOWN_FILES[name] || { id: name, label: name }), mainBytes: size(''), walBytes: size('-wal'), shmBytes: size('-shm') };
  base.bytes = base.mainBytes + base.walBytes + base.shmBytes;
  let db;
  try {
    db = new Database(file, { readonly: true, fileMustExist: true });
    db.pragma('busy_timeout = 2000');
    const pageSize = db.pragma('page_size', { simple: true });
    const pageCount = db.pragma('page_count', { simple: true });
    const freePages = db.pragma('freelist_count', { simple: true });
    let tableBytes = null;
    try {
      tableBytes = new Map();
      // dbstat groups indexes separately; attribute each index to its table.
      const owners = new Map(db.prepare("SELECT name, tbl_name FROM sqlite_master WHERE type IN ('table','index')").all().map(r => [r.name, r.tbl_name]));
      for (const row of db.prepare('SELECT name, SUM(pgsize) AS bytes FROM dbstat GROUP BY name').all()) {
        const owner = owners.get(row.name) || row.name;
        tableBytes.set(owner, (tableBytes.get(owner) || 0) + row.bytes);
      }
    } catch { tableBytes = null; }
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
      .map(({ name: table }) => {
        let rows = null;
        try { rows = db.prepare(`SELECT COUNT(*) AS n FROM ${quoteIdent(table)}`).get().n; } catch { /* virtual or unreadable */ }
        return { name: table, rows, bytes: tableBytes ? (tableBytes.get(table) || 0) : null };
      })
      .sort((a, b) => (b.bytes ?? 0) - (a.bytes ?? 0) || (b.rows ?? 0) - (a.rows ?? 0));
    return {
      ...base,
      status: 'ok',
      pageSize, pageCount, freePages,
      usedBytes: (pageCount - freePages) * pageSize,
      freeBytes: freePages * pageSize,
      journalMode: db.pragma('journal_mode', { simple: true }),
      schemaVersion: db.pragma('user_version', { simple: true }),
      tables,
    };
  } catch (error) {
    return { ...base, status: 'error', error: error.message, tables: [] };
  } finally {
    try { db?.close(); } catch { /* ignore */ }
  }
}

function inspectCostCache(file, fileSystem) {
  try {
    const all = JSON.parse(fileSystem.readFileSync(file, 'utf8')) || {};
    return Object.entries(all).map(([profile, entry]) => ({ profile, fetchedAt: entry?.fetchedAt || null }));
  } catch { return []; }
}

function inspectDataStorage({ dir = resolveDataDir(), Database = require('better-sqlite3'), fileSystem = fs } = {}) {
  const files = listFiles(dir, fileSystem);
  const databases = files
    .filter(f => f.kind === 'sqlite')
    .map(f => inspectSqlite(path.join(dir, f.name), { Database, fileSystem }));
  let freeDiskBytes = null;
  try {
    const s = fileSystem.statfsSync?.(dir);
    if (s) freeDiskBytes = Number(s.bavail) * Number(s.bsize);
  } catch { /* not available */ }
  return {
    dir,
    exists: !!statSafe(dir, fileSystem),
    totalBytes: files.reduce((sum, f) => sum + f.bytes, 0),
    freeDiskBytes,
    files,
    databases,
    awsCostCache: inspectCostCache(path.join(dir, 'aws-cost-cache.json'), fileSystem),
  };
}

module.exports = { inspectDataStorage, resolveDataDir, fileKind };
