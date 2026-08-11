'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { analyzeTopology } = require('./topologyAnalysis');

const resources = [
  { id: 'queue', type: 'sqs', name: 'gasco-orders-events', enabled: true },
  { id: 'worker', type: 'lambda', name: 'gasco-orders-worker', enabled: true },
];

test('suggests explainable relationships without confirming them', () => {
  const analysis = analyzeTopology({ id: 'gasco' }, resources, []);

  assert.equal(analysis.engine, 'local-rules');
  assert.equal(analysis.suggestions.length, 1);
  assert.equal(analysis.suggestions[0].relationType, 'consumed_by');
  assert.equal(analysis.suggestions[0].confirmed, false);
  assert.ok(analysis.suggestions[0].evidence.some(item => item.type === 'shared_name_tokens'));
  assert.equal(analysis.findings[0].code, 'no_confirmed_dependencies');
});

test('scores a confirmed connected topology above a disconnected topology', () => {
  const disconnected = analyzeTopology({ id: 'gasco' }, resources, []);
  const connected = analyzeTopology({ id: 'gasco' }, resources, [{
    sourceResourceId: 'queue', targetResourceId: 'worker', relationType: 'consumed_by',
  }]);

  assert.ok(connected.score > disconnected.score);
  assert.equal(connected.coveragePercent, 100);
  assert.equal(connected.counts.isolatedResources, 0);
  assert.equal(connected.suggestions.length, 0);
});

test('does not infer a dependency from compatible types alone', () => {
  const analysis = analyzeTopology({ id: 'gasco' }, [
    { id: 'queue', type: 'sqs', name: 'billing-events', enabled: true },
    { id: 'worker', type: 'lambda', name: 'customer-sync', enabled: true },
  ], []);

  assert.equal(analysis.suggestions.length, 0);
});

test('does not score a generic relationship as an operational dependency', () => {
  const generic = analyzeTopology({ id: 'gasco' }, resources, [{
    sourceResourceId: 'queue', targetResourceId: 'worker', relationType: 'related_to',
  }]);
  const operational = analyzeTopology({ id: 'gasco' }, resources, [{
    sourceResourceId: 'queue', targetResourceId: 'worker', relationType: 'consumed_by',
  }]);

  assert.ok(operational.score > generic.score);
  assert.equal(generic.counts.operationalDependencies, 0);
  assert.equal(generic.findings.some(finding => finding.code === 'generic_relationships'), true);
});