<template>
  <div class="gmc-wrap" :data-status="status">
    <div class="gmc-title">{{ label }}<span v-if="unit" class="gmc-unit"> ({{ unit }})</span></div>
    <div v-if="note" class="gmc-note">{{ note }}</div>
    <div v-if="status === 'loading'" class="gmc-empty">{{ t('state.loading') }}</div>
    <div v-else-if="status === 'error'" class="gmc-empty gmc-error" role="alert">
      <div>{{ t(`gcpv.audit.err.${state.errorKind || 'unknown'}`) }}</div>
      <div class="gmc-detail" :title="state.error">{{ state.error }}</div>
      <button class="btn sm" style="margin-top:6px" @click="$emit('retry')">{{ t('common.retry') }}</button>
    </div>
    <div v-else-if="status === 'multi'" class="gmc-empty">{{ t('gcpv.audit.metricMultiSeries', { n: state.seriesCount }) }}</div>
    <div v-else-if="!points?.length" class="gmc-empty">{{ t('gcpv.audit.metricNoSamples') }}</div>
    <div v-else style="position:relative;height:130px">
      <canvas ref="canvasEl"></canvas>
    </div>
    <div v-if="state.lastSampleAt" class="gmc-note">{{ t('gcpv.audit.metricLastSample', { at: new Date(state.lastSampleAt).toLocaleTimeString() }) }}<span v-if="state.partial"> · {{ t('gcpv.audit.metricPartial') }}</span></div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from '../../composables/useI18n'
import {
  Chart, LineController, LineElement, PointElement,
  LinearScale, CategoryScale, Filler, Tooltip
} from 'chart.js'

Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Filler, Tooltip)

const props = defineProps({
  label:  { type: String,   default: '' },
  points: { type: Array,    default: () => [] },
  color:  { type: String,   default: '#818cf8' },
  unit:   { type: String,   default: '' },
  fmt:    { type: Function, default: null },
  // { status: loading | ok | empty | multi | error, error, errorKind, lastSampleAt, partial }
  state:  { type: Object,   default: () => ({}) },
  note:   { type: String,   default: '' },
})
defineEmits(['retry'])

const { t } = useI18n()
const status = computed(() => props.state?.status || (props.points?.length ? 'ok' : 'empty'))

const canvasEl = ref(null)
let chart = null

function fmtVal(v) {
  if (props.fmt) return props.fmt(v)
  const n = Number(v)
  if (isNaN(n)) return '—'
  return n >= 1e9 ? (n / 1e9).toFixed(2) + 'G'
    : n >= 1e6  ? (n / 1e6).toFixed(2) + 'M'
    : n >= 1e3  ? (n / 1e3).toFixed(2) + 'K'
    : n % 1 === 0 ? n.toString()
    : n.toFixed(4)
}

function buildChart() {
  if (!canvasEl.value || !props.points?.length) return
  if (chart) { chart.destroy(); chart = null }
  const labels = props.points.map(p => {
    const d = new Date(p.x)
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
  })
  const data   = props.points.map(p => p.y)
  const color  = props.color
  chart = new Chart(canvasEl.value, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label:           props.label,
        data,
        borderColor:     color,
        backgroundColor: color + '20',
        fill:            true,
        tension:         0.35,
        pointRadius:     1,
        pointHoverRadius: 4,
        borderWidth:     1.5,
      }]
    },
    options: {
      responsive:          true,
      maintainAspectRatio: false,
      animation:           false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => `${fmtVal(ctx.parsed.y)}${props.unit ? ' ' + props.unit : ''}`
          }
        }
      },
      scales: {
        x: {
          ticks: { color: '#8b949e', font: { size: 9 }, maxTicksLimit: 8, maxRotation: 0 },
          grid:  { color: 'rgba(255,255,255,.04)' }
        },
        y: {
          ticks: { color: '#8b949e', font: { size: 9 }, maxTicksLimit: 5,
            callback: v => fmtVal(v) },
          grid:  { color: 'rgba(255,255,255,.06)' },
          beginAtZero: true,
        }
      }
    }
  })
}

watch(() => [props.points, status.value], () => { buildChart() }, { deep: true, flush: 'post' })
onMounted(()        => { buildChart() })
onBeforeUnmount(()  => { if (chart) { chart.destroy(); chart = null } })
</script>

<style scoped>
.gmc-wrap  { background: var(--surface, #161b22); border: 1px solid var(--border, #30363d); border-radius: 8px; padding: 10px 12px 8px; }
.gmc-title { font-size: 11px; font-weight: 600; color: var(--text-dim, #8b949e); margin-bottom: 6px; }
.gmc-unit  { font-weight: 400; }
.gmc-empty { font-size: 11px; color: var(--text-dim, #8b949e); text-align: center; padding: 24px 0; }
.gmc-error { color: var(--red, #f87171); padding: 14px 4px; }
.gmc-detail { color: var(--text-dim, #8b949e); font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gmc-note  { font-size: 10px; color: var(--text-dim, #8b949e); margin: -2px 0 4px; }
</style>
