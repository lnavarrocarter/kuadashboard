'use strict';
/**
 * lib/logIntelligence.js
 * Persisted, aggregated log intelligence for cached log groups. Every event a
 * cached group stores passes through the shared deterministic extractor
 * (frontend/src/shared/logSignals.mjs) and only aggregates are kept here:
 *   - 30-minute buckets (events, errors, warnings, failure keywords, categories,
 *     sensitive data found and redacted, by type),
 *   - recurring error/warning signatures with a sanitized sample and category,
 *   - references to other resources (ARNs, queues, hosts, Kubernetes DNS).
 * Aggregates outlive the raw cache (30 days vs ≤ 7) so historical rates exist
 * after events expire. Nothing here calls a cloud API.
 *
 * Provider-neutral by design: keys are (scope, region, source) so Kubernetes
 * log tabs, GCP and Vercel sources can feed the same tables later.
 */

const BUCKET_MS = 30 * 60 * 1000;            // same buckets as APM metric collection
const MINUTE_MS = 60 * 1000;                  // per-minute level counts: the chart outlives the raw cache
// Bumped when the stored aggregates change shape, so cached groups are re-analyzed.
const AGGREGATES_VERSION = 2;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_SIGNATURES_PER_SOURCE = 500;
const MAX_REFERENCES_PER_SOURCE = 500;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS log_intel_state (
    profile_id TEXT NOT NULL, region TEXT NOT NULL, log_group TEXT NOT NULL,
    version INTEGER NOT NULL, events_analyzed INTEGER NOT NULL DEFAULT 0,
    last_event_at INTEGER, updated_at INTEGER NOT NULL,
    PRIMARY KEY (profile_id, region, log_group)
  );
  CREATE TABLE IF NOT EXISTS log_intel_buckets (
    profile_id TEXT NOT NULL, region TEXT NOT NULL, log_group TEXT NOT NULL, bucket_start INTEGER NOT NULL,
    events INTEGER NOT NULL DEFAULT 0, errors INTEGER NOT NULL DEFAULT 0, warnings INTEGER NOT NULL DEFAULT 0,
    keywords_json TEXT NOT NULL DEFAULT '{}',
    PRIMARY KEY (profile_id, region, log_group, bucket_start)
  );
  CREATE TABLE IF NOT EXISTS log_intel_signatures (
    profile_id TEXT NOT NULL, region TEXT NOT NULL, log_group TEXT NOT NULL, signature TEXT NOT NULL,
    level TEXT NOT NULL, sample TEXT NOT NULL, occurrences INTEGER NOT NULL,
    first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL,
    PRIMARY KEY (profile_id, region, log_group, signature)
  );
  CREATE TABLE IF NOT EXISTS log_intel_references (
    profile_id TEXT NOT NULL, region TEXT NOT NULL, log_group TEXT NOT NULL, kind TEXT NOT NULL, target TEXT NOT NULL,
    type TEXT NOT NULL, name TEXT NOT NULL, namespace TEXT, occurrences INTEGER NOT NULL,
    first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL,
    PRIMARY KEY (profile_id, region, log_group, kind, target)
  );
  CREATE INDEX IF NOT EXISTS log_intel_buckets_time ON log_intel_buckets (bucket_start);
  CREATE TABLE IF NOT EXISTS log_intel_minutes (
    profile_id TEXT NOT NULL, region TEXT NOT NULL, log_group TEXT NOT NULL, minute_start INTEGER NOT NULL,
    events INTEGER NOT NULL DEFAULT 0, errors INTEGER NOT NULL DEFAULT 0, warnings INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (profile_id, region, log_group, minute_start)
  ) WITHOUT ROWID;
`;

// Columns added after the first version of the tables.
const ADDED_COLUMNS = [
  ['log_intel_buckets', 'categories_json', "TEXT NOT NULL DEFAULT '{}'"],
  ['log_intel_buckets', 'sensitive_json', "TEXT NOT NULL DEFAULT '{}'"],
  ['log_intel_signatures', 'category', "TEXT NOT NULL DEFAULT 'other_error'"],
];

function mergeCounts(target, source) {
  for (const [name, count] of Object.entries(source || {})) target[name] = (target[name] || 0) + count;
  return target;
}

let signalsModule = null;
/** The shared extractor is an ES module; load it once. */
async function loadSignals() {
  if (!signalsModule) signalsModule = await import('../frontend/src/shared/logSignals.mjs');
  return signalsModule;
}

function createLogIntelligence({ database, signals, now = () => Date.now() }) {
  if (typeof database !== 'function') throw new Error('database accessor is required');
  let ready = false;
  function db() {
    const handle = database();
    if (!ready) {
      handle.exec(SCHEMA);
      for (const [table, column, type] of ADDED_COLUMNS) {
        const columns = new Set(handle.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name));
        if (!columns.has(column)) handle.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
      }
      ready = true;
    }
    return handle;
  }

  const key = (profileId, region, logGroup) => [profileId, region, logGroup];

  /** Aggregates events into the tables. `signals` is the loaded shared module. */
  function ingest({ profileId, region, logGroup, events }) {
    if (!signals) throw new Error('log signals are not loaded');
    if (!events?.length) return { analyzed: 0 };
    const handle = db();
    const buckets = new Map();
    const minutes = new Map();
    const signatures = new Map();
    const references = new Map();
    let lastEventAt = 0;
    for (const event of events) {
      const ts = Number(event.timestamp);
      if (!Number.isFinite(ts)) continue;
      lastEventAt = Math.max(lastEventAt, ts);
      const result = signals.eventSignals(event.message);
      const start = Math.floor(ts / BUCKET_MS) * BUCKET_MS;
      const bucket = buckets.get(start) || { events: 0, errors: 0, warnings: 0, keywords: {}, categories: {}, sensitive: {} };
      bucket.events += 1;
      if (result.level === 'error') bucket.errors += 1;
      if (result.level === 'warn') bucket.warnings += 1;
      for (const keyword of result.keywords) bucket.keywords[keyword] = (bucket.keywords[keyword] || 0) + 1;
      bucket.categories[result.category] = (bucket.categories[result.category] || 0) + 1;
      // Internal counter (not a failure keyword): share of structured (JSON) lines.
      if (result.structured) bucket.keywords._json = (bucket.keywords._json || 0) + 1;
      mergeCounts(bucket.sensitive, result.sensitive);
      buckets.set(start, bucket);
      const minute = Math.floor(ts / MINUTE_MS) * MINUTE_MS;
      const counts = minutes.get(minute) || { events: 0, errors: 0, warnings: 0 };
      counts.events += 1;
      if (result.level === 'error') counts.errors += 1;
      if (result.level === 'warn') counts.warnings += 1;
      minutes.set(minute, counts);
      if (result.signature) {
        const current = signatures.get(result.signature) || { level: result.level, category: result.category, sample: result.sample, occurrences: 0, first: ts, last: ts };
        current.occurrences += 1;
        current.first = Math.min(current.first, ts);
        if (ts >= current.last) { current.last = ts; current.sample = result.sample; }
        if (result.level === 'error') current.level = 'error';
        signatures.set(result.signature, current);
      }
      for (const ref of result.references) {
        const refKey = `${ref.kind}\u0000${ref.target}`;
        const current = references.get(refKey) || { ...ref, occurrences: 0, first: ts, last: ts };
        current.occurrences += 1;
        current.first = Math.min(current.first, ts);
        current.last = Math.max(current.last, ts);
        references.set(refKey, current);
      }
    }
    const scope = key(profileId, region, logGroup);
    handle.transaction(() => {
      const bucketRead = handle.prepare('SELECT keywords_json, categories_json, sensitive_json FROM log_intel_buckets WHERE profile_id = ? AND region = ? AND log_group = ? AND bucket_start = ?');
      const bucketWrite = handle.prepare(`
        INSERT INTO log_intel_buckets (profile_id, region, log_group, bucket_start, events, errors, warnings, keywords_json, categories_json, sensitive_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (profile_id, region, log_group, bucket_start) DO UPDATE SET
          events = events + excluded.events, errors = errors + excluded.errors, warnings = warnings + excluded.warnings,
          keywords_json = excluded.keywords_json, categories_json = excluded.categories_json, sensitive_json = excluded.sensitive_json
      `);
      for (const [start, bucket] of buckets) {
        const previous = bucketRead.get(...scope, start) || {};
        bucketWrite.run(...scope, start, bucket.events, bucket.errors, bucket.warnings,
          JSON.stringify(mergeCounts(JSON.parse(previous.keywords_json || '{}'), bucket.keywords)),
          JSON.stringify(mergeCounts(JSON.parse(previous.categories_json || '{}'), bucket.categories)),
          JSON.stringify(mergeCounts(JSON.parse(previous.sensitive_json || '{}'), bucket.sensitive)));
      }
      const minuteWrite = handle.prepare(`
        INSERT INTO log_intel_minutes (profile_id, region, log_group, minute_start, events, errors, warnings)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (profile_id, region, log_group, minute_start) DO UPDATE SET
          events = events + excluded.events, errors = errors + excluded.errors, warnings = warnings + excluded.warnings
      `);
      for (const [minute, c] of minutes) minuteWrite.run(...scope, minute, c.events, c.errors, c.warnings);
      const signatureWrite = handle.prepare(`
        INSERT INTO log_intel_signatures (profile_id, region, log_group, signature, level, category, sample, occurrences, first_seen, last_seen)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (profile_id, region, log_group, signature) DO UPDATE SET
          occurrences = occurrences + excluded.occurrences,
          first_seen = MIN(first_seen, excluded.first_seen),
          sample = CASE WHEN excluded.last_seen >= last_seen THEN excluded.sample ELSE sample END,
          last_seen = MAX(last_seen, excluded.last_seen),
          level = CASE WHEN excluded.level = 'error' THEN 'error' ELSE level END
      `);
      for (const [signature, s] of signatures) signatureWrite.run(...scope, signature, s.level, s.category, s.sample, s.occurrences, s.first, s.last);
      const referenceWrite = handle.prepare(`
        INSERT INTO log_intel_references (profile_id, region, log_group, kind, target, type, name, namespace, occurrences, first_seen, last_seen)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (profile_id, region, log_group, kind, target) DO UPDATE SET
          occurrences = occurrences + excluded.occurrences,
          first_seen = MIN(first_seen, excluded.first_seen),
          last_seen = MAX(last_seen, excluded.last_seen)
      `);
      for (const r of references.values()) referenceWrite.run(...scope, r.kind, r.target, r.type, r.name, r.namespace || null, r.occurrences, r.first, r.last);
      handle.prepare(`
        INSERT INTO log_intel_state (profile_id, region, log_group, version, events_analyzed, last_event_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (profile_id, region, log_group) DO UPDATE SET
          version = excluded.version, events_analyzed = events_analyzed + excluded.events_analyzed,
          last_event_at = MAX(COALESCE(last_event_at, 0), excluded.last_event_at), updated_at = excluded.updated_at
      `).run(...scope, currentVersion(), events.length, lastEventAt || null, now());
      trimSource(handle, scope);
    })();
    return { analyzed: events.length };
  }

  /**
   * Per-minute level counts for events seen by a search but older than the
   * cache window (not stored, so they cannot be deduplicated by id). Each
   * minute keeps the MAXIMUM observed per level: repeating a search never
   * double counts; partial searches may undercount, never overcount.
   */
  function observeMinutes({ profileId, region, logGroup, events }) {
    if (!signals) throw new Error('log signals are not loaded');
    if (!events?.length) return { observed: 0 };
    const handle = db();
    const minutes = new Map();
    for (const event of events) {
      const ts = Number(event.timestamp);
      if (!Number.isFinite(ts)) continue;
      const minute = Math.floor(ts / MINUTE_MS) * MINUTE_MS;
      const counts = minutes.get(minute) || { error: 0, warn: 0, info: 0 };
      counts[signals.lineLevel(event.message)] += 1;
      minutes.set(minute, counts);
    }
    const scope = key(profileId, region, logGroup);
    const read = handle.prepare('SELECT events, errors, warnings FROM log_intel_minutes WHERE profile_id = ? AND region = ? AND log_group = ? AND minute_start = ?');
    const write = handle.prepare(`
      INSERT INTO log_intel_minutes (profile_id, region, log_group, minute_start, events, errors, warnings) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (profile_id, region, log_group, minute_start) DO UPDATE SET events = excluded.events, errors = excluded.errors, warnings = excluded.warnings
    `);
    let changed = 0;
    handle.transaction(() => {
      for (const [minute, seen] of minutes) {
        const row = read.get(...scope, minute) || { events: 0, errors: 0, warnings: 0 };
        const errors = Math.max(row.errors, seen.error);
        const warnings = Math.max(row.warnings, seen.warn);
        const info = Math.max(row.events - row.errors - row.warnings, seen.info);
        if (errors + warnings + info === row.events && errors === row.errors && warnings === row.warnings) continue;
        write.run(...scope, minute, errors + warnings + info, errors, warnings);
        changed += 1;
      }
    })();
    return { observed: events.length, minutesUpdated: changed };
  }

  // Keeps the most relevant signatures/references when a noisy source produces many.
  function trimSource(handle, scope) {
    handle.prepare(`
      DELETE FROM log_intel_signatures WHERE profile_id = ? AND region = ? AND log_group = ? AND signature NOT IN (
        SELECT signature FROM log_intel_signatures WHERE profile_id = ? AND region = ? AND log_group = ?
        ORDER BY last_seen DESC, occurrences DESC LIMIT ${MAX_SIGNATURES_PER_SOURCE})
    `).run(...scope, ...scope);
    handle.prepare(`
      DELETE FROM log_intel_references WHERE profile_id = ? AND region = ? AND log_group = ? AND (kind || char(0) || target) NOT IN (
        SELECT kind || char(0) || target FROM log_intel_references WHERE profile_id = ? AND region = ? AND log_group = ?
        ORDER BY occurrences DESC LIMIT ${MAX_REFERENCES_PER_SOURCE})
    `).run(...scope, ...scope);
  }

  /**
   * Removes the aggregates of a source. `keepMinutesBefore` preserves the
   * per-minute index older than that time: a re-analysis rebuilds only what
   * is still cached, so the chart history beyond the cache must survive it.
   */
  function clear({ profileId, region, logGroup }, { keepMinutesBefore = null } = {}) {
    const handle = db();
    const scope = key(profileId, region, logGroup);
    handle.transaction(() => {
      for (const table of ['log_intel_state', 'log_intel_buckets', 'log_intel_signatures', 'log_intel_references']) {
        handle.prepare(`DELETE FROM ${table} WHERE profile_id = ? AND region = ? AND log_group = ?`).run(...scope);
      }
      handle.prepare('DELETE FROM log_intel_minutes WHERE profile_id = ? AND region = ? AND log_group = ? AND minute_start >= ?')
        .run(...scope, keepMinutesBefore == null ? -Infinity : Math.floor(keepMinutesBefore / MINUTE_MS) * MINUTE_MS);
    })();
  }

  function prune() {
    const handle = db();
    const cutoff = now() - RETENTION_MS;
    handle.prepare('DELETE FROM log_intel_buckets WHERE bucket_start < ?').run(cutoff);
    handle.prepare('DELETE FROM log_intel_minutes WHERE minute_start < ?').run(cutoff);
    handle.prepare('DELETE FROM log_intel_signatures WHERE last_seen < ?').run(cutoff);
    handle.prepare('DELETE FROM log_intel_references WHERE last_seen < ?').run(cutoff);
  }

  /** Whether a source was analyzed with the current extractor version. */
  function isCurrent({ profileId, region, logGroup }) {
    if (!signals) return false;
    const row = db().prepare('SELECT version FROM log_intel_state WHERE profile_id = ? AND region = ? AND log_group = ?').get(profileId, region, logGroup);
    return row?.version === currentVersion();
  }

  // Extractor rules and aggregate layout both decide whether stored aggregates are current.
  function currentVersion() {
    return signals.SIGNALS_VERSION * 100 + AGGREGATES_VERSION;
  }

  /**
   * Level counts per bin (≥ 1 minute) from the per-minute index, kept for
   * RETENTION_MS even after the raw events left the cache.
   */
  function minuteSeries({ profileId, region, logGroup, from, to, binMs }) {
    const rows = db().prepare(`
      SELECT minute_start AS t, events, errors, warnings FROM log_intel_minutes
      WHERE profile_id = ? AND region = ? AND log_group = ? AND minute_start >= ? AND minute_start < ?
    `).all(profileId, region, logGroup, Math.floor(from / MINUTE_MS) * MINUTE_MS, to);
    const first = Math.floor(from / binMs) * binMs;
    const buckets = [];
    for (let t = first; t < to; t += binMs) buckets.push({ start: t, error: 0, warn: 0, info: 0 });
    let events = 0;
    for (const row of rows) {
      const bucket = buckets[Math.floor((row.t - first) / binMs)];
      if (!bucket) continue;
      bucket.error += row.errors;
      bucket.warn += row.warnings;
      bucket.info += row.events - row.errors - row.warnings;
      events += row.events;
    }
    const oldest = db().prepare('SELECT MIN(minute_start) AS t FROM log_intel_minutes WHERE profile_id = ? AND region = ? AND log_group = ?').get(profileId, region, logGroup).t;
    return { buckets, events, oldest };
  }

  function windowStats(scope, from) {
    const row = db().prepare(`
      SELECT COALESCE(SUM(events), 0) AS events, COALESCE(SUM(errors), 0) AS errors, COALESCE(SUM(warnings), 0) AS warnings
      FROM log_intel_buckets WHERE profile_id = ? AND region = ? AND log_group = ? AND bucket_start >= ?
    `).get(...scope, from);
    return { ...row, errorRatePercent: row.events ? Math.round((row.errors / row.events) * 10000) / 100 : null };
  }

  /** Read model for the UI and for APM: rates, recurring signatures, keywords and references. */
  function summary({ profileId, region, logGroup, signatureLimit = 10, referenceLimit = 20 }) {
    const handle = db();
    const scope = key(profileId, region, logGroup);
    const state = handle.prepare('SELECT * FROM log_intel_state WHERE profile_id = ? AND region = ? AND log_group = ?').get(...scope);
    if (!state) return null;
    const current = now();
    const totals = from => {
      const result = { keywords: {}, categories: {}, sensitive: {} };
      for (const row of handle.prepare('SELECT keywords_json, categories_json, sensitive_json FROM log_intel_buckets WHERE profile_id = ? AND region = ? AND log_group = ? AND bucket_start >= ?').all(...scope, from)) {
        mergeCounts(result.keywords, JSON.parse(row.keywords_json || '{}'));
        mergeCounts(result.categories, JSON.parse(row.categories_json || '{}'));
        mergeCounts(result.sensitive, JSON.parse(row.sensitive_json || '{}'));
      }
      return result;
    };
    const day = totals(current - 24 * 3600000);
    const week = totals(current - 7 * 24 * 3600000);
    const jsonEvents7d = week.keywords._json || 0;
    delete day.keywords._json;
    delete week.keywords._json;
    const keywords = day.keywords;
    return {
      logGroup,
      version: state.version,
      eventsAnalyzed: state.events_analyzed,
      lastEventAt: state.last_event_at,
      updatedAt: state.updated_at,
      last24h: windowStats(scope, current - 24 * 3600000),
      last7d: windowStats(scope, current - 7 * 24 * 3600000),
      keywords24h: keywords,
      jsonEvents7d,
      categories24h: day.categories,
      categories7d: week.categories,
      sensitive24h: day.sensitive,
      sensitive7d: week.sensitive,
      series: handle.prepare(`
        SELECT bucket_start AS start, events, errors, warnings FROM log_intel_buckets
        WHERE profile_id = ? AND region = ? AND log_group = ? AND bucket_start >= ? ORDER BY bucket_start
      `).all(...scope, current - 7 * 24 * 3600000),
      signatures: handle.prepare(`
        SELECT signature, level, category, sample, occurrences, first_seen AS firstSeen, last_seen AS lastSeen FROM log_intel_signatures
        WHERE profile_id = ? AND region = ? AND log_group = ? ORDER BY (level = 'error') DESC, occurrences DESC LIMIT ?
      `).all(...scope, signatureLimit),
      references: handle.prepare(`
        SELECT kind, target, type, name, namespace, occurrences, first_seen AS firstSeen, last_seen AS lastSeen FROM log_intel_references
        WHERE profile_id = ? AND region = ? AND log_group = ? ORDER BY occurrences DESC LIMIT ?
      `).all(...scope, referenceLimit),
    };
  }

  /** Buckets (with categories) since `from` and signatures first seen since `newSince`, for lib/logAnomalies.js. */
  function anomalyInputs({ profileId, region, logGroup, from, newSince }) {
    const handle = db();
    const scope = key(profileId, region, logGroup);
    const buckets = handle.prepare(`
      SELECT bucket_start AS start, events, errors, warnings, categories_json FROM log_intel_buckets
      WHERE profile_id = ? AND region = ? AND log_group = ? AND bucket_start >= ? ORDER BY bucket_start
    `).all(...scope, from).map(({ categories_json: categories, ...row }) => ({ ...row, categories: JSON.parse(categories || '{}') }));
    const signatures = handle.prepare(`
      SELECT signature, level, category, sample, occurrences, first_seen AS firstSeen, last_seen AS lastSeen FROM log_intel_signatures
      WHERE profile_id = ? AND region = ? AND log_group = ? AND first_seen >= ? ORDER BY occurrences DESC LIMIT 50
    `).all(...scope, newSince);
    return { buckets, signatures };
  }

  return { ingest, observeMinutes, clear, prune, isCurrent, summary, minuteSeries, anomalyInputs, setSignals: module => { signals = module; } };
}

module.exports = { createLogIntelligence, loadSignals, BUCKET_MS, MINUTE_MS, RETENTION_MS };
