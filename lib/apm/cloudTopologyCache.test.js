'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createCloudTopologyCache, resourceSignature } = require('./cloudTopologyCache');

const application = { id: 'app-1', profileId: 'p1', region: 'us-east-1' };
const resources = [
  { id: 'flow', type: 'stepfunctions', arn: 'arn:flow' },
  { id: 'worker', type: 'lambda', arn: 'arn:worker' },
];
const evidence = {
  requests: 1, unresolvedReferences: [], failedResources: [],
  suggestions: [
    { sourceResourceId: 'flow', targetResourceId: 'worker', relationType: 'invokes' },
    { sourceResourceId: 'worker', targetResourceId: 'flow', relationType: 'triggers' },
  ],
};

test('the signature ignores order and changes with resources, ARNs, profile and region', () => {
  const base = resourceSignature(application, resources);
  assert.equal(resourceSignature(application, [...resources].reverse()), base);
  assert.notEqual(resourceSignature(application, resources.slice(1)), base);
  assert.notEqual(resourceSignature(application, [resources[0], { ...resources[1], arn: 'arn:other' }]), base);
  assert.notEqual(resourceSignature({ ...application, region: 'eu-west-1' }, resources), base);
  assert.notEqual(resourceSignature({ ...application, profileId: 'p2' }, resources), base);
});

test('a stored analysis is current, then expired, and its confirmed pairs are filtered on read', () => {
  let clock = 1_000_000;
  const cache = createCloudTopologyCache({ ttlMs: 1000, now: () => clock });
  assert.equal(cache.read(application, resources, []), null);
  cache.store(application, resources, evidence);

  const current = cache.read(application, resources, [{ sourceResourceId: 'flow', targetResourceId: 'worker', relationType: 'depends_on' }]);
  assert.equal(current.state, 'current');
  assert.equal(current.analyzedAt, new Date(1_000_000).toISOString());
  assert.deepEqual(current.suggestions.map(item => item.relationType), ['triggers']);
  assert.equal(evidence.suggestions.length, 2, 'the stored evidence is not mutated');

  clock += 1001;
  assert.equal(cache.read(application, resources, []).state, 'expired');
});

test('changed resources make the analysis stale, with no suggestions', () => {
  const cache = createCloudTopologyCache();
  cache.store(application, resources, evidence);
  const stale = cache.read(application, [...resources, { id: 'queue', type: 'sqs', arn: 'arn:queue' }], []);
  assert.equal(stale.state, 'stale');
  assert.deepEqual(stale.suggestions, []);
  cache.forget(application.id);
  assert.equal(cache.read(application, resources, []), null);
});
