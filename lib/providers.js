'use strict';
/**
 * lib/providers.js
 * The providers KUA ships with (#193), read from one catalog that the backend and the frontend
 * share (frontend/src/shared/providers.json). Every list of providers reads from here, so adding
 * a provider is one catalog entry instead of a dozen enums.
 *
 * Entry: { id, label, plugin, view, cloudApi, advisor, observability, scopes }
 *   plugin         id of the first-party plugin that provides it (lib/plugins), or null for the
 *                  providers that are always on (Kubernetes, AWS, GCP)
 *   view           has its own tab in the top bar
 *   cloudApi       served under /api/cloud/<id>/ (response cache, read-only mode)
 *   advisor        has Advisor scopes (<id>:...)
 *   observability  has Observability (APM) routes of its own
 *   scopes         a KUA Application scope of this provider can be bound to a local profile
 */

const CATALOG = require('../frontend/src/shared/providers.json');

const FLAGS = ['view', 'cloudApi', 'advisor', 'observability', 'scopes'];
const PROVIDER_ID = /^[a-z][a-z0-9-]{1,39}$/;
// Same shape as a plugin id in lib/plugins/pluginRegistry.js.
const PLUGIN_ID = /^[a-z][a-z0-9.-]{1,79}$/;

function catalogError(message) {
  return Object.assign(new Error(message), { code: 'INVALID_PROVIDER_CATALOG' });
}

/** Validates a catalog: unique ids, a label, every flag explicitly true or false. */
function normalizeProviderCatalog(input) {
  if (!input || input.version !== 1 || !Array.isArray(input.providers)) throw catalogError('Provider catalog must be version 1 with a providers array');
  const seen = new Set();
  return Object.freeze(input.providers.map(entry => {
    if (!entry || !PROVIDER_ID.test(entry.id || '')) throw catalogError(`Invalid provider id: ${entry?.id}`);
    if (seen.has(entry.id)) throw catalogError(`Duplicate provider: ${entry.id}`);
    seen.add(entry.id);
    if (typeof entry.label !== 'string' || !entry.label.trim()) throw catalogError(`Provider ${entry.id} needs a label`);
    if (entry.plugin !== null && !PLUGIN_ID.test(entry.plugin || '')) throw catalogError(`Provider ${entry.id} has an invalid plugin`);
    for (const flag of FLAGS) {
      if (typeof entry[flag] !== 'boolean') throw catalogError(`Provider ${entry.id} must declare ${flag} as true or false`);
    }
    return Object.freeze({ id: entry.id, label: entry.label.trim(), plugin: entry.plugin, ...Object.fromEntries(FLAGS.map(flag => [flag, entry[flag]])) });
  }));
}

const PROVIDERS = normalizeProviderCatalog(CATALOG);

/** Ids of the providers, all of them or only those with a flag: providerIds('cloudApi'). */
function providerIds(flag = null, providers = PROVIDERS) {
  if (flag && !FLAGS.includes(flag)) throw new Error(`Unknown provider flag: ${flag}`);
  return Object.freeze(providers.filter(provider => !flag || provider[flag]).map(provider => provider.id));
}

/** "aws|gcp|vercel": an alternation for route patterns. Ids are [a-z0-9-], nothing to escape. */
function providerAlternation(flag = null, providers = PROVIDERS) {
  return providerIds(flag, providers).join('|');
}

/**
 * The catalog with whether each provider is on for this computer: always for those without a
 * plugin, else what the plugin registry says. A plugin the registry does not know counts as on,
 * so a provider is never hidden because its plugin is not registered yet.
 */
function activeProviders(registry, providers = PROVIDERS) {
  const known = new Set((registry?.manifests?.() || []).map(manifest => manifest.id));
  return providers.map(provider => ({
    ...provider,
    active: !provider.plugin || !known.has(provider.plugin) || registry.isActive(provider.plugin) === true,
  }));
}

module.exports = { FLAGS, PROVIDERS, activeProviders, normalizeProviderCatalog, providerAlternation, providerIds };
