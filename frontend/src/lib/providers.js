import catalog from '../shared/providers.json'

// The providers KUA ships with (#193): the catalog shared with the backend (lib/providers.js), so
// every list of providers reads from one place. Flags: view, cloudApi, advisor, observability, scopes.
export const PROVIDERS = Object.freeze(catalog.providers.map(provider => Object.freeze({ ...provider })))

/** Ids of the providers, all of them or only those with a flag: providerIds('scopes'). */
export function providerIds(flag = null) {
  return PROVIDERS.filter(provider => !flag || provider[flag]).map(provider => provider.id)
}
