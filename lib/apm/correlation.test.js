'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  applicationIdentityFromAwsTags,
  applicationIdentityFromKubeLabels,
  correlateResource,
  discoverResourceCandidates,
  suggestNameCandidates,
} = require('./correlation');

test('uses case-insensitive AWS tag priority and reports conflicts', () => {
  assert.deepEqual(applicationIdentityFromAwsTags({
    APPLICATION: 'orders',
    app: 'legacy-orders',
    SERVICE: 'checkout',
    Environment: 'prod',
    TEAM: 'payments',
  }), {
    application: 'orders',
    service: 'checkout',
    environment: 'prod',
    team: 'payments',
    source: 'tags',
    status: 'pending',
    candidates: ['orders', 'legacy-orders'],
  });
});

test('uses Kubernetes label priority and accepts AWS tag arrays', () => {
  const kubernetes = applicationIdentityFromKubeLabels({
    'app.kubernetes.io/name': 'billing',
    environment: 'dev',
  });
  const aws = applicationIdentityFromAwsTags([
    { Key: 'app-id', Value: 'billing' },
    { Key: 'team', Value: 'platform' },
  ]);
  assert.equal(kubernetes.application, 'billing');
  assert.equal(kubernetes.status, 'matched');
  assert.equal(aws.application, 'billing');
  assert.equal(aws.team, 'platform');
});

test('manual association always wins over conflicting metadata', () => {
  assert.deepEqual(correlateResource({
    manualApplication: 'confirmed-orders',
    tags: { Application: 'orders', app: 'other' },
  }), {
    application: 'confirmed-orders',
    service: '',
    environment: '',
    team: '',
    source: 'manual',
    status: 'matched',
    candidates: ['confirmed-orders'],
  });
});

test('name similarity only returns suggestions with scores', () => {
  const suggestions = suggestNameCandidates('orders-api-prod', [
    { id: 'orders', name: 'orders api' },
    { id: 'billing', name: 'billing worker' },
  ]);
  assert.deepEqual(suggestions, [{ application: { id: 'orders', name: 'orders api' }, score: 2 / 3 }]);
});

test('discovers metadata membership and name-only suggestions without raw metadata', () => {
  const applications = [
    { id: 'orders', name: 'orders api', environment: 'dev', team: 'checkout' },
    { id: 'payments', name: 'payments', environment: 'dev', team: 'checkout' },
  ];
  const results = discoverResourceCandidates([
    { type: 'lambda', name: 'worker', tags: { Application: 'orders' } },
    {
      type: 'lambda', name: 'conflicted',
      tags: [{ Key: 'Application', Value: 'orders' }, { Key: 'app', Value: 'payments' }],
    },
    { type: 'lambda', name: 'orders-api-handler' },
  ], applications);

  assert.equal(results[0].status, 'matched');
  assert.equal(results[0].suggestions[0].source, 'tags');
  assert.equal(results[1].status, 'pending');
  assert.equal(results[2].status, 'suggested');
  assert.equal(results[2].suggestions[0].source, 'name');
  assert.equal('tags' in results[0], false);
});