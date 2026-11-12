'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const test = require('node:test');
const { ArchitectureDatabase } = require('../architecture/database');
const { OtlpGatewayStore, createOtlpGatewayRouter } = require('./otlpGateway');

async function fixture(options = {}) {
  const { architectureDatabase = null, ...storeOptions } = options;
  let now = Date.now();
  const store = new OtlpGatewayStore({ filePath: ':memory:', now: () => now, ...storeOptions });
  const app = express();
  app.use('/api/observability/otlp', createOtlpGatewayRouter({ store, architectureDatabase }));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/observability/otlp`;
  async function request(path, { method = 'GET', token, enrollmentToken, body, headers: extraHeaders = {} } = {}) {
    const response = await fetch(`${base}${path}`, { method, headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(enrollmentToken ? { 'X-KUA-Enrollment-Token': enrollmentToken } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...extraHeaders,
    }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, headers: response.headers, body: await response.json() };
  }
  return { store, server, request, setNow(value) { now = value; } };
}

const enrollment = (name = 'api-host') => ({ contractVersion: 1, name, agentVersion: '0.1.0', capabilities: ['metrics'] });
const payload = (timestampMs, value = 42) => ({ resourceMetrics: [{
  resource: { attributes: [
    { key: 'service.name', value: { stringValue: 'checkout' } },
    { key: 'host.id', value: { stringValue: 'host-123' } },
  ] },
  scopeMetrics: [{ metrics: [{ name: 'http.server.request.count', unit: '{request}', sum: { dataPoints: [
    { timeUnixNano: String(BigInt(timestampMs) * 1_000_000n), asInt: String(value), attributes: [
      { key: 'http.route', value: { stringValue: '/checkout/{orderId}' } },
      { key: 'url.path', value: { stringValue: '/checkout?token=private' } },
      { key: 'password', value: { stringValue: 'private' } },
    ] },
  ] } }] }],
}] });

test('enrollment tokens are single use; agent token authenticates, rotates and revokes', async t => {
  const f = await fixture();
  t.after(() => { f.server.close(); f.store.close(); });
  const issued = await f.request('/enrollment-token', { method: 'POST' });
  assert.equal(issued.status, 201);
  const enrolled = await f.request('/enroll', { method: 'POST', enrollmentToken: issued.body.token, body: enrollment() });
  assert.equal(enrolled.status, 201);
  assert.equal((await f.request('/enroll', { method: 'POST', enrollmentToken: issued.body.token, body: enrollment() })).status, 401);
  const heartbeat = { contractVersion: 1, agentVersion: '0.1.1', capabilities: ['metrics'] };
  assert.equal((await f.request(`/agents/${enrolled.body.agentId}/heartbeat`, { method: 'POST', token: enrolled.body.token, body: heartbeat })).status, 200);
  const rotated = await f.request(`/agents/${enrolled.body.agentId}/rotate`, { method: 'POST' });
  assert.equal((await f.request('/agents/test/heartbeat', { method: 'POST', token: enrolled.body.token, body: heartbeat })).status, 401);
  assert.equal((await f.request('/agents/anything/heartbeat', { method: 'POST', token: rotated.body.token, body: heartbeat })).status, 404);
  assert.equal((await f.request(`/agents/${enrolled.body.agentId}/heartbeat`, { method: 'POST', token: rotated.body.token,
    body: { ...heartbeat, contractVersion: 2 } })).status, 409);
  assert.equal((await f.request(`/agents/${enrolled.body.agentId}`, { method: 'DELETE' })).body.revoked, true);
  assert.equal((await f.request(`/agents/${enrolled.body.agentId}/heartbeat`, { method: 'POST', token: rotated.body.token, body: heartbeat })).status, 401);
});

test('OTLP metrics are authenticated, deduplicated and retain safe resource identity', async t => {
  const f = await fixture();
  t.after(() => { f.server.close(); f.store.close(); });
  const issued = await f.request('/enrollment-token', { method: 'POST' });
  const agent = await f.request('/enroll', { method: 'POST', enrollmentToken: issued.body.token, body: enrollment() });
  const at = f.store.now();
  const body = payload(at);
  assert.equal((await f.request('/v1/metrics', { method: 'POST', body })).status, 401);
  const first = await f.request('/v1/metrics', { method: 'POST', token: agent.body.token, body });
  assert.equal(first.status, 200);
  assert.deepEqual(first.body, {});
  const duplicate = await f.request('/v1/metrics', { method: 'POST', token: agent.body.token, body });
  assert.match(duplicate.headers.get('content-type'), /application\/json/);
  assert.equal(duplicate.headers.get('x-kua-otlp-duplicates'), '1');
  const oversized = await f.request('/v1/metrics', { method: 'POST', token: agent.body.token,
    body: { resourceMetrics: [], padding: 'x'.repeat(270 * 1024) } });
  assert.equal(oversized.status, 413);
  assert.deepEqual(oversized.body, { error: 'OTLP_BODY_LIMIT' });
  const result = await f.request('/metrics');
  assert.equal(result.body.points.length, 1);
  assert.equal(result.body.points[0].attributes.resource['host.id'], 'host-123');
  assert.equal(result.body.points[0].attributes.point['http.route'], '/checkout/{orderId}');
  assert.deepEqual(Object.keys(result.body.points[0].attributes.point), ['http.route']);
});

test('retention, cardinality caps, contract validation and host deletion are bounded', async t => {
  const f = await fixture({ maxSeries: 1, retentionMs: 60_000 });
  t.after(() => { f.server.close(); f.store.close(); });
  const issue = await f.request('/enrollment-token', { method: 'POST' });
  assert.equal((await f.request('/enroll', { method: 'POST', enrollmentToken: issue.body.token,
    body: { ...enrollment(), contractVersion: 99 } })).status, 400);
  const issue2 = await f.request('/enrollment-token', { method: 'POST' });
  const agent = await f.request('/enroll', { method: 'POST', enrollmentToken: issue2.body.token, body: enrollment() });
  const at = f.store.now();
  assert.equal((await f.request('/v1/metrics', { method: 'POST', token: agent.body.token, body: payload(at) })).status, 200);
  const highCardinality = payload(at + 1);
  highCardinality.resourceMetrics[0].scopeMetrics[0].metrics[0].name = 'different.metric';
  assert.equal((await f.request('/v1/metrics', { method: 'POST', token: agent.body.token, body: highCardinality })).status, 429);
  const oldAt = at - 120_000;
  assert.equal((await f.request('/v1/metrics', { method: 'POST', token: agent.body.token, body: payload(oldAt) })).status, 400);
  assert.equal((await f.request('/metrics?host=' + agent.body.agentId)).body.points.length, 1);
  assert.equal((await f.request(`/agents/${agent.body.agentId}`, { method: 'DELETE' })).body.deletedMetrics, true);
  assert.equal((await f.request('/metrics?host=' + agent.body.agentId)).body.points.length, 0);
});

test('per-agent ingress rate and storage caps apply backpressure without partial writes', async t => {
  const f = await fixture({ requestsPerMinute: 1, maxPoints: 1 });
  t.after(() => { f.server.close(); f.store.close(); });
  const issued = await f.request('/enrollment-token', { method: 'POST' });
  const agent = await f.request('/enroll', { method: 'POST', enrollmentToken: issued.body.token, body: enrollment() });
  const at = f.store.now();
  const send = body => f.request('/v1/metrics', { method: 'POST', token: agent.body.token, body });
  assert.equal((await send(payload(at))).status, 200);
  assert.equal((await send(payload(at + 1))).body.error, 'INGEST_RATE_LIMIT');
  f.store.requestWindows.clear();
  const storageLimited = await send(payload(at + 1));
  assert.equal(storageLimited.body.error, 'STORAGE_LIMIT', JSON.stringify(storageLimited));
  assert.equal((await f.request('/metrics?host=' + agent.body.agentId)).body.points.length, 1);
});

test('OTLP spans are projected onto Architecture while unobserved load balancers stay inventory evidence', async t => {
  const architectureDatabase = new ArchitectureDatabase({ filePath: ':memory:' });
  const project = architectureDatabase.createProject({ profileId: 'local:dev', name: 'shop' });
  architectureDatabase.saveGraph(project.id, {
    projectId: project.id,
    nodes: [
      { id: 'web', name: 'shop-web', provider: 'generic', resourceType: 'frontend' },
      { id: 'alb', name: 'public-alb', provider: 'aws', resourceType: 'elb' },
      { id: 'api', name: 'checkout-api', provider: 'generic', resourceType: 'service' },
      { id: 'db', name: 'orders-db', provider: 'aws', resourceType: 'rds' },
    ],
    edges: [
      { id: 'web-alb', sourceNodeId: 'web', targetNodeId: 'alb', relationType: 'routes_to', status: 'automatic', evidence: [{ type: 'elb_registration', sourceId: 'aws:topology:1', values: ['sensitive-value'] }] },
      { id: 'alb-api', sourceNodeId: 'alb', targetNodeId: 'api', relationType: 'routes_to', status: 'automatic', evidence: [{ type: 'target_registration', sourceId: 'aws:topology:1' }] },
      { id: 'api-db', sourceNodeId: 'api', targetNodeId: 'db', relationType: 'depends_on', status: 'manual' },
    ],
  }, { expectedRevision: 0 });
  const f = await fixture({ architectureDatabase });
  t.after(() => { f.server.close(); f.store.close(); architectureDatabase.close(); });
  const issued = await f.request('/enrollment-token', { method: 'POST' });
  const agent = await f.request('/enroll', { method: 'POST', enrollmentToken: issued.body.token,
    body: { ...enrollment(), capabilities: ['traces'] } });
  const traceId = '1'.repeat(32);
  const timestamp = BigInt(f.store.now()) * 1_000_000n;
  const tracePayload = { resourceSpans: [
    { resource: { attributes: [{ key: 'service.name', value: { stringValue: 'shop-web' } }] }, scopeSpans: [{ scope: { name: 'test-instrumentation', version: '1.0' }, spans: [
      { traceId, spanId: 'a'.repeat(16), name: 'GET /private-user-path', kind: 'SPAN_KIND_SERVER', startTimeUnixNano: String(timestamp), endTimeUnixNano: String(timestamp + 1_000_000n), attributes: [{ key: 'http.request.method', value: { stringValue: 'GET' } }, { key: 'http.route', value: { stringValue: '/checkout/{orderId}' } }, { key: 'url.path', value: { stringValue: '/private-user-path?token=secret' } }] },
    ] }] },
    { resource: { attributes: [{ key: 'service.name', value: { stringValue: 'checkout-api' } }] }, scopeSpans: [{ scope: { name: 'test-instrumentation', version: '1.0' }, spans: [
      { traceId, spanId: 'b'.repeat(16), parentSpanId: 'a'.repeat(16), name: 'SELECT secret FROM users', kind: 'SPAN_KIND_SERVER', startTimeUnixNano: String(timestamp + 1_000_000n), endTimeUnixNano: String(timestamp + 2_000_000n), status: { code: 'STATUS_CODE_OK' }, attributes: [{ key: 'db.statement', value: { stringValue: 'SELECT secret' } }] },
    ] }] },
    { resource: { attributes: [{ key: 'service.name', value: { stringValue: 'orders-db' } }] }, scopeSpans: [{ scope: { name: 'test-instrumentation', version: '1.0' }, spans: [
      { traceId, spanId: 'c'.repeat(16), parentSpanId: 'b'.repeat(16), name: 'SELECT secret FROM users', kind: 'SPAN_KIND_CLIENT', startTimeUnixNano: String(timestamp + 2_000_000n), endTimeUnixNano: String(timestamp + 3_000_000n), attributes: [{ key: 'db.system.name', value: { stringValue: 'postgresql' } }, { key: 'db.operation.name', value: { stringValue: 'SELECT' } }] },
    ] }] },
  ] };
  assert.equal((await f.request('/v1/traces', { method: 'POST', token: agent.body.token, body: tracePayload })).status, 200);
  const projection = await f.request(`/traces/${traceId}/architecture?projectId=${project.id}`, { headers: { 'X-Profile-Id': 'local:dev' } });
  assert.equal(projection.status, 200);
  assert.equal(projection.body.coverage, 'partial');
  assert.equal(projection.body.spans.length, 3);
  assert.equal(projection.body.spans[1].architecture.node.id, 'api');
  assert.equal(projection.body.spans[2].operation, 'Database operation');
  assert.deepEqual(projection.body.segments[0].inventoryNodes.map(node => node.id), ['alb']);
  assert.equal(projection.body.segments[0].inventoryEdges.every(edge => edge.observedSpan === false), true);
  assert.equal(projection.body.segments[1].status, 'observed');
  const publicProjection = JSON.stringify(projection.body);
  assert.equal(publicProjection.includes('private-user-path'), false);
  assert.equal(publicProjection.includes('SELECT secret'), false);
  assert.equal(publicProjection.includes('sensitive-value'), false);
  assert.equal((await f.request(`/traces/${traceId}/architecture?projectId=${project.id}`, { headers: { 'X-Profile-Id': 'other-profile' } })).status, 404);
  assert.equal((await f.request(`/traces?host=${agent.body.agentId}`, { method: 'DELETE' })).body.deletedSpans, 3);
  assert.equal((await f.request(`/traces/${traceId}/architecture?projectId=${project.id}`, { headers: { 'X-Profile-Id': 'local:dev' } })).status, 404);
});
