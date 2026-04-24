'use strict';
/**
 * lib/auditLog.js
 * Audit log system for KuaDashboard.
 *
 * Logs user actions (create, modify, delete, read of sensitive resources,
 * connections and Kubernetes integrations) to an in-memory buffer and a
 * persistent NDJSON file (~/.kuadashboard/audit.log).
 *
 * Each entry:
 *   { id, timestamp, level, category, action, resource, details, context }
 *
 * Categories: kubernetes | aws | gcp | helm | envManager | localShell | system
 * Levels:     info | warning | error | critical
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { v4: uuidv4 } = require('uuid');

// ─── Config ───────────────────────────────────────────────────────────────────

const DATA_DIR    = path.join(os.homedir(), '.kuadashboard');
const LOG_FILE    = path.join(DATA_DIR, 'audit.log');
const MAX_ENTRIES = 5000;     // max in-memory entries
const MAX_BYTES   = 10 * 1024 * 1024; // rotate file at 10 MB

// ─── State ────────────────────────────────────────────────────────────────────

let _buffer = [];   // circular in-memory buffer

// ─── Init ─────────────────────────────────────────────────────────────────────

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  }
}

// Load existing entries from file into memory on startup
function loadFromDisk() {
  ensureDataDir();
  if (!fs.existsSync(LOG_FILE)) return;
  try {
    const raw   = fs.readFileSync(LOG_FILE, 'utf8');
    const lines = raw.split('\n').filter(l => l.trim());
    _buffer = lines
      .map(l => { try { return JSON.parse(l); } catch (_) { return null; } })
      .filter(Boolean)
      .slice(-MAX_ENTRIES);
  } catch (err) {
    console.error('[auditLog] Failed to load from disk:', err.message);
  }
}

loadFromDisk();

// ─── Internal helpers ─────────────────────────────────────────────────────────

function rotateIfNeeded() {
  try {
    if (fs.existsSync(LOG_FILE)) {
      const { size } = fs.statSync(LOG_FILE);
      if (size >= MAX_BYTES) {
        const backup = LOG_FILE + '.1';
        if (fs.existsSync(backup)) fs.unlinkSync(backup);
        fs.renameSync(LOG_FILE, backup);
      }
    }
  } catch (_) { /* best effort */ }
}

function appendToDisk(entry) {
  try {
    ensureDataDir();
    rotateIfNeeded();
    fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n', 'utf8');
  } catch (err) {
    console.error('[auditLog] Failed to write to disk:', err.message);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Record an audit event.
 *
 * @param {object} params
 * @param {string} params.category  - kubernetes | aws | gcp | helm | envManager | localShell | system
 * @param {string} params.action    - Human-readable action string (e.g. "Pod deleted")
 * @param {string} [params.resource]- Resource identifier (name, ARN, etc.)
 * @param {object} [params.details] - Extra key/value details (safe — no secrets)
 * @param {string} [params.level]   - info | warning | error | critical  (default: info)
 * @param {string} [params.context] - Kubernetes context, AWS profile, GCP project, etc.
 */
function log({ category, action, resource = '', details = {}, level = 'info', context = '' }) {
  const VALID_CATEGORIES = ['kubernetes', 'aws', 'gcp', 'helm', 'envManager', 'localShell', 'system'];
  const VALID_LEVELS     = ['info', 'warning', 'error', 'critical'];

  const entry = {
    id:        uuidv4(),
    timestamp: new Date().toISOString(),
    level:     VALID_LEVELS.includes(level) ? level : 'info',
    category:  VALID_CATEGORIES.includes(category) ? category : 'system',
    action:    String(action).slice(0, 500),
    resource:  String(resource).slice(0, 500),
    details,
    context:   String(context).slice(0, 200),
  };

  // In-memory circular buffer
  _buffer.push(entry);
  if (_buffer.length > MAX_ENTRIES) _buffer.shift();

  // Persist
  appendToDisk(entry);
}

/**
 * Retrieve log entries with optional filters.
 *
 * @param {object} [opts]
 * @param {number} [opts.limit=200]     - Max entries to return (newest first)
 * @param {string} [opts.category]      - Filter by category
 * @param {string} [opts.level]         - Filter by level
 * @param {string} [opts.search]        - Full-text search in action/resource/context
 * @param {string} [opts.from]          - ISO date string — entries after this date
 * @param {string} [opts.to]            - ISO date string — entries before this date
 * @returns {object[]}
 */
function getLogs({ limit = 200, category, level, search, from, to } = {}) {
  let entries = [..._buffer];

  if (category) entries = entries.filter(e => e.category === category);
  if (level)    entries = entries.filter(e => e.level === level);
  if (from)     entries = entries.filter(e => e.timestamp >= from);
  if (to)       entries = entries.filter(e => e.timestamp <= to);
  if (search) {
    const q = search.toLowerCase();
    entries = entries.filter(e =>
      e.action.toLowerCase().includes(q) ||
      e.resource.toLowerCase().includes(q) ||
      e.context.toLowerCase().includes(q)
    );
  }

  // Return newest first, capped at limit
  return entries.reverse().slice(0, Math.min(limit, MAX_ENTRIES));
}

/**
 * Clear all in-memory and on-disk entries.
 */
function clearLogs() {
  _buffer = [];
  try {
    if (fs.existsSync(LOG_FILE)) fs.unlinkSync(LOG_FILE);
    const backup = LOG_FILE + '.1';
    if (fs.existsSync(backup)) fs.unlinkSync(backup);
  } catch (err) {
    console.error('[auditLog] Failed to clear disk log:', err.message);
  }
}

/**
 * Export all entries as CSV string.
 */
function exportCsv() {
  const header = 'timestamp,level,category,action,resource,context,details\n';
  const rows = [..._buffer].map(e => [
    e.timestamp,
    e.level,
    e.category,
    `"${e.action.replace(/"/g, '""')}"`,
    `"${e.resource.replace(/"/g, '""')}"`,
    `"${e.context.replace(/"/g, '""')}"`,
    `"${JSON.stringify(e.details).replace(/"/g, '""')}"`,
  ].join(',')).join('\n');
  return header + rows;
}

module.exports = { log, getLogs, clearLogs, exportCsv };
