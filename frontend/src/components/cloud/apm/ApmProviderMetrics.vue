<template>
  <section v-if="provider === 'gcp' && gcpResources.length" class="provider-metrics">
    <header class="provider-metrics-header">
      <div><h3>Cloud Monitoring</h3><small>Metrics for this Application from Google Cloud Monitoring</small></div>
      <button class="btn sm" :disabled="loading" @click="loadMetrics"><i data-lucide="refresh-cw"></i> Refresh</button>
    </header>
    <div v-if="loading" class="apm-empty compact">Loading Cloud Monitoring metrics…</div>
    <div v-else-if="error" class="alert-error">{{ error }}</div>
    <div v-else class="provider-metric-resources">
      <article v-for="resource in gcpResources" :key="resource.id" class="provider-metric-resource">
        <header><strong>{{ resource.name }}</strong><small>{{ resource.type === 'gcp-function' ? 'Cloud Function' : 'Cloud Run' }}</small></header>
        <div class="provider-metric-grid">
          <div v-for="metric in metricDefinitions(resource)" :key="metric.key" class="provider-metric-card">
            <span>{{ metric.label }}</span>
            <strong>{{ latestValue(resource.id, metric.key) }}</strong>
            <small>{{ metric.unit || 'latest point' }}</small>
          </div>
        </div>
        <small v-if="!resourceMetrics[resource.id]?.points?.length" class="text-dim">No Cloud Monitoring points in this range.</small>
      </article>
    </div>
  </section>
</template>

<script setup>
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { createIcons, icons } from 'lucide'
import { useApi } from '../../../composables/useApi'

const props = defineProps({
  provider: { type: String, default: 'aws' },
  profileId: { type: String, default: '' },
  application: { type: Object, default: null },
  resources: { type: Array, default: () => [] },
})

const { apiFetch } = useApi()
const loading = ref(false)
const error = ref('')
const resourceMetrics = reactive({})
const gcpResources = computed(() => props.resources.filter(resource => ['gcp-cloud-run', 'gcp-function'].includes(resource.type)))

function locationOf(resource) {
  return resource.key?.split('/')[0] || props.application?.region || 'us-central1'
}
function metricDefinitions(resource) {
  if (resource.type === 'gcp-function') {
    return [
      { key: 'executions', label: 'Executions', metric: 'cloudfunctions.googleapis.com/function/execution_count' },
      { key: 'duration', label: 'Duration', metric: 'cloudfunctions.googleapis.com/function/execution_times', unit: 'ms' },
      { key: 'active', label: 'Active instances', metric: 'cloudfunctions.googleapis.com/function/active_instances' },
    ]
  }
  return [
    { key: 'requests', label: 'Requests', metric: 'run.googleapis.com/request_count' },
    { key: 'latency', label: 'Latency', metric: 'run.googleapis.com/request_latencies', unit: 'ms' },
    { key: 'instances', label: 'Instances', metric: 'run.googleapis.com/container/instance_count' },
  ]
}
function filterOf(resource) {
  const label = resource.type === 'gcp-function' ? 'function_name' : 'service_name'
  return `resource.labels.${label}="${String(resource.name).replaceAll('"', '\\"')}" AND resource.labels.location="${locationOf(resource)}"`
}
function latestValue(resourceId, key) {
  const points = resourceMetrics[resourceId]?.[key]?.points || []
  const point = points[points.length - 1]
  if (!point) return '—'
  return Number(point.y).toLocaleString(undefined, { maximumFractionDigits: 2 })
}

async function loadMetrics() {
  if (props.provider !== 'gcp' || !gcpResources.value.length || !props.profileId) return
  loading.value = true
  error.value = ''
  try {
    const requests = gcpResources.value.flatMap(resource => metricDefinitions(resource).map(async metric => {
      const params = new URLSearchParams({ metric: metric.metric, filter: filterOf(resource), hours: '3', period: '60' })
      const result = await apiFetch(`/api/cloud/gcp/monitoring/timeseries?${params}`, { headers: { 'X-Profile-Id': props.profileId } })
      if (!resourceMetrics[resource.id]) resourceMetrics[resource.id] = {}
      resourceMetrics[resource.id][metric.key] = result || { points: [] }
    }))
    await Promise.all(requests)
  } catch (requestError) {
    error.value = requestError.message
  } finally {
    loading.value = false
    nextTick(() => createIcons({ icons }))
  }
}

watch(() => [props.provider, props.profileId, props.resources.map(resource => resource.id).join('|')], loadMetrics)
onMounted(loadMetrics)
</script>

<style scoped>
.provider-metrics { margin-bottom: 18px; }
.provider-metrics-header, .provider-metric-resource header { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.provider-metrics-header { margin-bottom: 8px; }
.provider-metrics-header h3 { margin: 0 0 3px; font-size: 12px; }
.provider-metrics-header small, .provider-metric-resource header small, .provider-metric-card small { color: var(--text-dim); font-size: 9px; }
.provider-metric-resources { display: grid; gap: 9px; }
.provider-metric-resource { padding: 9px; border: 1px solid var(--border); border-radius: 7px; background: var(--surface); }
.provider-metric-resource header { margin-bottom: 8px; }
.provider-metric-resource header strong { font-size: 10px; }
.provider-metric-grid { display: grid; grid-template-columns: repeat(3, minmax(100px, 1fr)); gap: 7px; }
.provider-metric-card { display: flex; min-height: 56px; flex-direction: column; justify-content: center; gap: 3px; padding: 7px 8px; border: 1px solid var(--border); border-radius: 5px; }
.provider-metric-card span { color: var(--text-dim); font-size: 9px; }
.provider-metric-card strong { font-size: 14px; }
@media (max-width: 600px) { .provider-metric-grid { grid-template-columns: 1fr; } }
</style>
