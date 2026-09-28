<template>
  <div class="mw">
    <div v-if="loading && !data" class="mw-state">{{ t('common.loading') }}</div>
    <div v-else-if="error" class="mw-state error">
      <span>{{ error.message }}</span>
      <button v-if="error.details?.access" class="mw-link" @click="emit('request-access', { access: error.details.access, message: error.message })">{{ t('awsAccess.requestAccess') }}</button>
    </div>
    <template v-else-if="data">
      <div v-if="data.alarms.length" class="mw-alarms">
        <span v-for="a in data.alarms" :key="a.name" :class="['mw-alarm', a.state?.toLowerCase()]" :title="a.reason || ''">{{ a.state }} · {{ a.name }}</span>
      </div>

      <div v-if="!hasData" class="mw-state">{{ t('awsDashboards.noData') }}</div>

      <!-- Single value: last value per series, optional sparkline -->
      <div v-else-if="view === 'singleValue'" class="mw-single">
        <div v-for="(s, i) in visibleSeries" :key="s.id + s.label" class="mw-single-item">
          <span class="mw-single-label"><span class="mw-swatch" :style="{ background: seriesColor(s, i) }"></span>{{ s.label }}</span>
          <span class="mw-single-value">{{ fmt(lastValue(s.points)) }}</span>
          <DashboardChart
            v-if="props.widget.properties?.sparkline && s.points.length > 1" class="mw-spark"
            :datasets="[lineDataset(s, i, { fill: true })]" :format-value="fmt" :aria-label="s.label"
          />
        </div>
      </div>

      <!-- Bar: one bar per series (its latest value) -->
      <DashboardChart
        v-else-if="view === 'bar'" type="bar" class="mw-chart"
        :labels="visibleSeries.map(s => s.label)"
        :datasets="[{ label: title, data: visibleSeries.map(s => lastValue(s.points)), backgroundColor: visibleSeries.map((s, i) => seriesColor(s, i)), borderRadius: 4, borderSkipped: 'start', maxBarThickness: 36 }]"
        :format-value="fmt" :aria-label="title"
      />

      <!-- Time series: one chart per y axis in use (no dual scales) -->
      <div v-else class="mw-axes">
        <DashboardChart
          v-for="axis in axes" :key="axis" class="mw-chart"
          :datasets="axisDatasets(axis)" :stacked="!!props.widget.properties?.stacked"
          :y-min="axisConfig(axis).min ?? null" :y-max="axisConfig(axis).max ?? null"
          :show-legend="axisDatasets(axis).length > 1" :format-value="fmt" :format-time="formatTime"
          :aria-label="`${title} (${axis})`"
        />
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import DashboardChart from './DashboardChart.vue'
import { useAwsStore } from '../../../stores/useAwsStore'
import { useI18n } from '../../../composables/useI18n'
import { settings } from '../../../composables/useSettings'
import { seriesColor, formatNumber, lastValue } from './dashboardFormat'

const props = defineProps({
  dashboard: { type: String, required: true },
  index: { type: Number, required: true },
  widget: { type: Object, required: true },
  range: { type: Object, required: true },        // { start, end } epoch ms
  refreshKey: { type: Number, default: 0 },
})
const emit = defineEmits(['request-access'])

const awsStore = useAwsStore()
const { t } = useI18n()
const data = ref(null)
const loading = ref(false)
const error = ref(null)
let requestId = 0

const view = computed(() => props.widget.properties?.view || 'timeSeries')
const title = computed(() => props.widget.properties?.title || '')
const visibleSeries = computed(() => (data.value?.series || []).filter(s => !s.alarm || view.value === 'timeSeries'))
const hasData = computed(() => visibleSeries.value.some(s => s.points.length))
const axes = computed(() => {
  const used = new Set(visibleSeries.value.map(s => s.yAxis || 'left'))
  return ['left', 'right'].filter(axis => used.has(axis))
})

const fmt = v => formatNumber(v, settings.lang)
const formatTime = ts => {
  const long = (props.range.end - props.range.start) > 2 * 86400000
  return new Date(ts).toLocaleString(settings.lang === 'es' ? 'es' : 'en-US', long ? { day: '2-digit', month: '2-digit', hour: '2-digit' } : { hour: '2-digit', minute: '2-digit' })
}

function axisConfig(axis) {
  return props.widget.properties?.yAxis?.[axis] || {}
}

function lineDataset(series, index, { fill = false } = {}) {
  const color = seriesColor(series, index)
  return {
    label: series.label, data: series.points, borderColor: color, backgroundColor: `${color}33`,
    borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: 0.2, fill: fill ? 'origin' : false,
  }
}

function axisDatasets(axis) {
  const stacked = !!props.widget.properties?.stacked
  const lines = visibleSeries.value
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => (s.yAxis || 'left') === axis)
    .map(({ s, i }) => lineDataset(s, i, { fill: stacked }))
  // Horizontal annotations (and alarm thresholds) as dashed reference lines across the range.
  const refs = (data.value?.horizontal || []).filter(h => (h.yAxis || 'left') === axis).map(h => ({
    label: h.label || String(h.value),
    data: [{ t: props.range.start, v: h.value }, { t: props.range.end, v: h.value }],
    borderColor: h.color || '#d62728', borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0, fill: false, stack: `ref-${h.value}`,
  }))
  return [...lines, ...refs]
}

async function load() {
  const id = ++requestId
  loading.value = true
  try {
    const result = await awsStore.fetchCwWidgetMetrics(props.dashboard, props.index, props.range)
    if (id !== requestId) return
    data.value = result
    error.value = null
  } catch (e) {
    if (id === requestId) error.value = e
  } finally {
    if (id === requestId) loading.value = false
  }
}

watch(() => [props.dashboard, props.index, props.range.start, props.range.end, props.refreshKey], load, { immediate: true })

defineExpose({ load })
</script>

<style scoped>
.mw { display: flex; flex-direction: column; gap: 6px; height: 100%; min-height: 0; }
.mw-state { margin: auto; font-size: 12px; color: var(--text-dim); text-align: center; display: flex; flex-direction: column; gap: 4px; align-items: center; }
.mw-state.error { color: var(--red); }
.mw-link { border: none; background: transparent; color: var(--accent); cursor: pointer; font: inherit; font-size: 12px; padding: 0; }
.mw-alarms { display: flex; flex-wrap: wrap; gap: 4px; }
.mw-alarm { font-size: 10px; font-weight: 600; padding: 1px 7px; border-radius: 9px; border: 1px solid var(--border); color: var(--text-dim); }
.mw-alarm.alarm { color: var(--red); border-color: color-mix(in srgb, var(--red) 55%, var(--border)); }
.mw-alarm.ok { color: var(--green); border-color: color-mix(in srgb, var(--green) 55%, var(--border)); }
.mw-axes { display: flex; flex-direction: column; gap: 6px; flex: 1; min-height: 0; }
.mw-axes .mw-chart { flex: 1; min-height: 0; }
.mw-chart { flex: 1; min-height: 0; }
.mw-single { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 10px; align-content: start; overflow: auto; }
.mw-single-item { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.mw-single-label { display: flex; align-items: center; gap: 5px; font-size: 11px; color: var(--text-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mw-swatch { width: 8px; height: 8px; border-radius: 2px; flex: none; }
.mw-single-value { font-size: 24px; font-weight: 600; font-variant-numeric: tabular-nums; }
.mw-spark { height: 34px; min-height: 34px; }
</style>
