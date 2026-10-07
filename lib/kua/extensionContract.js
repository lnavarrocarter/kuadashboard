'use strict';

const EXTENSION_CONTRACT_VERSION = 1;
const EVIDENCE_SCHEMA_VERSION = 1;
const CAPABILITY_NAMES = Object.freeze([
  'discovery', 'enrichment', 'relationshipEvidence', 'telemetry', 'historicalSearch', 'findings',
]);
const EVIDENCE_CLASSES = Object.freeze(['observation', 'inference', 'history']);
const EVIDENCE_FRESHNESS = Object.freeze(['current', 'stale', 'unknown']);
const EVIDENCE_REFERENCE_KINDS = Object.freeze([
  'kua_resource', 'kua_relationship', 'architecture_change', 'architecture_snapshot', 'external',
]);

const EXTENSION_MANIFEST_SCHEMA = Object.freeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'KUA extension manifest',
  type: 'object',
  additionalProperties: false,
  required: ['manifestVersion', 'id', 'version', 'contractVersion', 'source', 'capabilities', 'transport', 'scopes', 'permissions'],
  properties: {
    manifestVersion: { const: 1 },
    id: { type: 'string', pattern: '^[a-z][a-z0-9.-]{1,79}$' },
    version: { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+(?:[-+][a-zA-Z0-9.-]+)?$' },
    contractVersion: { const: 1 },
    source: {
      type: 'object', additionalProperties: false, required: ['kind', 'publisher', 'name'],
      properties: {
        kind: { enum: ['builtin', 'external'] },
        publisher: { type: 'string', minLength: 1, maxLength: 120 },
        name: { type: 'string', minLength: 1, maxLength: 120 },
      },
    },
    capabilities: {
      type: 'object', additionalProperties: false, required: CAPABILITY_NAMES,
      properties: Object.fromEntries(CAPABILITY_NAMES.map(name => [name, { type: 'boolean' }])),
    },
    transport: {
      type: 'object', additionalProperties: false, required: ['kind', 'runtime'],
      properties: {
        kind: { enum: ['internal', 'stdio', 'streamable-http'] },
        runtime: { type: 'string', minLength: 1, maxLength: 40 },
      },
    },
    scopes: { type: 'array', uniqueItems: true, items: { enum: ['application', 'resource', 'provider-scope'] }, maxItems: 3 },
    permissions: { type: 'array', uniqueItems: true, items: { type: 'string', pattern: '^[a-z][a-z0-9_.:-]{1,99}$' }, maxItems: 100 },
  },
});

const EVIDENCE_RECORD_SCHEMA = Object.freeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'KUA evidence record',
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'id', 'sourceId', 'reference', 'scope', 'observedAt', 'retrievedAt', 'freshness', 'class', 'summary'],
  properties: {
    schemaVersion: { const: 1 },
    id: { type: 'string', minLength: 1, maxLength: 160 },
    sourceId: { type: 'string', pattern: '^[a-z][a-z0-9.-]{1,79}$' },
    reference: {
      type: 'object', additionalProperties: false, required: ['kind', 'uri', 'label'],
      properties: {
        kind: { enum: EVIDENCE_REFERENCE_KINDS },
        uri: { type: 'string', minLength: 1, maxLength: 2048 },
        label: { type: 'string', minLength: 1, maxLength: 240 },
      },
    },
    scope: {
      type: 'object', additionalProperties: false, required: ['applicationId'],
      properties: {
        applicationId: { type: 'string', minLength: 1, maxLength: 120 },
        resourceId: { type: ['string', 'null'], maxLength: 160 },
        scopeKey: { type: ['string', 'null'], maxLength: 160 },
      },
    },
    observedAt: { type: 'string', format: 'date-time' },
    retrievedAt: { type: 'string', format: 'date-time' },
    revision: { type: ['integer', 'null'], minimum: 0 },
    generation: { type: ['string', 'integer', 'null'], maxLength: 160 },
    freshness: { enum: EVIDENCE_FRESHNESS },
    class: { enum: EVIDENCE_CLASSES },
    summary: { type: 'string', minLength: 1, maxLength: 1000 },
  },
});

function contractError(message, code = 'INVALID_EXTENSION_CONTRACT') {
  return Object.assign(new Error(message), { code, statusCode: 400 });
}

function objectWithKeys(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw contractError(`${label} must be an object`);
  const unknown = Object.keys(value).find(key => !allowed.includes(key));
  if (unknown) throw contractError(`${label} contains an unsupported field: ${unknown}`);
}

function requiredText(value, label, maxLength = 240) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength) {
    throw contractError(`${label} must be a non-empty string of at most ${maxLength} characters`);
  }
  return value.trim();
}

function normalizeExtensionManifest(input) {
  objectWithKeys(input, ['manifestVersion', 'id', 'version', 'contractVersion', 'source', 'capabilities', 'transport', 'scopes', 'permissions'], 'Manifest');
  if (input.manifestVersion !== EXTENSION_CONTRACT_VERSION || input.contractVersion !== EXTENSION_CONTRACT_VERSION) {
    throw contractError('Unsupported extension contract version', 'UNSUPPORTED_EXTENSION_VERSION');
  }
  const id = requiredText(input.id, 'Manifest id', 80).toLowerCase();
  if (!/^[a-z][a-z0-9.-]{1,79}$/.test(id)) throw contractError('Manifest id has an invalid format');
  const version = requiredText(input.version, 'Manifest version', 80);
  if (!/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(version)) throw contractError('Manifest version must use semantic versioning');

  objectWithKeys(input.source, ['kind', 'publisher', 'name'], 'Manifest source');
  if (!['builtin', 'external'].includes(input.source.kind)) throw contractError('Manifest source kind is invalid');
  const source = {
    kind: input.source.kind,
    publisher: requiredText(input.source.publisher, 'Manifest source publisher', 120),
    name: requiredText(input.source.name, 'Manifest source name', 120),
  };

  objectWithKeys(input.capabilities, CAPABILITY_NAMES, 'Manifest capabilities');
  const capabilities = {};
  for (const name of CAPABILITY_NAMES) {
    if (typeof input.capabilities[name] !== 'boolean') throw contractError(`Manifest capability ${name} must be explicitly true or false`);
    capabilities[name] = input.capabilities[name];
  }

  objectWithKeys(input.transport, ['kind', 'runtime'], 'Manifest transport');
  if (!['internal', 'stdio', 'streamable-http'].includes(input.transport.kind)) throw contractError('Manifest transport kind is invalid');
  const transport = { kind: input.transport.kind, runtime: requiredText(input.transport.runtime, 'Manifest runtime', 40) };
  if (!Array.isArray(input.scopes) || input.scopes.length > 3 || input.scopes.some(scope => !['application', 'resource', 'provider-scope'].includes(scope))) {
    throw contractError('Manifest scopes must be an array of supported scope types');
  }
  if (new Set(input.scopes).size !== input.scopes.length) throw contractError('Manifest scopes must be unique');
  if (!Array.isArray(input.permissions) || input.permissions.length > 100) throw contractError('Manifest permissions must be an array');
  const permissions = input.permissions.map(permission => requiredText(permission, 'Manifest permission', 100));
  if (permissions.some(permission => !/^[a-z][a-z0-9_.:-]{1,99}$/.test(permission)) || new Set(permissions).size !== permissions.length) {
    throw contractError('Manifest permissions must be unique namespaced identifiers');
  }

  return { manifestVersion: 1, id, version, contractVersion: 1, source, capabilities, transport, scopes: [...input.scopes], permissions };
}

function isoDate(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw contractError(`${label} must be an ISO-8601 UTC timestamp`);
  }
  return new Date(value).toISOString();
}

function normalizeEvidenceRecord(input, { applicationId, resourceIds, sourceIds } = {}) {
  objectWithKeys(input, [
    'schemaVersion', 'id', 'sourceId', 'reference', 'scope', 'observedAt', 'retrievedAt',
    'revision', 'generation', 'freshness', 'class', 'summary',
  ], 'Evidence record');
  if (input.schemaVersion !== EVIDENCE_SCHEMA_VERSION) {
    throw contractError('Unsupported evidence schema version', 'UNSUPPORTED_EVIDENCE_VERSION');
  }
  const id = requiredText(input.id, 'Evidence id', 160);
  const sourceId = requiredText(input.sourceId, 'Evidence source id', 80).toLowerCase();
  if (!/^[a-z][a-z0-9.-]{1,79}$/.test(sourceId)) throw contractError('Evidence source id has an invalid format');
  if (sourceIds && !new Set(sourceIds).has(sourceId)) throw contractError('Evidence refers to an unregistered source', 'UNKNOWN_EVIDENCE_SOURCE');

  objectWithKeys(input.reference, ['kind', 'uri', 'label'], 'Evidence reference');
  if (!EVIDENCE_REFERENCE_KINDS.includes(input.reference.kind)) throw contractError('Evidence reference kind is invalid');
  const uri = requiredText(input.reference.uri, 'Evidence reference URI', 2048);
  let parsedUri;
  try { parsedUri = new URL(uri); } catch { throw contractError('Evidence reference URI must be absolute'); }
  if (!['https:', 'kua:', 'architecture:'].includes(parsedUri.protocol) || parsedUri.username || parsedUri.password) {
    throw contractError('Evidence reference URI uses an unsupported or unsafe scheme');
  }
  const reference = { kind: input.reference.kind, uri, label: requiredText(input.reference.label, 'Evidence reference label', 240) };

  objectWithKeys(input.scope, ['applicationId', 'resourceId', 'scopeKey'], 'Evidence scope');
  const scopedApplicationId = requiredText(input.scope.applicationId, 'Evidence application scope', 120);
  if (applicationId && scopedApplicationId !== applicationId) throw contractError('Evidence crosses the requested application scope', 'EVIDENCE_SCOPE_MISMATCH');
  const resourceId = input.scope.resourceId == null ? null : requiredText(input.scope.resourceId, 'Evidence resource scope', 160);
  if (resourceId && resourceIds && !new Set(resourceIds).has(resourceId)) throw contractError('Evidence refers to a resource outside the application', 'EVIDENCE_SCOPE_MISMATCH');
  const scopeKey = input.scope.scopeKey == null ? null : requiredText(input.scope.scopeKey, 'Evidence provider scope', 160);

  if (!EVIDENCE_FRESHNESS.includes(input.freshness)) throw contractError('Evidence freshness is invalid');
  if (!EVIDENCE_CLASSES.includes(input.class)) throw contractError('Evidence class is invalid');
  const revision = input.revision == null ? null : Number(input.revision);
  if (revision !== null && (!Number.isInteger(revision) || revision < 0)) throw contractError('Evidence revision must be a non-negative integer');
  const generation = input.generation == null ? null : input.generation;
  if (generation !== null && !['string', 'number'].includes(typeof generation)) throw contractError('Evidence generation must be a string or integer');
  if (typeof generation === 'number' && !Number.isInteger(generation)) throw contractError('Evidence generation must be an integer');
  if (typeof generation === 'string' && generation.length > 160) throw contractError('Evidence generation is too long');

  return {
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    id,
    sourceId,
    reference,
    scope: { applicationId: scopedApplicationId, resourceId, scopeKey },
    observedAt: isoDate(input.observedAt, 'Evidence observedAt'),
    retrievedAt: isoDate(input.retrievedAt, 'Evidence retrievedAt'),
    revision,
    generation,
    freshness: input.freshness,
    class: input.class,
    summary: requiredText(input.summary, 'Evidence summary', 1000),
  };
}

module.exports = {
  CAPABILITY_NAMES,
  EVIDENCE_CLASSES,
  EVIDENCE_FRESHNESS,
  EVIDENCE_REFERENCE_KINDS,
  EVIDENCE_RECORD_SCHEMA,
  EVIDENCE_SCHEMA_VERSION,
  EXTENSION_CONTRACT_VERSION,
  EXTENSION_MANIFEST_SCHEMA,
  contractError,
  normalizeEvidenceRecord,
  normalizeExtensionManifest,
};