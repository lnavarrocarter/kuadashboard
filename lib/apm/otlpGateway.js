'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const express = require('express');

const CONTRACT_VERSION = 1;
const MAX_BODY_BYTES = 256 * 1024;
const MAX_METRICS_PER_REQUEST = 500;
const MAX_ATTRIBUTES = 32;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_SERIES = 5000;
const MAX_POINTS_PER_REQUEST = 1000;
const MAX_STORED_POINTS = 1_000_000;
const MAX_INGEST_REQUESTS_PER_MINUTE = 120;
const SIGNALS = new Set(['metrics']);
const ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const POINT_ATTRIBUTE_KEYS = new Set([
  'http.request.method', 'http.response.status_code', 'http.route', 'network.protocol.version',
  'rpc.system', 'rpc.service', 'rpc.method', 'db.system.name', 'db.namespace',
  'messaging.system', 'messaging.destination.name', 'deployment.environment.name',
  'cloud.region', 'k8s.namespace.name', 'k8s.deployment.name', 'k8s.pod.name',
  'error.type', 'status', 'status_code', 'outcome', 'route', 'method',
]);
const RESOURCE_KEYS = new Set(['service.name', 'service.namespace', 'service.version', 'service.instance.id', 'host.id', 'host.name', 'deployment.environment.name', 'cloud.provider', 'cloud.region', 'k8s.cluster.name', 'k8s.namespace.name', 'k8s.deployment.name', 'k8s.pod.name']);

function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function safeAttributes(attributes, allowedKeys = POINT_ATTRIBUTE_KEYS) {
  if (!Array.isArray(attributes) || attributes.length > MAX_ATTRIBUTES) throw httpError(400, 'INVALID_ATTRIBUTES');
  const result = {};
  for (const item of attributes) {
    const key = item?.key;
    const value = item?.value;
    if (typeof key !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_.-]{0,127}$/.test(key)) throw httpError(400, 'INVALID_ATTRIBUTES');
    if (!allowedKeys.has(key)) continue;
    // Never persist free-form or potentially sensitive span/log attributes.
    if (/password|secret|token|cookie|authorization|email|user|query|statement|body|url\.|http\.target|http\.(request|response)\.header/i.test(key)) continue;
    const raw = value?.stringValue ?? value?.intValue ?? value?.boolValue ?? value?.doubleValue;
    if (typeof raw === 'string' && raw.length > 256) throw httpError(400, 'INVALID_ATTRIBUTES');
    if (['string', 'number', 'boolean'].includes(typeof raw)) result[key] = raw;
  }
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
}

function httpError(statusCode, code) {
  return Object.assign(new Error(code), { statusCode, code });
}

function databaseBytes(filePath) {
  return [`${filePath}`, `${filePath}-wal`, `${filePath}-shm`].reduce((total, file) => {
    try { return total + fs.statSync(file).size; } catch { return total; }
  }, 0);
}

function timestampMilliseconds(value) {
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    try { return Number(BigInt(value) / 1_000_000n); } catch { return NaN; }
  }
  const nanoseconds = Number(value);
  return Number.isFinite(nanoseconds) ? Math.round(nanoseconds / 1e6) : NaN;
}

function requireLocalOrTls(req, res, next) {
  const address = req.socket.remoteAddress || '';
  const loopback = address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
  if (loopback || req.socket.encrypted === true) return next();
  return res.status(426).json({ error: 'TLS_REQUIRED' });
}

function normalizeResource(resource) {
  const attrs = safeAttributes(resource?.attributes || [], RESOURCE_KEYS);
  const normalized = {};
  for (const key of RESOURCE_KEYS) {
    if (attrs[key] !== undefined) normalized[key] = attrs[key];
  }
  if (typeof normalized['service.name'] !== 'string' || !normalized['service.name'].trim()) throw httpError(400, 'SERVICE_NAME_REQUIRED');
  return normalized;
}

class OtlpGatewayStore {
  constructor({ filePath, now = () => Date.now(), maxSeries = MAX_SERIES, retentionMs = RETENTION_MS,
    maxPoints = MAX_STORED_POINTS, requestsPerMinute = MAX_INGEST_REQUESTS_PER_MINUTE } = {}) {
    this.now = now;
    this.maxSeries = maxSeries;
    this.retentionMs = retentionMs;
    this.maxPoints = maxPoints;
    this.requestsPerMinute = requestsPerMinute;
    this.requestWindows = new Map();
    this.filePath = filePath || path.join(process.env.KUA_DATA_DIR || path.join(os.homedir(), '.kuadashboard'), 'apm-otlp.sqlite3');
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    try { fs.chmodSync(path.dirname(this.filePath), 0o700); } catch {}
    this.db = new Database(this.filePath);
    if (this.filePath !== ':memory:') { try { fs.chmodSync(this.filePath, 0o600); } catch {} }
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
    this.db.pragma('auto_vacuum = INCREMENTAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agent_registry (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, contract_version INTEGER NOT NULL,
        capabilities_json TEXT NOT NULL, agent_version TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
        enrolled_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL, revoked_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS enrollment_tokens (
        token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL, used_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS otlp_metric_points (
        series_key TEXT NOT NULL, agent_id TEXT NOT NULL REFERENCES agent_registry(id) ON DELETE CASCADE,
        service_name TEXT NOT NULL, metric_name TEXT NOT NULL, unit TEXT NOT NULL,
        attributes_json TEXT NOT NULL, timestamp INTEGER NOT NULL, value REAL NOT NULL,
        received_at INTEGER NOT NULL, PRIMARY KEY(series_key, timestamp)
      );
      CREATE INDEX IF NOT EXISTS idx_otlp_points_time ON otlp_metric_points(timestamp);
      CREATE INDEX IF NOT EXISTS idx_otlp_points_host_service ON otlp_metric_points(agent_id, service_name, timestamp);
    `);
    this.createToken = this.db.prepare('INSERT INTO enrollment_tokens(token_hash, expires_at) VALUES (?, ?)');
    this.enrollToken = this.db.prepare('SELECT token_hash, expires_at, used_at FROM enrollment_tokens WHERE token_hash = ?');
    this.useToken = this.db.prepare('UPDATE enrollment_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL');
    this.insertAgent = this.db.prepare(`INSERT INTO agent_registry
      (id, name, contract_version, capabilities_json, agent_version, token_hash, enrolled_at, last_seen_at)
      VALUES (@id, @name, @contractVersion, @capabilities, @agentVersion, @tokenHash, @now, @now)`);
    this.agentByToken = this.db.prepare('SELECT * FROM agent_registry WHERE token_hash = ? AND revoked_at IS NULL');
    this.agentById = this.db.prepare('SELECT * FROM agent_registry WHERE id = ?');
    this.touchAgent = this.db.prepare('UPDATE agent_registry SET last_seen_at = ? WHERE id = ? AND revoked_at IS NULL');
    this.revokeAgent = this.db.prepare('UPDATE agent_registry SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL');
    this.updateToken = this.db.prepare('UPDATE agent_registry SET token_hash = ?, last_seen_at = ? WHERE id = ? AND revoked_at IS NULL');
  }

  issueEnrollmentToken() {
    this.db.prepare('DELETE FROM enrollment_tokens WHERE used_at IS NOT NULL OR expires_at < ?').run(this.now());
    this.db.prepare('DELETE FROM enrollment_tokens WHERE used_at IS NULL').run();
    const token = crypto.randomBytes(32).toString('base64url');
    this.createToken.run(digest(token), this.now() + 5 * 60 * 1000);
    return { token, expiresAt: new Date(this.now() + 5 * 60 * 1000).toISOString() };
  }

  enroll(input, token) {
    if (!input || input.contractVersion !== CONTRACT_VERSION || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 120
      || typeof input.agentVersion !== 'string' || input.agentVersion.length > 64 || !Array.isArray(input.capabilities)
      || input.capabilities.length < 1 || input.capabilities.length > 3 || input.capabilities.some(capability => !SIGNALS.has(capability))) {
      throw httpError(400, 'INCOMPATIBLE_AGENT_CONTRACT');
    }
    const hashed = digest(token || '');
    const enrollment = this.enrollToken.get(hashed);
    if (!enrollment || enrollment.used_at || enrollment.expires_at < this.now()) throw httpError(401, 'ENROLLMENT_TOKEN_INVALID');
    const agentId = crypto.randomUUID();
    const agentToken = crypto.randomBytes(32).toString('base64url');
    const now = this.now();
    this.db.transaction(() => {
      if (this.useToken.run(now, hashed).changes !== 1) throw httpError(401, 'ENROLLMENT_TOKEN_INVALID');
      this.insertAgent.run({ id: agentId, name: input.name.trim(), contractVersion: CONTRACT_VERSION,
        capabilities: JSON.stringify([...new Set(input.capabilities)]), agentVersion: input.agentVersion,
        tokenHash: digest(agentToken), now });
    })();
    return { agentId, token: agentToken, contractVersion: CONTRACT_VERSION };
  }

  authenticate(token) {
    if (!token || token.length > 128) throw httpError(401, 'AGENT_AUTH_REQUIRED');
    const agent = this.agentByToken.get(digest(token));
    if (!agent) throw httpError(401, 'AGENT_AUTH_REQUIRED');
    this.touchAgent.run(this.now(), agent.id);
    return { id: agent.id, name: agent.name, contractVersion: agent.contract_version,
      capabilities: JSON.parse(agent.capabilities_json), version: agent.agent_version };
  }

  listAgents() {
    return this.db.prepare('SELECT id, name, contract_version, capabilities_json, agent_version, enrolled_at, last_seen_at, revoked_at FROM agent_registry ORDER BY enrolled_at DESC')
      .all().map(row => ({ id: row.id, name: row.name, contractVersion: row.contract_version,
        capabilities: JSON.parse(row.capabilities_json), version: row.agent_version,
        enrolledAt: new Date(row.enrolled_at).toISOString(), lastSeenAt: new Date(row.last_seen_at).toISOString(),
        status: row.revoked_at ? 'revoked' : 'active' }));
  }

  rotate(id) {
    if (!this.agentById.get(id) || this.agentById.get(id).revoked_at) throw httpError(404, 'AGENT_NOT_FOUND');
    const token = crypto.randomBytes(32).toString('base64url');
    this.updateToken.run(digest(token), this.now(), id);
    return { token };
  }

  revoke(id) {
    if (!this.agentById.get(id)) throw httpError(404, 'AGENT_NOT_FOUND');
    this.revokeAgent.run(this.now(), id);
    this.db.prepare('DELETE FROM otlp_metric_points WHERE agent_id = ?').run(id);
    this.requestWindows.delete(id);
    return { revoked: true, deletedMetrics: true };
  }

  deleteMetrics(id) {
    if (!this.agentById.get(id)) throw httpError(404, 'AGENT_NOT_FOUND');
    return { deletedPoints: this.db.prepare('DELETE FROM otlp_metric_points WHERE agent_id = ?').run(id).changes };
  }

  heartbeat(agent, input) {
    if (!input || input.contractVersion !== CONTRACT_VERSION) throw httpError(409, 'AGENT_CONTRACT_MISMATCH');
    if (typeof input.agentVersion !== 'string' || input.agentVersion.length > 64 || !Array.isArray(input.capabilities)
      || input.capabilities.length > 3 || input.capabilities.some(capability => !agent.capabilities.includes(capability))) {
      throw httpError(400, 'INVALID_AGENT_HEARTBEAT');
    }
    this.db.prepare('UPDATE agent_registry SET last_seen_at = ?, agent_version = ? WHERE id = ? AND revoked_at IS NULL')
      .run(this.now(), input.agentVersion, agent.id);
    return { status: 'active', contractVersion: CONTRACT_VERSION, serverTime: new Date(this.now()).toISOString() };
  }

  ingestMetrics(agent, payload) {
    const windowStart = Math.floor(this.now() / 60_000) * 60_000;
    const window = this.requestWindows.get(agent.id);
    if (window?.start === windowStart && window.count >= this.requestsPerMinute) throw httpError(429, 'INGEST_RATE_LIMIT');
    this.requestWindows.set(agent.id, { start: windowStart, count: (window?.start === windowStart ? window.count : 0) + 1 });
    const resourceMetrics = payload?.resourceMetrics;
    if (!Array.isArray(resourceMetrics) || resourceMetrics.length > 50) throw httpError(400, 'INVALID_OTLP_METRICS');
    const points = [];
    let metricCount = 0;
    for (const group of resourceMetrics) {
      if (!group || !Array.isArray(group.scopeMetrics || [])) throw httpError(400, 'INVALID_OTLP_METRICS');
      const resource = normalizeResource(group.resource);
      const service = resource['service.name'];
      for (const scope of (group.scopeMetrics || [])) {
        if (!scope || !Array.isArray(scope.metrics || [])) throw httpError(400, 'INVALID_OTLP_METRICS');
        for (const metric of (scope.metrics || [])) {
          metricCount += 1;
          if (metricCount > MAX_METRICS_PER_REQUEST) throw httpError(413, 'OTLP_METRIC_LIMIT');
          if (!metric || typeof metric.name !== 'string' || !ID.test(metric.name) || metric.name.length > 128) throw httpError(400, 'INVALID_METRIC_NAME');
          const aggregation = metric.sum || metric.gauge;
          if (!aggregation || !Array.isArray(aggregation.dataPoints)) throw httpError(400, 'UNSUPPORTED_METRIC_TYPE');
          const metricKind = metric.sum ? 'sum' : 'gauge';
          const scopeIdentity = { name: String(scope.scope?.name || '').slice(0, 128), version: String(scope.scope?.version || '').slice(0, 64) };
          const aggregationIdentity = metricKind === 'sum'
            ? { kind: metricKind, temporality: aggregation.aggregationTemporality || 'unspecified', monotonic: !!aggregation.isMonotonic }
            : { kind: metricKind };
          const unit = typeof metric.unit === 'string' ? metric.unit.slice(0, 32) : '1';
          for (const point of aggregation.dataPoints) {
            if (points.length >= MAX_POINTS_PER_REQUEST) throw httpError(413, 'OTLP_POINT_LIMIT');
            if (!point || typeof point !== 'object') throw httpError(400, 'INVALID_METRIC_POINT');
            const rawValue = point.asDouble ?? point.asInt;
            if ((point.asDouble !== undefined && typeof point.asDouble !== 'number')
              || (point.asInt !== undefined && !(typeof point.asInt === 'string' ? /^-?\d+$/.test(point.asInt) : Number.isSafeInteger(point.asInt)))) {
              throw httpError(400, 'INVALID_METRIC_POINT');
            }
            const value = Number(rawValue);
            const timestamp = timestampMilliseconds(point.timeUnixNano);
            if (!Number.isFinite(value) || !Number.isFinite(timestamp) || timestamp < this.now() - this.retentionMs || timestamp > this.now() + 60_000) {
              throw httpError(400, 'INVALID_METRIC_POINT');
            }
            const attrs = safeAttributes(point.attributes || [], POINT_ATTRIBUTE_KEYS);
            const seriesAttrs = Object.fromEntries(Object.entries(attrs).slice(0, 12));
            const descriptor = { agentId: agent.id, resource, service, scope: scopeIdentity,
              name: metric.name, unit, aggregation: aggregationIdentity, attrs: seriesAttrs };
            const seriesKey = digest(JSON.stringify(descriptor));
            points.push({ seriesKey, service, name: metric.name, unit,
              attrs: JSON.stringify({ resource, point: seriesAttrs, scope: scopeIdentity, aggregation: aggregationIdentity }), timestamp, value });
          }
        }
      }
    }
    const insert = this.db.prepare(`INSERT INTO otlp_metric_points
      (series_key, agent_id, service_name, metric_name, unit, attributes_json, timestamp, value, received_at)
      VALUES (@seriesKey, @agentId, @service, @name, @unit, @attrs, @timestamp, @value, @receivedAt)
      ON CONFLICT(series_key, timestamp) DO UPDATE SET value = excluded.value, received_at = excluded.received_at`);
    let stored = 0;
    let duplicatePointsUpdated = 0;
    const exists = this.db.prepare('SELECT 1 FROM otlp_metric_points WHERE series_key = ? AND timestamp = ?');
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM otlp_metric_points WHERE timestamp < ?').run(this.now() - this.retentionMs);
      const series = this.db.prepare('SELECT COUNT(DISTINCT series_key) AS count FROM otlp_metric_points').get().count;
      const seriesExists = this.db.prepare('SELECT 1 FROM otlp_metric_points WHERE series_key = ? LIMIT 1');
      const newSeries = new Set(points.map(point => point.seriesKey).filter(key => !seriesExists.get(key))).size;
      if (series + newSeries > this.maxSeries) throw httpError(429, 'CARDINALITY_LIMIT');
      const rowCount = this.db.prepare('SELECT COUNT(*) AS count FROM otlp_metric_points').get().count;
      const uniqueIncoming = new Set(points.map(point => `${point.seriesKey}:${point.timestamp}`));
      const alreadyStored = [...uniqueIncoming].reduce((count, key) => {
        const splitAt = key.lastIndexOf(':');
        return count + (exists.get(key.slice(0, splitAt), Number(key.slice(splitAt + 1))) ? 1 : 0);
      }, 0);
      if (rowCount + uniqueIncoming.size - alreadyStored > this.maxPoints) throw httpError(429, 'STORAGE_LIMIT');
      for (const point of points) {
        if (exists.get(point.seriesKey, point.timestamp)) duplicatePointsUpdated += 1;
        stored += insert.run({ ...point, agentId: agent.id, receivedAt: this.now() }).changes;
      }
    })();
    return { accepted: points.length, stored, duplicatePointsUpdated };
  }

  queryMetrics({ agentId, service, from = this.now() - 60 * 60 * 1000, to = this.now(), limit = 1000 } = {}) {
    const boundedLimit = Math.max(1, Math.min(5000, Number(limit) || 1000));
    const fromMs = Number(from);
    const toMs = Number(to);
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs > toMs) throw httpError(400, 'INVALID_TIME_RANGE');
    return this.db.prepare(`SELECT agent_id AS agentId, service_name AS serviceName, metric_name AS metricName,
      unit, attributes_json AS attributesJson, timestamp, value FROM otlp_metric_points
      WHERE (? IS NULL OR agent_id = ?) AND (? IS NULL OR service_name = ?) AND timestamp BETWEEN ? AND ?
      ORDER BY timestamp DESC LIMIT ?`).all(agentId || null, agentId || null, service || null, service || null,
      Math.max(this.now() - this.retentionMs, fromMs), Math.min(this.now(), toMs), boundedLimit)
      .map(row => ({ ...row, attributes: JSON.parse(row.attributesJson), attributesJson: undefined,
        timestamp: new Date(row.timestamp).toISOString() }));
  }

  cleanup() {
    const points = this.db.prepare('DELETE FROM otlp_metric_points WHERE timestamp < ?').run(this.now() - this.retentionMs).changes;
    const tokens = this.db.prepare('DELETE FROM enrollment_tokens WHERE used_at IS NOT NULL OR expires_at < ?').run(this.now()).changes;
    this.db.pragma('incremental_vacuum(1000)');
    return { points, tokens };
  }

  close() { this.db.close(); }
}

function createOtlpGatewayRouter({ store, auditLog } = {}) {
  if (!store) throw new TypeError('store is required');
  const router = express.Router();
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.use(requireLocalOrTls);
  const bearer = req => /^Bearer ([A-Za-z0-9_-]{40,128})$/.exec(req.get('Authorization') || '')?.[1];
  const respondError = (res, error) => {
    if (error.statusCode === 429) res.set('Retry-After', '5');
    return res.status(error.statusCode || 500).json({ error: error.code || 'INTERNAL_ERROR' });
  };
  router.post('/enrollment-token', (_req, res) => {
    try {
      const issued = store.issueEnrollmentToken();
      auditLog?.log({ category: 'apm', action: 'agent.enrollment-token.issue', resource: 'otlp', details: {} });
      res.status(201).json(issued);
    } catch (error) { respondError(res, error); }
  });
  router.post('/enroll', express.json({ limit: '4kb', strict: true }), (req, res) => {
    try {
      const enrolled = store.enroll(req.body, req.get('X-KUA-Enrollment-Token'));
      auditLog?.log({ category: 'apm', action: 'agent.enroll', resource: enrolled.agentId,
        details: { name: req.body.name, capabilities: [...new Set(req.body.capabilities)] } });
      res.status(201).json(enrolled);
    } catch (error) { respondError(res, error); }
  });
  router.get('/agents', (_req, res) => res.json(store.listAgents()));
  router.post('/agents/:id/rotate', (req, res) => {
    try {
      const rotated = store.rotate(req.params.id);
      auditLog?.log({ category: 'apm', action: 'agent.token.rotate', resource: req.params.id, details: {} });
      res.json(rotated);
    } catch (error) { respondError(res, error); }
  });
  router.delete('/agents/:id', (req, res) => {
    try {
      const result = store.revoke(req.params.id);
      auditLog?.log({ category: 'apm', action: 'agent.revoke', resource: req.params.id, details: { deletedMetrics: result.deletedMetrics } });
      res.json(result);
    } catch (error) { respondError(res, error); }
  });
  router.post('/agents/:id/heartbeat', express.json({ limit: '4kb', strict: true }), (req, res) => {
    try {
      const agent = store.authenticate(bearer(req));
      if (agent.id !== req.params.id) throw httpError(404, 'AGENT_NOT_FOUND');
      res.json(store.heartbeat(agent, req.body));
    } catch (error) { respondError(res, error); }
  });
  router.post('/v1/metrics', express.json({ limit: MAX_BODY_BYTES, strict: true }), (req, res) => {
    try {
      const agent = store.authenticate(bearer(req));
      if (!agent.capabilities.includes('metrics')) throw httpError(403, 'SIGNAL_NOT_ENABLED');
      const result = store.ingestMetrics(agent, req.body);
      res.set('Content-Type', 'application/json')
        .set('X-KUA-OTLP-Accepted', String(result.accepted))
        .set('X-KUA-OTLP-Duplicates', String(result.duplicatePointsUpdated))
        .status(200).json({});
    } catch (error) { respondError(res, error); }
  });
  router.get('/metrics', (req, res) => {
    try {
      res.json({ retentionMs: store.retentionMs, maxSeries: store.maxSeries,
        points: store.queryMetrics({ agentId: req.query.host, service: req.query.service, from: req.query.from, to: req.query.to, limit: req.query.limit }) });
    } catch (error) { respondError(res, error); }
  });
  router.delete('/metrics', (req, res) => {
    try {
      if (typeof req.query.host !== 'string' || !req.query.host) throw httpError(400, 'HOST_REQUIRED');
      const result = store.deleteMetrics(req.query.host);
      auditLog?.log({ category: 'apm', action: 'agent.metrics.delete', resource: req.query.host, details: result });
      res.json(result);
    } catch (error) { respondError(res, error); }
  });
  router.get('/health', (_req, res) => {
    try {
      const stats = store.db.prepare(`SELECT COUNT(*) AS points, COUNT(DISTINCT series_key) AS series,
        COALESCE(MAX(received_at), 0) AS lastReceivedAt FROM otlp_metric_points`).get();
      const agents = store.db.prepare(`SELECT SUM(CASE WHEN revoked_at IS NULL THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN revoked_at IS NOT NULL THEN 1 ELSE 0 END) AS revoked FROM agent_registry`).get();
      res.json({ status: 'ok', contractVersion: CONTRACT_VERSION, ...stats, maxSeries: store.maxSeries,
        maxPoints: store.maxPoints, requestsPerMinute: store.requestsPerMinute,
        activeAgents: agents.active || 0, revokedAgents: agents.revoked || 0,
        retentionMs: store.retentionMs, storageBytes: store.filePath === ':memory:' ? null : databaseBytes(store.filePath) });
    } catch (error) { respondError(res, error); }
  });
  router.use((error, _req, res, _next) => {
    const status = error.status === 413 || error.type === 'entity.too.large' ? 413 : (error.status || 400);
    return res.status(status).json({ error: status === 413 ? 'OTLP_BODY_LIMIT' : 'INVALID_REQUEST_BODY' });
  });
  return router;
}

function positiveInteger(value, fallback, max) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? Math.min(number, max) : fallback;
}

function createOtlpGatewayStoreFromEnv(env = process.env) {
  return new OtlpGatewayStore({
    maxSeries: positiveInteger(env.KUA_OTLP_MAX_SERIES, MAX_SERIES, 100_000),
    maxPoints: positiveInteger(env.KUA_OTLP_MAX_POINTS, MAX_STORED_POINTS, 10_000_000),
    retentionMs: positiveInteger(env.KUA_OTLP_RETENTION_DAYS, 7, 365) * 24 * 60 * 60 * 1000,
    requestsPerMinute: positiveInteger(env.KUA_OTLP_REQUESTS_PER_MINUTE, MAX_INGEST_REQUESTS_PER_MINUTE, 10_000),
  });
}

module.exports = { CONTRACT_VERSION, MAX_BODY_BYTES, MAX_METRICS_PER_REQUEST, MAX_SERIES,
  MAX_STORED_POINTS, MAX_INGEST_REQUESTS_PER_MINUTE,
  OtlpGatewayStore, createOtlpGatewayRouter, createOtlpGatewayStoreFromEnv, normalizeResource, safeAttributes };
