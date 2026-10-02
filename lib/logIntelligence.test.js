'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createLogCache } = require('./awsLogCache');
const { buildLogEvidence, linkedApmResources, logGroupsForResource } = require('./logIntelligenceEvidence');

const NOW = Date.UTC(2026, 9, 1, 12);
const MIN = 60 * 1000;
const scope = { profileId: 'p1', region: 'us-east-1', logGroup: '/aws/lambda/orders' };

function cacheWith(options = {}) {
  let now = NOW;
  const cache = createLogCache({ dataDir: ':memory:', now: () => now, ...options });
  cache.enable(scope);
  return { cache, setNow: value => { now = value; } };
}

test('ingest sanitizes stored events and aggregates rates, signatures, keywords and references', async () => {
  const hooked = [];
  const { cache } = cacheWith({ onIngest: [async args => { hooked.push(args.events.length); }] });
  const inserted = await cache.ingest({ ...scope, events: [
    { eventId: '1', timestamp: NOW - 3 * MIN, message: 'ERROR db timeout for user ana@example.com password=hunter2 id 42' },
    { eventId: '2', timestamp: NOW - 2 * MIN, message: 'ERROR db timeout for user bob@example.com password=x id 77' },
    { eventId: '3', timestamp: NOW - 1 * MIN, message: '{"level":"warn","msg":"slow call to arn:aws:dynamodb:us-east-1:111111111111:table/orders"}' },
    { eventId: '4', timestamp: NOW - 1 * MIN, message: 'START RequestId: x' },
  ] });
  assert.equal(inserted, 4);
  assert.deepEqual(hooked, [4]);
  assert.equal(await cache.ingest({ ...scope, events: [{ eventId: '1', timestamp: NOW - 3 * MIN, message: 'ERROR db timeout for user ana@example.com password=hunter2 id 42' }] }), 0, 'duplicates are not re-analyzed');

  const stored = await cache.query({ ...scope, text: 'password' });
  assert.ok(stored.every(event => !event.message.includes('hunter2') && !event.message.includes('@example.com')));

  const intel = await cache.intelligenceFor(scope);
  assert.deepEqual([intel.last24h.events, intel.last24h.errors, intel.last24h.warnings], [4, 2, 1]);
  assert.equal(intel.last24h.errorRatePercent, 50);
  assert.equal(intel.keywords24h.timeout, 2);
  assert.equal(intel.signatures[0].occurrences, 2, 'both errors share one signature');
  assert.equal(intel.signatures[0].level, 'error');
  assert.ok(!intel.signatures[0].sample.includes('hunter2'));
  assert.deepEqual(intel.references.map(r => [r.type, r.name]), [['dynamodb', 'orders']]);
  assert.equal(intel.cache.events, 4);
});

test('groups cached before the intelligence existed are analyzed on first read', async () => {
  const { cache } = cacheWith();
  await cache.insertEvents({ ...scope, events: [
    { eventId: 'a', timestamp: NOW - MIN, message: 'FATAL out of memory' },
    { eventId: 'b', timestamp: NOW - MIN, message: 'ok' },
  ] });
  const intel = await cache.intelligenceFor(scope);
  assert.equal(intel.last24h.events, 2);
  assert.equal(intel.keywords24h.out_of_memory, 1);
  assert.equal((await cache.intelligenceFor(scope)).eventsAnalyzed, 2, 'the backfill runs once');
});

test('removing a group from the cache clears its intelligence; aggregates expire after 30 days', async () => {
  const { cache, setNow } = cacheWith();
  await cache.ingest({ ...scope, events: [{ eventId: 'a', timestamp: NOW - MIN, message: 'ERROR x' }] });
  setNow(NOW + 31 * 24 * 60 * MIN);
  cache.prune();
  const later = await cache.intelligenceFor(scope);
  assert.equal(later.last7d.events, 0);
  assert.equal(later.signatures.length, 0);
  cache.disable(scope);
  assert.equal(await cache.intelligenceFor(scope), null);
  assert.deepEqual(await cache.intelligenceForScope({ profileId: 'p1', region: 'us-east-1' }), {});
});

test('buildLogEvidence maps cached groups to resources and keeps suggestions reviewable', () => {
  const resources = [
    { id: 'fn', type: 'lambda', name: 'orders', enabled: true },
    { id: 'tbl', type: 'dynamodb', name: 'orders', arn: 'arn:aws:dynamodb:us-east-1:111111111111:table/orders', enabled: true },
    { id: 'q', type: 'sqs', name: 'jobs', enabled: true },
    { id: 'svc', type: 'ecs', name: 'web', logGroup: '/ecs/web', enabled: true },
    { id: 'off', type: 'lambda', name: 'paused', enabled: false },
  ];
  const intel = {
    last24h: { events: 100, errors: 10, warnings: 0, errorRatePercent: 10 },
    keywords24h: { timeout: 3, cold_start: 5 },
    lastEventAt: NOW - MIN,
    cache: { lastSyncAt: NOW - MIN },
    signatures: [{ signature: 'ERROR db timeout', level: 'error', sample: 'ERROR db timeout', occurrences: 5, lastSeen: NOW - MIN }],
    references: [
      { kind: 'arn', type: 'dynamodb', name: 'orders', target: 'arn:aws:dynamodb:us-east-1:111111111111:table/orders', occurrences: 4 },
      { kind: 'sqs_url', type: 'sqs', name: 'jobs', target: 'sqs:us-east-1:1:jobs', occurrences: 1 },
      { kind: 'arn', type: 'sns', name: 'alerts', target: 'arn:aws:sns:us-east-1:1:alerts', occurrences: 2 },
      { kind: 'arn', type: 'lambda', name: 'orders', target: 'arn:aws:lambda:us-east-1:1:function:orders', occurrences: 9 },
    ],
  };
  const evidence = buildLogEvidence({
    application: { thresholds: { errorRatePercent: 5 } },
    resources,
    edges: [{ sourceResourceId: 'q', targetResourceId: 'fn' }],
    intelligenceByGroup: { '/aws/lambda/orders': intel },
    now: NOW,
  });
  assert.equal(evidence.signals.length, 1);
  assert.equal(evidence.signals[0].errorRateHigh, true);
  assert.deepEqual(evidence.signals[0].severeKeywords, { timeout: 3 });
  assert.deepEqual(evidence.uncachedResourceIds, ['svc']);
  assert.deepEqual(evidence.suggestions.map(s => [s.sourceResourceId, s.targetResourceId, s.relationType, s.confidence]), [['fn', 'tbl', 'uses', 0.75]]);
  assert.deepEqual(evidence.unresolvedReferences.map(r => r.name), ['alerts'], 'self references and connected pairs are skipped');
  assert.deepEqual(evidence.findings.map(f => f.code), ['log_error_rate_high', 'log_recurring_errors', 'log_failure_keywords', 'logs_not_cached', 'log_references_outside_app']);
});

test('logGroupsForResource and linkedApmResources use explicit or Lambda default log groups', () => {
  assert.deepEqual(logGroupsForResource({ type: 'lambda', name: 'a' }), ['/aws/lambda/a']);
  assert.deepEqual(logGroupsForResource({ type: 'lambda', name: 'a', logGroup: '/custom/a' }), ['/custom/a', '/aws/lambda/a']);
  const database = {
    listApplications: () => [{ id: 'app', name: 'orders', environment: 'prod' }],
    listResources: () => [{ id: 'r', type: 'lambda', name: 'a' }, { id: 's', type: 'sqs', name: 'q' }],
  };
  assert.deepEqual(linkedApmResources({ database, profileId: 'p', region: 'r', logGroup: '/aws/lambda/a' }),
    [{ applicationId: 'app', applicationName: 'orders', environment: 'prod', resourceId: 'r', resourceName: 'a', type: 'lambda' }]);
});
