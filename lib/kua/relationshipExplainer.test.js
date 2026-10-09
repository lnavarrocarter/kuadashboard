'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { explainRelationship, EVIDENCE_CLASS } = require('./relationshipExplainer');

const source = { id: 'api', name: 'checkout-api', type: 'lambda' };
const target = { id: 'db', name: 'orders-db', type: 'dynamodb', nativeIdentifier: 'arn:aws:dynamodb:us-east-1:111111111111:table/orders-db' };

test('every evidence type has a class and unknown types fall back to a generic sentence', () => {
  const result = explainRelationship({
    relationship: { relationType: 'calls', evidence: [{ type: 'cloudformation_reference', path: 'Environment.TABLE', intrinsic: 'Ref' }, { type: 'brand_new_signal', values: ['x'] }] },
    source, target,
  });
  assert.equal(result.evidence[0].key, 'kuapps.explain.evidence.cloudformation_reference');
  assert.deepEqual(result.evidence[0].params, { path: 'Environment.TABLE', intrinsic: 'Ref', type: 'cloudformation_reference' });
  assert.equal(result.evidence[1].key, 'kuapps.explain.evidence.unknown');
  assert.equal(result.evidence[1].class, 'inferred');
  assert.ok(Object.values(EVIDENCE_CLASS).every(value => ['declared', 'observed', 'inferred'].includes(value)));
});

test('evidence only inferred from names asks to verify before accepting', () => {
  const result = explainRelationship({ relationship: { relationType: 'depends_on', confidence: 0.55, evidence: [{ type: 'shared_name_tokens', values: ['orders'] }] }, source, target });
  assert.equal(result.summary.key, 'kuapps.explain.summary.inferred');
  assert.deepEqual(result.confidence.byClass, { declared: 0, observed: 0, inferred: 1 });
  assert.deepEqual(result.advice.map(item => item.id), ['inferred_only']);
  assert.deepEqual(result.limits, ['no_signals']);
});

test('without signals, the limit points at the side that writes logs, or at the definition (#239)', () => {
  const securityGroup = { id: 'sg', name: 'sg-0720983be49e437e2', type: 'ec2' };
  const toLambda = explainRelationship({ relationship: { relationType: 'depends_on', evidence: [] }, source: securityGroup, target: source });
  assert.deepEqual(toLambda.limits, ['no_signals_target']);
  assert.equal(toLambda.signalsResourceId, 'api');
  const noLogs = explainRelationship({ relationship: { relationType: 'depends_on', evidence: [] }, source: securityGroup, target });
  assert.deepEqual(noLogs.limits, ['no_log_signals']);
  assert.equal(noLogs.signalsResourceId, '');
  const workload = explainRelationship({ relationship: { relationType: 'calls', evidence: [] }, source: { id: 'w', name: 'worker', type: 'deployment' }, target });
  assert.deepEqual(workload.limits, ['no_signals']);
  assert.equal(workload.signalsResourceId, 'w');
});

test('signals of the pair: target error rate over its threshold and caller errors that name the target', () => {
  const result = explainRelationship({
    relationship: { relationType: 'calls', status: 'suggested', confidence: 0.9, evidence: [{ type: 'observed_log_reference', values: ['/aws/lambda/checkout-api', 'orders-db', '38'] }] },
    source, target,
    thresholds: { errorRatePercent: 2 },
    signals: {
      source: { logGroup: '/aws/lambda/checkout-api', last24h: { errorRatePercent: 1 }, lastSyncAt: 1000, recurringErrors: [{ signature: 'Task timed out calling orders-db after 3000 ms', occurrences: 12 }, { signature: 'unrelated', occurrences: 4 }] },
      target: { logGroup: '/aws/dynamodb/orders-db', last24h: { errorRatePercent: 4.17, errors: 25, events: 600 }, lastSyncAt: 2000, recurringErrors: [] },
    },
    semantic: { state: 'ready', matches: [{ signature: 'ProvisionedThroughputExceeded on table', occurrences: 7, category: 'throttling', score: 0.71 }] },
  });
  assert.equal(result.summary.key, 'kuapps.explain.summary.observed');
  assert.deepEqual(result.signals.mentions.map(item => [item.match, item.occurrences]), [['rule', 12], ['semantic', 7]]);
  assert.equal(result.signals.syncedAt, 1000);
  const advice = Object.fromEntries(result.advice.map(item => [item.id, item]));
  assert.equal(advice.target_errors.params.rate, 4.2);
  assert.equal(advice.failures_to_target.params.count, 19);
  assert.ok(advice.observed_not_declared);
  assert.deepEqual(result.limits, []);
});

test('declared and observed evidence is safe to accept; a secret dependency is pointed out', () => {
  const result = explainRelationship({
    relationship: { relationType: 'uses', status: 'confirmed', evidence: [{ type: 'env_secret_key' }, { type: 'log_reference' }] },
    source, target,
    signals: { source: { last24h: {}, recurringErrors: [] }, target: null },
    semantic: { state: 'disabled', matches: [] },
  });
  assert.deepEqual(result.advice.map(item => item.id), ['declared_and_observed', 'secret_dependency'])
  assert.deepEqual(result.limits, ['semantic_disabled']);
});

test('a rejected relationship explains that rejecting stops the suggestion', () => {
  const result = explainRelationship({ relationship: { relationType: 'calls', status: 'rejected', evidence: [{ type: 'service_selector', selector: { app: 'api' } }] }, source, target });
  assert.equal(result.evidence[0].params.selector, 'app=api');
  assert.ok(result.advice.some(item => item.id === 'rejected'));
});
