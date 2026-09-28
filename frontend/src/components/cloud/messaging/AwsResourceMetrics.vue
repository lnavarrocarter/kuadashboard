<template>
  <div class="arm">
    <div class="arm-head">
      <span class="arm-title">{{ t('awsMsg.metrics24h') }}</span>
      <span class="arm-cost">{{ t('awsMsg.detailCost', { n: charts.length }) }}</span>
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
          :unit="chart.unit || 'count'" :color="chart.color" :points="data.series?.[chart.key] || []"
        />
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import CloudMetricChart from '../CloudMetricChart.vue'
import { useI18n } from '../../../composables/useI18n'

// One GetMetricData call per open detail (USD 0.01 per 1,000 metrics).
const props = defineProps({
  fetcher: { type: Function, required: true },
  // [{ key, label, unit?, color, stat: 'sum' | 'gauge' }]
  charts: { type: Array, required: true },
  resourceKey: { type: String, default: '' },
  emptyText: { type: String, default: '' },
})
const emit = defineEmits(['request-access'])
const { t } = useI18n()

const data = ref(null)
const loading = ref(false)
const failure = ref(null)
let requestId = 0

const hasData = computed(() => props.charts.some(chart => (data.value?.series?.[chart.key] || []).some(p => p.v)))
function total(key) {
  return Math.round((data.value?.series?.[key] || []).reduce((sum, p) => sum + (p.v || 0), 0))
}

async function load() {
  const id = ++requestId
  loading.value = true
  failure.value = null
  try {
    const result = await props.fetcher()
    if (id === requestId) data.value = result
  } catch (e) {
    if (id === requestId) failure.value = { text: e.message, access: e.details?.access || null }
  } finally {
    if (id === requestId) loading.value = false
  }
}

watch(() => props.resourceKey, () => { data.value = null; load() })
onMounted(load)
defineExpose({ load })
</script>

<style scoped>
.arm { display: flex; flex-direction: column; gap: 8px; }
.arm-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.arm-title { font-size: 12px; font-weight: 700; color: var(--text); }
.arm-cost { font-size: 11px; color: var(--text-dim); flex: 1; min-width: 160px; }
.arm-notice { margin: 0; }
.arm-quiet { color: var(--text-dim); border-color: var(--border); }
.arm-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 10px; }
</style>
