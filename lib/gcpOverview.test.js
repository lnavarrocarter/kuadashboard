'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { summarizeOverview } = require('./gcpOverview');

const ok = (id, extra = {}) => ({ id, status: 'available', count: 2, active: 2, inactive: 0, critical: 0, warning: 0, ...extra });
const down = (id, kind) => ({ id, status: 'unavailable', count: 0, active: 0, inactive: 0, critical: 0, warning: 0, error: { kind } });

test('read errors lower coverage but are not incidents', () => {
  const s = summarizeOverview([ok('cloudrun'), ok('gke'), down('tasks', 'api_disabled'), down('artifact', 'invalid_request'), down('spanner', 'api_disabled')]);
  assert.equal(s.resourceHealth, 'healthy');
  assert.equal(s.health, 'healthy');
  assert.equal(s.incidents, 0);
  assert.equal(s.attention, 0);
  assert.deepEqual(s.coverage, { evaluated: 2, total: 5, notEvaluated: 3, percent: 40, causes: { api_disabled: 2, invalid_request: 1 } });
});

test('resource health follows critical and warning signals only', () => {
  assert.equal(summarizeOverview([ok('a', { warning: 1 }), down('b', 'permission')]).resourceHealth, 'warning');
  const s = summarizeOverview([ok('a', { critical: 1, warning: 2 })]);
  assert.equal(s.resourceHealth, 'critical');
  assert.equal(s.incidents, 3);
});

test('build history is counted apart from deployed resources (G09)', () => {
  const s = summarizeOverview([
    ok('cloudrun', { count: 8, active: 8 }),
    ok('build', { kind: 'execution', count: 50, active: 48, partial: true }),
  ]);
  assert.equal(s.total, 8);
  assert.equal(s.active, 8);
  assert.deepEqual(s.executions, { count: 50, services: ['build'], partial: true });
  assert.deepEqual(s.partialServices, ['build']);
});
