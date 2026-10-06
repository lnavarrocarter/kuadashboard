'use strict';
/**
 * lib/kua/scopeCredentials.js
 * Which local profile reaches a resource of a KUA Application (#166). A legacy
 * application uses its own profile. An application without a provider uses the
 * verified binding of the scope the resource lives in. Kubernetes resources are
 * reached through their kube context and need no profile. Nothing here calls a
 * cloud or reads a credential; it only picks the profile id and region.
 */

const { normalizeScope } = require('./applicationContract');
const { resourceScopeFromApm } = require('./applicationRegistryService');

const PROVIDER_LESS_PROFILE = 'local';

function scopeError(message, code) {
  return Object.assign(new Error(message), { code, name: code });
}

/**
 * The application as a collector needs it for one resource: { ...application,
 * profileId, region }. Throws `scope_unbound` when no verified binding reaches it.
 */
function applicationForResource(database, application, resource) {
  if (application.profileId) return application;
  if (resource.type === 'kubernetes') return { ...application, profileId: PROVIDER_LESS_PROFILE, region: application.region || '' };
  const scopeOf = resourceScopeFromApm({ ...application, region: '' }, { provider: 'aws', ...resource });
  const scopes = database.listApplicationScopes(application.id);
  const bindings = new Map(database.listScopeBindings(application.id)
    .filter(binding => binding.status === 'verified')
    .map(binding => [binding.scopeKey, binding]));
  const candidates = scopes.filter(scope => scope.provider === scopeOf.provider && bindings.has(scope.key));
  // Exact account and region first, then the account alone. Only a resource that does not name
  // its account (no ARN) falls back to the one bound scope of its provider: a resource of another
  // account must never be read with these credentials.
  const exact = scopeOf.scopeId ? normalizeScope({ provider: scopeOf.provider, scopeId: scopeOf.scopeId, location: scopeOf.location }).key : null;
  const scope = scopeOf.scopeId
    ? candidates.find(item => item.key === exact) || candidates.find(item => item.scopeId === scopeOf.scopeId)
    : (candidates.length === 1 ? candidates[0] : null);
  if (!scope) throw scopeError(`No verified profile of this computer reaches the ${scopeOf.provider} scope of ${resource.name}`, 'scope_unbound');
  return { ...application, profileId: bindings.get(scope.key).profileId, region: scopeOf.location || scope.location || '' };
}

/** Profiles that may read an application without a provider through the APM routes. */
function profilesForApplication(database, application) {
  if (application.profileId) return new Set([application.profileId]);
  const profiles = new Set([PROVIDER_LESS_PROFILE]);
  for (const binding of database.listScopeBindings(application.id)) {
    if (binding.status === 'verified') profiles.add(binding.profileId);
  }
  return profiles;
}

module.exports = { applicationForResource, profilesForApplication, PROVIDER_LESS_PROFILE };
