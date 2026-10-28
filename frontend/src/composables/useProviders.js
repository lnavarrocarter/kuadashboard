import { ref } from 'vue'
import { api } from './useApi'
import { PROVIDERS, providerIds } from '../lib/providers'

export { PROVIDERS, providerIds }

const STORAGE_KEY = 'kua.activeProviders'

function storedIds() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
    return Array.isArray(stored) ? new Set(stored) : null
  } catch { return null }
}

// Ids turned on for this computer (a provider of a plugin that is off is not). Until the backend
// answers, the last answer this browser saw (so a tab that is off does not blink in at start), or
// null the first time: then, and if the backend cannot answer, every provider is shown.
const activeIds = ref(storedIds())
let loaded = false
let loading = null

export function refreshProviders() {
  loading = api('GET', '/api/plugins/providers')
    .then(body => {
      const ids = (body?.providers || []).filter(provider => provider.active).map(provider => provider.id)
      activeIds.value = new Set(ids)
      loaded = true
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(ids)) } catch { /* private mode */ }
    })
    .catch(() => {})
    .finally(() => { loading = null })
  return loading
}

export function useProviders() {
  if (!loaded && !loading) refreshProviders()
  return {
    PROVIDERS,
    providerIds,
    // Only catalog providers can be off; any other view (kuapps…) is always on.
    isProviderOn: id => activeIds.value === null || !PROVIDERS.some(provider => provider.id === id) || activeIds.value.has(id),
    refreshProviders,
  }
}
