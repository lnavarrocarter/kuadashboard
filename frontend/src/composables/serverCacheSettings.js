import { watch } from 'vue'
import { api } from './useApi'
import { settings } from './useSettings'

// Caches that live in the backend (Kubernetes list cache, Prometheus discovery,
// metric history retention); send the Options choices on start and on change.
export function syncServerCacheSettings() {
  return watch(
    () => [settings.kubeListCacheSec, settings.kubePrometheusDiscoveryMin, settings.metricHistoryDays],
    ([kubeListCacheSec, kubePrometheusDiscoveryMin, metricHistoryDays]) => {
      api('PUT', '/api/system/cache-settings', { kubeListCacheSec, kubePrometheusDiscoveryMin, metricHistoryDays }).catch(() => { /* backend keeps its defaults */ })
    },
    { immediate: true },
  )
}
