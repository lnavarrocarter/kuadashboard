'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const express = require('express');
const { ArchitectureDatabase } = require('../lib/architecture/database');
const { ApmDatabase } = require('../lib/apm/database');
const { createKuaAppsRouter } = require('./kuaApps');

async function fixture({ account, verifier } = {}) {
  const database = new ArchitectureDatabase({ filePath: ':memory:' });
  const apmDatabase = new ApmDatabase({ filePath: ':memory:' });
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use('/api/kua-apps', createKuaAppsRouter({ database, apmDatabase, ...(account ? { account: () => account } : {}), ...(verifier ? { verifier } : {}) }));
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
    subject.apmDatabase.addRegistryMembership({ applicationId: application.id, resourceId: source.id, sourceKind: 'manual', sourceReference: 'source' });
    subject.apmDatabase.addRegistryMembership({ applicationId: application.id, resourceId: target.id, sourceKind: 'manual', sourceReference: 'target' });
    subject.apmDatabase.upsertRegistryRelationship({
      id: 'relationship:api-queue', applicationId: application.id, sourceResourceId: source.id,
      targetResourceId: target.id, relationType: 'sends-to', status: 'confirmed', evidence: [],
    });

    const registry = await subject.request(`/applications/${application.id}/registry`, { profile: '' });
    assert.equal(registry.status, 200);
    assert.equal(registry.body.resources.length, 2);
    assert.equal(registry.body.resources[0].profileId, undefined);
    assert.equal(registry.body.relationships[0].sourceName, 'orders-api');
    assert.equal(registry.body.relationships[0].targetName, 'orders');
    assert.equal(JSON.stringify(registry.body).includes('local:secret'), false);
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
