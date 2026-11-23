'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const express = require('express');
const { rateLimit } = require('express-rate-limit');

const CONTRACT_VERSION = 1;
const MAX_BODY_BYTES = 256 * 1024;
const MAX_METRICS_PER_REQUEST = 500;
const MAX_ATTRIBUTES = 32;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_SERIES = 5000;
const MAX_POINTS_PER_REQUEST = 1000;
const MAX_STORED_POINTS = 1_000_000;
const MAX_SPANS_PER_REQUEST = 1000;
const MAX_STORED_SPANS = 500_000;
const MAX_SPANS_PER_TRACE = 5000;
const MAX_INGEST_REQUESTS_PER_MINUTE = 120;
const BROWSER_RELAY_AGENT_ID = 'kua-browser-relay';
const SIGNALS = new Set(['metrics', 'traces']);
const ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const POINT_ATTRIBUTE_KEYS = new Set([
  'http.request.method', 'http.response.status_code', 'http.route', 'network.protocol.version',
  'rpc.system', 'rpc.system.name', 'rpc.service', 'rpc.method', 'db.system.name', 'db.namespace', 'server.address', 'server.port',
  'db.operation.name',
  'messaging.system', 'messaging.destination.name', 'deployment.environment.name',
  'cloud.region', 'k8s.namespace.name', 'k8s.deployment.name', 'k8s.pod.name',
  'error.type', 'status', 'status_code', 'outcome',
]);
const RESOURCE_KEYS = new Set(['service.name', 'service.namespace', 'service.version', 'service.instance.id', 'host.id', 'host.name', 'host.type', 'cloud.resource_id', 'cloud.account.id', 'cloud.availability_zone', 'cloud.platform', 'faas.id', 'faas.instance', 'faas.name', 'faas.version', 'aws.lambda.invoked_arn', 'aws.ecs.task.arn', 'gcp.project_id', 'k8s.cluster.name', 'k8s.namespace.name', 'k8s.deployment.name', 'k8s.pod.name', 'k8s.pod.uid', 'deployment.environment.name', 'cloud.provider', 'cloud.region']);
const SPAN_KINDS = new Map([['SPAN_KIND_UNSPECIFIED', 0], ['SPAN_KIND_INTERNAL', 1], ['SPAN_KIND_SERVER', 2], ['SPAN_KIND_CLIENT', 3], ['SPAN_KIND_PRODUCER', 4], ['SPAN_KIND_CONSUMER', 5]]);
const SPAN_STATUSES = new Map([['STATUS_CODE_UNSET', 0], ['STATUS_CODE_OK', 1], ['STATUS_CODE_ERROR', 2]]);

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
    if (!['string', 'number', 'boolean'].includes(typeof raw)) continue;
    if (['http.request.method', 'method'].includes(key)) {
      if (typeof raw !== 'string' || !/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|CONNECT|TRACE)$/i.test(raw)) continue;
    }
    if (key === 'http.route') {
      if (typeof raw !== 'string' || raw.length > 128 || !raw.startsWith('/') || /[?#@%\\\d]/.test(raw)
        || raw.split('/').some(segment => segment && !/^[A-Za-z_-]+$/.test(segment) && !/^\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(segment))) continue;
    }
    if (['rpc.method', 'db.operation.name', 'messaging.system', 'error.type'].includes(key)
      && (typeof raw !== 'string' || !/^[A-Za-z][A-Za-z0-9_./-]{0,127}$/.test(raw))) continue;
    if (['http.response.status_code', 'status_code'].includes(key)) {
      const code = Number(raw);
      if (!Number.isInteger(code) || code < 100 || code > 599) continue;
      result[key] = code;
      continue;
    }
    if (key === 'server.address') {
      if (typeof raw !== 'string' || raw.length > 253 || !/^[A-Za-z0-9.-]+$/.test(raw)
        || raw.startsWith('.') || raw.endsWith('.') || raw.split('.').some(label => !label || label.length > 63 || label.startsWith('-') || label.endsWith('-'))) continue;
    }
    if (key === 'server.port') {
      const port = Number(raw);
      if (!Number.isInteger(port) || port < 1 || port > 65535) continue;
      result[key] = port;
      continue;
    }
    result[key] = raw;
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

/** Bound request parsing/authentication work by source IP before large payloads are parsed. */
function createIpRateLimit(maxRequests, windowMs = 60_000) {
  if (!Number.isInteger(maxRequests) || maxRequests < 1 || !Number.isInteger(windowMs) || windowMs < 1) {
    throw new TypeError('positive maxRequests and windowMs are required');
  }
  return rateLimit({
    windowMs,
    limit: maxRequests,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, res) => {
      res.set('Retry-After', String(Math.ceil(windowMs / 1000)));
      res.status(429).json({ error: 'REQUEST_RATE_LIMIT' });
    },
  });
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
    maxPoints = MAX_STORED_POINTS, maxSpans = MAX_STORED_SPANS,
    requestsPerMinute = MAX_INGEST_REQUESTS_PER_MINUTE } = {}) {
    this.now = now;
    this.maxSeries = maxSeries;
    this.retentionMs = retentionMs;
    this.maxPoints = maxPoints;
    this.maxSpans = maxSpans;
    this.requestsPerMinute = requestsPerMinute;
    this.requestWindows = new Map();
    this.filePath = filePath || path.join(process.env.KUA_DATA_DIR || path.join(os.homedir(), '.kuadashboard'), 'apm-otlp.sqlite3');
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    try { fs.chmodSync(path.dirname(this.filePath), 0o700); } catch {}
    this.db = new Database(this.filePath);
    if (this.filePath !== ':memory:') { try { fs.chmodSync(this.filePath, 0o600); } catch {} }
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
    this.db.pragma('foreign_keys = ON');
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
      CREATE TABLE IF NOT EXISTS otlp_spans (
        trace_id TEXT NOT NULL, span_id TEXT NOT NULL, parent_span_id TEXT NOT NULL DEFAULT '',
        agent_id TEXT NOT NULL REFERENCES agent_registry(id) ON DELETE CASCADE,
        service_name TEXT NOT NULL, span_name TEXT NOT NULL, span_kind INTEGER NOT NULL,
        status_code INTEGER NOT NULL, resource_json TEXT NOT NULL, attributes_json TEXT NOT NULL,
        start_time INTEGER NOT NULL, end_time INTEGER NOT NULL, received_at INTEGER NOT NULL,
        PRIMARY KEY(trace_id, span_id)
      );
      CREATE TABLE IF NOT EXISTS otlp_span_links (
        trace_id TEXT NOT NULL, span_id TEXT NOT NULL, linked_trace_id TEXT NOT NULL,
        linked_span_id TEXT NOT NULL, agent_id TEXT NOT NULL REFERENCES agent_registry(id) ON DELETE CASCADE,
        PRIMARY KEY(trace_id, span_id, linked_trace_id, linked_span_id)
      );
      CREATE INDEX IF NOT EXISTS idx_otlp_points_time ON otlp_metric_points(timestamp);
      CREATE INDEX IF NOT EXISTS idx_otlp_points_host_service ON otlp_metric_points(agent_id, service_name, timestamp);
      CREATE INDEX IF NOT EXISTS idx_otlp_spans_trace_time ON otlp_spans(trace_id, start_time);
      CREATE INDEX IF NOT EXISTS idx_otlp_spans_agent_time ON otlp_spans(agent_id, start_time);
      CREATE INDEX IF NOT EXISTS idx_otlp_links_target ON otlp_span_links(linked_trace_id, linked_span_id);
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
    this.insertSpan = this.db.prepare(`INSERT INTO otlp_spans
      (trace_id, span_id, parent_span_id, agent_id, service_name, span_name, span_kind, status_code,
       resource_json, attributes_json, start_time, end_time, received_at)
      VALUES (@traceId, @spanId, @parentSpanId, @agentId, @serviceName, @spanName, @spanKind, @statusCode,
       @resourceJson, @attributesJson, @startTime, @endTime, @receivedAt)
      ON CONFLICT(trace_id, span_id) DO UPDATE SET parent_span_id = excluded.parent_span_id,
       agent_id = excluded.agent_id, service_name = excluded.service_name, span_name = excluded.span_name,
       span_kind = excluded.span_kind, status_code = excluded.status_code, resource_json = excluded.resource_json,
       attributes_json = excluded.attributes_json, start_time = excluded.start_time,
       end_time = excluded.end_time, received_at = excluded.received_at`);
    this.insertSpanLink = this.db.prepare(`INSERT OR IGNORE INTO otlp_span_links
      (trace_id, span_id, linked_trace_id, linked_span_id, agent_id) VALUES (?, ?, ?, ?, ?)`);
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
    return this.db.prepare('SELECT id, name, contract_version, capabilities_json, agent_version, enrolled_at, last_seen_at, revoked_at FROM agent_registry WHERE id != ? ORDER BY enrolled_at DESC')
      .all(BROWSER_RELAY_AGENT_ID).map(row => ({ id: row.id, name: row.name, contractVersion: row.contract_version,
        capabilities: JSON.parse(row.capabilities_json), version: row.agent_version,
        enrolledAt: new Date(row.enrolled_at).toISOString(), lastSeenAt: new Date(row.last_seen_at).toISOString(),
        status: row.revoked_at ? 'revoked' : 'active' }));
  }

  rotate(id) {
    if (id === BROWSER_RELAY_AGENT_ID) throw httpError(404, 'AGENT_NOT_FOUND');
    if (!this.agentById.get(id) || this.agentById.get(id).revoked_at) throw httpError(404, 'AGENT_NOT_FOUND');
    const token = crypto.randomBytes(32).toString('base64url');
    this.updateToken.run(digest(token), this.now(), id);
    return { token };
  }

  revoke(id) {
    if (id === BROWSER_RELAY_AGENT_ID) throw httpError(404, 'AGENT_NOT_FOUND');
    if (!this.agentById.get(id)) throw httpError(404, 'AGENT_NOT_FOUND');
    this.revokeAgent.run(this.now(), id);
    this.db.prepare('DELETE FROM otlp_metric_points WHERE agent_id = ?').run(id);
    this.deleteTraces(id);
    this.requestWindows.delete(id);
    return { revoked: true, deletedMetrics: true };
  }

  deleteMetrics(id) {
    if (!this.agentById.get(id)) throw httpError(404, 'AGENT_NOT_FOUND');
    return { deletedPoints: this.db.prepare('DELETE FROM otlp_metric_points WHERE agent_id = ?').run(id).changes };
  }

  deleteTraces(id) {
    if (!this.agentById.get(id)) throw httpError(404, 'AGENT_NOT_FOUND');
    this.db.prepare('DELETE FROM otlp_span_links WHERE agent_id = ?').run(id);
    this.db.prepare(`DELETE FROM otlp_span_links WHERE EXISTS (
      SELECT 1 FROM otlp_spans WHERE otlp_spans.agent_id = ?
        AND otlp_spans.trace_id = otlp_span_links.linked_trace_id
        AND otlp_spans.span_id = otlp_span_links.linked_span_id
    )`).run(id);
    return { deletedSpans: this.db.prepare('DELETE FROM otlp_spans WHERE agent_id = ?').run(id).changes };
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

  ingestTraces(agent, payload) {
    const windowStart = Math.floor(this.now() / 60_000) * 60_000;
    const window = this.requestWindows.get(agent.id);
    if (window?.start === windowStart && window.count >= this.requestsPerMinute) throw httpError(429, 'INGEST_RATE_LIMIT');
    this.requestWindows.set(agent.id, { start: windowStart, count: (window?.start === windowStart ? window.count : 0) + 1 });
    const resourceSpans = payload?.resourceSpans;
    if (!Array.isArray(resourceSpans) || resourceSpans.length > 50) throw httpError(400, 'INVALID_OTLP_TRACES');
    const spans = [];
    const seenSpans = new Set();
    for (const group of resourceSpans) {
      if (!group || !Array.isArray(group.scopeSpans || [])) throw httpError(400, 'INVALID_OTLP_TRACES');
      const resource = normalizeResource(group.resource);
      for (const scope of group.scopeSpans || []) {
        if (!scope || !Array.isArray(scope.spans || [])) throw httpError(400, 'INVALID_OTLP_TRACES');
        const scopeIdentity = { name: String(scope.scope?.name || '').slice(0, 128), version: String(scope.scope?.version || '').slice(0, 64) };
        for (const span of scope.spans || []) {
          if (spans.length >= MAX_SPANS_PER_REQUEST) throw httpError(413, 'OTLP_SPAN_LIMIT');
          const traceId = typeof span?.traceId === 'string' ? span.traceId.toLowerCase() : '';
          const spanId = typeof span?.spanId === 'string' ? span.spanId.toLowerCase() : '';
          const parentSpanId = typeof span?.parentSpanId === 'string' ? span.parentSpanId.toLowerCase() : '';
          const isHex = (value, length) => value.length === length && /^[a-f0-9]+$/.test(value) && !/^0+$/.test(value);
          if (!isHex(traceId, 32) || !isHex(spanId, 16) || (parentSpanId && !isHex(parentSpanId, 16))
            || parentSpanId === spanId || typeof span.name !== 'string' || !span.name.trim() || span.name.length > 256) {
            throw httpError(400, 'INVALID_OTLP_SPAN');
          }
          const spanKey = `${traceId}:${spanId}`;
          if (seenSpans.has(spanKey)) throw httpError(400, 'DUPLICATE_OTLP_SPAN');
          seenSpans.add(spanKey);
          const startTime = timestampMilliseconds(span.startTimeUnixNano);
          const endTime = timestampMilliseconds(span.endTimeUnixNano);
          if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || startTime > endTime
            || startTime < this.now() - this.retentionMs || endTime > this.now() + 60_000) throw httpError(400, 'INVALID_OTLP_SPAN');
          const spanKind = typeof span.kind === 'string' ? SPAN_KINDS.get(span.kind) : Number(span.kind || 0);
          const rawStatus = span.status?.code;
          const statusCode = typeof rawStatus === 'string' ? SPAN_STATUSES.get(rawStatus) : Number(rawStatus || 0);
          if (!Number.isInteger(spanKind) || spanKind < 0 || spanKind > 5 || !Number.isInteger(statusCode) || statusCode < 0 || statusCode > 2) {
            throw httpError(400, 'INVALID_OTLP_SPAN');
          }
          const attrs = safeAttributes(span.attributes || [], POINT_ATTRIBUTE_KEYS);
          const operation = attrs['db.system.name'] ? 'Database operation'
            : attrs['messaging.system'] ? 'Message operation'
              : attrs['rpc.method'] ? String(attrs['rpc.method']).slice(0, 100)
                : attrs['http.request.method'] ? `${String(attrs['http.request.method']).slice(0, 12)} HTTP`
                  : spanKind === 2 ? 'HTTP server' : spanKind === 3 ? 'Client operation'
                    : spanKind === 4 ? 'Message producer' : spanKind === 5 ? 'Message consumer' : 'Internal operation';
          const links = Array.isArray(span.links) ? span.links : [];
          if (links.length > 32) throw httpError(413, 'OTLP_LINK_LIMIT');
          const normalizedLinks = links.map(link => {
            const linkedTraceId = typeof link?.traceId === 'string' ? link.traceId.toLowerCase() : '';
            const linkedSpanId = typeof link?.spanId === 'string' ? link.spanId.toLowerCase() : '';
            if (!isHex(linkedTraceId, 32) || !isHex(linkedSpanId, 16)) throw httpError(400, 'INVALID_OTLP_LINK');
            return { traceId: linkedTraceId, spanId: linkedSpanId };
          });
          spans.push({ traceId, spanId, parentSpanId, serviceName: resource['service.name'], spanName: operation,
            spanKind, statusCode, resource, attributes: { ...attrs, __scope: scopeIdentity }, startTime, endTime, links: normalizedLinks });
        }
      }
    }
    let duplicateSpansUpdated = 0;
    let acceptedLinks = 0;
    const existing = this.db.prepare('SELECT agent_id AS agentId FROM otlp_spans WHERE trace_id = ? AND span_id = ?');
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM otlp_spans WHERE start_time < ?').run(this.now() - this.retentionMs);
      const stored = this.db.prepare('SELECT COUNT(*) AS count FROM otlp_spans').get().count;
      const incoming = new Set(spans.map(span => `${span.traceId}:${span.spanId}`));
      const duplicates = [...incoming].reduce((count, key) => {
        const colon = key.indexOf(':');
        return count + (existing.get(key.slice(0, colon), key.slice(colon + 1)) ? 1 : 0);
      }, 0);
      if (stored + incoming.size - duplicates > this.maxSpans) throw httpError(429, 'TRACE_STORAGE_LIMIT');
      const traceCounts = new Map();
      const storedForTrace = this.db.prepare('SELECT COUNT(*) AS count FROM otlp_spans WHERE trace_id = ?');
      for (const span of spans) {
        if (!traceCounts.has(span.traceId)) traceCounts.set(span.traceId, new Set());
        traceCounts.get(span.traceId).add(span.spanId);
      }
      for (const [traceId, spanIds] of traceCounts) {
        const existingCount = storedForTrace.get(traceId).count;
        const newCount = [...spanIds].filter(spanId => !existing.get(traceId, spanId)).length;
        if (existingCount + newCount > MAX_SPANS_PER_TRACE) throw httpError(429, 'TRACE_SPAN_LIMIT');
      }
      for (const span of spans) {
        const prior = existing.get(span.traceId, span.spanId);
        if (prior && prior.agentId !== agent.id) throw httpError(409, 'SPAN_OWNERSHIP_CONFLICT');
        if (prior) duplicateSpansUpdated += 1;
        this.insertSpan.run({ traceId: span.traceId, spanId: span.spanId, parentSpanId: span.parentSpanId,
          agentId: agent.id, serviceName: span.serviceName, spanName: span.spanName, spanKind: span.spanKind,
          statusCode: span.statusCode, resourceJson: JSON.stringify(span.resource), attributesJson: JSON.stringify(span.attributes),
          startTime: span.startTime, endTime: span.endTime, receivedAt: this.now() });
        this.db.prepare('DELETE FROM otlp_span_links WHERE trace_id = ? AND span_id = ?').run(span.traceId, span.spanId);
        for (const link of span.links) {
          this.insertSpanLink.run(span.traceId, span.spanId, link.traceId, link.spanId, agent.id);
          acceptedLinks += 1;
        }
      }
    })();
    this.db.prepare(`DELETE FROM otlp_span_links WHERE NOT EXISTS
      (SELECT 1 FROM otlp_spans WHERE trace_id = otlp_span_links.trace_id AND span_id = otlp_span_links.span_id)`).run();
    return { accepted: spans.length, duplicateSpansUpdated, acceptedLinks };
  }

  ingestBrowserTraces(payload) {
    let row = this.agentById.get(BROWSER_RELAY_AGENT_ID);
    if (!row) {
      const now = this.now();
      this.insertAgent.run({ id: BROWSER_RELAY_AGENT_ID, name: 'Kua Dashboard browser relay', contractVersion: CONTRACT_VERSION,
        capabilities: JSON.stringify(['traces']), agentVersion: 'internal', tokenHash: digest(crypto.randomBytes(32).toString('base64url')), now });
      row = this.agentById.get(BROWSER_RELAY_AGENT_ID);
    }
    if (row.revoked_at) this.db.prepare('UPDATE agent_registry SET revoked_at = NULL, last_seen_at = ? WHERE id = ?').run(this.now(), BROWSER_RELAY_AGENT_ID);
    return this.ingestTraces({ id: BROWSER_RELAY_AGENT_ID, capabilities: ['traces'] }, payload);
  }

  getTrace(traceId) {
    const totalSpans = this.db.prepare('SELECT COUNT(*) AS count FROM otlp_spans WHERE trace_id = ?').get(traceId).count;
    const spans = this.db.prepare(`SELECT trace_id AS traceId, span_id AS spanId, parent_span_id AS parentSpanId,
      agent_id AS agentId, service_name AS serviceName, span_name AS name, span_kind AS kind, status_code AS statusCode,
      resource_json AS resourceJson, attributes_json AS attributesJson, start_time AS startTime, end_time AS endTime
      FROM otlp_spans WHERE trace_id = ? ORDER BY start_time, span_id LIMIT 5000`).all(traceId)
      .map(row => ({ ...row, resource: JSON.parse(row.resourceJson), attributes: JSON.parse(row.attributesJson),
        resourceJson: undefined, attributesJson: undefined, startTime: new Date(row.startTime).toISOString(), endTime: new Date(row.endTime).toISOString() }));
    const totalLinks = this.db.prepare('SELECT COUNT(*) AS count FROM otlp_span_links WHERE trace_id = ? OR linked_trace_id = ?').get(traceId, traceId).count;
    const links = this.db.prepare(`SELECT trace_id AS traceId, span_id AS spanId,
      linked_trace_id AS linkedTraceId, linked_span_id AS linkedSpanId
      FROM otlp_span_links WHERE trace_id = ? OR linked_trace_id = ? ORDER BY span_id LIMIT 20000`).all(traceId, traceId);
    return { traceId, spans, links, truncated: totalSpans > spans.length || totalLinks > links.length };
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
    const spans = this.db.prepare('DELETE FROM otlp_spans WHERE start_time < ?').run(this.now() - this.retentionMs).changes;
    this.db.prepare(`DELETE FROM otlp_span_links WHERE NOT EXISTS
      (SELECT 1 FROM otlp_spans WHERE trace_id = otlp_span_links.trace_id AND span_id = otlp_span_links.span_id)`).run();
    const tokens = this.db.prepare('DELETE FROM enrollment_tokens WHERE used_at IS NOT NULL OR expires_at < ?').run(this.now()).changes;
    this.db.pragma('incremental_vacuum(1000)');
    return { points, spans, tokens };
  }

  close() { this.db.close(); }
}

function createOtlpGatewayRouter({ store, auditLog, architectureDatabase = null, browserEnabled = false, browserSampleRatio = 0.1, browserServiceName = 'kuadashboard-frontend', ipLimits = {} } = {}) {
  if (!store) throw new TypeError('store is required');
  const router = express.Router();
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  // Apply a recognizable IP limit before transport/authentication guards; keep
  // the narrower route-specific limits below to protect individual operations.
  router.use(rateLimit({
    windowMs: 60_000,
    limit: ipLimits.gateway ?? 1200,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, res) => res.status(429).json({ error: 'REQUEST_RATE_LIMIT' }),
  }));
  router.use(requireLocalOrTls);
  const bearer = req => /^Bearer ([A-Za-z0-9_-]{40,128})$/.exec(req.get('Authorization') || '')?.[1];
  const respondError = (res, error) => {
    if (error.statusCode === 429) res.set('Retry-After', '5');
    return res.status(error.statusCode || 500).json({ error: error.code || 'INTERNAL_ERROR' });
  };
  const browserRateLimit = createIpRateLimit(ipLimits.browser ?? 120);
  const enrollmentTokenRateLimit = createIpRateLimit(ipLimits.enrollmentToken ?? 6);
  const enrollRateLimit = createIpRateLimit(ipLimits.enroll ?? 30);
  const heartbeatRateLimit = createIpRateLimit(ipLimits.heartbeat ?? 240);
  const ingestionRateLimit = createIpRateLimit(ipLimits.ingestion ?? 240);
  const sameOriginBrowser = (req, res, next) => {
    const origin = req.get('Origin');
    let originUrl;
    try { originUrl = new URL(origin); } catch {}
    const fetchSite = req.get('Sec-Fetch-Site');
    const requestHost = String(req.get('host') || '').toLowerCase();
    if (!originUrl || !['http:', 'https:'].includes(originUrl.protocol) || originUrl.username || originUrl.password
      || originUrl.pathname !== '/' || originUrl.search || originUrl.hash
      || originUrl.host.toLowerCase() !== requestHost || fetchSite !== 'same-origin') {
      return res.status(403).json({ error: 'SAME_ORIGIN_BROWSER_REQUIRED' });
    }
    return next();
  };
  router.get('/browser/config', (_req, res) => res.json({ enabled: browserEnabled, sampleRatio: browserSampleRatio, serviceName: browserServiceName }));
  router.post('/browser/v1/traces', browserRateLimit, sameOriginBrowser, express.json({ limit: MAX_BODY_BYTES, strict: true }), (req, res) => {
    try {
      if (!browserEnabled) throw httpError(404, 'BROWSER_TRACING_DISABLED');
      const result = store.ingestBrowserTraces(req.body);
      res.set('Content-Type', 'application/json')
        .set('X-KUA-OTLP-Accepted-Spans', String(result.accepted))
        .set('X-KUA-OTLP-Duplicate-Spans', String(result.duplicateSpansUpdated))
        .status(200).json({});
    } catch (error) { respondError(res, error); }
  });
  router.post('/enrollment-token', enrollmentTokenRateLimit, (_req, res) => {
    try {
      const issued = store.issueEnrollmentToken();
      auditLog?.log({ category: 'apm', action: 'agent.enrollment-token.issue', resource: 'otlp', details: {} });
      res.status(201).json(issued);
    } catch (error) { respondError(res, error); }
  });
  router.post('/enroll', enrollRateLimit, express.json({ limit: '4kb', strict: true }), (req, res) => {
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
  router.post('/agents/:id/heartbeat', heartbeatRateLimit, express.json({ limit: '4kb', strict: true }), (req, res) => {
    try {
      const agent = store.authenticate(bearer(req));
      if (agent.id !== req.params.id) throw httpError(404, 'AGENT_NOT_FOUND');
      res.json(store.heartbeat(agent, req.body));
    } catch (error) { respondError(res, error); }
  });
  router.post('/v1/metrics', ingestionRateLimit, express.json({ limit: MAX_BODY_BYTES, strict: true }), (req, res) => {
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
  router.post('/v1/traces', ingestionRateLimit, express.json({ limit: MAX_BODY_BYTES, strict: true }), (req, res) => {
    try {
      const agent = store.authenticate(bearer(req));
      if (!agent.capabilities.includes('traces')) throw httpError(403, 'SIGNAL_NOT_ENABLED');
      const result = store.ingestTraces(agent, req.body);
      res.set('Content-Type', 'application/json')
        .set('X-KUA-OTLP-Accepted-Spans', String(result.accepted))
        .set('X-KUA-OTLP-Duplicate-Spans', String(result.duplicateSpansUpdated))
        .status(200).json({});
    } catch (error) { respondError(res, error); }
  });
  router.get('/traces/:traceId/architecture', (req, res) => {
    try {
      const traceId = String(req.params.traceId || '').toLowerCase();
      if (!/^[a-f0-9]{32}$/.test(traceId) || /^0+$/.test(traceId)) throw httpError(400, 'INVALID_TRACE_ID');
      if (!architectureDatabase) throw httpError(503, 'ARCHITECTURE_UNAVAILABLE');
      const profileId = req.get('X-Profile-Id');
      const projectId = String(req.query.projectId || '');
      if (!profileId || !projectId) throw httpError(400, 'PROFILE_AND_PROJECT_REQUIRED');
      const project = architectureDatabase.getProject(projectId);
      if (!project || project.profileId !== profileId) throw httpError(404, 'ARCHITECTURE_PROJECT_NOT_FOUND');
      const trace = store.getTrace(traceId);
      if (!trace.spans.length) throw httpError(404, 'TRACE_NOT_FOUND');
      res.json(require('./traceProjection').projectTraceToArchitecture(trace, project, architectureDatabase.getGraph(projectId)));
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
  router.delete('/traces', (req, res) => {
    try {
      if (typeof req.query.host !== 'string' || !req.query.host) throw httpError(400, 'HOST_REQUIRED');
      const result = store.deleteTraces(req.query.host);
      auditLog?.log({ category: 'apm', action: 'agent.traces.delete', resource: req.query.host, details: result });
      res.json(result);
    } catch (error) { respondError(res, error); }
  });
  router.get('/health', (_req, res) => {
    try {
      const stats = store.db.prepare(`SELECT COUNT(*) AS points, COUNT(DISTINCT series_key) AS series,
        COALESCE(MAX(received_at), 0) AS lastReceivedAt FROM otlp_metric_points`).get();
      const traceStats = store.db.prepare(`SELECT COUNT(*) AS spans, COUNT(DISTINCT trace_id) AS traces
        FROM otlp_spans`).get();
      const agents = store.db.prepare(`SELECT SUM(CASE WHEN revoked_at IS NULL THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN revoked_at IS NOT NULL THEN 1 ELSE 0 END) AS revoked FROM agent_registry`).get();
      res.json({ status: 'ok', contractVersion: CONTRACT_VERSION, ...stats, maxSeries: store.maxSeries,
        ...traceStats, maxPoints: store.maxPoints, maxSpans: store.maxSpans, requestsPerMinute: store.requestsPerMinute,
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
    maxSpans: positiveInteger(env.KUA_OTLP_MAX_SPANS, MAX_STORED_SPANS, 5_000_000),
    retentionMs: positiveInteger(env.KUA_OTLP_RETENTION_DAYS, 7, 365) * 24 * 60 * 60 * 1000,
    requestsPerMinute: positiveInteger(env.KUA_OTLP_REQUESTS_PER_MINUTE, MAX_INGEST_REQUESTS_PER_MINUTE, 10_000),
  });
}

module.exports = { CONTRACT_VERSION, MAX_BODY_BYTES, MAX_METRICS_PER_REQUEST, MAX_SERIES,
  MAX_STORED_POINTS, MAX_STORED_SPANS, MAX_SPANS_PER_TRACE, MAX_INGEST_REQUESTS_PER_MINUTE,
  OtlpGatewayStore, createOtlpGatewayRouter, createOtlpGatewayStoreFromEnv, normalizeResource, safeAttributes };
