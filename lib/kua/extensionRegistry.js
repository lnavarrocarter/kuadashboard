'use strict';

const crypto = require('node:crypto');
const { normalizeEvidenceRecord, normalizeExtensionManifest } = require('./extensionContract');

const INTERNAL_KUA_MANIFEST = Object.freeze({
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

function stableEvidenceId(sourceId, uri) {
  return `evidence:${crypto.createHash('sha256').update(`${sourceId}\n${uri}`).digest('hex').slice(0, 32)}`;
}

function timestamp(value, fallback) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date(fallback).toISOString();
}

function safeToken(value, fallback = 'change') {
  const normalized = String(value || '').replace(/[^a-zA-Z0-9_.:-]/g, '_').slice(0, 80);
  return normalized || fallback;
}

function createKuaInternalAdapter({ apmDatabase, architectureDatabase, now = () => Date.now() } = {}) {
  if (!apmDatabase || !architectureDatabase) throw new Error('apmDatabase and architectureDatabase are required');
  return {
    manifest: INTERNAL_KUA_MANIFEST,

    async queryEvidence({ applicationId }) {
      const application = apmDatabase.getApplication(applicationId);
      if (!application) throw Object.assign(new Error('KUA Application not found'), { code: 'NOT_FOUND', statusCode: 404 });
      const retrievedAt = new Date(now()).toISOString();
      const resources = apmDatabase.listRegistryResources(applicationId);
      const resourceIds = new Set(resources.map(resource => resource.id));
      const scopes = apmDatabase.listApplicationScopes(applicationId);
      const resourceScopeKey = resource => scopes.find(scope => scope.provider === resource.provider &&
        scope.scopeId === resource.scopeId && scope.location === resource.location)?.key || null;
      const records = [];

      function add({ kind, uri, label, resourceId = null, scopeKey = null, observedAt, revision, evidenceClass, summary }) {
        records.push({
          schemaVersion: 1,
          id: stableEvidenceId('kua.internal', uri),
          sourceId: 'kua.internal',
          reference: { kind, uri, label },
          scope: { applicationId, resourceId, scopeKey },
          observedAt: timestamp(observedAt, now()),
          retrievedAt,
          revision: Number.isInteger(revision) && revision >= 0 ? revision : null,
          generation: null,
          freshness: 'unknown',
          class: evidenceClass,
          summary,
        });
      }

      for (const resource of resources) {
        const uri = `kua://applications/${encodeURIComponent(applicationId)}/registry/resources/${encodeURIComponent(resource.id)}`;
        const sourceNames = (resource.sources || []).filter(source => ['apm_resource', 'architecture_node'].includes(source));
        add({
          kind: 'kua_resource', uri, label: resource.displayName || resource.resourceType,
          resourceId: resource.id, scopeKey: resourceScopeKey(resource), observedAt: resource.updatedAt,
          revision: application.revision, evidenceClass: 'observation',
          summary: `Resource is present in the local registry${sourceNames.length ? ` via ${sourceNames.join(' and ')}` : ''}.`,
        });
      }

      const namesById = new Map(resources.map(resource => [resource.id, resource.displayName || resource.resourceType]));
      for (const relationship of apmDatabase.listRegistryRelationships(applicationId)) {
        if (!resourceIds.has(relationship.sourceResourceId) || !resourceIds.has(relationship.targetResourceId)) continue;
        const uri = `kua://applications/${encodeURIComponent(applicationId)}/registry/relationships/${encodeURIComponent(relationship.id)}`;
        const status = safeToken(relationship.status, 'unknown');
        const evidenceClass = status === 'suggested' ? 'inference'
          : ['manual', 'rejected', 'confirmed'].includes(status) ? 'history' : 'observation';
        add({
          kind: 'kua_relationship', uri, label: relationship.relationType || 'relationship',
          observedAt: relationship.updatedAt, revision: application.revision, evidenceClass,
          summary: `Relationship ${safeToken(relationship.relationType, 'related_to')} is ${status} between ${safeToken(namesById.get(relationship.sourceResourceId))} and ${safeToken(namesById.get(relationship.targetResourceId))}.`,
        });
      }

      for (const projectId of application.architectureProjectIds || []) {
        let changes;
        try { changes = architectureDatabase.listChanges(projectId, { limit: 100 }); }
        catch { continue; }
        for (const change of changes) {
          const uri = `architecture://projects/${encodeURIComponent(projectId)}/changes/${encodeURIComponent(change.id)}`;
          const changeType = safeToken(change.type);
          add({
            kind: 'architecture_change', uri, label: `Revision ${change.revision}`,
            observedAt: change.createdAt, revision: change.revision, evidenceClass: 'history',
            summary: `Architecture change ${changeType} at revision ${change.revision}.`,
          });
        }
      }

      return records;
    },
  };
}

class KuaExtensionRegistry {
  constructor({ adapters = [] } = {}) {
    this.adapters = new Map();
    for (const adapter of adapters) this.register(adapter);
  }

  register(adapter) {
    if (!adapter || typeof adapter.queryEvidence !== 'function') throw new Error('Extension adapter must provide queryEvidence()');
    const manifest = normalizeExtensionManifest(adapter.manifest);
    if (this.adapters.has(manifest.id)) throw Object.assign(new Error(`Duplicate extension source: ${manifest.id}`), { code: 'DUPLICATE_EXTENSION_SOURCE' });
    this.adapters.set(manifest.id, { manifest, queryEvidence: adapter.queryEvidence });
    return manifest;
  }

  listSources() {
    return [...this.adapters.values()].map(({ manifest }) => structuredClone(manifest));
  }

  async queryEvidence({ applicationId, resourceIds = [] } = {}) {
    const evidence = new Map();
    const sources = [];
    for (const { manifest, queryEvidence } of this.adapters.values()) {
      try {
        const records = await queryEvidence({ applicationId });
        if (!Array.isArray(records)) throw new Error('Source returned an invalid evidence collection');
        for (const record of records) {
          const normalized = normalizeEvidenceRecord(record, {
            applicationId,
            resourceIds,
            sourceIds: [manifest.id],
          });
          const key = `${normalized.sourceId}:${normalized.id}`;
          if (!evidence.has(key)) evidence.set(key, normalized);
        }
        sources.push({ id: manifest.id, state: 'available' });
      } catch (error) {
        const safeCodes = new Set([
          'NOT_FOUND', 'UNSUPPORTED_EXTENSION_VERSION', 'UNSUPPORTED_EVIDENCE_VERSION',
          'UNKNOWN_EVIDENCE_SOURCE', 'EVIDENCE_SCOPE_MISMATCH',
        ]);
        sources.push({
          id: manifest.id,
          state: 'unavailable',
          code: safeCodes.has(error.code) ? error.code : 'SOURCE_UNAVAILABLE',
        });
      }
    }
    return { sources, evidence: [...evidence.values()] };
  }
}

function createKuaExtensionRegistry({ apmDatabase, architectureDatabase, adapters = [], now } = {}) {
  const internal = createKuaInternalAdapter({ apmDatabase, architectureDatabase, ...(now ? { now } : {}) });
  return new KuaExtensionRegistry({ adapters: [internal, ...adapters] });
}

module.exports = {
  INTERNAL_KUA_MANIFEST,
  KuaExtensionRegistry,
  createKuaExtensionRegistry,
  createKuaInternalAdapter,
};