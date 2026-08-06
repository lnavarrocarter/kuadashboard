<template>
  <div class="cmc-wrap">
    <div class="cmc-heading">
      <span>{{ label }}</span>
      <strong>{{ formattedLatest }}</strong>
    </div>
    <div v-if="!points.length" class="cmc-empty">No data in this range</div>
    <div v-else class="cmc-canvas"><canvas ref="canvasEl"></canvas></div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  CategoryScale,
  Chart,
  Filler,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from 'chart.js'

Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Filler, Tooltip)

const props = defineProps({
  label: { type: String, default: '' },
  unit: { type: String, default: '' },
  points: { type: Array, default: () => [] },
  color: { type: String, default: '#58a6ff' },
  xTickLimit: { type: Number, default: 7 },
})

const canvasEl = ref(null)
let chart = null

const formattedLatest = computed(() => formatValue(props.points.at(-1)?.v, props.unit))

function formatValue(value, unit) {
  const number = Number(value)
  if (!Number.isFinite(number)) return '-'
  if (unit === '%') return `${number.toFixed(1)}%`
  if (unit === 'bytes') {
    if (number >= 1e9) return `${(number / 1e9).toFixed(2)} GB`
    if (number >= 1e6) return `${(number / 1e6).toFixed(2)} MB`
    if (number >= 1e3) return `${(number / 1e3).toFixed(1)} KB`
    return `${number.toFixed(0)} B`
  }
  return number.toLocaleString(undefined, { maximumFractionDigits: 1 })
}

function buildChart() {
  if (chart) chart.destroy()
  chart = null
  if (!canvasEl.value || !props.points.length) return
  chart = new Chart(canvasEl.value, {
    type: 'line',
    data: {
      labels: props.points.map(point => new Date(point.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })),
      datasets: [{
        data: props.points.map(point => point.v),
        borderColor: props.color,
        backgroundColor: `${props.color}1f`,
        fill: true,
        tension: 0.28,
        pointRadius: 0,
        pointHoverRadius: 4,
        borderWidth: 1.5,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: context => formatValue(context.parsed.y, props.unit) } },
      },
      scales: {
        x: {
          ticks: { color: '#8b949e', font: { size: 9 }, maxTicksLimit: props.xTickLimit, maxRotation: 0 },
          grid: { display: false },
        },
        y: {
          beginAtZero: true,
          ticks: { color: '#8b949e', font: { size: 9 }, maxTicksLimit: 4, callback: value => formatValue(value, props.unit) },
          grid: { color: 'rgba(139,148,158,.12)' },
        },
      },
    },
  })
}

watch(() => props.points, buildChart, { deep: true })
onMounted(buildChart)
onBeforeUnmount(() => chart?.destroy())
</script>

<style scoped>
.cmc-wrap { min-width: 0; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-row); padding: 10px 12px; }
.cmc-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; color: var(--text-dim); font-size: 11px; }
.cmc-heading strong { color: var(--text); font-size: 15px; }
.cmc-canvas { position: relative; height: 138px; margin-top: 8px; }
.cmc-empty { height: 138px; display: grid; place-items: center; color: var(--text-dim); font-size: 11px; }
</style>