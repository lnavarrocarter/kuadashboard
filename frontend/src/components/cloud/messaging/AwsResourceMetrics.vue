<template>
  <div class="arm">
    <div class="arm-head">
      <span class="arm-title">{{ t('awsMsg.metricsTitle') }}</span>
      <div class="btn-toggle-group arm-range" role="group" :aria-label="t('awsMsg.range')">
        <button v-for="r in RANGES" :key="r.hours" :class="['btn', 'sm', { active: hours === r.hours }]" @click="setRange(r.hours)">{{ r.label }}</button>
      </div>
      <span class="arm-cost">{{ costText }}</span>
      <button class="btn sm" :disabled="loading" @click="load">{{ t('action.refresh') }}</button>
    </div>
    <div v-if="loading && !data" class="empty-row">{{ t('awsMsg.loadingMetrics') }}</div>
    <div v-else-if="failure" class="activity-notice arm-notice">
      <span>{{ t('awsMsg.metricsUnavailable', { reason: failure.text }) }}</span>
      <button v-if="failure.access" class="btn sm" @click="emit('request-access', failure)">{{ t('awsAccess.requestAccess') }}</button>
    </div>
    <template v-else-if="data">
      <div v-if="!hasData" class="activity-notice arm-notice arm-quiet">{{ emptyText || t('awsMsg.noMetrics') }}</div>
      <div class="arm-grid">
        <CloudMetricChart
          v-for="chart in charts" :key="chart.key"
          :label="`${chart.label}${chart.stat === 'sum' ? ` · ${t('awsMsg.total')} ${total(chart.key).toLocaleString()}` : ''}`"
          :unit="chart.unit || 'count'" :color="chart.color" :points="data.series?.[chart.key] || []" :show-date="hours > 24"
        />
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import CloudMetricChart from '../CloudMetricChart.vue'
import { useI18n } from '../../../composables/useI18n'

// GetMetricData bills per metric requested (not per range); the server keeps
// hourly history and only requests metrics it did not read recently.
const props = defineProps({
  // (hours) => Promise<{ series, cache: { requested, reused } }>
  fetcher: { type: Function, required: true },
  // [{ key, label, unit?, color, stat: 'sum' | 'gauge' }]
  charts: { type: Array, required: true },
  resourceKey: { type: String, default: '' },
  emptyText: { type: String, default: '' },
})
const emit = defineEmits(['request-access'])
const { t } = useI18n()

const RANGES = [{ hours: 24, label: '24h' }, { hours: 168, label: '7d' }, { hours: 720, label: '30d' }]
const hours = ref(24)
const data = ref(null)
const loading = ref(false)
const failure = ref(null)
let requestId = 0

const hasData = computed(() => props.charts.some(chart => (data.value?.series?.[chart.key] || []).some(p => p.v)))
const costText = computed(() => {
  const cache = data.value?.cache
  if (!cache) return t('awsMsg.detailCost', { n: props.charts.length })
  if (!cache.requested) return t('awsMsg.fromHistory', { n: cache.reused })
  return t('awsMsg.requestedMetrics', { requested: cache.requested, reused: cache.reused })
})
function total(key) {
  return Math.round((data.value?.series?.[key] || []).reduce((sum, p) => sum + (p.v || 0), 0))
}

async function load() {
  const id = ++requestId
  loading.value = true
  failure.value = null
  try {
    const result = await props.fetcher(hours.value)
    if (id === requestId) data.value = result
  } catch (e) {
    if (id === requestId) failure.value = { text: e.message, access: e.details?.access || null }
  } finally {
    if (id === requestId) loading.value = false
  }
}
function setRange(value) {
  if (hours.value === value) return
  hours.value = value
  load()
}

watch(() => props.resourceKey, () => { data.value = null; load() })
onMounted(load)
defineExpose({ load })
</script>

<style scoped>
.arm { display: flex; flex-direction: column; gap: 8px; }
.arm-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.arm-title { font-size: 12px; font-weight: 700; color: var(--text); }
.arm-range { display: flex; }
.arm-range .btn { border-radius: 0; }
.arm-range .btn:first-child { border-radius: 4px 0 0 4px; }
.arm-range .btn:last-child { border-radius: 0 4px 4px 0; }
.arm-range .btn.active { background: var(--accent); border-color: var(--accent); color: #fff; }
.arm-cost { font-size: 11px; color: var(--text-dim); flex: 1; min-width: 160px; }
.arm-notice { margin: 0; }
.arm-quiet { color: var(--text-dim); border-color: var(--border); }
.arm-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 10px; }
</style>
