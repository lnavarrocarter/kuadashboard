import { ref } from 'vue'
import { api } from './useApi'
import { PROVIDERS, providerIds } from '../lib/providers'

export { PROVIDERS, providerIds }

// Ids turned on for this computer (a provider of a plugin that is off is not). null until read:
// until then, and if the backend cannot answer, every provider is shown as before.
const activeIds = ref(null)
let loading = null

export function refreshProviders() {
  loading = api('GET', '/api/plugins/providers')
    .then(body => { activeIds.value = new Set((body?.providers || []).filter(provider => provider.active).map(provider => provider.id)) })
    .catch(() => {})
    .finally(() => { loading = null })
  return loading
}

export function useProviders() {
  if (activeIds.value === null && !loading) refreshProviders()
  return {
    PROVIDERS,
    providerIds,
    // Only catalog providers can be off; any other view (kuapps…) is always on.
    isProviderOn: id => activeIds.value === null || !PROVIDERS.some(provider => provider.id === id) || activeIds.value.has(id),
    refreshProviders,
  }
}
