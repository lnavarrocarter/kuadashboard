'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { normalizeScope } = require('./applicationContract');
const { applicationLogHistory, loadApplicationSignals, logScopeForResource, productLogAnalysis } = require('./relationshipSignals');

const application = { id: 'app-orders', profileId: null, region: '', thresholds: { errorRatePercent: 2 } };
const awsScope = normalizeScope({ provider: 'aws', scopeId: '123456789012', location: 'us-east-1' });
const kubeScope = normalizeScope({ provider: 'kubernetes', scopeId: 'orders-prod', location: '' });
const resources = [
  {
    id: 'aws-api', applicationId: application.id, provider: 'aws', type: 'lambda', name: 'checkout-api',
    arn: 'arn:aws:lambda:us-east-1:123456789012:function:checkout-api', enabled: true,
  },
  {
    id: 'kube-deployment', applicationId: application.id, provider: 'kubernetes', type: 'kubernetes',
    kind: 'Deployment', name: 'orders-worker', namespace: 'payments', kubeContext: 'orders-prod', enabled: true,
  },
];

function summary(errors, events) {
  return {
    last24h: { errors, events, errorRatePercent: events ? (errors / events) * 100 : null },
    last7d: { errors, events, errorRatePercent: events ? (errors / events) * 100 : null },
    lastEventAt: Date.parse('2026-10-07T10:00:00.000Z'),
    cache: { lastSyncAt: Date.parse('2026-10-07T10:01:00.000Z') },
    signatures: [], keywords24h: {}, categories24h: {}, recommendations: [], references: [],
  };
}

function database() {
  return {
    listResources: () => resources,
    listEdges: () => [],
    listRegistryResources: () => [],
    listRegistryRelationships: () => [],
    listApplicationScopes: () => [awsScope, kubeScope],
    listScopeBindings: () => [
      { scopeKey: awsScope.key, profileId: 'aws:production', status: 'verified' },
      { scopeKey: kubeScope.key, profileId: 'kube-local:production', status: 'verified' },
    ],
  };
}

test('log scopes resolve CloudWatch and Kubernetes groups per resource without crossing scopes', async () => {
  const db = database();
  assert.deepEqual(logScopeForResource(db, application, resources[0]), { profileId: 'aws:production', region: 'us-east-1' });
  assert.deepEqual(logScopeForResource(db, application, resources[1]), { profileId: 'k8s:orders-prod', region: 'payments' });

  const reads = [];
  const cache = {
    async intelligenceFor(scope) {
      reads.push(scope);
      return summary(scope.profileId.startsWith('k8s:') ? 3 : 8, 100);
    },
  };
  const result = await loadApplicationSignals({ apmDatabase: db, application, cache });

  assert.deepEqual(reads, [
    { profileId: 'aws:production', region: 'us-east-1', logGroup: '/aws/lambda/checkout-api' },
    { profileId: 'k8s:orders-prod', region: 'payments', logGroup: 'payments/deployments/orders-worker' },
  ]);
  assert.deepEqual(result.evidence.signals.map(signal => [signal.resourceId, signal.errorRateHigh]), [
    ['aws-api', true], ['kube-deployment', true],
  ]);
});

test('unbound provider scopes do not read cached logs with another profile', async () => {
  const db = database();
  db.listScopeBindings = () => [];
  const reads = [];
  const result = await loadApplicationSignals({
    apmDatabase: db,
    application,
    cache: { async intelligenceFor(scope) { reads.push(scope); return null; } },
  });
  assert.deepEqual(reads, [
    { profileId: 'k8s:orders-prod', region: 'payments', logGroup: 'payments/deployments/orders-worker' },
  ]);
  assert.deepEqual(result.evidence.uncachedResourceIds, ['kube-deployment']);
});

test('product log analysis exposes per-resource summaries without raw log payloads', async () => {
  const db = database();
  const analysis = await productLogAnalysis({
    apmDatabase: db,
    application,
    cache: { async intelligenceFor() { return summary(5, 100); } },
  });
  assert.equal(analysis.resourceLogs.length, 2);
  assert.deepEqual(analysis.uncachedLogResources, []);
  assert.deepEqual(analysis.dependencies, []);
});

test('application log history aggregates scoped buckets and signature comparisons', async () => {
  const db = database();
  const end = Date.parse('2026-10-07T12:00:00.000Z');
  const reads = [];
  const cache = {
    async histogram(scope) {
      reads.push(scope);
      return {
        coverage: { coverageFrom: end - 48 * 60 * 60 * 1000, syncedUntil: end, lastSyncAt: end - 60_000 },
        buckets: [{ start: end - 30 * 60 * 1000, error: 8, warn: 2, info: 90 }],
      };
    },
    async signatureCounts({ profileId }) {
      const isKube = profileId.startsWith('k8s:');
      return [{ signature: 'database timeout', occurrences: isKube ? 4 : 6 }];
    },
  };
  const history = await applicationLogHistory({ apmDatabase: db, application, cache, from: end - 90 * 24 * 60 * 60 * 1000, to: end });

  assert.deepEqual(reads, [
    { profileId: 'aws:production', region: 'us-east-1', logGroup: '/aws/lambda/checkout-api', from: end - 30 * 24 * 60 * 60 * 1000, to: end, binMs: 30 * 60 * 1000 },
    { profileId: 'k8s:orders-prod', region: 'payments', logGroup: 'payments/deployments/orders-worker', from: end - 30 * 24 * 60 * 60 * 1000, to: end, binMs: 30 * 60 * 1000 },
  ]);
  assert.equal(history.points.length, 1);
  assert.equal(history.points[0].errorRatePercent, 8);
  assert.equal(history.points[0].warningRatePercent, 2);
  assert.equal(history.health.signatures[0].currentOccurrences, 10);
  assert.equal(history.coverage.sources.length, 2);
  assert.equal(history.coverage.limitedToDays, 30);
});

test('application log history skips signature growth when either 24-hour window lacks coverage', async () => {
  const db = database();
  const end = Date.parse('2026-10-07T12:00:00.000Z');
  let signatureReads = 0;
  const cache = {
    async histogram() {
      return {
        coverage: { coverageFrom: end - 24 * 60 * 60 * 1000, syncedUntil: end, lastSyncAt: end - 60_000 },
        buckets: [{ start: end - 30 * 60 * 1000, error: 8, warn: 2, info: 90 }],
      };
    },
    async signatureCounts() { signatureReads += 1; return [{ signature: 'database timeout', occurrences: 12 }]; },
  };
  const history = await applicationLogHistory({ apmDatabase: db, application, cache, from: end - 2 * 24 * 60 * 60 * 1000, to: end });

  assert.equal(history.health.errorRatePercent, 8);
  assert.deepEqual(history.health.signatures, []);
  assert.equal(signatureReads, 0);
});
