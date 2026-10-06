'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { ApmDatabase } = require('../apm/database');
const { ApplicationScopeService } = require('./applicationScopes');
const { ArchitectureDatabase } = require('../architecture/database');
const { KuaApplicationService } = require('./applicationService');
const { createScopeVerifier } = require('./scopeVerifier');

function fixture() {
  const database = new ApmDatabase({ filePath: ':memory:' });
  const architectureDatabase = new ArchitectureDatabase({ filePath: ':memory:' });
  const audited = [];
  const verifier = createScopeVerifier({
    resolvers: {
      async aws(profileId) {
        if (profileId === 'broken') throw new Error('Local AWS profile not found: broken');
        return { identity: profileId === 'prod' ? '111111111111' : '222222222222' };
      },
    },
  });
  return {
    database,
    audited,
    scopes: new ApplicationScopeService({ database, architectureDatabase }),
    service: new KuaApplicationService({ database, verifier, audit: (...entry) => audited.push(entry) }),
    close() { database.close(); architectureDatabase.close(); },
  };
}

test('creates an application with no provider and several scopes', () => {
  const subject = fixture();
  try {
    const created = subject.service.create({
      name: 'Orders', environment: 'production', team: 'Platform',
      scopes: [
        { provider: 'aws', scopeId: '111111111111', location: 'us-east-1' },
        { provider: 'kubernetes', scopeId: 'eks-orders' },
        { provider: 'aws', scopeId: '111111111111', location: 'us-east-1' },
      ],
    });
    assert.equal(created.contractVersion, 1);
    assert.equal(created.scopes.length, 2);
    assert.equal(created.local.legacy, null);
    assert.deepEqual(created.warnings.map(warning => warning.kind), ['scope_unbound', 'scope_unbound']);
    assert.equal(subject.service.list().length, 1);
  } finally { subject.close(); }
});

test('writes with a stale expectedRevision are rejected', () => {
  const subject = fixture();
  try {
    const created = subject.service.create({ name: 'Orders' });
    const updated = subject.service.update(created.id, { team: 'Platform' }, { expectedRevision: created.revision });
    assert.equal(updated.revision, created.revision + 1);
    assert.throws(() => subject.service.update(created.id, { team: 'Other' }, { expectedRevision: created.revision }),
      error => error.statusCode === 409 && error.code === 'REVISION_CONFLICT' && error.revision === updated.revision);
    assert.throws(() => subject.service.addScope(created.id, { provider: 'gcp', scopeId: 'p' }, { expectedRevision: 0 }), /changed since/);
    assert.equal(subject.service.get(created.id).team, 'Platform');
  } finally { subject.close(); }
});

test('adding the same scope twice is idempotent', () => {
  const subject = fixture();
  try {
    const created = subject.service.create({ name: 'Orders' });
    const first = subject.service.addScope(created.id, { provider: 'aws', scopeId: '111111111111', location: 'us-east-1' });
    const again = subject.service.addScope(created.id, { provider: 'AWS', scopeId: '111111111111', location: 'us-east-1' });
    assert.equal(first.created, true);
    assert.equal(again.created, false);
    assert.equal(again.application.revision, first.application.revision);
    assert.throws(() => subject.service.addScope(created.id, { provider: '../x' }), /Invalid provider/);
  } finally { subject.close(); }
});

test('binding verifies the profile and reports mismatches and failures', async () => {
  const subject = fixture();
  try {
    const created = subject.service.create({ name: 'Orders', scopes: [{ provider: 'aws', scopeId: '111111111111', location: 'us-east-1' }] });
    const [scope] = created.scopes;
    assert.equal((await subject.service.bindScope(created.id, scope.key, 'prod')).status, 'verified');
    assert.equal((await subject.service.bindScope(created.id, scope.key, 'dev')).status, 'mismatch');
    const failed = await subject.service.bindScope(created.id, scope.key, 'broken');
    assert.equal(failed.status, 'unverified');
    assert.match(failed.application.local.bindings[0].lastError, /not found/);
    assert.equal(failed.application.revision, created.revision, 'bindings are local and do not move the revision');
    assert.ok(subject.audited.every(([, , details]) => !JSON.stringify(details).includes('broken')), 'the audit never names the profile');
  } finally { subject.close(); }
});

test('binding a scope without account completes it, and legacy sync does not bring the pending one back', async () => {
  const subject = fixture();
  try {
    const legacy = subject.database.createApplication({ provider: 'aws', profileId: 'prod', region: 'us-east-1', name: 'Billing' });
    subject.database.addResource(legacy.id, { type: 's3', key: 'billing-assets', name: 'billing-assets' });
    subject.scopes.migrate();
    const [pending] = subject.service.get(legacy.id).scopes;
    assert.equal(pending.scopeId, '');

    const result = await subject.service.bindScope(legacy.id, pending.key, 'prod');
    assert.equal(result.status, 'verified');
    assert.deepEqual(result.application.scopes.map(scope => [scope.scopeId, scope.location]), [['111111111111', 'us-east-1']]);
    assert.equal(result.application.local.bindings[0].scopeKey, result.scopeKey);

    subject.scopes.syncLegacyScopes(subject.database.getApplication(legacy.id));
    assert.equal(subject.service.get(legacy.id).scopes.length, 1);
  } finally { subject.close(); }
});

test('a scope that legacy resources live in cannot be removed; an empty one can', () => {
  const subject = fixture();
  try {
    const legacy = subject.database.createApplication({ provider: 'aws', profileId: 'prod', region: 'us-east-1', name: 'Orders' });
    subject.database.addResource(legacy.id, { type: 'lambda', key: 'orders', arn: 'arn:aws:lambda:us-east-1:111111111111:function:orders', name: 'orders' });
    subject.scopes.migrate();
    const [inUse] = subject.service.get(legacy.id).scopes;
    assert.throws(() => subject.service.removeScope(legacy.id, inUse.key), error => error.code === 'SCOPE_IN_USE');

    const extra = subject.service.addScope(legacy.id, { provider: 'gcp', scopeId: 'analytics' });
    const after = subject.service.removeScope(legacy.id, extra.scope.key);
    assert.equal(after.scopes.length, 1);
    assert.equal(subject.service.get(legacy.id).local.legacy.profileId, 'prod');
  } finally { subject.close(); }
});

test('unknown applications and scopes answer 404', async () => {
  const subject = fixture();
  try {
    assert.throws(() => subject.service.get('missing'), error => error.statusCode === 404);
    const created = subject.service.create({ name: 'Orders' });
    await assert.rejects(subject.service.bindScope(created.id, 'kua-scope:missing', 'prod'), error => error.code === 'SCOPE_NOT_FOUND');
    await assert.rejects(subject.service.verifyScope(created.id, 'kua-scope:missing'), error => error.statusCode === 404);
  } finally { subject.close(); }
});
