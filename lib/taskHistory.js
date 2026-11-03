'use strict';
/**
 * lib/taskHistory.js
 * The runs of the background tasks (#351): every run that ends (completed, failed or cancelled)
 * is kept in <KUA data dir>/task-history.sqlite3, so the task manager can show what happened
 * yesterday, how long a task usually takes and whether it keeps failing.
 *
 * Kept 7 days or the last 2 000 runs, whichever is smaller. Privacy: task ids and names,
 * types, providers, times, outcome and error code only. Never the task detail (log groups,
 * application or resource names) or messages. Nothing leaves this computer.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_RUNS = 2000;
const OUTCOMES = new Set(['completed', 'failed', 'cancelled']);
const RECENT = 10;
const TYPICAL_SAMPLE = 20;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS task_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL, name TEXT NOT NULL, type TEXT, provider TEXT,
    started_at INTEGER, finished_at INTEGER NOT NULL, duration_ms INTEGER,
    outcome TEXT NOT NULL, error_code TEXT
  );
  CREATE INDEX IF NOT EXISTS task_runs_finished ON task_runs (finished_at);
  CREATE INDEX IF NOT EXISTS task_runs_task ON task_runs (task_id, finished_at);
`;

function resolveDataDir() {
  return process.env.KUA_DATA_DIR || path.join(os.homedir(), '.kuadashboard');
}

function median(sorted) {
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function createTaskHistory({ dataDir = resolveDataDir(), Database = require('better-sqlite3'), now = () => Date.now(), retentionMs = RETENTION_MS, maxRuns = MAX_RUNS } = {}) {
  let db = null;
  let sincePrune = 0;

  function open() {
    if (db) return db;
    if (dataDir !== ':memory:') fs.mkdirSync(dataDir, { recursive: true });
    db = new Database(dataDir === ':memory:' ? ':memory:' : path.join(dataDir, 'task-history.sqlite3'));
    db.pragma('journal_mode = WAL');
    db.exec(SCHEMA);
    prune();
    return db;
  }

  function prune() {
    const database = db;
    database.prepare('DELETE FROM task_runs WHERE finished_at < ?').run(now() - retentionMs);
    database.prepare('DELETE FROM task_runs WHERE id NOT IN (SELECT id FROM task_runs ORDER BY finished_at DESC, id DESC LIMIT ?)').run(maxRuns);
  }

  /** One finished run. Anything that is not a known outcome is ignored. */
  function record({ taskId, name, type = null, provider = null, startedAt = null, finishedAt = now(), outcome, errorCode = null }) {
    if (!OUTCOMES.has(outcome) || !taskId) return;
    const started = startedAt == null ? null : Date.parse(startedAt) || Number(startedAt) || null;
    const finished = typeof finishedAt === 'number' ? finishedAt : Date.parse(finishedAt) || now();
    open().prepare(`
      INSERT INTO task_runs (task_id, name, type, provider, started_at, finished_at, duration_ms, outcome, error_code)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(String(taskId).slice(0, 80), String(name || taskId).slice(0, 100), type ? String(type).slice(0, 40) : null,
      provider ? String(provider).slice(0, 40) : null, started, finished, started == null ? null : Math.max(0, finished - started),
      outcome, outcome === 'failed' ? String(errorCode || 'task_failed').slice(0, 64) : null);
    // Pruning on every insert would cost a scan per run; every 50 is enough for the limits.
    sincePrune += 1;
    if (sincePrune >= 50) { sincePrune = 0; prune(); }
  }

  function view(row) {
    return {
      id: row.id,
      taskId: row.task_id,
      name: row.name,
      type: row.type,
      provider: row.provider,
      startedAt: row.started_at == null ? null : new Date(row.started_at).toISOString(),
      finishedAt: new Date(row.finished_at).toISOString(),
      durationMs: row.duration_ms,
      outcome: row.outcome,
      errorCode: row.error_code,
    };
  }

  /**
   * Newest first, plus a 24-hour summary.
   * @param filter.outcome completed | failed | cancelled
   * @param filter.q text matched against task id, name and error code
   * @param filter.limit at most this many runs (default 200, max 500)
   */
  function list({ outcome = null, q = '', limit = 200 } = {}) {
    const where = ['finished_at >= ?'];
    const params = [now() - retentionMs];
    if (OUTCOMES.has(outcome)) { where.push('outcome = ?'); params.push(outcome); }
    const text = String(q || '').trim().toLowerCase().slice(0, 80);
    if (text) {
      where.push("(lower(task_id) LIKE ? ESCAPE '\\' OR lower(name) LIKE ? ESCAPE '\\' OR lower(coalesce(error_code, '')) LIKE ? ESCAPE '\\')");
      const like = `%${text.replace(/[\\%_]/g, character => `\\${character}`)}%`;
      params.push(like, like, like);
    }
    const max = Math.max(1, Math.min(500, Number.parseInt(limit, 10) || 200));
    const runs = open().prepare(`SELECT * FROM task_runs WHERE ${where.join(' AND ')} ORDER BY finished_at DESC, id DESC LIMIT ?`).all(...params, max).map(view);
    const day = open().prepare('SELECT outcome, COUNT(*) AS count FROM task_runs WHERE finished_at >= ? GROUP BY outcome').all(now() - 24 * 60 * 60 * 1000);
    const count = name => day.find(row => row.outcome === name)?.count || 0;
    return {
      runs,
      retentionDays: Math.round(retentionMs / (24 * 60 * 60 * 1000)),
      maxRuns,
      summary24h: { runs: day.reduce((sum, row) => sum + row.count, 0), completed: count('completed'), failed: count('failed'), cancelled: count('cancelled') },
    };
  }

  /** What the task list shows beside a task: its last runs, typical duration and recent failures. */
  function stats(taskId) {
    const rows = open().prepare('SELECT duration_ms, outcome, finished_at FROM task_runs WHERE task_id = ? ORDER BY finished_at DESC, id DESC LIMIT ?').all(taskId, TYPICAL_SAMPLE);
    if (!rows.length) return null;
    const completed = rows.filter(row => row.outcome === 'completed' && row.duration_ms != null).map(row => row.duration_ms).sort((left, right) => left - right);
    return {
      recent: rows.slice(0, RECENT).reverse().map(row => ({ durationMs: row.duration_ms, outcome: row.outcome })),
      typicalMs: median(completed),
      failuresInLast5: rows.slice(0, 5).filter(row => row.outcome === 'failed').length,
      lastFinishedAt: new Date(rows[0].finished_at).toISOString(),
    };
  }

  function close() {
    db?.close();
    db = null;
  }

  return { record, list, stats, close };
}

let shared = null;
function getTaskHistory() {
  if (!shared) shared = createTaskHistory();
  return shared;
}

module.exports = { createTaskHistory, getTaskHistory, RETENTION_MS, MAX_RUNS };
