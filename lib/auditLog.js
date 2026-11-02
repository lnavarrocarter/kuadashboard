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
 *   { id, timestamp, level, category, action, resource, details, context, actor, prevHash, hash }
 *
 * actor: who did it ({ kind: ui | mcp | system, user, account }, lib/auditContext.js).
 * prevHash/hash: each entry carries the SHA-256 of the previous one, so removing
 * or editing a line breaks the chain (verify()). Tamper-evident, not tamper-proof:
 * anyone who can write the file can rewrite the whole chain; forwarding entries
 * to an external destination (lib/auditForwarder.js) keeps a copy outside.
 * Retention: entries older than retentionDays (settings, default 90) are pruned.
 *
 * Categories: console | <provider with a view> (lib/providers.js) | architecture | advisor | helm | envManager | localShell | system
 * Levels:     info | warning | error | critical
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { providerIds } = require('./providers');

// ─── Config ───────────────────────────────────────────────────────────────────

const DATA_DIR    = path.join(os.homedir(), '.kuadashboard');
const LOG_FILE    = path.join(DATA_DIR, 'audit.log');
const MAX_ENTRIES = 5000;     // max in-memory entries
const MAX_BYTES   = 10 * 1024 * 1024; // rotate file at 10 MB
const SETTINGS_FILE = path.join(DATA_DIR, 'audit-settings.json');
const DEFAULT_RETENTION_DAYS = 90;
const GENESIS = 'genesis';
const PRUNE_EVERY_MS = 60 * 60 * 1000;

// ─── State ────────────────────────────────────────────────────────────────────

let _buffer = [];   // circular in-memory buffer
let _lastHash = GENESIS;
let _lastPruneAt = 0;
let _onEntry = null; // forwarder hook

// ─── Init ─────────────────────────────────────────────────────────────────────

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  }
}

// ─── Integrity, settings, actor ───────────────────────────────────────────────

const HASHED_FIELDS = ['id', 'timestamp', 'level', 'category', 'action', 'resource', 'details', 'context', 'actor', 'prevHash'];

function hashOf(entry) {
  const payload = JSON.stringify(HASHED_FIELDS.map(field => entry[field] ?? null));
  return crypto.createHash('sha256').update(payload).digest('hex');
}

function getSettings() {
  try {
    const value = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    return { retentionDays: Number(value.retentionDays) || DEFAULT_RETENTION_DAYS, forward: value.forward || null };
  } catch { return { retentionDays: DEFAULT_RETENTION_DAYS, forward: null }; }
}

/** Saves the settings (retentionDays 7–3650; forward is kept by lib/auditForwarder.js). */
function saveSettings(changes = {}) {
  const current = getSettings();
  const next = { ...current, ...changes };
  if (changes.retentionDays !== undefined) {
    const days = Number(changes.retentionDays);
    if (!Number.isInteger(days) || days < 7 || days > 3650) throw Object.assign(new Error('retentionDays must be a whole number from 7 to 3650'), { statusCode: 400 });
    next.retentionDays = days;
  }
  ensureDataDir();
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2), { mode: 0o600 });
  if (changes.retentionDays !== undefined) prune({ force: true });
  return next;
}

let _account = null;
function accountEmail() {
  try {
    _account ||= require('./account/account').getAccount();
    return _account.status?.().user?.email || null;
  } catch { return null; }
}

function actorOf() {
  let kind = 'system';
  try { kind = require('./auditContext').currentActorKind(); } catch { /* no context */ }
  let user = null;
  try { user = os.userInfo().username; } catch { /* restricted environment */ }
  return { kind, user, account: accountEmail() };
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
    _lastHash = _buffer[_buffer.length - 1]?.hash || GENESIS;
  } catch (err) {
    console.error('[auditLog] Failed to load from disk:', err.message);
  }
}

/**
 * Drops entries older than the retention, in memory and on disk. The first entry
 * left becomes the anchor of the chain (verify() starts there).
 */
function prune({ force = false } = {}) {
  const now = Date.now();
  if (!force && now - _lastPruneAt < PRUNE_EVERY_MS) return 0;
  _lastPruneAt = now;
  const cutoff = new Date(now - getSettings().retentionDays * 24 * 60 * 60 * 1000).toISOString();
  const before = _buffer.length;
  _buffer = _buffer.filter(entry => entry.timestamp >= cutoff);
  let removed = before - _buffer.length;
  // The file can hold more than memory (up to 10 MB): a forced pass always reads it.
  if (!removed && !force) return 0;
  try {
    const raw = fs.existsSync(LOG_FILE) ? fs.readFileSync(LOG_FILE, 'utf8') : '';
    const lines = raw.split('\n').filter(line => line.trim());
    const kept = lines.filter(line => {
      try { return JSON.parse(line).timestamp >= cutoff; } catch { return false; }
    });
    if (kept.length !== lines.length) {
      fs.writeFileSync(LOG_FILE, kept.length ? `${kept.join('\n')}\n` : '', 'utf8');
      removed = Math.max(removed, lines.length - kept.length);
    }
    const backup = LOG_FILE + '.1';
    if (removed && fs.existsSync(backup)) fs.unlinkSync(backup);
  } catch (err) {
    console.error('[auditLog] Failed to prune:', err.message);
  }
  return removed;
}

loadFromDisk();
prune({ force: true });

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
 * @param {string} params.category  - console | kubernetes | aws | gcp | vercel | architecture | helm | envManager | localShell | system
 * @param {string} params.action    - Human-readable action string (e.g. "Pod deleted")
 * @param {string} [params.resource]- Resource identifier (name, ARN, etc.)
 * @param {object} [params.details] - Extra key/value details (safe — no secrets)
 * @param {string} [params.level]   - info | warning | error | critical  (default: info)
 * @param {string} [params.context] - Kubernetes context, AWS profile, GCP project, etc.
 */
function log({ category, action, resource = '', details = {}, level = 'info', context = '' }) {
  const VALID_CATEGORIES = ['console', ...providerIds('view'), 'architecture', 'advisor', 'helm', 'envManager', 'localShell', 'system'];
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
    actor:     actorOf(),
    prevHash:  _lastHash,
  };
  entry.hash = hashOf(entry);
  _lastHash = entry.hash;

  // In-memory circular buffer
  _buffer.push(entry);
  if (_buffer.length > MAX_ENTRIES) _buffer.shift();

  // Persist
  appendToDisk(entry);
  prune();
  try { _onEntry?.(entry); } catch (err) { console.error('[auditLog] Forwarding hook failed:', err.message); }
  return entry;
}

/**
 * Checks the chain of the log file: every entry's hash and its link to the
 * previous one. Entries written before the chain existed (no hash) are counted
 * apart. Returns { valid, checked, legacy, firstAt, lastAt, brokenAt }.
 */
function verify() {
  let lines = [];
  try { lines = fs.existsSync(LOG_FILE) ? fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter(line => line.trim()) : []; } catch { /* unreadable: nothing checked */ }
  let previous = null;
  let checked = 0;
  let legacy = 0;
  let firstAt = null;
  let lastAt = null;
  for (let index = 0; index < lines.length; index += 1) {
    let entry;
    try { entry = JSON.parse(lines[index]); } catch {
      return { valid: false, checked, legacy, firstAt, lastAt, brokenAt: { line: index + 1, reason: 'unreadable' } };
    }
    if (!entry.hash) { legacy += 1; continue; }
    if (hashOf(entry) !== entry.hash) return { valid: false, checked, legacy, firstAt, lastAt, brokenAt: { line: index + 1, id: entry.id, reason: 'modified' } };
    // The first chained entry is the anchor (older ones were rotated or pruned).
    if (previous && entry.prevHash !== previous.hash) return { valid: false, checked, legacy, firstAt, lastAt, brokenAt: { line: index + 1, id: entry.id, reason: 'missing' } };
    firstAt ||= entry.timestamp;
    lastAt = entry.timestamp;
    previous = entry;
    checked += 1;
  }
  return { valid: true, checked, legacy, firstAt, lastAt, brokenAt: null };
}

/** lib/auditForwarder.js receives every new entry. */
function onEntry(fn) {
  _onEntry = fn;
}

// Entries matching the filters, oldest first.
function matchingEntries({ category, level, search, from, to, actor } = {}) {
  let entries = [..._buffer];

  if (actor)    entries = entries.filter(e => (e.actor?.kind || 'system') === actor);
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
  return entries;
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
function getLogs({ limit = 200, ...filters } = {}) {
  return queryLogs({ limit, ...filters }).entries;
}

/**
 * One page of matching entries, newest first, with the number of matches.
 *
 * @param {object} [opts] - getLogs filters, plus offset
 * @returns {{ entries: object[], total: number, offset: number, limit: number }}
 */
function queryLogs({ limit = 200, offset = 0, ...filters } = {}) {
  const matches = matchingEntries(filters).reverse();
  const size  = Math.max(1, Math.min(Number(limit) || 200, MAX_ENTRIES));
  const start = Math.max(0, Number(offset) || 0);
  return { entries: matches.slice(start, start + size), total: matches.length, offset: start, limit: size };
}

/**
 * Counts by level and category of the entries matching the filters.
 */
function getStats(filters = {}) {
  const entries = matchingEntries(filters);
  const byCategory = {};
  const byLevel    = {};
  for (const e of entries) {
    byCategory[e.category] = (byCategory[e.category] || 0) + 1;
    byLevel[e.level]       = (byLevel[e.level]       || 0) + 1;
  }
  return { total: entries.length, byCategory, byLevel };
}

/**
 * Clear all in-memory and on-disk entries.
 */
function clearLogs() {
  _buffer = [];
  _lastHash = GENESIS;
  try {
    if (fs.existsSync(LOG_FILE)) fs.unlinkSync(LOG_FILE);
    const backup = LOG_FILE + '.1';
    if (fs.existsSync(backup)) fs.unlinkSync(backup);
  } catch (err) {
    console.error('[auditLog] Failed to clear disk log:', err.message);
  }
}

/**
 * Export the entries matching the filters (all of them by default) as CSV string.
 */
function exportCsv(filters = {}) {
  const header = 'timestamp,level,category,action,resource,context,actor,user,account,details\n';
  const rows = matchingEntries(filters).map(e => [
    e.timestamp,
    e.level,
    e.category,
    `"${e.action.replace(/"/g, '""')}"`,
    `"${e.resource.replace(/"/g, '""')}"`,
    `"${e.context.replace(/"/g, '""')}"`,
    e.actor?.kind || '',
    `"${String(e.actor?.user || '').replace(/"/g, '""')}"`,
    `"${String(e.actor?.account || '').replace(/"/g, '""')}"`,
    `"${JSON.stringify(e.details).replace(/"/g, '""')}"`,
  ].join(',')).join('\n');
  return header + rows;
}

module.exports = { log, getLogs, queryLogs, getStats, clearLogs, exportCsv, verify, prune, getSettings, saveSettings, onEntry, hashOf };
