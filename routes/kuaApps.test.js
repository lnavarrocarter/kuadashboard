'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const express = require('express');
const { ArchitectureDatabase } = require('../lib/architecture/database');
const { ApmDatabase } = require('../lib/apm/database');
const { ApplicationRegistryService } = require('../lib/kua/applicationRegistryService');
const { createKuaAppsRouter } = require('./kuaApps');

async function fixture({ account, verifier, logCache } = {}) {
  const database = new ArchitectureDatabase({ filePath: ':memory:' });
  const apmDatabase = new ApmDatabase({ filePath: ':memory:' });
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use('/api/kua-apps', createKuaAppsRouter({ database, apmDatabase, ...(account ? { account: () => account } : {}), ...(verifier ? { verifier } : {}), ...(logCache ? { logCache: () => logCache } : {}) }));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/kua-apps`;

  async function request(relativePath, { method = 'GET', body, profile = 'local:test' } = {}) {
    const response = await fetch(`${baseUrl}${relativePath}`, {
      method,
      headers: {
        'X-Profile-Id': profile,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, headers: response.headers, body: text ? JSON.parse(text) : null };
  }

  return {
    database,
    apmDatabase,
    request,
    async close() {
      await new Promise(resolve => server.close(resolve));
      database.close();
      apmDatabase.close();
    },
  };
}

async function createSource(subject) {
  const application = subject.apmDatabase.createApplication({
    profileId: 'local:test', provider: 'aws', region: 'us-east-1', name: 'Orders',
  });
  const project = subject.database.createProject({
    profileId: 'local:test', name: 'Orders architecture', description: 'Source project',
  });
  subject.apmDatabase.updateArchitectureProjectLink(application.id, project.id);
  subject.database.saveGraph(project.id, {
    projectId: project.id,
    nodes: [{ id: 'node-1', name: 'Orders API', token: 'must-not-export' }],
  }, { expectedRevision: 0 });
  subject.database.createSnapshot(project.id, { name: 'Baseline' });
  return subject.apmDatabase.getApplication(application.id);
}

test('local KUAAppBundle export/import restores app, graph and snapshots by profile', async () => {
  const subject = await fixture();
  try {
    const source = await createSource(subject);
    const exported = await subject.request(`/${source.id}/export`);
    assert.equal(exported.status, 200);
    assert.match(exported.headers.get('content-disposition'), /\.kuaapp\.json/);
    assert.equal(exported.body.application.name, 'Orders');
    assert.equal(exported.body.architecture.graph.document.nodes[0].token, undefined);
    assert.equal(exported.body.architecture.snapshots.length, 1);

    const imported = await subject.request('/import', { method: 'POST', body: exported.body });
    assert.equal(imported.status, 201, JSON.stringify(imported.body));
    assert.notEqual(imported.body.application.id, source.id);
    assert.equal(imported.body.application.profileId, 'local:test');
    assert.equal(imported.body.graph.document.nodes[0].name, 'Orders API');
    assert.equal(imported.body.importedSnapshots, 1);
    assert.equal(subject.database.listSnapshots(imported.body.project.id).length, 1);

    const hidden = await subject.request(`/${source.id}/export`, { profile: 'local:other' });
    assert.equal(hidden.status, 404);
  } finally {
    await subject.close();
  }
});

test('an application without provider exports from any profile, and the preview writes nothing (#153)', async () => {
  const subject = await fixture();
  try {
    const created = await subject.request('/applications', {
      method: 'POST', body: { name: 'Checkout', scopes: [{ provider: 'kubernetes', scopeId: 'prod-cluster' }] },
    });
    const exported = await subject.request(`/${created.body.id}/export`, { profile: 'local:other' });
    assert.equal(exported.status, 200);
    assert.equal(exported.body.application.provider, undefined);
    assert.deepEqual(exported.body.application.scopes.map(scope => scope.scopeId), ['prod-cluster']);

    const before = subject.apmDatabase.listApplications().length;
    const preview = await subject.request('/import/preview', { method: 'POST', body: exported.body });
    assert.equal(preview.status, 200, JSON.stringify(preview.body));
    assert.equal(preview.body.application.alreadyHere, true);
    assert.equal(preview.body.scopes.length, 1);
    assert.equal(subject.apmDatabase.listApplications().length, before);

    const imported = await subject.request('/import', { method: 'POST', body: exported.body });
    assert.equal(imported.status, 201, JSON.stringify(imported.body));
    assert.equal(imported.body.application.profileId, null);
    const unknown = await subject.request('/import/preview', { method: 'POST', body: { ...exported.body, version: 3 } });
    assert.equal(unknown.status, 400);
  } finally {
    await subject.close();
  }
});

test('local KUAAppBundle import rejects non-sanitized bundles', async () => {
  const subject = await fixture();
  try {
    const result = await subject.request('/import', {
      method: 'POST', body: { kind: 'KUAAppBundle', version: 1, mode: 'raw' },
    });
    assert.equal(result.status, 400);
  } finally {
    await subject.close();
  }
});

test('KUApps exposes versioned extension capabilities and attributed historical evidence', async () => {
  const subject = await fixture();
  try {
    const application = await createSource(subject);
    const sources = await subject.request(`/applications/${application.id}/extensions`);
    assert.equal(sources.status, 200);
    const internal = sources.body.sources.find(source => source.id === 'kua.internal');
    assert.equal(internal.manifestVersion, 1);
    assert.equal(internal.capabilities.discovery, false);
    assert.equal(internal.capabilities.historicalSearch, true);
    assert.ok(internal.permissions.includes('kua.architecture.history.read'));

    const response = await subject.request(`/applications/${application.id}/evidence`);
    assert.equal(response.status, 200);
    assert.equal(response.body.sources[0].state, 'available');
    const history = response.body.evidence.find(item => item.class === 'history');
    assert.equal(history.scope.applicationId, application.id);
    assert.equal(history.reference.kind, 'architecture_change');
    assert.equal(JSON.stringify(response.body).includes('must-not-export'), false);
  } finally {
    await subject.close();
  }
});

test('KUApps extension endpoints return not found for unknown applications', async () => {
  const subject = await fixture();
  try {
    assert.equal((await subject.request('/applications/missing/extensions')).status, 404);
    assert.equal((await subject.request('/applications/missing/evidence')).status, 404);
  } finally {
    await subject.close();
  }
});

test('cloud backups upload the sanitized bundle and restore it as a new application', async () => {
  const stored = new Map();
  const account = {
    backups: {
      async create(bundle) {
        const id = `b${stored.size + 1}`;
        stored.set(id, JSON.parse(JSON.stringify(bundle)));
        return { id, applicationName: bundle.application.name, sizeBytes: JSON.stringify(bundle).length };
      },
      async download(id) {
        if (!stored.has(id)) throw Object.assign(new Error('Backup not found'), { statusCode: 404 });
        return stored.get(id);
      },
    },
  };
  const subject = await fixture({ account });
  try {
    const source = await createSource(subject);
    const backup = await subject.request(`/${source.id}/cloud-backup`, { method: 'POST' });
    assert.equal(backup.status, 201);
    assert.equal(backup.body.applicationName, 'Orders');
    const uploaded = JSON.stringify(stored.get('b1'));
    assert.equal(uploaded.includes('must-not-export'), false, 'sanitized before leaving the computer');
    assert.equal(uploaded.includes('local:test'), false, 'no local profile ids');

    // Another profile cannot back up an application it does not own.
    assert.equal((await subject.request(`/${source.id}/cloud-backup`, { method: 'POST', profile: 'local:other' })).status, 404);

    const restored = await subject.request('/cloud-backups/b1/restore', { method: 'POST', profile: 'local:other' });
    assert.equal(restored.status, 201);
    assert.equal(restored.body.application.name, 'Orders');
    assert.equal(restored.body.application.profileId, 'local:other');
    assert.equal(restored.body.importedSnapshots, 1);
    assert.equal((await subject.request('/cloud-backups/missing/restore', { method: 'POST' })).status, 404);
  } finally { await subject.close(); }
});

test('cloud backup errors from the account service keep their status and code', async () => {
  const account = { backups: { async create() { throw Object.assign(new Error('Cloud backups need a Pro or Team plan'), { statusCode: 403, code: 'PLAN_REQUIRED' }); } } };
  const subject = await fixture({ account });
  try {
    const source = await createSource(subject);
    const refused = await subject.request(`/${source.id}/cloud-backup`, { method: 'POST' });
    assert.equal(refused.status, 403);
    assert.equal(refused.body.code, 'PLAN_REQUIRED');
  } finally { await subject.close(); }
});

test('the migration report lists provider-less applications and never names a profile', async () => {
  const subject = await fixture();
  try {
    subject.apmDatabase.createApplication({ provider: 'aws', profileId: 'local:secret', region: 'us-east-1', name: 'Orders' });
    subject.apmDatabase.createApplication({ name: 'Checkout' });
    const report = await subject.request('/migration-report');
    assert.equal(report.status, 200);
    assert.equal(report.body.applications, 2);
    assert.equal(report.body.providerLessApplications, 1);
    assert.ok(report.body.findings.some(finding => finding.kind === 'application_without_view'));
    assert.equal(JSON.stringify(report.body).includes('local:secret'), false);
  } finally { await subject.close(); }
});

test('KUA Applications API: create without provider, add scopes, bind and resolve revision conflicts', async () => {
  const { createScopeVerifier } = require('../lib/kua/scopeVerifier');
  const verifier = createScopeVerifier({ resolvers: { async aws(profileId) { return { identity: profileId === 'prod' ? '111111111111' : '999999999999' }; } } });
  const subject = await fixture({ verifier });
  try {
    const created = await subject.request('/applications', { method: 'POST', body: { name: 'Orders', environment: 'production' } });
    assert.equal(created.status, 201);
    assert.equal(created.body.local.legacy, null);
    const id = created.body.id;

    const scope = await subject.request(`/applications/${id}/scopes`, { method: 'POST', body: { provider: 'aws', scopeId: '111111111111', location: 'us-east-1', expectedRevision: 0 } });
    assert.equal(scope.status, 201);
    const again = await subject.request(`/applications/${id}/scopes`, { method: 'POST', body: { provider: 'aws', scopeId: '111111111111', location: 'us-east-1' } });
    assert.equal(again.status, 200);

    const stale = await subject.request(`/applications/${id}`, { method: 'PATCH', body: { team: 'Platform', expectedRevision: 0 } });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.code, 'REVISION_CONFLICT');
    assert.equal(stale.body.revision, 1);

    const key = encodeURIComponent(scope.body.scope.key);
    const bound = await subject.request(`/applications/${id}/scopes/${key}/binding`, { method: 'PUT', body: { profileId: 'prod' } });
    assert.equal(bound.status, 200);
    assert.equal(bound.body.status, 'verified');
    const mismatch = await subject.request(`/applications/${id}/scopes/${key}/binding`, { method: 'PUT', body: { profileId: 'dev' } });
    assert.equal(mismatch.body.status, 'mismatch');
    assert.deepEqual(mismatch.body.application.warnings.map(warning => warning.kind), ['scope_mismatch']);

    const list = await subject.request('/applications', { profile: '' });
    assert.equal(list.status, 200, 'not scoped by X-Profile-Id');
    assert.equal(list.body.length, 1);

    assert.equal((await subject.request(`/applications/${id}/scopes/${key}/binding`, { method: 'DELETE' })).body.local.bindings.length, 0);
    assert.equal((await subject.request(`/applications/${id}/scopes/${key}`, { method: 'DELETE' })).body.scopes.length, 0);
    assert.equal((await subject.request(`/applications/${id}`, { method: 'DELETE' })).body.deleted, true);
    assert.equal((await subject.request(`/applications/${id}`)).status, 404);
  } finally { await subject.close(); }
});

test('KUA Application registry lists shared resources and relationships without local profile ids', async () => {
  const subject = await fixture();
  try {
    const application = await createSource(subject);
    const source = subject.apmDatabase.upsertRegistryResource({
      id: 'resource:api', identityKey: 'aws:api', provider: 'aws', profileId: 'local:secret',
      scopeId: '123456789012', location: 'us-east-1', nativeIdentifier: 'arn:aws:lambda:us-east-1:123456789012:function:api',
      resourceType: 'lambda', displayName: 'orders-api', lineage: [],
    });
    const target = subject.apmDatabase.upsertRegistryResource({
      id: 'resource:queue', identityKey: 'aws:queue', provider: 'aws', profileId: 'local:secret',
      scopeId: '123456789012', location: 'us-east-1', nativeIdentifier: 'arn:aws:sqs:us-east-1:123456789012:orders',
      resourceType: 'sqs', displayName: 'orders', lineage: [],
    });
    const workload = subject.apmDatabase.upsertRegistryResource({
      id: 'resource:workload', identityKey: 'kubernetes:workload', provider: 'kubernetes', profileId: 'local:secret',
      scopeId: 'dev-eks', location: '', nativeIdentifier: 'dev-eks/orders/Deployment/api',
      resourceType: 'deployment', displayName: 'api',
      lineage: [{ kind: 'architecture_node', id: 'node-api', kubeContext: 'dev-eks', namespace: 'orders' }],
    });
    subject.apmDatabase.addRegistryMembership({ applicationId: application.id, resourceId: source.id, sourceKind: 'manual', sourceReference: 'source' });
    subject.apmDatabase.addRegistryMembership({ applicationId: application.id, resourceId: target.id, sourceKind: 'manual', sourceReference: 'target' });
    subject.apmDatabase.addRegistryMembership({ applicationId: application.id, resourceId: workload.id, sourceKind: 'architecture_node', sourceReference: 'node-api' });
    subject.apmDatabase.upsertRegistryRelationship({
      id: 'relationship:api-queue', applicationId: application.id, sourceResourceId: source.id,
      targetResourceId: target.id, relationType: 'sends-to', status: 'confirmed', evidence: [],
    });

    const registry = await subject.request(`/applications/${application.id}/registry`, { profile: '' });
    assert.equal(registry.status, 200);
    assert.equal(registry.body.resources.length, 3);
    assert.equal(registry.body.resources[0].profileId, undefined);
    assert.equal(registry.body.resources.find(resource => resource.id === workload.id).kubeContext, 'dev-eks');
    assert.equal(registry.body.resources.find(resource => resource.id === workload.id).namespace, 'orders');
    assert.equal(registry.body.relationships[0].sourceName, 'orders-api');
    assert.equal(registry.body.relationships[0].targetName, 'orders');
    assert.equal(JSON.stringify(registry.body).includes('local:secret'), false);
  } finally { await subject.close(); }
});

test('removing a registry resource stops future reconciliation without deleting its source resource', async () => {
  const subject = await fixture();
  try {
    const application = subject.apmDatabase.createApplication({
      profileId: 'local:test', provider: 'aws', region: 'us-east-1', name: 'Development',
    });
    const { resource } = subject.apmDatabase.attachResource(application.id, {
      type: 'lambda', key: 'arn:aws:lambda:us-east-1:123456789012:function:orders-api',
      arn: 'arn:aws:lambda:us-east-1:123456789012:function:orders-api', name: 'orders-api',
    });
    const registryService = new ApplicationRegistryService({ database: subject.apmDatabase, architectureDatabase: subject.database });
    registryService.reconcile(application);
    const [registryResource] = subject.apmDatabase.listRegistryResources(application.id);
    assert.ok(registryResource);

    const removed = await subject.request(`/applications/${application.id}/registry/resources/${registryResource.id}`, {
      method: 'DELETE', profile: '',
    });
    assert.equal(removed.status, 204);
    assert.equal(subject.apmDatabase.getResource(resource.id).name, 'orders-api');
    assert.equal(subject.apmDatabase.listRegistryResources(application.id).length, 0);

    registryService.reconcile(application);
    assert.equal(subject.apmDatabase.listRegistryResources(application.id).length, 0);
  } finally { await subject.close(); }
});

test('KUA Applications API rejects invalid input', async () => {
  const subject = await fixture();
  try {
    assert.equal((await subject.request('/applications', { method: 'POST', body: { name: ' ' } })).status, 400);
    const created = await subject.request('/applications', { method: 'POST', body: { name: 'Orders' } });
    const invalid = await subject.request(`/applications/${created.body.id}/scopes`, { method: 'POST', body: { provider: 'Not A Provider' } });
    assert.equal(invalid.status, 400);
    const missing = await subject.request(`/applications/${created.body.id}/scopes/nope/binding`, { method: 'PUT', body: { profileId: 'prod' } });
    assert.equal(missing.status, 404);
  } finally { await subject.close(); }
});

test('explains a relationship with the pair log signals and local-ML matches, without cloud calls (#172)', async () => {
  const searchSignatures = async ({ logGroup, query }) => {
    assert.equal(logGroup, '/aws/lambda/checkout-api');
    assert.match(query, /orders-db/);
    return [{ signature: 'ProvisionedThroughputExceeded on table', occurrences: 7, category: 'throttling', score: 0.71 }];
  };
  const logCache = {
    async intelligenceForScope() {
      return {
        '/aws/lambda/checkout-api': { last24h: { errorRatePercent: 1, errors: 2, events: 200 }, cache: { lastSyncAt: Date.now() }, recurring: [{ signature: 'timed out calling orders-db', occurrences: 12 }] },
      };
    },
    searchSignatures,
  };
  const subject = await fixture({ logCache });
  try {
    const application = subject.apmDatabase.createApplication({ provider: 'aws', profileId: 'local:prod', region: 'us-east-1', name: 'Orders' });
    const api = subject.apmDatabase.addResource(application.id, { type: 'lambda', key: 'arn:aws:lambda:us-east-1:111111111111:function:checkout-api', arn: 'arn:aws:lambda:us-east-1:111111111111:function:checkout-api', name: 'checkout-api' });
    const db = subject.apmDatabase.addResource(application.id, { type: 'dynamodb', key: 'arn:aws:dynamodb:us-east-1:111111111111:table/orders-db', arn: 'arn:aws:dynamodb:us-east-1:111111111111:table/orders-db', name: 'orders-db' });

    const explained = await subject.request(`/applications/${application.id}/relationships/explain`, {
      method: 'POST', profile: '',
      body: { sourceResourceId: api.id, targetResourceId: db.id, relationType: 'calls', status: 'suggested', confidence: 0.6, evidence: [{ type: 'shared_name_tokens', values: ['orders'] }] },
    });
    assert.equal(explained.status, 200);
    assert.equal(explained.body.source.name, 'checkout-api');
    assert.equal(explained.body.signals.semantic, 'ready');
    assert.ok(explained.body.signals.mentions.some(item => item.match === 'semantic'));
    assert.ok(explained.body.advice.some(item => item.id === 'inferred_only'));
    assert.equal(JSON.stringify(explained.body).includes('local:prod'), false, 'the profile never appears in the explanation');

    const disabled = await (await fixture({ logCache: { ...logCache, async searchSignatures() { throw Object.assign(new Error('off'), { code: 'ML_DISABLED' }); } } }));
    try {
      const app2 = disabled.apmDatabase.createApplication({ provider: 'aws', profileId: 'local:prod', region: 'us-east-1', name: 'Orders' });
      const a = disabled.apmDatabase.addResource(app2.id, { type: 'lambda', key: 'k1', arn: 'arn:aws:lambda:us-east-1:111111111111:function:checkout-api', name: 'checkout-api' });
      const b = disabled.apmDatabase.addResource(app2.id, { type: 'sqs', key: 'k2', name: 'orders-queue' });
      const result = await disabled.request(`/applications/${app2.id}/relationships/explain`, { method: 'POST', body: { sourceResourceId: a.id, targetResourceId: b.id, relationType: 'publishes_to', evidence: [] } });
      assert.deepEqual(result.body.limits, ['semantic_disabled']);
    } finally { await disabled.close(); }
    assert.equal((await subject.request('/applications/missing/relationships/explain', { method: 'POST', body: {} })).status, 404);
  } finally { await subject.close(); }
});

test('observability resources: per-resource access from scope bindings, capabilities and a stable order', async () => {
  const { normalizeScope } = require('../lib/kua/applicationContract');
  const subject = await fixture();
  try {
    const application = subject.apmDatabase.createApplication({ name: 'Checkout' });
    const bound = normalizeScope({ provider: 'aws', scopeId: '111111111111', location: 'us-east-1' });
    subject.apmDatabase.addApplicationScope(application.id, bound);
    subject.apmDatabase.setScopeBinding(application.id, bound.key, { profileId: 'local:prod', status: 'verified' });
    const arn = name => `arn:aws:lambda:us-east-1:111111111111:function:${name}`;
    for (const name of ['zeta', 'Alpha']) subject.apmDatabase.attachResource(application.id, { provider: 'aws', type: 'lambda', key: arn(name), arn: arn(name), name });
    subject.apmDatabase.attachResource(application.id, { provider: 'aws', type: 'sqs', key: 'arn:aws:sqs:us-east-1:111111111111:jobs', arn: 'arn:aws:sqs:us-east-1:111111111111:jobs', name: 'jobs' });
    subject.apmDatabase.attachResource(application.id, { provider: 'aws', type: 'lambda', key: 'arn:aws:lambda:eu-west-1:222222222222:function:other', arn: 'arn:aws:lambda:eu-west-1:222222222222:function:other', name: 'other' });

    const { status, body } = await subject.request(`/applications/${application.id}/observability/resources`);
    assert.equal(status, 200);
    assert.deepEqual(body.resources.map(item => item.name), ['Alpha', 'other', 'zeta', 'jobs']);
    const alpha = body.resources[0];
    assert.deepEqual(alpha.access, { profileId: 'local:prod', region: 'us-east-1' });
    assert.deepEqual(alpha.capabilities, { metrics: true, logs: true });
    assert.equal(body.resources.find(item => item.name === 'other').access.error, 'scope_unbound');
    const jobs = body.resources.find(item => item.name === 'jobs');
    assert.deepEqual([jobs.capabilities, jobs.signals.state], [{ metrics: false, logs: false }, 'unsupported']);
    assert.equal((await subject.request('/applications/missing/observability/resources')).status, 404);
  } finally { await subject.close(); }
});

test('observability metrics: the series of one resource of the application, grouped by metric', async () => {
  const subject = await fixture();
  try {
    const application = subject.apmDatabase.createApplication({ name: 'Checkout' });
    const other = subject.apmDatabase.createApplication({ name: 'Billing' });
    const { resource } = subject.apmDatabase.attachResource(application.id, { provider: 'aws', type: 'lambda', key: 'arn:aws:lambda:us-east-1:1:function:api', arn: 'arn:aws:lambda:us-east-1:1:function:api', name: 'api' });
    const now = Date.now();
    for (const [metricName, offset, value] of [['duration_ms', 60000, 120], ['duration_ms', 0, 80], ['invocations_observed', 0, 3]]) {
      subject.apmDatabase.upsertMetricBucket({ resourceId: resource.id, bucketStart: now - offset, metricName, count: 1, sum: value, min: value, max: value, last: value, source: 'cloudwatch_logs' });
    }
    const { status, body } = await subject.request(`/applications/${application.id}/observability/resources/${resource.id}/metrics?from=${now - 3600000}&to=${now}`);
    assert.equal(status, 200);
    assert.deepEqual(body.metrics.map(metric => [metric.name, metric.points.length]), [['duration_ms', 2], ['invocations_observed', 1]]);
    assert.equal(body.metrics[0].points[1].average, 80);
    assert.equal((await subject.request(`/applications/${other.id}/observability/resources/${resource.id}/metrics`)).status, 404);
  } finally { await subject.close(); }
});

test('possible duplicates: same identifier with and without account, never by name alone (#239)', async () => {
  const subject = await fixture();
  try {
    const application = subject.apmDatabase.createApplication({ name: 'Dev' });
    const register = (id, displayName, scopeId, nativeIdentifier) => {
      subject.apmDatabase.upsertRegistryResource({ id, identityKey: id, provider: 'aws', scopeId, location: scopeId ? 'us-east-1' : '', nativeIdentifier, resourceType: 'ec2', displayName, lineage: [] });
      subject.apmDatabase.addRegistryMembership({ applicationId: application.id, resourceId: id, sourceKind: 'architecture_node', sourceReference: `p:${id}` });
    };
    register('a1', 'sg-1', '111111111111', 'AWS::EC2::SecurityGroup:sg-1');
    register('a2', 'sg-1', '222222222222', 'AWS::EC2::SecurityGroup:sg-1');
    register('a3', 'sg-1', '', 'AWS::EC2::SecurityGroup:sg-1');
    register('b1', 'error', '111111111111', 'Custom::LogRetention:/aws-glue/jobs/error');
    register('b2', 'error', '111111111111', 'Custom::LogRetention:/aws-glue/python-jobs/error');
    const { status, body } = await subject.request(`/applications/${application.id}/registry/possible-duplicates`);
    assert.equal(status, 200);
    assert.equal(body.length, 1);
    assert.deepEqual(body[0].resources.map(resource => resource.id).sort(), ['a1', 'a2', 'a3']);
  } finally { await subject.close(); }
});

test('API registry: a cluster-scoped object of an EKS context has no namespace (#239 N05)', async () => {
  const subject = await fixture();
  try {
    const { ApplicationRegistryService } = require('../lib/kua/applicationRegistryService');
    const context = 'arn:aws:eks:us-east-1:073746111526:cluster/EKS130-360-Dev';
    const application = subject.apmDatabase.createApplication({ profileId: 'local:test', region: 'us-east-1', name: 'Dev' });
    subject.apmDatabase.addResource(application.id, { type: 'kubernetes', kind: 'Node', name: 'ip-1', key: `${context}//Node/ip-1`, associationSource: 'manual' });
    subject.apmDatabase.addResource(application.id, { type: 'kubernetes', kind: 'Deployment', name: 'authv1', key: `${context}/backend360/Deployment/authv1`, associationSource: 'manual' });
    new ApplicationRegistryService({ database: subject.apmDatabase, architectureDatabase: subject.database }).reconcile(subject.apmDatabase.getApplication(application.id));
    const { body } = await subject.request(`/applications/${application.id}/registry`);
    const byName = Object.fromEntries(body.resources.map(resource => [resource.displayName, resource]));
    assert.equal(byName['ip-1'].namespace, '');
    assert.equal(byName['ip-1'].kubeContext, context);
    assert.equal(byName.authv1.namespace, 'backend360');
    assert.equal(byName.authv1.kubeContext, context);
  } finally {
    await subject.close();
  }
});
