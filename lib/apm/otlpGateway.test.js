'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const test = require('node:test');
const { OtlpGatewayStore, createOtlpGatewayRouter } = require('./otlpGateway');

async function fixture(options = {}) {
  let now = Date.now();
  const store = new OtlpGatewayStore({ filePath: ':memory:', now: () => now, ...options });
  const app = express();
  app.use('/api/observability/otlp', createOtlpGatewayRouter({ store }));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/observability/otlp`;
  async function request(path, { method = 'GET', token, enrollmentToken, body } = {}) {
    const response = await fetch(`${base}${path}`, { method, headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(enrollmentToken ? { 'X-KUA-Enrollment-Token': enrollmentToken } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
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
      { key: 'route', value: { stringValue: '/checkout' } },
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
  assert.equal(result.body.points[0].attributes.point.route, '/checkout');
  assert.deepEqual(Object.keys(result.body.points[0].attributes.point), ['route']);
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
