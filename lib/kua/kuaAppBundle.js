'use strict';

const { normalizeGraph } = require('../architecture/graphModel');

const KUA_APP_BUNDLE_KIND = 'KUAAppBundle';
const KUA_APP_BUNDLE_VERSION = 1;
const MAX_COLLECTION_ITEMS = 10000;
const MAX_STRING_LENGTH = 100000;

const SUPPORTED_PROVIDERS = new Set(['generic', 'aws', 'gcp', 'vercel', 'kubernetes']);
const SENSITIVE_KEY = /(?:password|secret|token|private.?key|access.?key|credential|kubeconfig|authorization|cookie|client.?secret|api.?key|profile.?id|raw.?log|trace.?payload|environment.?variables?|(?:^|_)(?:env|config|data|payload|request|response|body|query|sample|values?|logs?|traces?)(?:$|_))/i;

function bundleError(message) {
  return Object.assign(new Error(message), { statusCode: 400 });
}

function stringValue(value, fallback = '') {
  return value == null ? fallback : String(value).trim();
}

function sanitizeValue(value, key = '', depth = 0) {
  if (SENSITIVE_KEY.test(key)) return undefined;
  if (depth > 20) return undefined;
  if (typeof value === 'string') return value.length > MAX_STRING_LENGTH ? value.slice(0, MAX_STRING_LENGTH) : value;
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return value.slice(0, MAX_COLLECTION_ITEMS)
      .map(item => sanitizeValue(item, '', depth + 1))
      .filter(item => item !== undefined);
  }
  if (typeof value !== 'object') return undefined;
  const output = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    const sanitized = sanitizeValue(childValue, childKey, depth + 1);
    if (sanitized !== undefined) output[childKey] = sanitized;
  }
  return output;
}

function sanitizeGraph(graph, projectId) {
  const sanitized = sanitizeValue(graph) || {};
  // These fields bind an exported document to a local credential profile.
  for (const collection of [sanitized.scopes, sanitized.sources]) {
    if (!Array.isArray(collection)) continue;
    collection.forEach(item => {
      if (item && typeof item === 'object') delete item.profileId;
    });
  }
  for (const collection of [sanitized.nodes, sanitized.edges]) {
    if (!Array.isArray(collection)) continue;
    collection.forEach(item => {
      if (!Array.isArray(item?.evidence)) return;
      item.evidence = item.evidence.map(evidence => ({
        type: stringValue(evidence?.type),
        sourceId: stringValue(evidence?.sourceId),
        occurrences: Number(evidence?.occurrences) || undefined,
      }));
    });
  }
  return normalizeGraph(sanitized, projectId);
}

function sanitizeApplication(application) {
  if (!application || typeof application !== 'object') return null;
  return {
    sourceId: stringValue(application.id) || undefined,
    provider: stringValue(application.provider, 'generic').toLowerCase(),
    region: stringValue(application.region),
    name: stringValue(application.name),
    environment: stringValue(application.environment),
    team: stringValue(application.team),
    pollingEnabled: application.pollingEnabled === true,
    pollIntervalMinutes: Number.isFinite(Number(application.pollIntervalMinutes))
      ? Number(application.pollIntervalMinutes) : undefined,
  };
}

function sanitizeProject(project) {
  if (!project || typeof project !== 'object') return null;
  return {
    sourceId: stringValue(project.id) || undefined,
    name: stringValue(project.name),
    description: stringValue(project.description),
    automaticEdgeThreshold: Number.isFinite(Number(project.automaticEdgeThreshold))
      ? Number(project.automaticEdgeThreshold) : 0.85,
  };
}

function sanitizeSnapshot(snapshot, projectId) {
  if (!snapshot || typeof snapshot !== 'object' || !snapshot.document) return null;
  return {
    sourceId: stringValue(snapshot.id) || undefined,
    version: Number(snapshot.version) || 0,
    name: stringValue(snapshot.name, 'Imported snapshot'),
    description: stringValue(snapshot.description),
    sourceRevision: Number(snapshot.sourceRevision) || 0,
    createdAt: stringValue(snapshot.createdAt) || undefined,
    document: sanitizeGraph(snapshot.document, projectId),
  };
}

function sanitizeChange(change) {
  if (!change || typeof change !== 'object') return null;
  return {
    sourceId: stringValue(change.id) || undefined,
    revision: Number(change.revision) || 0,
    type: stringValue(change.type, 'graph.replace'),
    subjectType: stringValue(change.subjectType, 'graph'),
    subjectId: stringValue(change.subjectId) || undefined,
    author: stringValue(change.author, 'local'),
    reason: stringValue(change.reason),
    createdAt: stringValue(change.createdAt) || undefined,
    // State payloads are deliberately excluded: they can contain arbitrary provider data.
  };
}

function sanitizeRegistryResource(resource) {
  if (!resource || typeof resource !== 'object') return null;
  return {
    sourceId: stringValue(resource.id) || undefined,
    identityKey: stringValue(resource.identityKey),
    provider: stringValue(resource.provider).toLowerCase(),
    scopeId: stringValue(resource.scopeId),
    location: stringValue(resource.location),
    nativeIdentifier: stringValue(resource.nativeIdentifier),
    resourceType: stringValue(resource.resourceType),
    displayName: stringValue(resource.displayName),
    lineage: sanitizeValue(resource.lineage) || [],
    sources: Array.isArray(resource.sources) ? resource.sources.map(String).slice(0, 100) : [],
    createdAt: stringValue(resource.createdAt) || undefined,
    updatedAt: stringValue(resource.updatedAt) || undefined,
  };
}

function sanitizeRegistryRelationship(relationship) {
  if (!relationship || typeof relationship !== 'object') return null;
  return {
    sourceId: stringValue(relationship.id) || undefined,
    sourceResourceId: stringValue(relationship.sourceResourceId),
    targetResourceId: stringValue(relationship.targetResourceId),
    relationType: stringValue(relationship.relationType),
    status: stringValue(relationship.status),
    // Evidence values may contain raw provider responses; retain only its classification and origin.
    evidence: Array.isArray(relationship.evidence) ? relationship.evidence.map(item => ({
      type: stringValue(item?.type),
      sourceId: stringValue(item?.sourceId),
    })) : [],
    createdAt: stringValue(relationship.createdAt) || undefined,
    updatedAt: stringValue(relationship.updatedAt) || undefined,
  };
}

function sanitizeSyncStatus(status) {
  if (!status || typeof status !== 'object') return null;
  return {
    lastSuccessAt: stringValue(status.lastSuccessAt) || undefined,
    lastErrorAt: stringValue(status.lastErrorAt) || undefined,
    lastDurationMs: Number(status.lastDurationMs) || 0,
    divergentResourceCount: Number(status.divergentResourceCount) || 0,
    divergentRelationshipCount: Number(status.divergentRelationshipCount) || 0,
    updatedAt: stringValue(status.updatedAt) || undefined,
  };
}

function buildKuaAppBundle({ application, project, graph, snapshots = [], changes = [], resources = [], relationships = [], syncStatus } = {}, { now = () => Date.now() } = {}) {
  if (!application) throw bundleError('application is required');
  if (!graph?.document) throw bundleError('architecture graph is required');
  const sanitizedApplication = sanitizeApplication(application);
  const sanitizedProject = sanitizeProject(project);
  if (!sanitizedApplication.name || !sanitizedApplication.region) throw bundleError('application name and region are required');
  if (!SUPPORTED_PROVIDERS.has(sanitizedApplication.provider)) throw bundleError('Unsupported application provider');

  const projectId = stringValue(project?.id || graph.projectId, 'imported-project');
  const sanitizedGraph = sanitizeGraph(graph.document, projectId);
  return {
    kind: KUA_APP_BUNDLE_KIND,
    version: KUA_APP_BUNDLE_VERSION,
    mode: 'sanitized',
    createdAt: new Date(now()).toISOString(),
    source: {
      applicationId: sanitizedApplication.sourceId,
      projectId: sanitizedProject?.sourceId,
    },
    application: sanitizedApplication,
    architecture: sanitizedProject ? {
      project: sanitizedProject,
      graph: {
        revision: Number(graph.revision) || 0,
        updatedAt: stringValue(graph.updatedAt) || undefined,
        document: sanitizedGraph,
      },
      snapshots: snapshots.slice(0, MAX_COLLECTION_ITEMS).map(item => sanitizeSnapshot(item, projectId)).filter(Boolean),
      changes: changes.slice(0, MAX_COLLECTION_ITEMS).map(sanitizeChange).filter(Boolean),
    } : null,
    registry: {
      resources: resources.slice(0, MAX_COLLECTION_ITEMS).map(sanitizeRegistryResource).filter(Boolean),
      relationships: relationships.slice(0, MAX_COLLECTION_ITEMS).map(sanitizeRegistryRelationship).filter(Boolean),
      syncStatus: sanitizeSyncStatus(syncStatus),
    },
  };
}

function validateKuaAppBundle(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw bundleError('KUAAppBundle must be an object');
  if (input.kind !== KUA_APP_BUNDLE_KIND) throw bundleError(`Unsupported bundle kind: ${input.kind || 'unknown'}`);
  if (Number(input.version) !== KUA_APP_BUNDLE_VERSION) throw bundleError(`Unsupported KUAAppBundle version: ${input.version}`);
  if (input.mode !== 'sanitized') throw bundleError('Only sanitized KUAAppBundle files are accepted');
  const architecture = input.architecture?.project ? input.architecture : null;
  const bundle = buildKuaAppBundle({
    application: input.application,
    project: architecture?.project,
    graph: architecture?.graph || { document: { projectId: 'no-architecture' } },
    snapshots: architecture?.snapshots,
    changes: architecture?.changes,
    resources: input.registry?.resources,
    relationships: input.registry?.relationships,
    syncStatus: input.registry?.syncStatus,
  });
  if (!bundle.application.name || !bundle.application.region) throw bundleError('application name and region are required');
  return bundle;
}

module.exports = {
  KUA_APP_BUNDLE_KIND,
  KUA_APP_BUNDLE_VERSION,
  buildKuaAppBundle,
  sanitizeGraph,
  validateKuaAppBundle,
};
