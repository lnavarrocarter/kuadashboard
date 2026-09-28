<template>
  <div class="msg-detail">
    <div v-if="error" class="activity-notice">
      <span>{{ t('awsMsg.metricsUnavailable', { reason: error.text }) }}</span>
      <button v-if="error.access" class="btn sm" @click="emit('request-access', error)">{{ t('awsAccess.requestAccess') }}</button>
    </div>
    <div v-else-if="!estimate" class="text-dim">{{ t('ses.setCounting') }}</div>
    <template v-else>
      <div v-if="!estimate.dimensionNames.length" class="text-dim">{{ t('ses.setNoCloudWatch') }}</div>
      <div v-else-if="!estimate.metrics.length" class="text-dim">{{ t('ses.setNoMetrics', { dims: estimate.dimensionNames.join(', ') }) }}</div>
      <template v-else>
        <div class="msg-section-head">
          <span>{{ t('ses.setMetricsFound', { n: estimate.metrics.length, dims: estimate.dimensionNames.join(', ') }) }}</span>
          <span v-if="estimate.truncated" class="status-warn">{{ t('ses.setTruncated') }}</span>
          <div class="btn-toggle-group">
            <button v-for="r in RANGES" :key="r.hours" :class="['btn', 'sm', { active: hours === r.hours }]" @click="setRange(r.hours)">{{ r.label }}</button>
          </div>
          <button class="btn sm" :disabled="loading" @click="load">{{ data ? t('action.refresh') : t('ses.setLoad', { usd: usd }) }}</button>
        </div>
        <div v-if="data" class="text-dim msg-hint">{{ data.cache?.requested ? t('awsMsg.requestedMetrics', { requested: data.cache.requested, reused: data.cache.reused }) : t('awsMsg.fromHistory', { n: data.cache?.reused ?? 0 }) }}</div>
        <table v-if="data" class="msg-subtable">
          <thead><tr><th>{{ t('ses.dimensionValue') }}</th><th v-for="e in events" :key="e">{{ t(`ses.event_${e}`) }}</th></tr></thead>
          <tbody>
            <tr v-for="row in rows" :key="row.value">
              <td>{{ row.dimension }}=<strong>{{ row.value }}</strong></td>
              <td v-for="e in events" :key="e" :class="row[e] ? '' : 'text-dim'">{{ row[e] == null ? '—' : row[e].toLocaleString() }}</td>
            </tr>
          </tbody>
        </table>
      </template>
    </template>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useAwsStore } from '../../../stores/useAwsStore'
import { useI18n } from '../../../composables/useI18n'

// Configuration set event metrics come from its CloudWatch destination. Counting
// them (ListMetrics) is effectively free; reading them bills per metric.
const props = defineProps({ name: { type: String, required: true } })
const emit = defineEmits(['request-access'])
const awsStore = useAwsStore()
const { t } = useI18n()
const RANGES = [{ hours: 24, label: '24h' }, { hours: 168, label: '7d' }, { hours: 720, label: '30d' }]
const EVENT_ORDER = ['send', 'delivery', 'bounce', 'complaint', 'reject', 'open', 'click', 'renderingFailure', 'deliveryDelay']

const estimate = ref(null)
const data = ref(null)
const loading = ref(false)
const error = ref(null)
const hours = ref(24)

const usd = computed(() => ((estimate.value?.metrics.length || 0) * 0.00001).toFixed(5))
const events = computed(() => EVENT_ORDER.filter(e => (estimate.value?.metrics || []).some(m => m.event === e)))
const rows = computed(() => {
  const byValue = new Map()
  for (const m of estimate.value?.metrics || []) {
    const row = byValue.get(`${m.dimension}=${m.value}`) || { dimension: m.dimension, value: m.value }
    row[m.event] = data.value?.totals?.[m.key] ?? null
    byValue.set(`${m.dimension}=${m.value}`, row)
  }
  return [...byValue.values()].sort((a, b) => (b.send || 0) - (a.send || 0))
})

function setRange(value) {
  hours.value = value
  if (data.value) load()
}

async function load() {
  loading.value = true
  error.value = null
  try {
    data.value = await awsStore.fetchSesSetMetrics(props.name, { hours: hours.value })
  } catch (e) {
    error.value = { text: e.message, access: e.details?.access || null }
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  try {
    estimate.value = await awsStore.fetchSesSetMetrics(props.name, { estimate: true })
  } catch (e) {
    error.value = { text: e.message, access: e.details?.access || null }
  }
})
</script>
