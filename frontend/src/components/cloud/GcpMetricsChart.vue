<template>
  <div class="gmc-wrap">
    <div class="gmc-title">{{ label }}<span v-if="unit" class="gmc-unit"> ({{ unit }})</span></div>
    <div v-if="!points?.length" class="gmc-empty">No data</div>
    <div v-else style="position:relative;height:130px">
      <canvas ref="canvasEl"></canvas>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
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
})

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

watch(() => props.points, () => { buildChart() }, { deep: true })
onMounted(()        => { buildChart() })
onBeforeUnmount(()  => { if (chart) { chart.destroy(); chart = null } })
</script>

<style scoped>
.gmc-wrap  { background: var(--surface, #161b22); border: 1px solid var(--border, #30363d); border-radius: 8px; padding: 10px 12px 8px; }
.gmc-title { font-size: 11px; font-weight: 600; color: var(--text-dim, #8b949e); margin-bottom: 6px; }
.gmc-unit  { font-weight: 400; }
.gmc-empty { font-size: 11px; color: var(--text-dim, #8b949e); text-align: center; padding: 24px 0; }
</style>
