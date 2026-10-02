'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { recommend, deniedActions } = require('./logRecommendations');
const { createLogCache } = require('./awsLogCache');

const NOW = Date.UTC(2026, 9, 1, 12);
const MIN = 60 * 1000;

function intel(overrides = {}) {
  return {
    last24h: { events: 0, errors: 0 }, last7d: { events: 0, errors: 0 },
    categories24h: {}, categories7d: {}, sensitive24h: {}, sensitive7d: {}, jsonEvents7d: 0,
    signatures: [], references: [], ...overrides,
  };
}

test('deniedActions extracts IAM actions and resources from access-denied samples', () => {
  const result = deniedActions([
    { category: 'access_denied', sample: 'User: arn:aws:sts::1:assumed-role/fn is not authorized to perform: dynamodb:PutItem on resource: arn:aws:dynamodb:us-east-1:1:table/orders' },
    { category: 'timeout', sample: 'perform: s3:GetObject' },
  ]);
  assert.deepEqual(result, { actions: ['dynamodb:PutItem'], resources: ['arn:aws:dynamodb:us-east-1:1:table/orders'] });
});

test('fix recommendations follow the categories found, with evidence, confidence and actions', () => {
  const recs = recommend(intel({
    last7d: { events: 100, errors: 40 },
    categories7d: { timeout: 30, access_denied: 2, throttling: 1 },
    categories24h: { timeout: 10 },
    signatures: [
      { signature: 'Task timed out after <n> seconds', category: 'timeout', occurrences: 30, sample: 'Task timed out after 3.00 seconds' },
      { signature: 'not authorized to perform: sqs:SendMessage', category: 'access_denied', occurrences: 2, sample: 'is not authorized to perform: sqs:SendMessage on resource: arn:aws:sqs:us-east-1:1:jobs' },
    ],
  }), { logGroup: '/aws/lambda/orders', service: 'lambda', retentionInDays: 14 }, { categoryQuery: category => `q:${category}` });
  const byId = Object.fromEntries(recs.map(r => [r.id, r]));
  assert.equal(recs[0].severity, 'high', 'sorted by severity');
  assert.ok(byId.fix_timeout_lambda);
  assert.equal(byId.fix_timeout_lambda.confidence, 0.9);
  assert.equal(byId.fix_timeout_lambda.evidence.signatures[0].occurrences, 30);
  assert.deepEqual(byId.fix_timeout_lambda.actions.slice(0, 2), [{ type: 'filter', category: 'timeout' }, { type: 'query', query: 'q:timeout' }]);
  assert.equal(byId.fix_access_denied_actions.params.actions, 'sqs:SendMessage');
  const policy = JSON.parse(byId.fix_access_denied_actions.actions.find(a => a.language === 'json').code);
  assert.deepEqual(policy.Statement[0], { Effect: 'Allow', Action: ['sqs:SendMessage'], Resource: ['arn:aws:sqs:us-east-1:1:jobs'] });
  assert.ok(byId.fix_throttling.actions.some(a => a.type === 'snippet' && a.language === 'python'));
  assert.equal(byId.cost_retention, undefined, 'retention is set');
});

test('sensitive data produces sanitize-at-source and data protection recommendations', () => {
  const recs = recommend(intel({ sensitive7d: { email: 12, password: 2, ip_address: 40 } }), { logGroup: '/app/web', retentionInDays: 30 });
  const source = recs.find(r => r.id === 'sanitize_at_source');
  assert.equal(source.severity, 'high');
  assert.equal(source.params.count, 54);
  const policy = recs.find(r => r.id === 'sanitize_data_protection_policy');
  const document = JSON.parse(policy.actions.find(a => a.language === 'json').code);
  assert.deepEqual(document.Statement[1].DataIdentifier, [
    'arn:aws:dataprotection::aws:data-identifier/EmailAddress',
    'arn:aws:dataprotection::aws:data-identifier/IpAddress',
  ]);
  assert.match(policy.actions.find(a => a.language === 'shell').code, /put-data-protection-policy --log-group-identifier "\/app\/web"/);
});

test('practice and cost recommendations: client errors, structure, debug noise and retention', () => {
  const recs = recommend(intel({
    last7d: { events: 1000, errors: 100 },
    categories7d: { validation: 60, not_found: 10, debug: 400, info: 500 },
    jsonEvents7d: 50,
  }), { logGroup: '/aws/lambda/api', service: 'lambda', retentionInDays: null });
  const ids = recs.map(r => r.id);
  assert.ok(ids.includes('practice_client_errors_level'));
  assert.ok(ids.includes('practice_structured_lambda'));
  assert.ok(ids.includes('practice_debug_noise_lambda'));
  assert.ok(ids.includes('cost_retention'));
  assert.deepEqual(recommend(intel(), { logGroup: '/x', retentionInDays: 7 }), [], 'quiet groups get no recommendations');
});

test('the cache exposes categories, sensitive findings, recommendations and filtered events', async () => {
  const scope = { profileId: 'p', region: 'us-east-1', logGroup: '/aws/lambda/orders' };
  const cache = createLogCache({ dataDir: ':memory:', now: () => NOW });
  cache.enable({ ...scope, retentionInDays: null });
  await cache.ingest({ ...scope, events: [
    { eventId: '1', timestamp: NOW - 5 * MIN, message: 'ERROR Task timed out after 3.00 seconds' },
    { eventId: '2', timestamp: NOW - 4 * MIN, message: 'ERROR Task timed out after 3.00 seconds' },
    { eventId: '3', timestamp: NOW - 3 * MIN, message: 'INFO login ok for ana@corp.io' },
    { eventId: '4', timestamp: NOW - 2 * MIN, message: 'WARN invalid request body' },
    { eventId: '5', timestamp: NOW - 1 * MIN, message: 'START RequestId: abc' },
  ] });
  const result = await cache.intelligenceFor(scope);
  assert.deepEqual(result.categories7d, { timeout: 2, info: 1, validation: 1, platform: 1 });
  assert.deepEqual(result.sensitive7d, { email: 1 });
  assert.equal(result.signatures[0].category, 'timeout');
  const ids = result.recommendations.map(r => r.id);
  assert.ok(ids.includes('fix_timeout_lambda'));
  assert.ok(ids.includes('sanitize_at_source'));
  assert.ok(ids.includes('cost_retention'));

  const timeouts = await cache.filterEvents({ ...scope, category: 'timeout' });
  assert.deepEqual(timeouts.events.map(e => [e.category, e.level]), [['timeout', 'error'], ['timeout', 'error']]);
  assert.equal((await cache.filterEvents({ ...scope, level: 'warn' })).events[0].message, 'WARN invalid request body');
  const bySignature = await cache.filterEvents({ ...scope, signature: result.signatures[0].signature });
  assert.equal(bySignature.events.length, 2);
  assert.ok(timeouts.blocksRead >= 1);
});
