'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  EXAMPLES,
  legacyApplicationContext,
  normalizeApplicationContext,
  normalizeScope,
  portableResourceIdentity,
} = require('./applicationContract');

test('the documented examples are valid contexts', () => {
  for (const [name, example] of Object.entries(EXAMPLES)) {
    const context = normalizeApplicationContext(example);
    assert.equal(context.scopes.length, example.scopes.length, name);
    assert.equal(context.contractVersion, 1);
  }
});

test('an application needs a name but no provider, profile or scope', () => {
  const context = normalizeApplicationContext({ name: 'Checkout' });
  assert.deepEqual(context.scopes, []);
  assert.equal(context.id, null);
  assert.throws(() => normalizeApplicationContext({ name: ' ' }), /name is required/);
  assert.throws(() => normalizeApplicationContext({ name: 'A', contractVersion: 9 }), /Unsupported application contract/);
});

test('scopes are portable: local profiles are dropped and duplicates collapse', () => {
  const context = normalizeApplicationContext({
    name: 'Orders',
    scopes: [
      { provider: 'AWS', scopeId: '111111111111', location: 'us-east-1', profileId: 'prod-admin' },
      { provider: 'aws', scopeId: '111111111111', location: 'US-EAST-1' },
      { provider: 'aws', scopeId: '111111111111', location: 'eu-west-1' },
    ],
  });
  assert.equal(context.scopes.length, 2);
  assert.equal(JSON.stringify(context).includes('prod-admin'), false);
});

test('provider ids are open to plugins but validated by shape', () => {
  assert.equal(normalizeScope({ provider: 'zabbix', scopeId: 'noc' }).provider, 'zabbix');
  assert.equal(normalizeScope({ provider: 'github', scopeId: 'org/repo' }).provider, 'github');
  assert.throws(() => normalizeScope({ provider: '../etc' }), /Invalid provider/);
  assert.throws(() => normalizeScope({ provider: '' }), /Invalid provider/);
});

test('resource identity v2 ignores the profile and the display name', () => {
  const base = { provider: 'aws', scopeId: '111111111111', location: 'us-east-1', resourceType: 'lambda', nativeIdentifier: 'arn:aws:lambda:us-east-1:111111111111:function:orders' };
  const a = portableResourceIdentity({ ...base, profileId: 'laptop-profile', displayName: 'Orders' });
  const b = portableResourceIdentity({ ...base, profileId: 'team-sso', displayName: 'orders-api' });
  assert.equal(a.id, b.id);
  assert.equal(a.identityVersion, 2);
  assert.equal(a.identityKey.includes('profile'), false);
});

test('resource identity v2 keeps different scopes apart', () => {
  const base = { provider: 'kubernetes', location: '', resourceType: 'deployment', nativeIdentifier: 'orders/deployment/api' };
  assert.notEqual(
    portableResourceIdentity({ ...base, scopeId: 'staging' }).id,
    portableResourceIdentity({ ...base, scopeId: 'production' }).id,
  );
});

test('legacy AWS application maps to the scopes of its resources and binds its profile', () => {
  const application = { id: 'app-1', provider: 'aws', profileId: 'prod', region: 'us-east-1', name: 'Orders', architectureProjectId: 'project-1' };
  const { context, bindings } = legacyApplicationContext(application, {
    resources: [
      { type: 'lambda', arn: 'arn:aws:lambda:us-east-1:111111111111:function:orders', key: 'orders', provider: 'aws' },
      { type: 'sqs', arn: 'arn:aws:sqs:eu-west-1:222222222222:events', key: 'events', provider: 'aws' },
      { type: 'kubernetes', kind: 'Deployment', key: 'eks-prod/orders/deployment/api', kubeContext: 'eks-prod', provider: 'aws' },
    ],
    architectureProjectIds: ['project-1', 'project-2'],
  });
  assert.deepEqual(context.scopes.map(scope => [scope.provider, scope.scopeId, scope.location]), [
    ['aws', '111111111111', 'us-east-1'],
    ['aws', '222222222222', 'eu-west-1'],
    ['kubernetes', 'eks-prod', ''],
  ]);
  assert.deepEqual(context.views.architectureProjectIds, ['project-1', 'project-2']);
  // The kube context is not reached through the AWS profile.
  assert.equal(bindings.length, 2);
  assert.ok(bindings.every(binding => binding.profileId === 'prod' && binding.status === 'migrated'));
});

test('legacy application without resources keeps an unverified primary scope', () => {
  const { context, bindings } = legacyApplicationContext({ id: 'app-2', provider: 'gcp', profileId: 'gcp-main', region: 'us-central1', name: 'Search' });
  assert.deepEqual(context.scopes.map(scope => [scope.provider, scope.scopeId, scope.location]), [['gcp', '', 'us-central1']]);
  assert.deepEqual(bindings.map(binding => binding.status), ['unverified']);
});
