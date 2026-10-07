'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { KuaExtensionRegistry, createKuaInternalAdapter } = require('./extensionRegistry');

const APP_ID = 'app-orders';
const RESOURCE_ID = 'kua-resource:orders-api';

function fixture() {
  const apmDatabase = {
    getApplication: id => id === APP_ID ? { id, revision: 7, architectureProjectIds: ['project-orders'] } : null,
    listApplicationScopes: () => [{ key: 'scope:aws-prod', provider: 'aws', scopeId: '123456789012', location: 'us-east-1' }],
    listRegistryResources: () => [{
      id: RESOURCE_ID, provider: 'aws', scopeId: '123456789012', location: 'us-east-1',
      resourceType: 'lambda', displayName: 'orders-api', sources: ['apm_resource', 'architecture_node'], updatedAt: '2026-10-06T12:00:00.000Z',
    }],
    listRegistryRelationships: () => [
      { id: 'rel-suggested', sourceResourceId: RESOURCE_ID, targetResourceId: RESOURCE_ID, relationType: 'calls', status: 'suggested', updatedAt: '2026-10-06T12:00:00.000Z' },
      { id: 'rel-rejected', sourceResourceId: RESOURCE_ID, targetResourceId: RESOURCE_ID, relationType: 'uses', status: 'rejected', updatedAt: '2026-10-06T12:00:00.000Z' },
      { id: 'rel-outside', sourceResourceId: RESOURCE_ID, targetResourceId: 'other-app-resource', relationType: 'calls', status: 'suggested' },
    ],
  };
  const architectureDatabase = {
    listChanges: () => [{ id: 'change-1', revision: 6, type: 'edge.review', createdAt: '2026-10-06T11:00:00.000Z', reason: 'sensitive text must not leak' }],
  };
  return { apmDatabase, architectureDatabase };
}

test('internal adapter emits scoped observations, inferences and historical references', async () => {
  const subject = fixture();
  const adapter = createKuaInternalAdapter({ ...subject, now: () => Date.parse('2026-10-06T13:00:00.000Z') });
  const evidence = await adapter.queryEvidence({ applicationId: APP_ID });

  assert.deepEqual(new Set(evidence.map(item => item.class)), new Set(['observation', 'inference', 'history']));
  assert.ok(evidence.every(item => item.scope.applicationId === APP_ID));
  assert.ok(evidence.some(item => item.scope.resourceId === RESOURCE_ID && item.scope.scopeKey === 'scope:aws-prod'));
  assert.equal(evidence.some(item => item.reference.uri.includes('rel-outside')), false);
  assert.equal(JSON.stringify(evidence).includes('sensitive text'), false);
});

test('internal adapter emits deterministic ids and the registry deduplicates records', async () => {
  const subject = fixture();
  const adapter = createKuaInternalAdapter(subject);
  const first = await adapter.queryEvidence({ applicationId: APP_ID });
  const second = await adapter.queryEvidence({ applicationId: APP_ID });
  assert.deepEqual(first.map(item => item.id), second.map(item => item.id));

  const duplicateAdapter = { manifest: adapter.manifest, queryEvidence: async () => [...first, ...first] };
  const registry = new KuaExtensionRegistry({ adapters: [duplicateAdapter] });
  const result = await registry.queryEvidence({ applicationId: APP_ID, resourceIds: [RESOURCE_ID] });
  assert.equal(result.evidence.length, first.length, 'duplicate evidence ids collapse to one record');
});

test('registry reports an unavailable source without failing other sources', async () => {
  const subject = fixture();
  const internal = createKuaInternalAdapter(subject);
  const unavailable = {
    manifest: { ...internal.manifest, id: 'test.offline', source: { ...internal.manifest.source, name: 'Offline source' } },
    async queryEvidence() { throw new Error('sensitive credential detail'); },
  };
  const result = await new KuaExtensionRegistry({ adapters: [internal, unavailable] })
    .queryEvidence({ applicationId: APP_ID, resourceIds: [RESOURCE_ID] });

  assert.equal(result.sources.find(source => source.id === 'test.offline').state, 'unavailable');
  assert.equal(JSON.stringify(result).includes('sensitive credential detail'), false);
  assert.ok(result.evidence.length > 0);
});

test('registry rejects duplicate sources and evidence outside the requested application', async () => {
  const internal = createKuaInternalAdapter(fixture());
  const registry = new KuaExtensionRegistry({ adapters: [internal] });
  assert.throws(() => registry.register(internal), error => error.code === 'DUPLICATE_EXTENSION_SOURCE');
  const badSource = {
    manifest: { ...internal.manifest, id: 'test.cross-app' },
    async queryEvidence() {
      const records = await internal.queryEvidence({ applicationId: APP_ID });
      return records.map(record => ({ ...record, sourceId: 'test.cross-app', scope: { ...record.scope, applicationId: 'another-app' } }));
    },
  };
  const result = await new KuaExtensionRegistry({ adapters: [badSource] })
    .queryEvidence({ applicationId: APP_ID, resourceIds: [RESOURCE_ID] });
  assert.deepEqual(result.sources, [{ id: 'test.cross-app', state: 'unavailable', code: 'EVIDENCE_SCOPE_MISMATCH' }]);
  assert.deepEqual(result.evidence, []);
});

test('an extension cannot attribute evidence to another registered source', async () => {
  const internal = createKuaInternalAdapter(fixture());
  const spoofing = {
    manifest: { ...internal.manifest, id: 'test.spoof' },
    async queryEvidence() { return internal.queryEvidence({ applicationId: APP_ID }); },
  };
  const registry = new KuaExtensionRegistry({ adapters: [internal, spoofing] });
  const result = await registry.queryEvidence({ applicationId: APP_ID, resourceIds: [RESOURCE_ID] });
  assert.deepEqual(result.sources.find(source => source.id === 'test.spoof'), {
    id: 'test.spoof', state: 'unavailable', code: 'UNKNOWN_EVIDENCE_SOURCE',
  });
});