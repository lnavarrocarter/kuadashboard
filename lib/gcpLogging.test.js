'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { mapLogEntry, logMessage, loggingRequest } = require('./gcpLogging');
test('preserves audit, structured, HTTP and text log payloads', () => {
  const audit = { methodName: 'get', status: { code: 7 } };
  assert.deepEqual(JSON.parse(mapLogEntry({ protoPayload: audit }).message), audit);
  assert.equal(logMessage({ textPayload: '', jsonPayload: { foo: 1 } }), '');
  assert.equal(logMessage({ jsonPayload: { count: 0 } }), '{"count":0}');
  assert.equal(logMessage({ httpRequest: { status: 500 } }), '{"status":500}');
});
test('keeps the exact query window and filter while paginating', () => {
  const first = loggingRequest('p', { filter: 'severity>=ERROR OR severity=INFO', hours: 3, limit: 5 }, Date.parse('2026-10-07T12:00:00Z'));
  const next = loggingRequest('p', { filter: 'severity>=ERROR OR severity=INFO', hours: 3, limit: 5, since: first.since, until: first.until, pageToken: 'next' }, Date.parse('2026-10-07T13:00:00Z'));
  assert.equal(next.body.filter, first.body.filter);
  assert.ok(first.body.filter.startsWith('(severity>=ERROR OR severity=INFO) AND timestamp'));
  assert.deepEqual(next.body, { ...first.body, pageToken: 'next' });
});
test('rejects bad windows and cursor-only requests, bounds page size', () => {
  assert.throws(() => loggingRequest('p', { since: 'bad' }), /Invalid log time/);
  assert.throws(() => loggingRequest('p', { pageToken: 'next' }), /required for pagination/);
  assert.throws(() => loggingRequest('p', { filter: {} }), /filter must/);
  assert.equal(loggingRequest('p', { limit: -10 }).body.pageSize, 1);
  assert.equal(loggingRequest('p', { limit: 1000 }).body.pageSize, 500);
});
