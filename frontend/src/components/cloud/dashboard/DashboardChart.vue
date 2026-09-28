<template>
  <div class="dch"><canvas ref="canvasEl" :aria-label="ariaLabel" role="img"></canvas></div>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  BarController, BarElement, CategoryScale, Chart, Filler, Legend, LinearScale,
  LineController, LineElement, PointElement, Tooltip,
} from 'chart.js'

Chart.register(LineController, LineElement, PointElement, BarController, BarElement, CategoryScale, LinearScale, Filler, Legend, Tooltip)

// Generic chart for dashboard widgets. Time series use numeric x values
// (epoch ms) on a linear scale, so no date adapter is needed.
const props = defineProps({
  type: { type: String, default: 'line' },          // 'line' | 'bar'
  datasets: { type: Array, default: () => [] },       // Chart.js datasets
  labels: { type: Array, default: null },             // category labels (bar charts)
  horizontal: Boolean,
  stacked: Boolean,
  yMin: { type: Number, default: null },
  yMax: { type: Number, default: null },
  showLegend: Boolean,
  formatValue: { type: Function, default: v => String(v) },
  formatTime: { type: Function, default: t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) },
  ariaLabel: { type: String, default: '' },
})

const canvasEl = ref(null)
let chart = null

function cssVar(name, fallback) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

function build() {
  chart?.destroy()
  chart = null
  if (!canvasEl.value) return
  const dim = cssVar('--text-dim', '#8b949e')
  const grid = 'rgba(139,148,158,.14)'
  const timeSeries = props.type === 'line' && !props.labels
  const valueAxis = {
    stacked: props.stacked,
    beginAtZero: props.yMin == null,
    ...(props.yMin != null ? { min: props.yMin } : {}),
    ...(props.yMax != null ? { max: props.yMax } : {}),
    ticks: { color: dim, font: { size: 10 }, maxTicksLimit: 5, callback: v => props.formatValue(v) },
    grid: { color: grid },
    border: { display: false },
  }
  const categoryAxis = timeSeries
    ? { type: 'linear', ticks: { color: dim, font: { size: 10 }, maxTicksLimit: 6, maxRotation: 0, callback: v => props.formatTime(v) }, grid: { display: false } }
    : { type: 'category', stacked: props.stacked, ticks: { color: dim, font: { size: 10 }, autoSkip: !props.horizontal, maxRotation: 0 }, grid: { display: false } }
  chart = new Chart(canvasEl.value, {
    type: props.type,
    data: { labels: props.labels || undefined, datasets: props.datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      indexAxis: props.horizontal ? 'y' : 'x',
      parsing: timeSeries ? { xAxisKey: 't', yAxisKey: 'v' } : undefined,
      interaction: { mode: timeSeries ? 'x' : 'nearest', intersect: false },
      plugins: {
        legend: { display: props.showLegend, position: 'bottom', labels: { color: dim, boxWidth: 10, boxHeight: 10, font: { size: 10 } } },
        tooltip: {
          callbacks: {
            title: items => (timeSeries && items[0] ? new Date(items[0].parsed.x).toLocaleString() : items[0]?.label),
            label: item => `${item.dataset.label}: ${props.formatValue(props.horizontal ? item.parsed.x : item.parsed.y)}`,
          },
        },
      },
      scales: props.horizontal ? { x: valueAxis, y: categoryAxis } : { x: categoryAxis, y: valueAxis },
    },
  })
}

watch(() => [props.datasets, props.labels, props.type, props.stacked, props.yMin, props.yMax], build, { deep: true })
onMounted(build)
onBeforeUnmount(() => chart?.destroy())
</script>

<style scoped>
.dch { position: relative; width: 100%; height: 100%; min-height: 60px; }
</style>
