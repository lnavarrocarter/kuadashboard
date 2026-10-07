'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  EVIDENCE_RECORD_SCHEMA,
  EXTENSION_MANIFEST_SCHEMA,
  normalizeEvidenceRecord,
  normalizeExtensionManifest,
} = require('./extensionContract');

const manifest = () => ({
  manifestVersion: 1,
  id: 'kua.internal',
  version: '1.0.0',
  contractVersion: 1,
  source: { kind: 'builtin', publisher: 'KUA', name: 'KUA internal registry' },
  capabilities: {
    discovery: false,
    enrichment: true,
    relationshipEvidence: true,
    telemetry: false,
    historicalSearch: true,
    findings: false,
  },
  transport: { kind: 'internal', runtime: 'node' },
  scopes: ['application', 'resource'],
  permissions: ['kua.registry.read', 'kua.architecture.history.read'],
});

const evidence = overrides => ({
  schemaVersion: 1,
  id: 'evidence:resource-1',
  sourceId: 'kua.internal',
  reference: { kind: 'kua_resource', uri: 'kua://applications/app-1/resources/resource-1', label: 'orders-api' },
  scope: { applicationId: 'app-1', resourceId: 'resource-1', scopeKey: null },
  observedAt: '2026-10-06T12:00:00.000Z',
  retrievedAt: '2026-10-06T12:01:00.000Z',
  revision: 4,
  generation: null,
  freshness: 'unknown',
  class: 'observation',
  summary: 'Resource is present in the local application registry.',
  ...overrides,
});

test('manifest schema and normalizer require explicit capability declarations', () => {
  assert.equal(EXTENSION_MANIFEST_SCHEMA.properties.capabilities.required.length, 6);
  assert.deepEqual(normalizeExtensionManifest(manifest()).capabilities, manifest().capabilities);
  const incomplete = manifest();
  delete incomplete.capabilities.telemetry;
  assert.throws(() => normalizeExtensionManifest(incomplete), /must be explicitly true or false/);
});

test('manifest rejects unknown fields and unsupported contract versions', () => {
  assert.throws(() => normalizeExtensionManifest({ ...manifest(), code: 'node arbitrary.js' }), /unsupported field/);
  assert.throws(() => normalizeExtensionManifest({ ...manifest(), contractVersion: 2 }), error => error.code === 'UNSUPPORTED_EXTENSION_VERSION');
  assert.throws(() => normalizeExtensionManifest({ ...manifest(), version: 'latest' }), /semantic versioning/);
});

test('evidence schema and normalizer preserve the three evidence classes', () => {
  assert.deepEqual(EVIDENCE_RECORD_SCHEMA.properties.class.enum, ['observation', 'inference', 'history']);
  for (const evidenceClass of ['observation', 'inference', 'history']) {
    assert.equal(normalizeEvidenceRecord(evidence({ class: evidenceClass }), {
      applicationId: 'app-1', resourceIds: ['resource-1'], sourceIds: ['kua.internal'],
    }).class, evidenceClass);
  }
});

test('evidence rejects cross-application, cross-resource and unknown-source scope', () => {
  assert.throws(() => normalizeEvidenceRecord(evidence(), { applicationId: 'other-app' }), error => error.code === 'EVIDENCE_SCOPE_MISMATCH');
  assert.throws(() => normalizeEvidenceRecord(evidence(), { applicationId: 'app-1', resourceIds: ['other-resource'] }), error => error.code === 'EVIDENCE_SCOPE_MISMATCH');
  assert.throws(() => normalizeEvidenceRecord(evidence(), { sourceIds: ['another.source'] }), error => error.code === 'UNKNOWN_EVIDENCE_SOURCE');
});

test('evidence rejects stale schema, unsafe references and unknown fields', () => {
  assert.throws(() => normalizeEvidenceRecord(evidence({ schemaVersion: 9 })), error => error.code === 'UNSUPPORTED_EVIDENCE_VERSION');
  assert.throws(() => normalizeEvidenceRecord(evidence({ reference: { kind: 'external', uri: 'javascript:alert(1)', label: 'unsafe' } })), /unsafe scheme/);
  assert.throws(() => normalizeEvidenceRecord({ ...evidence(), payload: { token: 'secret' } }), /unsupported field/);
});

test('evidence requires normalized timestamps and valid freshness', () => {
  assert.throws(() => normalizeEvidenceRecord(evidence({ observedAt: 'yesterday' })), /ISO-8601 UTC timestamp/);
  assert.throws(() => normalizeEvidenceRecord(evidence({ freshness: 'current-ish' })), /freshness is invalid/);
  assert.equal(normalizeEvidenceRecord(evidence({ freshness: 'stale' })).freshness, 'stale');
});