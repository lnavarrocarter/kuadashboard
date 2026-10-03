'use strict';
/**
 * lib/awsLogCache.js
 * Local cache of CloudWatch Logs events for the log groups the user chooses to
 * keep (aws-log-cache.sqlite3 in KUA's data directory).
 *
 * Storage: events live in sealed blocks (lib/logCacheCrypto.js): Brotli
 * compressed and AES-256-GCM encrypted with a key kept in the OS keychain of
 * the current user. Only block metadata (group, time range, counts, sizes) is
 * readable without the key. Two tiers:
 *   - hot: the last HOT_MS hours, small blocks written as events arrive;
 *   - cold: older events compacted into one block per group and hour with
 *     maximum compression.
 * Reading cached events decrypts blocks newest first, so local search is
 * slower than a plain table but the data at rest is protected and smaller.
 *
 * Retention depends on size: every cached group gets a window of at most
 * 7 days, shortened when the group's estimated daily volume would not fit its
 * share of the cache budget. Recent hours come first: syncs read the latest
 * hours before backfilling older ones, and pruning drops the oldest blocks.
 *
 * Background scans (lib/awsLogScans.js) read up to MAX_SCAN_MS of a group in
 * the background; the oldest time a scan asked for is pinned on the group
 * (pinned_from) so the window does not drop it, while the global budget still
 * applies.
 *
 * Every event that enters the cache goes through ingest(): it is sanitized,
 * stored, analyzed by the log intelligence (aggregates only) and handed to the
 * onIngest hooks (e.g. APM metrics for Lambda REPORT lines).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createLogIntelligence, loadSignals } = require('./logIntelligence');
const { loadCacheKey, sealBlock, openBlock, eventKey, legacyEventKey, keyCheck, verifyKeyCheck } = require('./logCacheCrypto');

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const MAX_WINDOW_MS = 7 * DAY_MS;
const MIN_WINDOW_MS = HOUR_MS;
const HOT_MS = 6 * HOUR_MS;           // recent hours: synced first, kept in small fast blocks
const COLD_BLOCK_MS = HOUR_MS;        // older events: one block per group and hour
const DEFAULT_BUDGET_BYTES = 256 * 1024 * 1024;
const SYNC_OVERLAP_MS = 60 * 1000;    // late events are re-read; event ids dedupe them
const MAX_SYNC_PAGES = 10;            // FilterLogEvents pages are ≤ 1 MB / 10,000 events
const MAX_MESSAGE_BYTES = 64 * 1024;
const MAX_BLOCK_EVENTS = 5000;
const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
// Histogram resolutions, finest first: the first one that fits MAX_BINS wins.
const BIN_SIZES = [1, 2, 5, 10, 15, 30].map(n => n * SECOND_MS)
  .concat([1, 2, 5, 10, 15, 30].map(n => n * MINUTE_MS))
  .concat([1, 2, 3, 6, 12].map(n => n * HOUR_MS), DAY_MS);
const MAX_BINS = 120;

/** Bin size for a range: seconds for minutes, minutes for hours, hours for days. */
function pickBinMs(rangeMs, maxBins = MAX_BINS) {
  return BIN_SIZES.find(size => rangeMs / size <= maxBins) || DAY_MS;
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS log_cache_meta (key TEXT PRIMARY KEY, value BLOB);
  CREATE TABLE IF NOT EXISTS log_cache_groups (
    profile_id TEXT NOT NULL,
    region TEXT NOT NULL,
    log_group TEXT NOT NULL,
    window_ms INTEGER NOT NULL,
    stored_bytes INTEGER,
    retention_days INTEGER,
    creation_time INTEGER,
    synced_until INTEGER,
    last_sync_at INTEGER,
    last_sync_status TEXT,
    last_error TEXT,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (profile_id, region, log_group)
  );
  CREATE TABLE IF NOT EXISTS log_cache_blocks (
    id INTEGER PRIMARY KEY,
    profile_id TEXT NOT NULL,
    region TEXT NOT NULL,
    log_group TEXT NOT NULL,
    tier TEXT NOT NULL CHECK (tier IN ('hot', 'cold')),
    min_ts INTEGER NOT NULL,
    max_ts INTEGER NOT NULL,
    events INTEGER NOT NULL,
    raw_bytes INTEGER NOT NULL,
    bytes INTEGER NOT NULL,
    payload BLOB NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS log_cache_blocks_group ON log_cache_blocks (profile_id, region, log_group, max_ts);
  CREATE INDEX IF NOT EXISTS log_cache_blocks_time ON log_cache_blocks (max_ts);
  CREATE TABLE IF NOT EXISTS log_cache_scans (
    id INTEGER PRIMARY KEY,
    profile_id TEXT NOT NULL,
    region TEXT NOT NULL,
    log_group TEXT NOT NULL,
    from_ts INTEGER NOT NULL,
    to_ts INTEGER NOT NULL,
    cursor_ts INTEGER NOT NULL,
    status TEXT NOT NULL,
    pages INTEGER NOT NULL DEFAULT 0,
    fetched INTEGER NOT NULL DEFAULT 0,
    inserted INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    created_at INTEGER NOT NULL,
    started_at INTEGER,
    updated_at INTEGER NOT NULL,
    finished_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS log_cache_scans_scope ON log_cache_scans (profile_id, region, status);
`;

// Columns added after the first release of the cache.
// history_ms: how far back syncs backfill (null = the whole window).
// pinned_from: oldest time a background scan asked to keep (beyond the window).
const GROUP_COLUMNS = { coverage_from: 'INTEGER', backfill_cursor: 'INTEGER', history_ms: 'INTEGER', pinned_from: 'INTEGER' };
const MAX_SCAN_MS = 5 * DAY_MS;
const SCAN_COLUMNS = {
  status: 'status', cursor: 'cursor_ts', pages: 'pages', fetched: 'fetched', inserted: 'inserted',
  error: 'error', startedAt: 'started_at', finishedAt: 'finished_at',
};

function resolveDataDir() {
  return process.env.KUA_DATA_DIR || path.join(os.homedir(), '.kuadashboard');
}

function budgetFromEnv() {
  const mb = Number(process.env.KUA_LOG_CACHE_MB);
  return Number.isFinite(mb) && mb > 0 ? mb * 1024 * 1024 : DEFAULT_BUDGET_BYTES;
}

/**
 * Estimated bytes per day a log group ingests, from what CloudWatch reports it
 * stores. Groups that keep logs forever are averaged over their age.
 */
function estimateDailyBytes({ storedBytes, retentionInDays, creationTime }, now = Date.now()) {
  if (!storedBytes) return 0;
  const ageDays = creationTime ? Math.max(1, (now - creationTime) / DAY_MS) : null;
  const days = Math.max(1, Math.min(retentionInDays || Infinity, ageDays || Infinity));
  return Number.isFinite(days) ? storedBytes / days : storedBytes;
}

/**
 * Cache window for one group: 7 days unless its estimated volume for 7 days
 * exceeds its share of the budget, in which case the window shrinks (≥ 1 h).
 */
function planWindow(group, { budgetBytes = DEFAULT_BUDGET_BYTES, groupCount = 1, now = Date.now() } = {}) {
  const share = budgetBytes / Math.max(1, groupCount);
  const daily = estimateDailyBytes(group, now);
  if (!daily) return { windowMs: MAX_WINDOW_MS, dailyBytes: 0, limitedBySize: false };
  const windowMs = Math.max(MIN_WINDOW_MS, Math.min(MAX_WINDOW_MS, Math.floor((share / daily) * DAY_MS)));
  return { windowMs, dailyBytes: Math.round(daily), limitedBySize: windowMs < MAX_WINDOW_MS };
}

function trimMessage(message) {
  const text = String(message ?? '');
  return Buffer.byteLength(text) > MAX_MESSAGE_BYTES ? `${text.slice(0, MAX_MESSAGE_BYTES)}…[truncated]` : text;
}

function createLogCache({
  dataDir = resolveDataDir(), Database = require('better-sqlite3'), budgetBytes = budgetFromEnv(), now = () => Date.now(), fileSystem = fs,
  onIngest = [], key: providedKey = null, loadKey = () => loadCacheKey({ dataDir }), ml = null,
} = {}) {
  let db = null;
  const intelligence = createLogIntelligence({ database: () => open(), now });
  // Local embeddings (lib/ml): optional, opt-in, never downloaded from here.
  const semantic = ml ? (() => {
    const { createSemantic, createVectorCache } = require('./ml/semantic');
    return createSemantic({ vectorCache: createVectorCache({ database: () => open(), model: ml }), model: ml });
  })() : null;
  const hooks = [...onIngest];
  const locks = new Map();
  let signalsReady = null;
  let readyPromise = null;
  let key = null;
  let keyStore = providedKey ? 'provided' : null;

  function signals() {
    if (!signalsReady) signalsReady = loadSignals().then(module => { intelligence.setSignals(module); return module; });
    return signalsReady;
  }
  let patternsReady = null;
  function patterns() {
    if (!patternsReady) patternsReady = import('../frontend/src/shared/filterPattern.mjs');
    return patternsReady;
  }

  function open() {
    if (db) return db;
    if (dataDir !== ':memory:') fileSystem.mkdirSync(dataDir, { recursive: true });
    db = new Database(dataDir === ':memory:' ? ':memory:' : path.join(dataDir, 'aws-log-cache.sqlite3'));
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 3000');
    db.exec(SCHEMA);
    const columns = new Set(db.prepare('PRAGMA table_info(log_cache_groups)').all().map(c => c.name));
    for (const [name, type] of Object.entries(GROUP_COLUMNS)) if (!columns.has(name)) db.exec(`ALTER TABLE log_cache_groups ADD COLUMN ${name} ${type}`);
    return db;
  }

  /**
   * Loads the key, checks it still opens this cache (otherwise the encrypted
   * blocks are unreadable and are dropped) and migrates the plain-text events
   * of the first cache version into sealed blocks.
   */
  function ready() {
    if (!readyPromise) {
      readyPromise = (async () => {
        const database = open();
        if (providedKey) key = providedKey;
        else if (dataDir === ':memory:') { key = require('crypto').randomBytes(32); keyStore = 'ephemeral'; }
        else ({ key, store: keyStore } = loadKey());
        const check = database.prepare("SELECT value FROM log_cache_meta WHERE key = 'key_check'").get();
        if (check && !(await verifyKeyCheck(key, check.value))) {
          console.warn('[log-cache] The cache key changed; dropping blocks that can no longer be read.');
          database.exec('DELETE FROM log_cache_blocks');
          database.exec('UPDATE log_cache_groups SET synced_until = NULL, coverage_from = NULL, backfill_cursor = NULL');
        }
        if (!check || !(await verifyKeyCheck(key, check.value))) {
          const sealed = await keyCheck(key);
          database.prepare("INSERT OR REPLACE INTO log_cache_meta (key, value) VALUES ('key_check', ?)").run(sealed.payload);
        }
        await migratePlainEvents(database);
      })().catch(err => { readyPromise = null; throw err; });
    }
    return readyPromise;
  }

  async function migratePlainEvents(database) {
    const legacy = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'log_cache_events'").get();
    if (!legacy) return;
    const scopes = database.prepare('SELECT DISTINCT profile_id, region, log_group FROM log_cache_events').all();
    for (const s of scopes) {
      const scope = { profileId: s.profile_id, region: s.region, logGroup: s.log_group };
      let after = 0;
      for (;;) {
        const rows = database.prepare(`
          SELECT rowid AS rid, event_id, ts, log_stream, message FROM log_cache_events
          WHERE profile_id = ? AND region = ? AND log_group = ? AND rowid > ? ORDER BY rowid LIMIT ${MAX_BLOCK_EVENTS}
        `).all(s.profile_id, s.region, s.log_group, after);
        if (!rows.length) break;
        const events = rows.map(r => ({ timestamp: r.ts, logStreamName: r.log_stream, id: legacyEventKey({ eventId: r.event_id }) || eventKey({ logStreamName: r.log_stream, timestamp: r.ts }, r.message), message: r.message }));
        await writeBlocks(scope, events, 'hot');
        after = rows[rows.length - 1].rid;
      }
    }
    database.exec('DROP TABLE log_cache_events');
    if (dataDir !== ':memory:') database.exec('VACUUM');
    console.log(`[log-cache] Migrated ${scopes.length} cached group(s) to encrypted, compressed blocks.`);
  }

  // One operation at a time per group (dedupe reads blocks before writing).
  function withGroupLock(scope, task) {
    const lockKey = `${scope.profileId}\u0000${scope.region}\u0000${scope.logGroup}`;
    const previous = locks.get(lockKey) || Promise.resolve();
    const run = previous.then(task, task);
    const tail = run.catch(() => {});
    locks.set(lockKey, tail);
    tail.then(() => { if (locks.get(lockKey) === tail) locks.delete(lockKey); });
    return run;
  }

  function groupRow(profileId, region, logGroup) {
    return open().prepare('SELECT * FROM log_cache_groups WHERE profile_id = ? AND region = ? AND log_group = ?').get(profileId, region, logGroup) || null;
  }

  // Oldest event a group keeps: its window, extended by a scan pin (never beyond MAX_WINDOW_MS).
  function keepFrom(row, current = now()) {
    return Math.max(current - MAX_WINDOW_MS, Math.min(current - row.window_ms, row.pinned_from ?? Infinity));
  }

  function groupCount() {
    return open().prepare('SELECT COUNT(*) AS n FROM log_cache_groups').get().n;
  }

  // Windows depend on how many groups share the budget: recompute all of them.
  function replanWindows() {
    const database = open();
    const rows = database.prepare('SELECT * FROM log_cache_groups').all();
    const update = database.prepare('UPDATE log_cache_groups SET window_ms = ? WHERE profile_id = ? AND region = ? AND log_group = ?');
    database.transaction(() => {
      for (const row of rows) {
        const { windowMs } = planWindow({ storedBytes: row.stored_bytes, retentionInDays: row.retention_days, creationTime: row.creation_time }, { budgetBytes, groupCount: rows.length, now: now() });
        update.run(windowMs, row.profile_id, row.region, row.log_group);
      }
    })();
  }

  function enable({ profileId, region, logGroup, storedBytes = null, retentionInDays = null, creationTime = null, historyMs }) {
    const database = open();
    const existing = groupRow(profileId, region, logGroup);
    const count = groupCount() + (existing ? 0 : 1);
    const { windowMs } = planWindow({ storedBytes, retentionInDays, creationTime }, { budgetBytes, groupCount: count, now: now() });
    database.prepare(`
      INSERT INTO log_cache_groups (profile_id, region, log_group, window_ms, stored_bytes, retention_days, creation_time, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (profile_id, region, log_group) DO UPDATE SET
        stored_bytes = excluded.stored_bytes, retention_days = excluded.retention_days, creation_time = excluded.creation_time
    `).run(profileId, region, logGroup, windowMs, storedBytes, retentionInDays, creationTime, now());
    if (historyMs !== undefined) setHistory({ profileId, region, logGroup, historyMs });
    replanWindows();
    return describeGroup(profileId, region, logGroup);
  }

  /**
   * How far back syncs fill the cache: null = the whole window, 0 = only new
   * events from now on. Shortening it does not delete what is already cached.
   */
  function setHistory({ profileId, region, logGroup, historyMs }) {
    const value = historyMs == null ? null : Math.max(0, Math.min(MAX_WINDOW_MS, Number(historyMs)));
    open().prepare('UPDATE log_cache_groups SET history_ms = ?, backfill_cursor = NULL WHERE profile_id = ? AND region = ? AND log_group = ?')
      .run(value, profileId, region, logGroup);
    return describeGroup(profileId, region, logGroup);
  }

  function disable({ profileId, region, logGroup }) {
    const database = open();
    database.transaction(() => {
      database.prepare('DELETE FROM log_cache_blocks WHERE profile_id = ? AND region = ? AND log_group = ?').run(profileId, region, logGroup);
      database.prepare('DELETE FROM log_cache_groups WHERE profile_id = ? AND region = ? AND log_group = ?').run(profileId, region, logGroup);
      database.prepare(`UPDATE log_cache_scans SET status = 'cancelled', error = 'Log group removed from the cache', updated_at = ?, finished_at = ?
        WHERE profile_id = ? AND region = ? AND log_group = ? AND status IN ('queued', 'running', 'paused')`).run(now(), now(), profileId, region, logGroup);
    })();
    intelligence.clear({ profileId, region, logGroup });
    replanWindows();
  }

  // ── Blocks ──

  async function writeBlocks(scope, events, tier) {
    const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);
    const insert = open().prepare(`
      INSERT INTO log_cache_blocks (profile_id, region, log_group, tier, min_ts, max_ts, events, raw_bytes, bytes, payload, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (let i = 0; i < sorted.length; i += MAX_BLOCK_EVENTS) {
      const chunk = sorted.slice(i, i + MAX_BLOCK_EVENTS);
      const { payload, rawBytes } = await sealBlock(key, scope, chunk, { tier });
      insert.run(scope.profileId, scope.region, scope.logGroup, tier, chunk[0].timestamp, chunk[chunk.length - 1].timestamp, chunk.length, rawBytes, payload.length, payload, now());
    }
  }

  function blocksInRange(scope, from, to, order = 'DESC') {
    return open().prepare(`
      SELECT id, tier, min_ts, max_ts, events FROM log_cache_blocks
      WHERE profile_id = ? AND region = ? AND log_group = ? AND max_ts >= ? AND min_ts <= ?
      ORDER BY max_ts ${order === 'ASC' ? 'ASC' : 'DESC'}, id ${order === 'ASC' ? 'ASC' : 'DESC'}
    `).all(scope.profileId, scope.region, scope.logGroup, from ?? 0, to ?? Number.MAX_SAFE_INTEGER);
  }

  async function readBlock(scope, id) {
    const row = open().prepare('SELECT payload FROM log_cache_blocks WHERE id = ?').get(id);
    if (!row) return [];
    try { return await openBlock(key, scope, row.payload); } catch (err) {
      // A block that cannot be authenticated is useless: drop it instead of failing every read.
      console.warn('[log-cache] dropping unreadable block:', err.message);
      open().prepare('DELETE FROM log_cache_blocks WHERE id = ?').run(id);
      return [];
    }
  }

  // Stores events (deduplicated by event id) and returns the ones that were new.
  async function storeEvents({ profileId, region, logGroup, events, sanitize = text => text }) {
    await ready();
    const scope = { profileId, region, logGroup };
    return withGroupLock(scope, async () => {
      const incoming = [];
      for (const event of events || []) {
        if (!event || !Number.isFinite(Number(event.timestamp))) continue;
        const raw = trimMessage(event.message);
        incoming.push({ timestamp: Number(event.timestamp), logStreamName: event.logStreamName || '', id: eventKey(event, raw), legacy: legacyEventKey(event), message: sanitize(raw) });
      }
      if (!incoming.length) return [];
      const minTs = Math.min(...incoming.map(e => e.timestamp));
      const maxTs = Math.max(...incoming.map(e => e.timestamp));
      const seen = new Set();
      for (const block of blocksInRange(scope, minTs, maxTs)) {
        for (const event of await readBlock(scope, block.id)) seen.add(event.id);
      }
      const fresh = [];
      for (const event of incoming) {
        if (seen.has(event.id) || (event.legacy && seen.has(event.legacy))) continue;
        seen.add(event.id);
        fresh.push({ timestamp: event.timestamp, logStreamName: event.logStreamName, id: event.id, message: event.message });
      }
      if (fresh.length) await writeBlocks(scope, fresh, now() - maxTs > HOT_MS ? 'cold' : 'hot');
      return fresh.map(e => ({ eventId: e.id, timestamp: e.timestamp, logStreamName: e.logStreamName, message: e.message }));
    });
  }

  /** Insert without analysis or hooks (tests, internal moves). Prefer ingest(). */
  async function insertEvents(args) {
    return (await storeEvents(args)).length;
  }

  /**
   * The single entry for events of a cached group: sanitize → store → analyze →
   * hooks. Events older than the group's window (e.g. from a 3-day Logs
   * Insights search on a group that only fits an hour) are not stored; they
   * only update the per-minute index (max per minute, so repeats never double
   * count). Returns how many events were new or observed.
   */
  async function ingest({ profileId, region, logGroup, events }) {
    const row = groupRow(profileId, region, logGroup);
    if (!row) return 0;
    const module = await signals();
    const windowStart = keepFrom(row);
    const inWindow = [];
    const older = [];
    for (const event of events || []) (Number(event?.timestamp) >= windowStart ? inWindow : older).push(event);
    let observed = 0;
    if (older.length) {
      await ensureAnalyzed({ profileId, region, logGroup });
      observed = intelligence.observeMinutes({ profileId, region, logGroup, events: older }).observed;
    }
    const stored = await storeEvents({ profileId, region, logGroup, events: inWindow, sanitize: module.sanitizeLogLine });
    if (!stored.length) return observed;
    if (!intelligence.isCurrent({ profileId, region, logGroup })) {
      await ensureAnalyzed({ profileId, region, logGroup });
    } else {
      intelligence.ingest({ profileId, region, logGroup, events: stored });
    }
    for (const hook of hooks) {
      try { await hook({ profileId, region, logGroup, events: stored }); } catch (err) { console.warn('[log-cache] ingest hook:', err.message); }
    }
    return stored.length + observed;
  }

  /**
   * Re-analyzes every cached event of a group when its aggregates are missing
   * or were produced by an older extractor.
   */
  async function ensureAnalyzed({ profileId, region, logGroup }) {
    await signals();
    if (intelligence.isCurrent({ profileId, region, logGroup })) return false;
    await ready();
    const scope = { profileId, region, logGroup };
    await withGroupLock(scope, async () => {
      if (intelligence.isCurrent(scope)) return;
      // Keep the per-minute history older than the cached events (it cannot be rebuilt).
      const oldestCached = open().prepare('SELECT MIN(min_ts) AS t FROM log_cache_blocks WHERE profile_id = ? AND region = ? AND log_group = ?').get(profileId, region, logGroup).t;
      intelligence.clear(scope, { keepMinutesBefore: oldestCached ?? now() });
      let analyzed = 0;
      for (const block of blocksInRange(scope, null, null, 'ASC')) {
        const events = await readBlock(scope, block.id);
        intelligence.ingest({ ...scope, events });
        analyzed += events.length;
      }
      if (!analyzed) intelligence.ingest({ ...scope, events: [] });
    });
    return true;
  }

  /** Intelligence read model of a cached group (backfills it first if needed). */
  async function intelligenceFor({ profileId, region, logGroup }) {
    if (!groupRow(profileId, region, logGroup)) return null;
    await ensureAnalyzed({ profileId, region, logGroup });
    const summary = intelligence.summary({ profileId, region, logGroup });
    if (!summary) return null;
    const cache = describeGroup(profileId, region, logGroup);
    const row = groupRow(profileId, region, logGroup);
    const { classifyLogGroup } = require('./awsLogGroups');
    const { recommend } = require('./logRecommendations');
    const shared = await signals();
    const recommendations = recommend(summary, { logGroup, service: classifyLogGroup(logGroup).service, retentionInDays: row.retention_days }, shared);
    const { detectAnomalies } = require('./logAnomalies');
    const current = now();
    const anomalies = detectAnomalies({
      ...intelligence.anomalyInputs({ profileId, region, logGroup, from: current - 8 * 24 * 3600000, newSince: current - 2 * 24 * 3600000 }),
      syncedUntil: cache.syncedUntil,
      coverageFrom: cache.coverageFrom,
      backfillPending: cache.backfillPending,
      groups: Object.fromEntries(shared.CATEGORIES.map(category => [category.id, category.group])),
      now: current,
    });
    return { ...summary, recommendations, anomalies, ml: await semanticFor({ profileId, region, logGroup }), cache: { windowMs: cache.windowMs, lastSyncAt: cache.lastSyncAt, lastSyncStatus: cache.lastSyncStatus, events: cache.events } };
  }

  /** Similar-error clusters and category suggestions, only when local ML is enabled and loaded. */
  async function semanticFor(scope) {
    if (!semantic) return null;
    const state = ml.status().state;
    if (!ml.isReady()) return { state };
    try {
      return { state, ...(await semantic.analyze(intelligence.signatures({ ...scope, limit: 100 }))) };
    } catch (err) {
      return { state: 'error', error: err.message };
    }
  }

  /**
   * Signatures of the cached groups of a profile/region ranked by meaning.
   * Loads the model when it is enabled; throws ML_DISABLED otherwise.
   */
  async function searchSignatures({ profileId, region, query, logGroup = null, limit = 20 }) {
    if (!semantic) throw Object.assign(new Error('Local ML is not available'), { code: 'ML_DISABLED' });
    await ready();
    const rows = open().prepare('SELECT log_group FROM log_cache_groups WHERE profile_id = ? AND region = ? AND (? IS NULL OR log_group = ?)')
      .all(profileId, region, logGroup, logGroup);
    const groups = rows.map(row => ({ logGroup: row.log_group, signatures: intelligence.signatures({ profileId, region, logGroup: row.log_group, limit: 500 }) }));
    return semantic.search(query, groups, { limit });
  }

  /** Every cached group of a profile/region with its intelligence (used by APM). */
  async function intelligenceForScope({ profileId, region }) {
    const rows = open().prepare('SELECT log_group FROM log_cache_groups WHERE profile_id = ? AND region = ?').all(profileId, region);
    const result = {};
    for (const row of rows) result[row.log_group] = await intelligenceFor({ profileId, region, logGroup: row.log_group });
    return result;
  }

  // ── Retention and compaction ──

  /**
   * Merges hot blocks older than HOT_MS into one cold block per hour with
   * maximum compression (async: runs on the thread pool).
   */
  async function compact() {
    await ready();
    const database = open();
    const cutoff = now() - HOT_MS;
    const groups = database.prepare("SELECT DISTINCT profile_id, region, log_group FROM log_cache_blocks WHERE tier = 'hot' AND max_ts < ?").all(cutoff);
    let merged = 0;
    for (const g of groups) {
      const scope = { profileId: g.profile_id, region: g.region, logGroup: g.log_group };
      merged += await withGroupLock(scope, async () => {
        const hot = database.prepare(`
          SELECT id, min_ts FROM log_cache_blocks WHERE profile_id = ? AND region = ? AND log_group = ? AND tier = 'hot' AND max_ts < ? ORDER BY min_ts
        `).all(g.profile_id, g.region, g.log_group, cutoff);
        const byHour = new Map();
        for (const block of hot) {
          const hour = Math.floor(block.min_ts / COLD_BLOCK_MS);
          if (!byHour.has(hour)) byHour.set(hour, []);
          byHour.get(hour).push(block.id);
        }
        let count = 0;
        for (const ids of byHour.values()) {
          const events = [];
          const seen = new Set();
          for (const id of ids) for (const event of await readBlock(scope, id)) if (!seen.has(event.id)) { seen.add(event.id); events.push(event); }
          await writeBlocks(scope, events, 'cold');
          const remove = database.prepare('DELETE FROM log_cache_blocks WHERE id = ?');
          database.transaction(() => { for (const id of ids) remove.run(id); })();
          count += ids.length;
        }
        return count;
      });
    }
    return merged;
  }

  /** Drops blocks outside each group's window, then the oldest blocks while over budget. */
  function prune() {
    const database = open();
    const current = now();
    let removed = 0;
    database.transaction(() => {
      for (const row of database.prepare('SELECT profile_id, region, log_group, window_ms, pinned_from FROM log_cache_groups').all()) {
        removed += database.prepare('DELETE FROM log_cache_blocks WHERE profile_id = ? AND region = ? AND log_group = ? AND max_ts < ?')
          .run(row.profile_id, row.region, row.log_group, keepFrom(row, current)).changes;
      }
      removed += database.prepare('DELETE FROM log_cache_blocks WHERE max_ts < ?').run(current - MAX_WINDOW_MS).changes;
      let total = database.prepare('SELECT COALESCE(SUM(bytes), 0) AS bytes FROM log_cache_blocks').get().bytes;
      const oldest = database.prepare('SELECT id, bytes FROM log_cache_blocks ORDER BY max_ts ASC, id ASC LIMIT 200');
      const remove = database.prepare('DELETE FROM log_cache_blocks WHERE id = ?');
      while (total > budgetBytes) {
        const batch = oldest.all();
        if (!batch.length) break;
        for (const block of batch) {
          if (total <= budgetBytes) break;
          remove.run(block.id);
          total -= block.bytes;
          removed += 1;
        }
      }
    })();
    intelligence.prune();
    return removed;
  }

  /** Compaction then retention; called after each sync. */
  async function maintain() {
    const compacted = await compact();
    return { compacted, pruned: prune() };
  }

  // ── Read model ──

  // Oldest time syncs fill: the window, shortened by the group's history setting.
  function backfillStart(row, current) {
    return current - Math.min(row.window_ms, row.history_ms ?? row.window_ms);
  }

  function markSync({ profileId, region, logGroup, fields }) {
    const sets = Object.keys(fields).map(name => `${name} = ?`);
    open().prepare(`UPDATE log_cache_groups SET ${sets.join(', ')}, last_sync_at = ? WHERE profile_id = ? AND region = ? AND log_group = ?`)
      .run(...Object.values(fields), now(), profileId, region, logGroup);
  }

  function describeGroup(profileId, region, logGroup) {
    const row = groupRow(profileId, region, logGroup);
    if (!row) return null;
    const stats = open().prepare(`
      SELECT COALESCE(SUM(events), 0) AS events, COALESCE(SUM(bytes), 0) AS bytes, COALESCE(SUM(raw_bytes), 0) AS rawBytes,
        COUNT(*) AS blocks, SUM(tier = 'hot') AS hotBlocks, MIN(min_ts) AS oldest, MAX(max_ts) AS newest
      FROM log_cache_blocks WHERE profile_id = ? AND region = ? AND log_group = ?
    `).get(profileId, region, logGroup);
    const windowStart = backfillStart(row, now());
    return {
      logGroup: row.log_group,
      region: row.region,
      windowMs: row.window_ms,
      historyMs: row.history_ms,
      pinnedFrom: row.pinned_from != null && row.pinned_from < now() - row.window_ms ? row.pinned_from : null,
      limitedBySize: row.window_ms < MAX_WINDOW_MS,
      dailyBytes: Math.round(estimateDailyBytes({ storedBytes: row.stored_bytes, retentionInDays: row.retention_days, creationTime: row.creation_time }, now())),
      syncedUntil: row.synced_until,
      coverageFrom: row.coverage_from,
      backfillPending: row.synced_until != null && (row.coverage_from ?? Infinity) > windowStart + SYNC_OVERLAP_MS,
      lastSyncAt: row.last_sync_at,
      lastSyncStatus: row.last_sync_status,
      lastError: row.last_error,
      ...stats,
      hotBlocks: stats.hotBlocks || 0,
      compressionRatio: stats.bytes ? Math.round((stats.rawBytes / stats.bytes) * 10) / 10 : null,
    };
  }

  function summary({ profileId, region } = {}) {
    const database = open();
    const rows = database.prepare('SELECT profile_id, region, log_group FROM log_cache_groups WHERE (? IS NULL OR profile_id = ?) AND (? IS NULL OR region = ?) ORDER BY log_group')
      .all(profileId ?? null, profileId ?? null, region ?? null, region ?? null);
    const total = database.prepare('SELECT COALESCE(SUM(events), 0) AS events, COALESCE(SUM(bytes), 0) AS bytes, COALESCE(SUM(raw_bytes), 0) AS rawBytes FROM log_cache_blocks').get();
    return {
      budgetBytes,
      maxWindowMs: MAX_WINDOW_MS,
      hotWindowMs: HOT_MS,
      totalBytes: total.bytes,
      totalRawBytes: total.rawBytes,
      totalEvents: total.events,
      encryption: { algorithm: 'AES-256-GCM', compression: 'brotli', keyStore },
      groups: rows.map(row => describeGroup(row.profile_id, row.region, row.log_group)),
    };
  }

  /**
   * Newest cached events of a group matching a predicate. Decrypts blocks
   * newest first and stops when enough events were found.
   */
  async function collect(scope, { from = null, to = null, max, match = () => true }) {
    await ready();
    const found = [];
    let truncated = false;
    let blocksRead = 0;
    const blocks = blocksInRange(scope, from, to);
    for (let index = 0; index < blocks.length; index += 1) {
      const block = blocks[index];
      const events = await readBlock(scope, block.id);
      blocksRead += 1;
      for (const event of events) {
        if ((from != null && event.timestamp < from) || (to != null && event.timestamp > to) || !match(event)) continue;
        found.push({ timestamp: event.timestamp, logStreamName: event.logStreamName, message: event.message });
      }
      // Blocks overlap in time: only stop once the next block cannot hold newer events.
      if (found.length > max) {
        found.sort((a, b) => b.timestamp - a.timestamp);
        const cutoff = found[max - 1].timestamp;
        const next = blocks[index + 1];
        if (!next || next.max_ts < cutoff) { truncated = !!next || found.length > max; break; }
      }
    }
    found.sort((a, b) => b.timestamp - a.timestamp);
    if (found.length > max) truncated = true;
    return { events: found.slice(0, max), truncated, blocksRead };
  }

  /**
   * Cached events matching a CloudWatch filter pattern (same syntax and
   * semantics as FilterLogEvents), newest first.
   */
  async function query({ profileId, region, logGroup, from = null, to = null, text = '', pattern, stream = '', limit = 500 }) {
    const compiled = (await patterns()).compileFilterPattern(pattern ?? text);
    if (compiled.error) throw Object.assign(new Error(`Invalid filter pattern: ${compiled.error}`), { $metadata: { httpStatusCode: 400 } });
    const cap = Math.max(1, Math.min(Number(limit) || 500, 5000));
    const result = await collect({ profileId, region, logGroup }, {
      from: from == null ? null : Number(from), to: to == null ? null : Number(to), max: cap,
      match: event => (!stream || event.logStreamName === stream) && compiled.match(event.message),
    });
    return result.events;
  }

  /**
   * Event counts per time bin and level over a range, from the cached events
   * (decrypted). The bin size adapts to the range (seconds → days). Optional
   * category/level/pattern filters use the same rules as filterEvents.
   */
  async function histogram({ profileId, region, logGroup, from, to, binMs, category = '', level = '', pattern = '' }) {
    await ready();
    const module = await signals();
    const compiled = (await patterns()).compileFilterPattern(pattern);
    if (compiled.error) throw Object.assign(new Error(`Invalid filter pattern: ${compiled.error}`), { $metadata: { httpStatusCode: 400 } });
    const end = Number(to ?? now());
    const start = Number(from ?? end - DAY_MS);
    const size = binMs && BIN_SIZES.includes(Number(binMs)) && (end - start) / Number(binMs) <= MAX_BINS * 2 ? Number(binMs) : pickBinMs(end - start);
    const first = Math.floor(start / size) * size;
    const buckets = [];
    for (let t = first; t < end; t += size) buckets.push({ start: t, error: 0, warn: 0, info: 0 });
    const scope = { profileId, region, logGroup };
    const group = describeGroup(profileId, region, logGroup);
    // Bins of a minute or more come from the per-minute index, which keeps
    // counting after the raw events leave the cache. Category and pattern
    // filters need the event text, so they read the cached events instead.
    if (size >= 60 * 1000 && !category && !pattern) {
      await ensureAnalyzed(scope);
      const series = intelligence.minuteSeries({ ...scope, from: start, to: end, binMs: size });
      if (level) for (const bucket of series.buckets) for (const key of ['error', 'warn', 'info']) if (key !== level) bucket[key] = 0;
      return {
        from: start, to: end, binMs: size, source: 'index',
        events: series.buckets.reduce((sum, b) => sum + b.error + b.warn + b.info, 0),
        buckets: series.buckets,
        coverage: { oldest: series.oldest ?? group?.oldest ?? null, newest: group?.newest ?? null, syncedUntil: group?.syncedUntil ?? null, lastSyncAt: group?.lastSyncAt ?? null },
      };
    }
    let events = 0;
    for (const block of blocksInRange(scope, start, end, 'ASC')) {
      for (const event of await readBlock(scope, block.id)) {
        if (event.timestamp < start || event.timestamp >= end) continue;
        const eventLevel = module.lineLevel(event.message);
        if (level && eventLevel !== level) continue;
        if (category && module.categorize(event.message, eventLevel) !== category) continue;
        if (!compiled.match(event.message)) continue;
        const bucket = buckets[Math.floor((event.timestamp - first) / size)];
        if (!bucket) continue;
        bucket[eventLevel] += 1;
        events += 1;
      }
    }
    return {
      from: start, to: end, binMs: size, events, buckets, source: 'events',
      coverage: { oldest: group?.oldest ?? null, newest: group?.newest ?? null, syncedUntil: group?.syncedUntil ?? null, lastSyncAt: group?.lastSyncAt ?? null },
    };
  }

  /**
   * Cached events of one category, level and/or signature, newest first. Each
   * event is re-classified with the shared rules while its block is decrypted.
   */
  async function filterEvents({ profileId, region, logGroup, from = null, to = null, category = '', level = '', signature = '', pattern = '', limit = 200 }) {
    const module = await signals();
    const compiled = (await patterns()).compileFilterPattern(pattern);
    if (compiled.error) throw Object.assign(new Error(`Invalid filter pattern: ${compiled.error}`), { $metadata: { httpStatusCode: 400 } });
    const cap = Math.max(1, Math.min(Number(limit) || 200, 2000));
    const result = await collect({ profileId, region, logGroup }, {
      from, to, max: cap,
      match: event => {
        if (!compiled.match(event.message)) return false;
        const eventLevel = module.lineLevel(event.message);
        if (level && eventLevel !== level) return false;
        if (category && module.categorize(event.message, eventLevel) !== category) return false;
        if (signature && (eventLevel === 'info' || module.errorSignature(event.message) !== signature)) return false;
        return true;
      },
    });
    return {
      truncated: result.truncated,
      blocksRead: result.blocksRead,
      events: result.events.map(event => {
        const eventLevel = module.lineLevel(event.message);
        return { ...event, level: eventLevel, category: module.categorize(event.message, eventLevel) };
      }),
    };
  }

  /** Newest cached events of a group in a range (input for local queries). */
  async function scan({ profileId, region, logGroup, from = null, to = null, max = 200000 }) {
    return collect({ profileId, region, logGroup }, { from, to, max });
  }

  // ── Sync ──

  /**
   * Reads a time range with FilterLogEvents (ascending) within a page budget.
   * Returns how far it got: { pages, fetched, inserted, newest, complete }.
   */
  async function fetchRange(scope, { client, FilterLogEventsCommand, startTime, endTime, pageBudget }) {
    let nextToken;
    let pages = 0;
    let fetched = 0;
    let inserted = 0;
    let newest = null;
    if (pageBudget <= 0 || startTime >= endTime) return { pages, fetched, inserted, newest, complete: startTime >= endTime };
    do {
      const response = await client.send(new FilterLogEventsCommand({ logGroupName: scope.logGroup, startTime, endTime, nextToken }));
      const events = response.events || [];
      fetched += events.length;
      inserted += await ingest({ ...scope, events });
      for (const event of events) if (event.timestamp > (newest ?? -Infinity)) newest = event.timestamp;
      nextToken = response.nextToken;
      pages += 1;
    } while (nextToken && pages < pageBudget);
    return { pages, fetched, inserted, newest, complete: !nextToken };
  }

  /**
   * Recent hours first, then older ones:
   *  1. recent: from the last sync (or the last HOT_MS hours on a first or
   *     long-delayed sync) up to now;
   *  2. backfill: with the pages left, from the start of the window up to
   *     where recent coverage begins, resuming at the previous cursor.
   * "partial" means either part still has pages pending.
   */
  async function syncGroup({ profileId, region, logGroup, client, FilterLogEventsCommand, maxPages = MAX_SYNC_PAGES }) {
    const row = groupRow(profileId, region, logGroup);
    if (!row) throw Object.assign(new Error('Log group is not cached'), { $metadata: { httpStatusCode: 404 } });
    await ready();
    const scope = { profileId, region, logGroup };
    const current = now();
    const windowStart = current - row.window_ms;
    const historyStart = backfillStart(row, current);
    const continuous = row.synced_until != null && row.synced_until >= current - HOT_MS;
    const recentStart = continuous ? Math.max(windowStart, row.synced_until - SYNC_OVERLAP_MS) : Math.max(historyStart, windowStart, current - Math.min(HOT_MS, Math.max(row.history_ms ?? HOT_MS, SYNC_OVERLAP_MS)));
    let coverageFrom = continuous ? Math.max(windowStart, row.coverage_from ?? recentStart) : recentStart;
    let backfillCursor = row.backfill_cursor;
    const totals = { pages: 0, fetched: 0, inserted: 0 };
    let syncedUntil = row.synced_until;
    let recentComplete = false;
    let backfillComplete = false;
    try {
      const recent = await fetchRange(scope, { client, FilterLogEventsCommand, startTime: recentStart, endTime: current, pageBudget: maxPages });
      recentComplete = recent.complete;
      syncedUntil = recent.complete ? current : (recent.newest ?? recentStart);
      for (const k of Object.keys(totals)) totals[k] += recent[k];

      const olderStart = Math.max(historyStart, backfillCursor ?? historyStart);
      if (olderStart >= coverageFrom) {
        backfillComplete = true;
      } else {
        const older = await fetchRange(scope, { client, FilterLogEventsCommand, startTime: olderStart, endTime: coverageFrom, pageBudget: maxPages - totals.pages });
        for (const k of Object.keys(totals)) totals[k] += older[k];
        if (older.complete) { backfillComplete = true; coverageFrom = historyStart; backfillCursor = null; }
        else if (older.newest != null) backfillCursor = older.newest;
      }
    } catch (err) {
      if (err.name === 'ResourceNotFoundException') {
        markSync({ ...scope, fields: { last_sync_status: 'missing', last_error: 'Log group not found' } });
        return { status: 'missing', ...totals, pruned: 0, group: describeGroup(profileId, region, logGroup) };
      }
      markSync({ ...scope, fields: { synced_until: syncedUntil, last_sync_status: 'error', last_error: err.message } });
      throw err;
    }
    const status = recentComplete && backfillComplete ? 'ok' : 'partial';
    markSync({ ...scope, fields: { synced_until: syncedUntil, coverage_from: coverageFrom, backfill_cursor: backfillCursor, last_sync_status: status, last_error: null } });
    const { compacted, pruned } = await maintain();
    return { status, ...totals, compacted, pruned, group: describeGroup(profileId, region, logGroup) };
  }

  // ── Background scans (state only; lib/awsLogScans.js runs them) ──

  function scanRow(row) {
    if (!row) return null;
    const span = row.to_ts - row.from_ts;
    return {
      id: row.id, profileId: row.profile_id, region: row.region, logGroup: row.log_group,
      from: row.from_ts, to: row.to_ts, cursor: row.cursor_ts, status: row.status,
      progress: span > 0 ? Math.min(1, Math.max(0, (row.to_ts - row.cursor_ts) / span)) : 1,
      pages: row.pages, fetched: row.fetched, inserted: row.inserted, error: row.error,
      createdAt: row.created_at, startedAt: row.started_at, updatedAt: row.updated_at, finishedAt: row.finished_at,
    };
  }

  /** Creates a queued scan of [from, to) (at most MAX_SCAN_MS) and pins its range on the group. */
  function createScan({ profileId, region, logGroup, from, to }) {
    if (!groupRow(profileId, region, logGroup)) throw Object.assign(new Error('Log group is not cached'), { $metadata: { httpStatusCode: 404 } });
    const current = now();
    const end = Math.min(Number(to) || current, current);
    const start = Math.max(Number(from) || 0, end - MAX_SCAN_MS, current - MAX_WINDOW_MS);
    if (!(start < end)) throw Object.assign(new Error('Invalid scan range'), { $metadata: { httpStatusCode: 400 } });
    const database = open();
    const id = database.transaction(() => {
      database.prepare('UPDATE log_cache_groups SET pinned_from = MIN(COALESCE(pinned_from, ?), ?) WHERE profile_id = ? AND region = ? AND log_group = ?')
        .run(start, start, profileId, region, logGroup);
      return database.prepare(`
        INSERT INTO log_cache_scans (profile_id, region, log_group, from_ts, to_ts, cursor_ts, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?)
      `).run(profileId, region, logGroup, start, end, end, current, current).lastInsertRowid;
    })();
    return getScan(Number(id));
  }

  function getScan(id) {
    return scanRow(open().prepare('SELECT * FROM log_cache_scans WHERE id = ?').get(id));
  }

  function listScans({ profileId, region, statuses } = {}) {
    const rows = open().prepare(`
      SELECT * FROM log_cache_scans
      WHERE (? IS NULL OR profile_id = ?) AND (? IS NULL OR region = ?)
      ORDER BY created_at DESC, id DESC
    `).all(profileId ?? null, profileId ?? null, region ?? null, region ?? null).map(scanRow);
    return statuses ? rows.filter(scan => statuses.includes(scan.status)) : rows;
  }

  function updateScan(id, fields) {
    const entries = Object.entries(fields).filter(([name]) => SCAN_COLUMNS[name]);
    if (entries.length) {
      open().prepare(`UPDATE log_cache_scans SET ${entries.map(([name]) => `${SCAN_COLUMNS[name]} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
        .run(...entries.map(([, value]) => value), now(), id);
    }
    return getScan(id);
  }

  function deleteScan(id) {
    return open().prepare('DELETE FROM log_cache_scans WHERE id = ?').run(id).changes > 0;
  }

  /** Cache bytes used and allowed (scans stop when the budget is reached). */
  function usage() {
    const { bytes } = open().prepare('SELECT COALESCE(SUM(bytes), 0) AS bytes FROM log_cache_blocks').get();
    return { bytes, budgetBytes };
  }

  function close() {
    if (db) db.close();
    db = null;
  }

  return {
    ready, enable, disable, insertEvents, ingest, ensureAnalyzed, intelligenceFor, intelligenceForScope, searchSignatures,
    compact, prune, maintain, query, scan, filterEvents, histogram, setHistory, summary,
    addIngestHook: hook => hooks.push(hook), describeGroup, syncGroup, close, isCached: (p, r, g) => !!groupRow(p, r, g),
    createScan, getScan, listScans, updateScan, deleteScan, usage,
  };
}

// Lambda REPORT lines of cached groups feed APM metrics (same dedupe by event
// and request id as the opportunistic capture of the Lambda logs view).
async function captureLambdaReports({ profileId, region, logGroup, events }) {
  const { getApmDatabase } = require('./apm/database');
  const { captureLambdaLogEvents } = require('./apm/opportunisticCapture');
  const functionName = logGroup.startsWith('/aws/lambda/') ? logGroup.slice('/aws/lambda/'.length) : logGroup;
  captureLambdaLogEvents({ database: getApmDatabase(), profileId, region, functionName, logGroupName: logGroup, events });
}

let shared = null;
function getLogCache() {
  if (!shared) shared = createLogCache({ onIngest: [captureLambdaReports], ml: require('./ml/localModel').getLocalModel() });
  return shared;
}

module.exports = {
  createLogCache, getLogCache, planWindow, estimateDailyBytes, pickBinMs,
  MAX_WINDOW_MS, MIN_WINDOW_MS, HOT_MS, DEFAULT_BUDGET_BYTES, MAX_SCAN_MS,
};
