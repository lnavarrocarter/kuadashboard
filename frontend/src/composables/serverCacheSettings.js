import { watch } from 'vue'
import { api } from './useApi'
import { settings } from './useSettings'

// Kubernetes caches live in the backend (shared list cache and Prometheus
// discovery); send the Options choices on start and whenever they change.
export function syncServerCacheSettings() {
  return watch(
    () => [settings.kubeListCacheSec, settings.kubePrometheusDiscoveryMin],
    ([kubeListCacheSec, kubePrometheusDiscoveryMin]) => {
      api('PUT', '/api/system/cache-settings', { kubeListCacheSec, kubePrometheusDiscoveryMin }).catch(() => { /* backend keeps its defaults */ })
    },
    { immediate: true },
  )
}
