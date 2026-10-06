'use strict';
/**
 * lib/kua/applicationContract.js
 * The canonical KUA Application context (#149): identity, portable provider
 * scopes and architecture views. An application has no provider or profile of
 * its own; each resource belongs to a scope, and each computer binds its own
 * local profile to a scope. Bindings never leave the computer: they are not
 * part of this contract, of a KUAAppBundle, of sync or of the Control Plane.
 */

const crypto = require('crypto');
const { resourceScopeFromApm } = require('./applicationRegistryService');

const APPLICATION_CONTRACT_VERSION = 1;
const RESOURCE_IDENTITY_VERSION = 2;

// Providers KUA ships with. The list is open: plugins (#156) add providers such as
// Zabbix, GitHub or Datadog without a schema change, so ids are validated by shape.
const BUILTIN_PROVIDERS = Object.freeze(['aws', 'gcp', 'vercel', 'kubernetes', 'generic']);
const PROVIDER_ID = /^[a-z][a-z0-9-]{1,39}$/;
const MAX_SCOPES = 200;
const MAX_VIEWS = 100;

function contractError(message) {
  return Object.assign(new Error(message), { statusCode: 400 });
}

function text(value) {
  return value == null ? '' : String(value).trim();
}

function stableId(prefix, value) {
  return `${prefix}:${crypto.createHash('sha256').update(value).digest('hex').slice(0, 24)}`;
}

function normalizeProvider(value) {
  const provider = text(value).toLowerCase();
  if (!PROVIDER_ID.test(provider)) throw contractError(`Invalid provider: ${provider || 'empty'}`);
  return provider;
}

/**
 * A portable provider scope: AWS account + region, GCP project + location,
 * Kubernetes context, Vercel team. An empty scopeId means "not verified yet".
 */
function normalizeScope(input) {
  if (!input || typeof input !== 'object') throw contractError('Scope must be an object');
  const provider = normalizeProvider(input.provider);
  const scopeId = text(input.scopeId);
  const location = text(input.location);
  return {
    key: stableId('kua-scope', JSON.stringify([provider, scopeId, location].map(value => value.toLowerCase()))),
    provider,
    scopeId,
    location,
    label: text(input.label),
  };
}

/**
 * Resource identity v2: provider, scope, location, type and native identifier.
 * Never the local profile, so the same resource has the same identity on every
 * computer and an exported identity reveals no credential name.
 */
function portableResourceIdentity(input) {
  const provider = normalizeProvider(input?.provider);
  const resourceType = text(input?.resourceType).toLowerCase();
  const nativeIdentifier = text(input?.nativeIdentifier);
  if (!resourceType || !nativeIdentifier) throw contractError('Resource identity requires a type and a native identifier');
  const identityKey = JSON.stringify([
    `v${RESOURCE_IDENTITY_VERSION}`, provider, text(input.scopeId), text(input.location), resourceType, nativeIdentifier,
  ].map(value => value.toLowerCase()));
  return { identityVersion: RESOURCE_IDENTITY_VERSION, identityKey, id: stableId('kua-resource', identityKey) };
}

/** A relationship id built only from portable resource ids, so it is the same on every computer. */
function portableRelationshipId(sourceResourceId, targetResourceId, relationType) {
  return stableId('kua-relationship', [sourceResourceId, targetResourceId, text(relationType)].join(':'));
}

/** Validates and normalizes an application context; scopes are de-duplicated by key. */
function normalizeApplicationContext(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw contractError('Application context must be an object');
  const version = input.contractVersion == null ? APPLICATION_CONTRACT_VERSION : Number(input.contractVersion);
  if (version !== APPLICATION_CONTRACT_VERSION) throw contractError(`Unsupported application contract version: ${input.contractVersion}`);
  const name = text(input.name);
  if (!name) throw contractError('Application name is required');
  const scopes = Array.isArray(input.scopes) ? input.scopes : [];
  if (scopes.length > MAX_SCOPES) throw contractError(`An application supports up to ${MAX_SCOPES} scopes`);
  const byKey = new Map();
  for (const scope of scopes.map(normalizeScope)) if (!byKey.has(scope.key)) byKey.set(scope.key, scope);
  const projectIds = Array.isArray(input.views?.architectureProjectIds) ? input.views.architectureProjectIds : [];
  return {
    contractVersion: APPLICATION_CONTRACT_VERSION,
    id: text(input.id) || null,
    name,
    environment: text(input.environment),
    team: text(input.team),
    revision: Math.max(0, Number.parseInt(input.revision, 10) || 0),
    scopes: [...byKey.values()],
    views: { architectureProjectIds: [...new Set(projectIds.map(text).filter(Boolean))].slice(0, MAX_VIEWS) },
  };
}

/**
 * Maps a legacy APM application (one provider, profile and region) to the
 * contract without losing anything: one scope per provider scope its resources
 * live in, plus its primary scope; scopes of its own provider are bound to its local profile.
 * Bindings are returned apart because they are local-only.
 */
function legacyApplicationContext(application, { resources = [], architectureProjectIds = [] } = {}) {
  if (!application?.id) throw contractError('Legacy application is required');
  const primaryProvider = text(application.provider || 'aws').toLowerCase();
  const scopeInputs = resources.map(resource => resourceScopeFromApm(application, resource));
  // The primary scope only counts when no resource already names its account/context:
  // an AWS application's region alone does not identify an account.
  const primaryLocation = primaryProvider === 'kubernetes' ? '' : text(application.region);
  const coveredByResource = scopeInputs.some(scope => scope.provider === primaryProvider && scope.location === primaryLocation);
  if (!coveredByResource) scopeInputs.unshift({ provider: primaryProvider, scopeId: '', location: primaryLocation });
  const context = normalizeApplicationContext({
    id: application.id,
    name: application.name,
    environment: application.environment,
    team: application.team,
    revision: application.revision,
    scopes: scopeInputs,
    views: { architectureProjectIds: [application.architectureProjectId, ...architectureProjectIds].filter(Boolean) },
  });
  const profileId = text(application.profileId);
  // Only scopes of the application's own provider were reached through its profile; a
  // Kubernetes workload inside an AWS application is reached through its kube context.
  const bindings = profileId ? context.scopes.filter(scope => scope.provider === primaryProvider).map(scope => ({
    scopeKey: scope.key,
    profileId,
    // An empty scopeId is still a guess: the binding must be verified against the session.
    status: scope.scopeId ? 'migrated' : 'unverified',
  })) : [];
  return { context, bindings };
}

const EXAMPLES = Object.freeze({
  empty: {
    contractVersion: 1, id: 'app-empty', name: 'Checkout', environment: 'staging', team: 'Payments', revision: 0,
    scopes: [], views: { architectureProjectIds: [] },
  },
  kubernetesOnly: {
    contractVersion: 1, id: 'app-k8s', name: 'Search', environment: 'production', team: 'Discovery', revision: 3,
    scopes: [{ provider: 'kubernetes', scopeId: 'prod-cluster', location: '', label: 'Production cluster' }],
    views: { architectureProjectIds: ['project-search'] },
  },
  multiScope: {
    contractVersion: 1, id: 'app-orders', name: 'Orders', environment: 'production', team: 'Platform', revision: 12,
    scopes: [
      { provider: 'aws', scopeId: '111111111111', location: 'us-east-1', label: 'Orders account' },
      { provider: 'aws', scopeId: '222222222222', location: 'eu-west-1', label: 'Shared data account' },
      { provider: 'kubernetes', scopeId: 'eks-orders-prod', location: '' },
      { provider: 'vercel', scopeId: 'team_orders', location: '' },
    ],
    views: { architectureProjectIds: ['project-orders', 'project-orders-data'] },
  },
});

module.exports = {
  APPLICATION_CONTRACT_VERSION,
  BUILTIN_PROVIDERS,
  EXAMPLES,
  RESOURCE_IDENTITY_VERSION,
  legacyApplicationContext,
  normalizeApplicationContext,
  normalizeScope,
  portableRelationshipId,
  portableResourceIdentity,
};
