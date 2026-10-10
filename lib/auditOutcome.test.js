'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createAuditOutcomeMiddleware, outcomeOf } = require('./auditOutcome');

function exercise(middleware, { method, url, status, body, locals = {} }) {
  const res = Object.assign(new EventEmitter(), { statusCode: status, locals });
  middleware({ method, originalUrl: url, body, get: () => 'p-1' }, res, () => {});
  res.emit('finish');
}

test('records the outcome of writes to clouds and clusters, not reads', () => {
  const entries = [];
  let clock = 1000;
  const middleware = createAuditOutcomeMiddleware({ audit: { log: entry => entries.push(entry) }, now: () => (clock += 250) });
  exercise(middleware, { method: 'POST', url: '/api/cloud/aws/ec2/i-1/stop', status: 200 });
  exercise(middleware, { method: 'DELETE', url: '/api/default/pods/web', status: 500 });
  exercise(middleware, { method: 'GET', url: '/api/cloud/aws/ec2', status: 200 });
  exercise(middleware, { method: 'POST', url: '/api/cloud/aws/athena/query', status: 200, body: { query: 'SELECT 1' } });
  exercise(middleware, { method: 'POST', url: '/api/cloud/aws/ec2/i-1/start', status: 403, locals: { auditRecorded: true } });
  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map(entry => [entry.category, entry.action, entry.resource]), [
    ['aws', 'operation.succeeded', 'POST /api/cloud/aws/ec2/i-1/stop'],
    ['kubernetes', 'operation.failed', 'DELETE /api/default/pods/web'],
  ]);
  assert.deepEqual(entries[0].details, { status: 200, durationMs: 250, outcome: 'succeeded' });
  assert.equal(entries[1].level, 'warning');
  assert.equal(entries[0].context, 'p-1');
});

test('outcome names', () => {
  assert.deepEqual([200, 204, 403, 409, 404, 500].map(outcomeOf), ['succeeded', 'succeeded', 'refused', 'refused', 'failed', 'failed']);
});
