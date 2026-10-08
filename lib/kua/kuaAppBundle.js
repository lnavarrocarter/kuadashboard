'use strict';

const { normalizeGraph } = require('../architecture/graphModel');
const { normalizeScope, portableRelationshipId, portableResourceIdentity } = require('./applicationContract');

const KUA_APP_BUNDLE_KIND = 'KUAAppBundle';
// The envelope version: the account service and older KUA versions only accept 1, so new
// content is added inside it and announced by contentVersion (#153). A reader ignores what it
// does not know; an older KUA reads a contentVersion 2 bundle as the legacy one-view bundle.
const KUA_APP_BUNDLE_VERSION = 1;
const KUA_APP_BUNDLE_CONTENT_VERSION = 2;
const MAX_VIEWS = 100;
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

// A legacy application (one provider, profile and region) keeps provider and region so older
// readers and the account service still accept it; a KUA Application without provider (#149)
// travels with its portable scopes only.
function sanitizeApplication(application, scopes = []) {
  if (!application || typeof application !== 'object') return null;
  const provider = stringValue(application.provider).toLowerCase();
  const byKey = new Map();
  for (const scope of (Array.isArray(scopes) ? scopes : []).slice(0, MAX_COLLECTION_ITEMS)) {
    try {
      const normalized = normalizeScope(scope);
      if (!byKey.has(normalized.key)) byKey.set(normalized.key, normalized);
    } catch { /* an invalid scope is left out */ }
  }
  return {
    sourceId: stringValue(application.id || application.sourceId) || undefined,
    ...(provider ? { provider, region: stringValue(application.region) } : {}),
    name: stringValue(application.name),
    environment: stringValue(application.environment),
    team: stringValue(application.team),
    pollingEnabled: application.pollingEnabled === true,
    pollIntervalMinutes: Number.isFinite(Number(application.pollIntervalMinutes))
      ? Number(application.pollIntervalMinutes) : undefined,
    scopes: [...byKey.values()].map(({ provider: scopeProvider, scopeId, location, label }) => ({ provider: scopeProvider, scopeId, location, label })),
  };
}

function sanitizeProject(project) {
  if (!project || typeof project !== 'object') return null;
  return {
    sourceId: stringValue(project.id || project.sourceId) || undefined,
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

function sanitizeChange(change, localProfiles = new Set()) {
  if (!change || typeof change !== 'object') return null;
  const author = stringValue(change.author, 'local');
  return {
    sourceId: stringValue(change.id) || undefined,
    revision: Number(change.revision) || 0,
    type: stringValue(change.type, 'graph.replace'),
    subjectType: stringValue(change.subjectType, 'graph'),
    subjectId: stringValue(change.subjectId) || undefined,
    // Automatic changes record the local profile as their author; it must not leave the computer.
    author: localProfiles.has(author) ? 'local' : author,
    reason: stringValue(change.reason),
    createdAt: stringValue(change.createdAt) || undefined,
    // State payloads are deliberately excluded: they can contain arbitrary provider data.
  };
}

// The local registry identity (and the id hashed from it) includes the local profile, so a resource
// travels with its portable identity v2 instead (lib/kua/applicationContract.js). The incoming
// identityKey and id are never copied: they are recomputed, which also cleans older bundles.
// How the resource is observed (an APM resource of the application), so an import can make it a
// member again. Only the fields that address the resource: no metadata, thresholds or state.
function sanitizeApmMembership(membership) {
  if (!membership || typeof membership !== 'object') return undefined;
  const type = stringValue(membership.type);
  const key = stringValue(membership.key);
  const name = stringValue(membership.name);
  if (!type || !key || !name) return undefined;
  const optional = field => stringValue(membership[field]) || undefined;
  return {
    provider: stringValue(membership.provider).toLowerCase() || undefined,
    type, key, name,
    arn: optional('arn'),
    kind: optional('kind'),
    service: optional('service'),
    logGroup: optional('logGroup'),
    kubeContext: optional('kubeContext'),
    namespace: optional('namespace'),
    scopeId: optional('scopeId'),
    location: optional('location'),
    enabled: membership.enabled !== false,
    // How it joined (manual, tags, labels, deployment, architecture): a view brings back its own.
    associationSource: optional('associationSource'),
  };
}

function sanitizeRegistryResource(resource) {
  if (!resource || typeof resource !== 'object') return null;
  const fields = {
    provider: stringValue(resource.provider).toLowerCase(),
    scopeId: stringValue(resource.scopeId),
    location: stringValue(resource.location),
    nativeIdentifier: stringValue(resource.nativeIdentifier),
    resourceType: stringValue(resource.resourceType),
  };
  let identity;
  try { identity = portableResourceIdentity(fields); } catch { return null; }
  return {
    localId: stringValue(resource.id || resource.sourceId),
    record: {
      sourceId: identity.id,
      identityKey: identity.identityKey,
      identityVersion: identity.identityVersion,
      ...fields,
      displayName: stringValue(resource.displayName),
      lineage: sanitizeValue(resource.lineage) || [],
      sources: Array.isArray(resource.sources) ? resource.sources.map(String).slice(0, 100) : [],
      apm: sanitizeApmMembership(resource.apm),
      createdAt: stringValue(resource.createdAt) || undefined,
      updatedAt: stringValue(resource.updatedAt) || undefined,
    },
  };
}

// Endpoints are remapped to portable resource ids; a relationship to a resource that is not in
// the bundle is left out rather than exporting a local id.
function sanitizeRegistryRelationship(relationship, portableIds) {
  if (!relationship || typeof relationship !== 'object') return null;
  const sourceResourceId = portableIds.get(stringValue(relationship.sourceResourceId));
  const targetResourceId = portableIds.get(stringValue(relationship.targetResourceId));
  if (!sourceResourceId || !targetResourceId) return null;
  return {
    sourceId: portableRelationshipId(sourceResourceId, targetResourceId, relationship.relationType),
    sourceResourceId,
    targetResourceId,
    relationType: stringValue(relationship.relationType),
    status: stringValue(relationship.status),
    // Evidence values may contain raw provider responses; retain only its classification and origin.
    evidence: Array.isArray(relationship.evidence) ? relationship.evidence.map(item => ({
      type: stringValue(item?.type || item?.kind),
      sourceId: stringValue(item?.sourceId),
    })) : [],
    createdAt: stringValue(relationship.createdAt) || undefined,
    updatedAt: stringValue(relationship.updatedAt) || undefined,
  };
}

// A resource the user detached stays detached after an import: only identity v2 keys travel,
// which name the provider scope and resource but never a profile.
function sanitizeDetachment(detachment) {
  const identityKey = stringValue(detachment?.identityKey);
  let parts;
  try { parts = JSON.parse(identityKey); } catch { return null; }
  if (!Array.isArray(parts) || parts.length !== 6 || parts[0] !== 'v2') return null;
  const [, provider, scopeId, location, resourceType, nativeIdentifier] = parts;
  let identity;
  try { identity = portableResourceIdentity({ provider, scopeId, location, resourceType, nativeIdentifier }); } catch { return null; }
  return identity.identityKey === identityKey ? { resourceId: identity.id, identityKey } : null;
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

/**
 * A product Advisor acceptance (lib/advisor/posture.js) as it travels in the
 * bundle: the decision and who made it, never a scope or local id.
 */
function sanitizeAcceptance(acceptance) {
  if (!acceptance || typeof acceptance !== 'object' || !stringValue(acceptance.ruleId)) return null;
  const kind = stringValue(acceptance.kind, 'accepted');
  if (kind !== 'accepted' && kind !== 'silenced') return null;
  return {
    ruleId: stringValue(acceptance.ruleId),
    resourceKey: stringValue(acceptance.resourceKey) || null,
    resourceLabel: stringValue(acceptance.resourceLabel) || null,
    kind,
    reason: stringValue(acceptance.reason).slice(0, 500),
    author: stringValue(acceptance.author, 'local'),
    createdAt: stringValue(acceptance.createdAt) || undefined,
    expiresAt: stringValue(acceptance.expiresAt) || null,
  };
}

function sanitizeView(view, localProfiles) {
  const project = sanitizeProject(view?.project);
  if (!project) return null;
  const graph = view.graph || {};
  const projectId = stringValue(view.project.id || view.project.sourceId || graph.projectId, 'imported-project');
  return {
    project,
    graph: {
      revision: Number(graph.revision) || 0,
      updatedAt: stringValue(graph.updatedAt) || undefined,
      document: sanitizeGraph(graph.document || { projectId }, projectId),
    },
    snapshots: (Array.isArray(view.snapshots) ? view.snapshots : []).slice(0, MAX_COLLECTION_ITEMS).map(item => sanitizeSnapshot(item, projectId)).filter(Boolean),
    changes: (Array.isArray(view.changes) ? view.changes : []).slice(0, MAX_COLLECTION_ITEMS).map(change => sanitizeChange(change, localProfiles)).filter(Boolean),
  };
}

/**
 * Builds the sanitized bundle and lists what was left out (`issues`), so an import preview
 * can say it instead of dropping data silently. `views` are the application's architecture
 * views; `project`/`graph`/`snapshots`/`changes` remain accepted as its only view.
 */
function assembleKuaAppBundle(input = {}, { now = () => Date.now() } = {}) {
  const { application, scopes, project, graph, snapshots = [], changes = [], resources = [], relationships = [], detachments = [], syncStatus, acceptances = [] } = input;
  if (!application) throw bundleError('application is required');
  const issues = [];
  const sanitizedApplication = sanitizeApplication(application, scopes ?? application.scopes);
  if (!sanitizedApplication?.name) throw bundleError('application name is required');
  if (sanitizedApplication.provider) {
    if (!sanitizedApplication.region) throw bundleError('application name and region are required');
    if (!SUPPORTED_PROVIDERS.has(sanitizedApplication.provider)) throw bundleError('Unsupported application provider');
  }

  const inputViews = Array.isArray(input.views)
    ? input.views
    : (project ? [{ project, graph: graph?.document ? graph : { document: { projectId: project.id } }, snapshots, changes }] : []);
  if (inputViews.length > MAX_VIEWS) issues.push({ kind: 'views_truncated', count: inputViews.length - MAX_VIEWS });
  const localProfiles = new Set([application.profileId, ...inputViews.map(view => view?.project?.profileId), ...(resources || []).map(item => item?.profileId)]
    .map(value => stringValue(value)).filter(Boolean));
  const views = [];
  for (const view of inputViews.slice(0, MAX_VIEWS)) {
    const sanitized = sanitizeView(view, localProfiles);
    if (sanitized) views.push(sanitized);
    else issues.push({ kind: 'view_invalid' });
  }

  const registryResources = (resources || []).slice(0, MAX_COLLECTION_ITEMS).map(sanitizeRegistryResource);
  const invalidResources = registryResources.filter(item => !item).length;
  if (invalidResources) issues.push({ kind: 'resource_invalid', count: invalidResources });
  const validResources = registryResources.filter(Boolean);
  const portableIds = new Map(validResources.filter(item => item.localId).map(item => [item.localId, item.record.sourceId]));
  // A portable id names itself too, so the relationships of an exported bundle still resolve.
  for (const item of validResources) portableIds.set(item.record.sourceId, item.record.sourceId);
  const uniqueResources = [...new Map(validResources.map(item => [item.record.sourceId, item.record])).values()];
  const portableRelationships = (relationships || []).slice(0, MAX_COLLECTION_ITEMS)
    .map(item => sanitizeRegistryRelationship(item, portableIds));
  const dangling = portableRelationships.filter(item => !item).length;
  if (dangling) issues.push({ kind: 'relationship_dangling', count: dangling });
  const sanitizedDetachments = (Array.isArray(detachments) ? detachments : []).slice(0, MAX_COLLECTION_ITEMS).map(sanitizeDetachment);
  const invalidDetachments = sanitizedDetachments.filter(item => !item).length;
  if (invalidDetachments) issues.push({ kind: 'detachment_invalid', count: invalidDetachments });

  const [primary, ...additionalViews] = views;
  const bundle = {
    kind: KUA_APP_BUNDLE_KIND,
    version: KUA_APP_BUNDLE_VERSION,
    contentVersion: KUA_APP_BUNDLE_CONTENT_VERSION,
    mode: 'sanitized',
    createdAt: new Date(now()).toISOString(),
    source: {
      applicationId: sanitizedApplication.sourceId,
      projectId: primary?.project.sourceId,
    },
    application: sanitizedApplication,
    // The first view stays where older readers find it; the others follow in additionalViews.
    architecture: primary || null,
    additionalViews,
    registry: {
      resources: uniqueResources,
      relationships: [...new Map(portableRelationships.filter(Boolean).map(item => [item.sourceId, item])).values()],
      detachments: [...new Map(sanitizedDetachments.filter(Boolean).map(item => [item.identityKey, item])).values()],
      syncStatus: sanitizeSyncStatus(syncStatus),
    },
    // Product Advisor findings the team accepted or silenced. Optional: a KUA
    // without it reads the bundle as before.
    advisor: { acceptances: (acceptances || []).slice(0, MAX_COLLECTION_ITEMS).map(sanitizeAcceptance).filter(item => item?.reason) },
  };
  return { bundle, issues };
}

function buildKuaAppBundle(input = {}, options = {}) {
  return assembleKuaAppBundle(input, options).bundle;
}

/** Every architecture view of a bundle, the first one included. */
function bundleViews(bundle) {
  return [bundle?.architecture, ...(Array.isArray(bundle?.additionalViews) ? bundle.additionalViews : [])]
    .filter(view => view?.project && view.graph?.document);
}

/**
 * Reads an untrusted bundle (a file, a backup, another computer): checks the envelope,
 * sanitizes it again and reports what was left out. A legacy bundle (no contentVersion)
 * keeps working; a newer contentVersion is read as far as this KUA understands it.
 */
function readKuaAppBundle(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw bundleError('KUAAppBundle must be an object');
  if (input.kind !== KUA_APP_BUNDLE_KIND) throw bundleError(`Unsupported bundle kind: ${input.kind || 'unknown'}`);
  if (Number(input.version) !== KUA_APP_BUNDLE_VERSION) throw bundleError(`Unsupported KUAAppBundle version: ${input.version}`);
  if (input.mode !== 'sanitized') throw bundleError('Only sanitized KUAAppBundle files are accepted');
  const contentVersion = input.contentVersion == null ? 1 : Number(input.contentVersion);
  if (!Number.isInteger(contentVersion) || contentVersion < 1) throw bundleError(`Unsupported KUAAppBundle content version: ${input.contentVersion}`);
  const { bundle, issues } = assembleKuaAppBundle({
    application: input.application,
    scopes: input.application?.scopes,
    views: bundleViews(input).map(view => ({ project: view.project, graph: view.graph, snapshots: view.snapshots, changes: view.changes })),
    resources: input.registry?.resources,
    relationships: input.registry?.relationships,
    detachments: input.registry?.detachments,
    syncStatus: input.registry?.syncStatus,
    acceptances: Array.isArray(input.advisor?.acceptances) ? input.advisor.acceptances : [],
  });
  if (contentVersion > KUA_APP_BUNDLE_CONTENT_VERSION) issues.unshift({ kind: 'newer_content', contentVersion });
  return { bundle, issues, contentVersion };
}

function validateKuaAppBundle(input) {
  return readKuaAppBundle(input).bundle;
}

module.exports = {
  KUA_APP_BUNDLE_CONTENT_VERSION,
  KUA_APP_BUNDLE_KIND,
  KUA_APP_BUNDLE_VERSION,
  buildKuaAppBundle,
  bundleViews,
  readKuaAppBundle,
  sanitizeGraph,
  validateKuaAppBundle,
};
