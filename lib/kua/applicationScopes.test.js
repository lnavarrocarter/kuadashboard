'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ApmDatabase } = require('../apm/database');
const { ArchitectureDatabase } = require('../architecture/database');
const { ApplicationRegistryService } = require('./applicationRegistryService');
const { ApplicationScopeService, legacyApplicationContext } = require('./applicationScopes');

function fixture({ schemaVersion } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kua-scopes-'));
  const filePath = path.join(directory, 'apm.sqlite3');
  const architectureDatabase = new ArchitectureDatabase({ filePath: ':memory:' });
  const subject = {
    architectureDatabase,
    open(options = {}) {
      subject.database = new ApmDatabase({ filePath, now: () => Date.UTC(2026, 9, 6, 12), ...options });
      subject.registry = new ApplicationRegistryService({ database: subject.database, architectureDatabase });
      subject.scopes = new ApplicationScopeService({ database: subject.database, architectureDatabase, registry: subject.registry });
      return subject.database;
    },
    close() {
      subject.database?.close();
      architectureDatabase.close();
      fs.rmSync(directory, { recursive: true, force: true });
    },
  };
  subject.open(schemaVersion ? { schemaVersion } : {});
  return subject;
}

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

test('legacy resources without an account fall into the primary scope; generic is never a resource scope', () => {
  const aws = legacyApplicationContext({ id: 'app-4', provider: 'aws', profileId: 'prod', region: 'us-east-1', name: 'Billing' }, {
    resources: [
      { type: 's3', key: 'billing-assets', provider: 'aws' },
      { type: 'lambda', key: 'billing-api', provider: 'aws' },
      { type: 'cloudfront', key: 'E123', provider: 'aws' },
    ],
  });
  assert.deepEqual(aws.context.scopes.map(scope => [scope.provider, scope.scopeId, scope.location]), [['aws', '', 'us-east-1']]);
  assert.deepEqual(aws.bindings.map(binding => binding.status), ['unverified']);

  const generic = legacyApplicationContext({ id: 'app-5', provider: 'generic', profileId: 'local', region: 'us-east-1', name: 'J360' }, {
    resources: [{ type: 'kubernetes', kind: 'Deployment', key: 'prod/api/deployment/api', kubeContext: 'prod', provider: 'generic' }],
  });
  assert.deepEqual(generic.context.scopes.map(scope => [scope.provider, scope.scopeId]), [['kubernetes', 'prod']]);
  assert.deepEqual(generic.bindings, [], 'the kube context is not reached through the generic profile');
});

test('legacy mapping of a provider-less application has no scopes or bindings', () => {
  const { context, bindings } = legacyApplicationContext({ id: 'app-3', name: 'Checkout', environment: '', team: '' });
  assert.deepEqual(context.scopes, []);
  assert.deepEqual(bindings, []);
});

test('upgrading a v20 database keeps applications and their references, and drops the name uniqueness', () => {
  const subject = fixture({ schemaVersion: 20 });
  try {
    const now = new Date().toISOString();
    subject.database.db.prepare(`INSERT INTO apm_applications (id, profile_id, region, name, environment, team, polling_enabled,
      poll_interval_minutes, created_at, updated_at, thresholds_json, provider, architecture_project_id)
      VALUES ('app-1', 'prod', 'us-east-1', 'Orders', 'production', 'Platform', 1, 30, ?, ?, '{"errorRatePercent":7}', 'aws', 'project-1')`).run(now, now);
    subject.database.db.prepare(`INSERT INTO apm_resources (id, application_id, provider, resource_type, resource_key, arn, name,
      association_source, created_at, updated_at) VALUES ('res-1', 'app-1', 'aws', 'lambda', 'orders',
      'arn:aws:lambda:us-east-1:111111111111:function:orders', 'orders', 'manual', ?, ?)`).run(now, now);
    subject.database.close();

    const database = subject.open();
    const application = database.getApplication('app-1');
    assert.equal(application.provider, 'aws');
    assert.equal(application.profileId, 'prod');
    assert.equal(application.thresholds.errorRatePercent, 7);
    assert.equal(application.architectureProjectId, 'project-1');
    assert.equal(application.revision, 0);
    assert.equal(database.listResources('app-1').length, 1);
    // Same legacy shape and name: allowed now, the id is the identity.
    assert.doesNotThrow(() => database.createApplication({ provider: 'aws', profileId: 'prod', region: 'us-east-1', name: 'Orders', environment: 'production' }));
    database.deleteApplication('app-1');
    assert.equal(database.listResources('app-1').length, 0, 'resources still cascade with their application');
  } finally { subject.close(); }
});

test('a KUA Application can be created without provider, profile or region', () => {
  const subject = fixture();
  try {
    const application = subject.database.createApplication({ name: 'Checkout', environment: 'staging', team: 'Payments', pollingEnabled: true });
    assert.equal(application.provider, null);
    assert.equal(application.profileId, null);
    assert.equal(application.region, null);
    assert.equal(application.pollingEnabled, false, 'nothing to collect without a scope binding');
    assert.equal(subject.database.listApplications({ profileId: 'prod' }).length, 0, 'not listed under a profile');
    assert.throws(() => subject.database.createApplication({ provider: 'aws', name: 'Half legacy' }), /profileId, region and name/);
    assert.throws(() => subject.database.createApplication({ name: '' }), /name is required/);
  } finally { subject.close(); }
});

test('scopes are added once and move the revision; bindings keep user decisions', () => {
  const subject = fixture();
  try {
    const { database } = subject;
    const application = database.createApplication({ name: 'Checkout' });
    const scope = { key: 'kua-scope:a', provider: 'aws', scopeId: '111111111111', location: 'us-east-1', label: '' };
    assert.equal(database.addApplicationScope(application.id, scope), true);
    assert.equal(database.addApplicationScope(application.id, scope), false);
    assert.equal(database.getApplication(application.id).revision, 1);

    database.setScopeBinding(application.id, scope.key, { profileId: 'team-sso', status: 'verified' });
    database.setScopeBinding(application.id, scope.key, { profileId: 'legacy', status: 'migrated' }, { onlyIfMissing: true });
    assert.equal(database.getScopeBinding(application.id, scope.key).profileId, 'team-sso');

    assert.equal(database.removeApplicationScope(application.id, scope.key), true);
    assert.equal(database.getScopeBinding(application.id, scope.key), null, 'a binding goes with its scope');
    assert.equal(database.getApplication(application.id).revision, 2);
  } finally { subject.close(); }
});

test('migrate() gives legacy applications their scopes and bindings, idempotently', () => {
  const subject = fixture();
  try {
    const { database } = subject;
    const application = database.createApplication({ provider: 'aws', profileId: 'prod', region: 'us-east-1', name: 'Orders' });
    database.addResource(application.id, { type: 'lambda', key: 'orders', arn: 'arn:aws:lambda:us-east-1:111111111111:function:orders', name: 'orders' });
    database.addResource(application.id, { type: 'kubernetes', key: 'eks-prod/orders/deployment/api', kubeContext: 'eks-prod', namespace: 'orders', kind: 'Deployment', name: 'api' });

    assert.equal(subject.scopes.migrate().scopesAdded, 2);
    assert.equal(subject.scopes.migrate().scopesAdded, 0);
    const scopes = database.listApplicationScopes(application.id);
    assert.deepEqual(scopes.map(scope => [scope.provider, scope.scopeId]), [['aws', '111111111111'], ['kubernetes', 'eks-prod']]);
    const bindings = database.listScopeBindings(application.id);
    assert.deepEqual(bindings.map(binding => [binding.profileId, binding.status]), [['prod', 'migrated']]);
  } finally { subject.close(); }
});

test('registry v1 rows are replaced by identity v2 and merged resources are recorded', () => {
  const subject = fixture();
  try {
    const { database } = subject;
    const arn = 'arn:aws:lambda:us-east-1:111111111111:function:orders';
    const a = database.createApplication({ provider: 'aws', profileId: 'laptop', region: 'us-east-1', name: 'Orders' });
    const b = database.createApplication({ provider: 'aws', profileId: 'team-sso', region: 'us-east-1', name: 'Orders shared' });
    database.addResource(a.id, { type: 'lambda', key: 'orders', arn, name: 'orders' });
    database.addResource(b.id, { type: 'lambda', key: 'orders', arn, name: 'orders' });
    // What v1 stored: one row per profile for the same function.
    for (const [application, profile] of [[a, 'laptop'], [b, 'team-sso']]) {
      const identityKey = JSON.stringify(['aws', profile, '111111111111', 'us-east-1', 'lambda', arn]);
      const id = `kua-resource:v1-${profile}`;
      database.upsertRegistryResource({ id, identityKey, provider: 'aws', profileId: profile, scopeId: '111111111111', location: 'us-east-1', nativeIdentifier: arn, resourceType: 'lambda', displayName: 'orders' });
      database.addRegistryMembership({ applicationId: application.id, resourceId: id, sourceKind: 'apm_resource', sourceReference: 'legacy' });
    }

    const result = subject.scopes.migrateRegistryIdentities();
    assert.equal(result.removed, 2);
    assert.equal(result.merged, 1);
    assert.deepEqual(result.failed, []);
    assert.equal(database.listLegacyRegistryResources().length, 0);
    const [ra] = database.listRegistryResources(a.id);
    const [rb] = database.listRegistryResources(b.id);
    assert.equal(ra.id, rb.id, 'one resource for both profiles');
    assert.match(ra.identityKey, /^\["v2",/);
    assert.deepEqual(database.listRegistryIdentityMerges().map(merge => merge.applicationIds), [[a.id, b.id].sort()]);
    assert.equal(subject.scopes.migrateRegistryIdentities().migrated, false, 'nothing left to migrate');
  } finally { subject.close(); }
});

test('migration report lists what needs a decision, most severe first', () => {
  const subject = fixture();
  try {
    const { database, architectureDatabase } = subject;
    const linked = database.createApplication({ provider: 'aws', profileId: 'prod', region: 'us-east-1', name: 'Orders' });
    const other = database.createApplication({ provider: 'aws', profileId: 'dev', region: 'us-east-1', name: 'Orders' });
    database.createApplication({ name: 'Checkout' });
    const mismatched = architectureDatabase.createProject({ profileId: 'other-profile', name: 'orders-view' });
    architectureDatabase.createProject({ profileId: 'prod', name: 'orphan-view' });
    database.updateArchitectureProjectLink(linked.id, mismatched.id);
    database.updateArchitectureProjectLink(other.id, mismatched.id);
    database.updateArchitectureProjectLink(other.id, 'missing-project');
    subject.scopes.migrate();
    const scope = database.listApplicationScopes(linked.id)[0];
    database.setScopeBinding(linked.id, scope.key, { profileId: 'prod', status: 'mismatch' });

    const report = subject.scopes.migrationReport();
    const kinds = report.findings.map(finding => finding.kind);
    assert.equal(report.providerLessApplications, 1);
    assert.equal(kinds[0], 'scope_mismatch');
    for (const kind of ['broken_view_link', 'view_profile_mismatch', 'view_shared_by_applications', 'view_without_application', 'duplicate_name', 'application_without_view', 'scope_unverified']) {
      assert.ok(kinds.includes(kind), kind);
    }
    assert.equal(JSON.stringify(report).includes('"profileId"'), false, 'the report names scopes, not profiles');
  } finally { subject.close(); }
});

test('upgrading from v22 reconciles once so existing resources get their account and region', () => {
  const subject = fixture({ schemaVersion: 22 });
  try {
    const now = new Date().toISOString();
    subject.database.db.prepare(`INSERT INTO apm_applications (id, provider, profile_id, region, name, created_at, updated_at)
      VALUES ('app-22', 'aws', 'local:prod', 'us-east-1', 'Orders', ?, ?)`).run(now, now);
    subject.database.close();
    subject.open();
    assert.equal(subject.database.migratedFrom, 22);
    assert.equal(subject.scopes.migrate().refreshed, 1);
    subject.database.close();
    subject.open();
    assert.equal(subject.scopes.migrate().refreshed, 0, 'only once');
  } finally { subject.close(); }
});
