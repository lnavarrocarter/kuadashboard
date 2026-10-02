<template>
  <section class="lac">
    <div class="lac-range">
      <span v-if="cached" class="lac-switch" role="group" :aria-label="t('awsLogs.chart.source')">
        <button class="btn sm" :class="{ accent: source === 'levels' }" :aria-pressed="source === 'levels'" :title="t('awsLogs.chart.levelsHint')" @click="setSource('levels')">{{ t('awsLogs.chart.levels') }}</button>
        <button class="btn sm" :class="{ accent: source === 'volume' }" :aria-pressed="source === 'volume'" :title="t('awsLogs.chart.volumeHint')" @click="setSource('volume')">{{ t('awsLogs.chart.volume') }}</button>
      </span>
      <button v-for="r in LOG_RANGES" :key="r.minutes" class="btn sm" :class="{ accent: !view.stack.length && view.minutes === r.minutes }" @click="setRange(r.minutes)">{{ r.label }}</button>
      <button v-if="view.stack.length" class="btn sm" @click="zoomOut">← {{ t('awsLogs.chart.zoomOut') }}</button>
      <button class="btn sm" :disabled="loading" :title="t('awsLogs.refresh')" @click="reload">↻</button>
      <span class="text-dim lac-coverage">{{ sourceNote }}</span>
    </div>
    <div v-if="error" class="activity-notice">{{ error }}</div>
    <LogHistogram
      v-else-if="hist"
      :buckets="hist.buckets" :bin-ms="hist.binMs" :series="series" :loading="loading" :lang="settings.lang"
      :covered-from="source === 'levels' ? (hist.coverage?.oldest ?? hist.to) : null"
      :title="source === 'levels' ? t('awsLogs.chart.title') : t('awsLogs.chart.volumeTitle')"
      :subtitle="t('awsLogs.chart.subtitle', { bin: binLabel(hist.binMs), from: formatTime(hist.from, settings.lang), to: formatTime(hist.to, settings.lang) })"
      :labels="chartLabels"
      @zoom="zoom"
    />
    <div v-else-if="loading" class="empty-row">{{ source === 'levels' ? t('awsLogs.intel.decrypting') : t('common.loading') }}</div>
  </section>
</template>

<script setup>
// Activity of a log group over time with an adaptive bin size, range buttons
// and zoom. Two sources:
//  - levels: errors / warnings / info from KUA's own data (the per-minute index,
//    kept 30 days after events leave the cache, or the cached events for bins
//    under a minute). Only for cached groups.
//  - volume: total events from CloudWatch (AWS/Logs IncomingLogEvents), for any
//    group and range, about USD 0.00001 per read, stored in the local history.
// Emits `range` ({ from, to, zoomed }) when the visible window changes.
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useApi } from '../../../composables/useApi'
import { useI18n } from '../../../composables/useI18n'
import { settings } from '../../../composables/useSettings'
import { LOG_RANGES, formatTime } from '../../../lib/awsLogs'
import LogHistogram from './LogHistogram.vue'

const props = defineProps({
  group: { type: String, required: true },
  profileId: { type: String, default: '' },
  cached: { type: Boolean, default: true },
  category: { type: String, default: '' },
  level: { type: String, default: '' },
  defaultMinutes: { type: Number, default: 1440 },
})
const emit = defineEmits(['range'])
const { t } = useI18n()
const { apiFetch } = useApi()

const view = reactive({ minutes: props.defaultMinutes, from: null, to: null, stack: [] })
const source = ref(props.cached ? 'levels' : 'volume')
const hist = ref(null)
const total = ref(null) // CloudWatch total for the same window (levels mode)
const loading = ref(false)
const error = ref(null)

const series = computed(() => (source.value === 'volume'
  ? [{ key: 'events', label: t('awsLogs.chart.events'), color: 'var(--lh-info)' }]
  : [
    { key: 'error', label: t('awsLogs.intel.level_error'), color: 'var(--lh-error)' },
    { key: 'warn', label: t('awsLogs.intel.level_warn'), color: 'var(--lh-warn)' },
    { key: 'info', label: t('awsLogs.intel.level_info'), color: 'var(--lh-info)' },
  ]))
const chartLabels = computed(() => ({
  total: t('awsLogs.chart.total'), time: t('awsLogs.chart.time'), table: t('awsLogs.chart.table'),
  chart: t('awsLogs.chart.chart'), empty: t('awsLogs.chart.empty'), zoomHint: t('awsLogs.chart.zoomHint'),
  uncovered: t('awsLogs.chart.uncovered'),
}))
const sourceNote = computed(() => {
  if (!hist.value) return ''
  if (source.value === 'volume') return hist.value.requests ? t('awsLogs.chart.volumeRead', { n: hist.value.requests }) : t('awsLogs.chart.volumeHistory')
  const c = hist.value.coverage
  if (!c?.oldest) return t('awsLogs.chart.noCache')
  const seen = hist.value.events || 0
  if (total.value) {
    const percent = total.value ? Math.min(100, Math.round((seen / total.value) * 1000) / 10) : 0
    return t('awsLogs.chart.observed', { seen: seen.toLocaleString(), total: total.value.toLocaleString(), percent })
  }
  return t('awsLogs.chart.history', { from: formatTime(c.oldest, settings.lang), to: formatTime(c.syncedUntil || c.newest, settings.lang) })
})

function binLabel(ms) {
  if (ms < 60000) return `${ms / 1000} s`
  if (ms < 3600000) return `${ms / 60000} min`
  if (ms < 86400000) return `${ms / 3600000} h`
  return `${ms / 86400000} d`
}

function currentRange() {
  const to = view.to ?? Date.now()
  return { from: view.from ?? to - view.minutes * 60000, to, zoomed: view.stack.length > 0 }
}

async function reload() {
  loading.value = true
  error.value = null
  try {
    const { from, to } = currentRange()
    const query = new URLSearchParams({ group: props.group, from, to })
    let path = '/api/cloud/aws/cloudwatch/log-groups/volume'
    if (source.value === 'levels') {
      path = '/api/cloud/aws/cloudwatch/log-intelligence/histogram'
      if (props.category) query.set('category', props.category)
      if (props.level) query.set('level', props.level)
    }
    const headers = { 'X-Profile-Id': props.profileId }
    const [data, volume] = await Promise.all([
      apiFetch(`${path}?${query}`, { headers }),
      // Same window from CloudWatch (served from the local history when fresh), to show coverage.
      source.value === 'levels' && !props.category && !props.level
        ? apiFetch(`/api/cloud/aws/cloudwatch/log-groups/volume?${new URLSearchParams({ group: props.group, from, to })}`, { headers }).catch(() => null)
        : Promise.resolve(null),
    ])
    hist.value = data
    total.value = volume?.total ?? null
  } catch (err) { error.value = err.message } finally { loading.value = false }
}

function changed() {
  reload()
  emit('range', currentRange())
}

function setSource(next) {
  if (source.value === next) return
  source.value = next
  reload()
}

function setRange(minutes) {
  Object.assign(view, { minutes, from: null, to: null, stack: [] })
  changed()
}

function zoom({ from, to }) {
  view.stack.push({ from: view.from, to: view.to })
  Object.assign(view, { from, to })
  changed()
}

function zoomOut() {
  Object.assign(view, view.stack.pop())
  changed()
}

watch(() => [props.category, props.level], () => { if (source.value === 'levels') reload() })
watch(() => props.cached, cached => { if (!cached && source.value === 'levels') setSource('volume') })
watch(() => [props.group, props.profileId], () => setRange(view.minutes))

defineExpose({ reload, zoom, zoomOut, currentRange, setSource })
onMounted(reload)
</script>

<style scoped>
.lac { display: flex; flex-direction: column; gap: 6px; }
.lac-range { display: flex; gap: 4px; align-items: center; flex-wrap: wrap; }
.lac-switch { display: inline-flex; gap: 2px; margin-right: 8px; }
.lac-coverage { font-size: 11px; margin-left: auto; }
</style>
