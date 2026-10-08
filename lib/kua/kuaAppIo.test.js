'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ArchitectureDatabase } = require('../architecture/database');
const { ApmDatabase } = require('../apm/database');
const { PostureStore } = require('../advisor/posture');
const { validateKuaAppBundle } = require('./kuaAppBundle');
const { createKuaAppIo, contentHash } = require('./kuaAppIo');

function fixture() {
  const database = new ArchitectureDatabase({ filePath: ':memory:' });
  const apmDatabase = new ApmDatabase({ filePath: ':memory:' });
  const io = createKuaAppIo({ database, apmDatabase });
  const posture = new PostureStore(apmDatabase.db);
  const application = apmDatabase.createApplication({ profileId: 'local:test', provider: 'aws', region: 'us-east-1', name: 'Orders' });
  return { database, apmDatabase, io, posture, application, close: () => { database.close(); apmDatabase.close(); } };
}

const FUTURE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

test('product Advisor acceptances travel in the bundle and are restored on import (#94)', () => {
  const subject = fixture();
  try {
    const scope = `product:${subject.application.id}`;
    subject.posture.accept({ scopeKey: scope, ruleId: 'product.no_staging', reason: 'Single environment by design', author: 'ana@example.com', expiresAt: FUTURE });
    const [revoked] = subject.posture.accept({ scopeKey: scope, ruleId: 'product.no_owner', reason: 'temporary' });
    subject.posture.revoke(revoked.id);

    const bundle = validateKuaAppBundle(JSON.parse(JSON.stringify(subject.io.exportBundle(subject.application))));
    assert.deepEqual(bundle.advisor.acceptances.map(item => [item.ruleId, item.kind, item.reason, item.author]), [['product.no_staging', 'accepted', 'Single environment by design', 'ana@example.com']]);
    assert.doesNotMatch(JSON.stringify(bundle.advisor), /product:|local:test/);

    const imported = subject.io.importBundle('local:other', bundle);
    const restored = subject.posture.list(`product:${imported.application.id}`);
    assert.deepEqual(restored.map(item => [item.ruleId, item.reason, item.author, item.expiresAt]), [['product.no_staging', 'Single environment by design', 'ana@example.com', FUTURE]]);
  } finally { subject.close(); }
});

test('sync takes the other computer acceptances, and a bundle without them changes nothing', () => {
  const subject = fixture();
  try {
    const scope = `product:${subject.application.id}`;
    subject.posture.accept({ scopeKey: scope, ruleId: 'product.local_only', reason: 'decided here' });
    const remote = { ruleId: 'product.no_staging', kind: 'silenced', reason: 'decided there', author: 'bo@example.com', createdAt: '2026-10-01T00:00:00.000Z', expiresAt: null };

    subject.io.applyBundle(subject.application, { application: { environment: '', team: '', pollingEnabled: false }, advisor: { acceptances: [remote] } }, { author: 'sync' });
    assert.deepEqual(subject.posture.list(scope).map(item => [item.ruleId, item.author]), [['product.no_staging', 'bo@example.com']]);

    // Applying the same again does not duplicate; an older KUA's bundle (no advisor) leaves them alone.
    subject.io.applyBundle(subject.application, { application: {}, advisor: { acceptances: [remote] } });
    subject.io.applyBundle(subject.application, { application: {} });
    assert.equal(subject.posture.list(scope).length, 1);
  } finally { subject.close(); }
});

test('the sync hash only includes acceptances when there are some', () => {
  const base = { application: { provider: 'aws', region: 'us-east-1' }, architecture: null };
  assert.equal(contentHash({ ...base, advisor: { acceptances: [] } }), contentHash(base));
  assert.notEqual(contentHash({ ...base, advisor: { acceptances: [{ ruleId: 'r', kind: 'accepted', reason: 'x', author: 'a' }] } }), contentHash(base));
});

// ── Portable applications: scopes, several views and membership (#153) ──────

const { normalizeScope } = require('./applicationContract');
const { ApplicationRegistryService } = require('./applicationRegistryService');
const { readKuaAppBundle } = require('./kuaAppBundle');

const QUEUE_ARN = 'arn:aws:sqs:us-east-1:111111111111:orders';
const TOPIC_ARN = 'arn:aws:sns:us-east-1:111111111111:orders-events';
const LAMBDA_ARN = 'arn:aws:lambda:us-east-1:111111111111:function:orders-api';

function portableFixture() {
  const subject = fixture();
  const { database, apmDatabase } = subject;
  const application = apmDatabase.createApplication({ name: 'Checkout', environment: 'production', team: 'Payments' });
  for (const scope of [
    { provider: 'aws', scopeId: '111111111111', location: 'us-east-1', label: 'Payments account' },
    { provider: 'kubernetes', scopeId: 'prod-cluster', location: '' },
  ]) apmDatabase.addApplicationScope(application.id, normalizeScope(scope));

  const views = ['Checkout', 'Checkout data'].map(name => database.createProject({ name, profileId: 'local:secret-profile' }));
  const [main, data] = views;
  database.saveGraph(main.id, {
    ...database.getGraph(main.id).document,
    nodes: [
      { id: 'queue', name: 'orders', provider: 'aws', region: 'us-east-1', accountId: '111111111111', resourceType: 'sqs', arn: QUEUE_ARN, nativeId: QUEUE_ARN },
      { id: 'topic', name: 'orders-events', provider: 'aws', region: 'us-east-1', accountId: '111111111111', resourceType: 'sns', arn: TOPIC_ARN, nativeId: TOPIC_ARN },
      { id: 'lambda', name: 'orders-api', provider: 'aws', region: 'us-east-1', accountId: '111111111111', resourceType: 'lambda', arn: LAMBDA_ARN, nativeId: LAMBDA_ARN },
    ],
    edges: [{ id: 'reads', sourceNodeId: 'lambda', targetNodeId: 'queue', relationType: 'reads_from', status: 'rejected' }],
  }, { expectedRevision: database.getGraph(main.id).revision });
  database.saveGraph(data.id, {
    ...database.getGraph(data.id).document,
    nodes: [{ id: 'orders-db', name: 'orders-db', provider: 'aws', region: 'us-east-1', accountId: '111111111111', resourceType: 'kinesis', nativeId: 'orders-stream' }],
    edges: [],
  }, { expectedRevision: database.getGraph(data.id).revision });
  database.createSnapshot(main.id, { name: 'Before launch' });
  for (const view of views) apmDatabase.updateArchitectureProjectLink(application.id, view.id);

  const registry = new ApplicationRegistryService({ database: apmDatabase, architectureDatabase: database });
  const current = () => apmDatabase.getApplication(application.id);
  const lambda = registry.attachResource(current(), {
    provider: 'aws', type: 'lambda', key: LAMBDA_ARN, arn: LAMBDA_ARN, name: 'orders-api', scopeId: '111111111111', location: 'us-east-1',
  }).resource;
  const worker = registry.attachResource(current(), {
    provider: 'kubernetes', type: 'kubernetes', kind: 'deployment', key: 'prod-cluster/payments/deployment/worker',
    kubeContext: 'prod-cluster', namespace: 'payments', name: 'worker',
  }).resource;
  apmDatabase.addEdge(application.id, { sourceResourceId: lambda.id, targetResourceId: worker.id, relationType: 'invokes' });
  registry.reconcile(current());
  // The user took the topic out of the application: it stays out after an import.
  const topic = apmDatabase.listRegistryResources(application.id).find(resource => resource.displayName === 'orders-events');
  registry.detachRegistryResource(current(), topic.id);
  return { ...subject, registry, application: current(), views };
}

const roundTrip = bundle => readKuaAppBundle(JSON.parse(JSON.stringify(bundle)));
const registryShape = (apmDatabase, applicationId) => ({
  resources: apmDatabase.listRegistryResources(applicationId).map(resource => resource.id).sort(),
  relationships: apmDatabase.listRegistryRelationships(applicationId)
    .map(item => [item.sourceResourceId, item.targetResourceId, item.relationType, item.status].join(' ')).sort(),
});

test('an application without provider round-trips with its scopes, views, membership and decisions (#153)', () => {
  const subject = portableFixture();
  try {
    const before = registryShape(subject.apmDatabase, subject.application.id);
    assert.ok(before.relationships.some(item => item.endsWith('invokes confirmed')));
    assert.ok(before.relationships.some(item => item.endsWith('reads_from rejected')));
    const { bundle, issues } = roundTrip(subject.io.exportBundle(subject.application));
    assert.deepEqual(issues, []);
    assert.equal(bundle.version, 1);
    assert.equal(bundle.contentVersion, 2);
    assert.equal(bundle.application.provider, undefined);
    assert.equal(bundle.application.scopes.length, 2);
    assert.equal(bundle.additionalViews.length, 1);
    assert.equal(bundle.registry.detachments.length, 1);

    const imported = subject.io.importBundle('local:other', bundle);
    const application = subject.apmDatabase.getApplication(imported.application.id);
    assert.equal(application.profileId, null);
    assert.equal(application.name, 'Checkout');
    assert.deepEqual(subject.apmDatabase.listApplicationScopes(application.id).map(scope => scope.key).sort(),
      subject.apmDatabase.listApplicationScopes(subject.application.id).map(scope => scope.key).sort());
    assert.deepEqual(subject.apmDatabase.listScopeBindings(application.id), [], 'bindings are local and never imported');
    assert.equal(imported.importedViews, 2);
    assert.deepEqual(imported.projects.map(project => project.name).sort(), ['Checkout', 'Checkout data']);
    assert.equal(imported.importedSnapshots, 1);
    assert.equal(imported.restoredMembers, 2);
    assert.deepEqual(imported.skipped, []);

    // Same portable resources and relationships, the rejected one still rejected, the topic still detached.
    assert.deepEqual(registryShape(subject.apmDatabase, application.id), before);
    assert.ok(!subject.apmDatabase.listRegistryResources(application.id).some(resource => resource.displayName === 'orders-events'));
    assert.equal(subject.apmDatabase.listResources(application.id).find(resource => resource.name === 'worker').enabled, true);

    // Exporting the imported copy gives the same portable content.
    const again = roundTrip(subject.io.exportBundle(application)).bundle;
    assert.deepEqual(again.registry.resources.map(resource => resource.sourceId).sort(), bundle.registry.resources.map(resource => resource.sourceId).sort());
    assert.deepEqual(again.registry.detachments, bundle.registry.detachments);
  } finally { subject.close(); }
});

test('the export carries no profile, credential or local data outside the contract (#153)', () => {
  const subject = portableFixture();
  try {
    const bundle = subject.io.exportBundle(subject.application);
    assert.doesNotMatch(JSON.stringify(bundle), /secret-profile|local:test|local:other/);
    // The same key check the account service applies before it stores a bundle.
    const forbidden = /(?:password|secret|token|private.?key|access.?key|credential|kubeconfig|authorization|cookie|client.?secret|api.?key|profile.?id|raw.?log|trace.?payload|environment.?variables?)/i;
    const walk = (value, path) => {
      if (Array.isArray(value)) return value.forEach((item, index) => walk(item, `${path}[${index}]`));
      if (!value || typeof value !== 'object') return;
      for (const [key, child] of Object.entries(value)) {
        assert.doesNotMatch(key, forbidden, `${path}.${key}`);
        walk(child, `${path}.${key}`);
      }
    };
    walk(bundle, '$');
    const allowed = new Set(['provider', 'type', 'key', 'name', 'arn', 'kind', 'service', 'logGroup', 'kubeContext', 'namespace', 'scopeId', 'location', 'enabled', 'associationSource']);
    for (const resource of bundle.registry.resources.filter(item => item.apm)) {
      assert.deepEqual(Object.keys(resource.apm).filter(key => !allowed.has(key)), []);
    }
  } finally { subject.close(); }
});

test('a legacy bundle (one view, no scopes, no contentVersion) is still read and imported', () => {
  const subject = fixture();
  try {
    const project = subject.database.createProject({ name: 'Orders view', profileId: 'local:test' });
    subject.apmDatabase.updateArchitectureProjectLink(subject.application.id, project.id);
    const legacy = JSON.parse(JSON.stringify(subject.io.exportBundle(subject.apmDatabase.getApplication(subject.application.id))));
    delete legacy.contentVersion;
    delete legacy.additionalViews;
    delete legacy.application.scopes;
    delete legacy.registry.detachments;
    legacy.registry.resources = [];

    const { bundle, issues, contentVersion } = readKuaAppBundle(legacy);
    assert.equal(contentVersion, 1);
    assert.deepEqual(issues, []);
    const preview = subject.io.previewImport('local:other', bundle);
    assert.deepEqual(preview.application.legacy, { provider: 'aws', region: 'us-east-1' });
    assert.equal(preview.views.length, 1);
    const imported = subject.io.importBundle('local:other', bundle);
    assert.equal(imported.application.profileId, 'local:other');
    assert.equal(imported.application.provider, 'aws');
    assert.equal(imported.importedViews, 1);
  } finally { subject.close(); }
});

test('the preview reports existing identities, skipped resources and what the file left out, writing nothing', () => {
  const subject = portableFixture();
  try {
    const exported = JSON.parse(JSON.stringify(subject.io.exportBundle(subject.application)));
    exported.registry.resources.push(
      { provider: 'gcp', resourceType: 'gcp-cloud-run', nativeIdentifier: 'billing', scopeId: 'other-project', location: 'europe-west1', displayName: 'billing', sources: ['apm_resource'], apm: { provider: 'gcp', type: 'gcp-cloud-run', key: 'billing', name: 'billing' } },
      { provider: 'aws', resourceType: 'mq', nativeIdentifier: 'broker-1', displayName: 'broker', sources: ['apm_resource'], apm: { provider: 'aws', type: 'mq', key: 'broker-1', name: 'broker' } },
      { provider: 'aws', displayName: 'no identity' },
    );
    exported.registry.resources.push({ ...exported.registry.resources[0] });
    exported.registry.relationships.push({ sourceResourceId: 'kua-resource:missing', targetResourceId: exported.registry.resources[0].sourceId, relationType: 'reads' });
    // The data view is missing from this file, so its stream has nowhere to come back from.
    const views = [exported.architecture, ...exported.additionalViews];
    exported.architecture = views.find(view => view.project.name === 'Checkout');
    exported.additionalViews = [];

    const applications = subject.apmDatabase.listApplications().length;
    const { bundle, issues } = readKuaAppBundle(exported);
    assert.deepEqual(issues.map(issue => [issue.kind, issue.count]), [['resource_invalid', 1], ['relationship_dangling', 1]]);
    const preview = subject.io.previewImport('local:other', bundle, { issues });
    assert.equal(subject.apmDatabase.listApplications().length, applications, 'a preview writes nothing');
    assert.equal(preview.application.alreadyHere, true);
    assert.equal(preview.application.sameName.length, 1);
    assert.equal(preview.scopes.length, 2);
    assert.equal(preview.views.length, 1);
    assert.equal(preview.resources.total, bundle.registry.resources.length, 'a duplicated resource counts once');
    assert.ok(preview.resources.existing.some(item => item.displayName === 'orders-api' && item.applications[0].name === 'Checkout'));
    assert.deepEqual(preview.resources.skipped.map(item => [item.displayName, item.reason]).sort(), [['broker', 'unsupported_type'], ['orders-db', 'no_source']]);
    assert.deepEqual(preview.resources.outsideScopes.map(item => item.displayName), ['billing']);
    assert.equal(preview.issues.length, 2);

    const imported = subject.io.importBundle('local:other', bundle);
    assert.deepEqual(imported.skipped.map(item => item.displayName).sort(), ['broker', 'orders-db']);
    const ids = subject.apmDatabase.listRegistryResources(imported.application.id).map(resource => resource.id);
    assert.equal(new Set(ids).size, ids.length, 'no duplicated resources');
    assert.ok(subject.apmDatabase.listRegistryResources(imported.application.id).some(resource => resource.displayName === 'billing'));
  } finally { subject.close(); }
});

test('unknown bundle versions are refused, and a newer content version is read as far as it is understood', () => {
  const subject = portableFixture();
  try {
    const bundle = JSON.parse(JSON.stringify(subject.io.exportBundle(subject.application)));
    assert.throws(() => readKuaAppBundle({ ...bundle, version: 2 }), /Unsupported KUAAppBundle version/);
    assert.throws(() => readKuaAppBundle({ ...bundle, contentVersion: 'next' }), /content version/);
    const newer = readKuaAppBundle({ ...bundle, contentVersion: 7, futureSection: { anything: true } });
    assert.deepEqual(newer.issues[0], { kind: 'newer_content', contentVersion: 7 });
    assert.equal(newer.bundle.futureSection, undefined);
    assert.equal(newer.bundle.registry.resources.length, bundle.registry.resources.length);
  } finally { subject.close(); }
});

test('a failed import leaves nothing behind', () => {
  const subject = portableFixture();
  try {
    const { bundle } = roundTrip(subject.io.exportBundle(subject.application));
    const applications = subject.apmDatabase.listApplications().length;
    const projects = subject.database.listProjects().length;
    const original = subject.apmDatabase.addEdge;
    subject.apmDatabase.addEdge = () => { throw new Error('disk full'); };
    try {
      assert.throws(() => subject.io.importBundle('local:other', bundle), /disk full/);
    } finally { subject.apmDatabase.addEdge = original; }
    assert.equal(subject.apmDatabase.listApplications().length, applications);
    assert.equal(subject.database.listProjects().length, projects);
  } finally { subject.close(); }
});

test('sync applies every view once and adds scopes; the hash of a legacy application ignores its derived scopes', () => {
  const subject = portableFixture();
  try {
    const { bundle } = roundTrip(subject.io.exportBundle(subject.application));
    const target = subject.apmDatabase.createApplication({ name: 'Checkout copy' });
    subject.io.applyBundle(target, bundle);
    assert.equal(subject.apmDatabase.listApplicationScopes(target.id).length, 2);
    // No profile of its own and no view yet: a view needs a profile to be created.
    assert.equal(subject.apmDatabase.getApplication(target.id).architectureProjectIds.length, 0);

    // Imported where the view names are taken: they become "Name (imported)".
    const imported = subject.io.importBundle('local:secret-profile', bundle);
    assert.ok(imported.projects.every(project => project.name.endsWith('(imported)')));
    subject.io.applyBundle(subject.apmDatabase.getApplication(imported.application.id), bundle);
    subject.io.applyBundle(subject.apmDatabase.getApplication(imported.application.id), bundle);
    assert.equal(subject.apmDatabase.getApplication(imported.application.id).architectureProjectIds.length, 2, 'views renamed "(imported)" are matched, not created again');

    const legacy = { application: { provider: 'aws', region: 'us-east-1', scopes: [] }, architecture: null };
    assert.equal(contentHash({ ...legacy, application: { ...legacy.application, scopes: [{ provider: 'aws', scopeId: '1', location: 'us-east-1' }] } }), contentHash(legacy));
    assert.notEqual(contentHash({ application: { scopes: [{ provider: 'aws', scopeId: '1', location: '' }] }, architecture: null }), contentHash({ application: { scopes: [] }, architecture: null }));
  } finally { subject.close(); }
});
