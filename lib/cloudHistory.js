'use strict';

const crypto = require('crypto');

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RETENTION_DAYS = 7;
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_LIMIT = 5000;

function badRequest(message) {
  return Object.assign(new Error(message), { code: 400 });
}

function parseJson(value, fallback) {
  try { return JSON.parse(value); } catch (_) { return fallback; }
}

function canonicalize(value) {
  // Apply toJSON first, as JSON.stringify does: a Date (SDK timestamps) would otherwise become {}.
  if (value && typeof value.toJSON === 'function') return canonicalize(value.toJSON());
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = canonicalize(value[key]);
      return result;
    }, {});
  }
  return value;
}

function serialize(value) {
  const result = JSON.stringify(canonicalize(value));
  if (result === undefined) throw badRequest('payload must be JSON-serializable');
  return result;
}

function hashPayload(serialized) {
  return crypto.createHash('sha256').update(serialized).digest('hex');
}

function toTimestamp(value, fallback) {
  if (value === undefined || value === null) return fallback;
  const timestamp = value instanceof Date ? value.getTime() : Number(value);
  if (!Number.isFinite(timestamp) || timestamp < 0) throw badRequest('capturedAt must be a valid timestamp');
  return Math.trunc(timestamp);
}

function normalizeText(value, name, { allowEmpty = false } = {}) {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim())) throw badRequest(`${name} is required`);
  return value.trim();
}

function normalizeLimit(value) {
  const limit = Number(value);
  return Math.min(Math.max(Number.isFinite(limit) ? Math.trunc(limit) : 100, 1), MAX_LIMIT);
}

class CloudHistory {
  /** @param {import('better-sqlite3').Database} db */
  constructor(db, { now = () => Date.now(), retentionDays = DEFAULT_RETENTION_DAYS, cacheTtlMs = DEFAULT_CACHE_TTL_MS } = {}) {
    this.db = db;
    this.now = now;
    this.retentionDays = retentionDays;
    this.cacheTtlMs = cacheTtlMs;
    this.st = {
      insert: db.prepare(`INSERT OR IGNORE INTO kua_cloud_documents
        (provider, profile_id, region, resource_key, kind, captured_at, expires_at,
         content_hash, payload_json, metadata_json)
        VALUES (@provider, @profileId, @region, @resourceKey, @kind, @capturedAt,
          @expiresAt, @contentHash, @payload, @metadata)`),
      latest: db.prepare(`SELECT * FROM kua_cloud_documents
        WHERE provider = @provider AND profile_id = @profileId AND region = @region
          AND resource_key = @resourceKey AND kind = @kind
          AND (@allowExpired = 1 OR expires_at >= @now)
        ORDER BY captured_at DESC, id DESC LIMIT 1`),
      range: db.prepare(`SELECT * FROM kua_cloud_documents
        WHERE provider = @provider AND profile_id = @profileId AND region = @region
          AND resource_key = @resourceKey AND kind = @kind
          AND captured_at >= @from AND captured_at < @to
        ORDER BY captured_at DESC, id DESC LIMIT @limit`),
      cleanup: db.prepare(`DELETE FROM kua_cloud_documents
        WHERE captured_at < @cutoff
          AND (@provider IS NULL OR provider = @provider)
          AND (@profileId IS NULL OR profile_id = @profileId)`),
    };
  }

  static documentKey({ provider, profileId, region = '', resourceKey, kind }) {
    return {
      provider: normalizeText(provider, 'provider'),
      profileId: normalizeText(profileId, 'profileId'),
      region: typeof region === 'string' ? region.trim() : '',
      resourceKey: normalizeText(resourceKey, 'resourceKey'),
      kind: normalizeText(kind, 'kind'),
    };
  }

  _row(row) {
    if (!row) return null;
    return {
      id: row.id,
      provider: row.provider,
      profileId: row.profile_id,
      region: row.region,
      resourceKey: row.resource_key,
      kind: row.kind,
      capturedAt: row.captured_at,
      expiresAt: row.expires_at,
      contentHash: row.content_hash,
      payload: parseJson(row.payload_json, null),
      metadata: parseJson(row.metadata_json, {}),
    };
  }

  /** Store a JSON document without coupling it to a provider-specific schema. */
  putDocument({ provider, profileId, region = '', resourceKey, kind, payload, metadata = {}, capturedAt, ttlMs = this.cacheTtlMs } = {}) {
    const key = CloudHistory.documentKey({ provider, profileId, region, resourceKey, kind });
    const timestamp = toTimestamp(capturedAt, this.now());
    const ttl = Number(ttlMs);
    if (!Number.isFinite(ttl) || ttl < 0) throw badRequest('ttlMs must be a non-negative number');
    const serializedPayload = serialize(payload);
    const serializedMetadata = serialize(metadata);
    const result = this.st.insert.run({
      ...key,
      capturedAt: timestamp,
      expiresAt: timestamp + Math.trunc(ttl),
      contentHash: hashPayload(serializedPayload),
      payload: serializedPayload,
      metadata: serializedMetadata,
    });
    this.cleanup({ provider: key.provider, profileId: key.profileId });
    const row = this.db.prepare('SELECT * FROM kua_cloud_documents WHERE id = ?').get(
      result.changes ? result.lastInsertRowid : this.db.prepare(`SELECT id FROM kua_cloud_documents
        WHERE provider = ? AND profile_id = ? AND region = ? AND resource_key = ? AND kind = ?
          AND captured_at = ? AND content_hash = ?`).get(
        key.provider, key.profileId, key.region, key.resourceKey, key.kind,
        timestamp, hashPayload(serializedPayload)
      ).id
    );
    return { ...this._row(row), inserted: result.changes > 0 };
  }

  putSnapshot(input) {
    return this.putDocument(input);
  }

  readLatest({ provider, profileId, region = '', resourceKey, kind, allowExpired = false } = {}) {
    const key = CloudHistory.documentKey({ provider, profileId, region, resourceKey, kind });
    return this._row(this.st.latest.get({ ...key, allowExpired: allowExpired ? 1 : 0, now: this.now() }));
  }

  readRange({ provider, profileId, region = '', resourceKey, kind, from = 0, to = this.now(), limit = 100 } = {}) {
    const key = CloudHistory.documentKey({ provider, profileId, region, resourceKey, kind });
    const start = toTimestamp(from, 0);
    const end = toTimestamp(to, this.now());
    if (end < start) throw badRequest('to must be greater than or equal to from');
    return this.st.range.all({ ...key, from: start, to: end, limit: normalizeLimit(limit) }).map(row => this._row(row));
  }

  setRetentionDays(days) {
    const value = Number(days);
    if (!Number.isInteger(value) || value < 1 || value > 3650) throw badRequest('retentionDays must be an integer between 1 and 3650');
    this.retentionDays = value;
    return this.cleanup();
  }

  cleanup({ provider = null, profileId = null, retentionDays = this.retentionDays } = {}) {
    const days = Number(retentionDays);
    if (!Number.isFinite(days) || days < 1) throw badRequest('retentionDays must be at least 1');
    return this.st.cleanup.run({
      provider, profileId,
      cutoff: this.now() - days * DAY_MS,
    }).changes;
  }
}

let _instance = null;

function getCloudHistory() {
  if (!_instance) {
    const { getApmDatabase } = require('./apm/database');
    _instance = new CloudHistory(getApmDatabase().db);
  }
  return _instance;
}

module.exports = {
  CloudHistory,
  getCloudHistory,
  DAY_MS,
  DEFAULT_RETENTION_DAYS,
  DEFAULT_CACHE_TTL_MS,
};