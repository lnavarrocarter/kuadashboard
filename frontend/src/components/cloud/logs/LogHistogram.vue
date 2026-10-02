<template>
  <figure class="lh" :aria-label="title">
    <figcaption class="lh-head">
      <span class="lh-title">{{ title }}</span>
      <span class="lh-sub">{{ subtitle }}</span>
      <span class="lh-legend">
        <span v-for="s in series" :key="s.key" class="lh-legend-item">
          <i class="lh-swatch" :style="{ background: s.color }"></i>{{ s.label }} <b>{{ totals[s.key].toLocaleString() }}</b>
        </span>
      </span>
      <span class="lh-switch" role="group">
        <button class="btn sm" type="button" :class="{ accent: !showTable }" :aria-pressed="!showTable" @click="showTable = false">{{ labels.chart }}</button>
        <button class="btn sm" type="button" :class="{ accent: showTable }" :aria-pressed="showTable" @click="showTable = true">{{ labels.table }}</button>
      </span>
    </figcaption>

    <div v-if="!showTable" ref="plot" class="lh-plot" @pointerleave="hover = null; dragEnd = null">
      <!-- Inline size: the app's global `svg { width: 12px }` (icons) would otherwise shrink the chart. -->
      <svg :width="width" :height="HEIGHT" :style="{ width: `${width}px`, height: `${HEIGHT}px` }" :viewBox="`0 0 ${width} ${HEIGHT}`" role="img" :aria-label="subtitle">
        <g class="lh-grid">
          <g v-for="tick in yTicks" :key="tick">
            <line :x1="PAD_LEFT" :x2="width - PAD_RIGHT" :y1="y(tick)" :y2="y(tick)" />
            <text :x="PAD_LEFT - 6" :y="y(tick) + 3" text-anchor="end">{{ compact(tick) }}</text>
          </g>
        </g>
        <g v-if="uncovered">
          <rect class="lh-uncovered" :x="PAD_LEFT" :y="PAD_TOP" :width="uncovered.width" :height="plotHeight" />
          <text v-if="uncovered.width > 90" class="lh-uncovered-label" :x="PAD_LEFT + uncovered.width / 2" :y="PAD_TOP + plotHeight / 2" text-anchor="middle">{{ labels.uncovered }}</text>
        </g>
        <rect v-if="selection" class="lh-selection" :x="selection.x" :y="PAD_TOP" :width="selection.width" :height="plotHeight" />
        <g v-for="(bar, i) in bars" :key="bar.start">
          <path v-for="seg in bar.segments" :key="seg.key" :d="seg.d" :fill="seg.color" />
          <rect
            class="lh-hit" :x="bar.x - gap / 2" :y="PAD_TOP" :width="barWidth + gap" :height="plotHeight"
            @pointerenter="hover = i" @pointerdown="dragStart = i; dragEnd = i" @pointermove="dragStart != null && (dragEnd = i)"
            @pointerup="finishDrag(i)"
          />
        </g>
        <g class="lh-axis">
          <line :x1="PAD_LEFT" :x2="width - PAD_RIGHT" :y1="PAD_TOP + plotHeight" :y2="PAD_TOP + plotHeight" />
          <text v-for="tick in xTicks" :key="tick.x" :x="tick.x" :y="HEIGHT - 4" text-anchor="middle">{{ tick.label }}</text>
        </g>
      </svg>
      <div v-if="hover != null && bars[hover]" class="lh-tip" :style="tipStyle">
        <div class="lh-tip-time">{{ rangeLabel(bars[hover].start) }}</div>
        <div v-for="s in series" :key="s.key" class="lh-tip-row"><i class="lh-swatch" :style="{ background: s.color }"></i>{{ s.label }} <b>{{ (bars[hover].values[s.key] || 0).toLocaleString() }}</b></div>
        <div class="lh-tip-row lh-tip-total">{{ labels.total }} <b>{{ bars[hover].total.toLocaleString() }}</b></div>
        <div class="lh-tip-hint">{{ labels.zoomHint }}</div>
      </div>
      <div v-if="!total && !loading" class="lh-empty">{{ labels.empty }}</div>
    </div>

    <div v-else class="lh-table-wrap">
      <table class="msg-subtable">
        <thead><tr><th>{{ labels.time }}</th><th v-for="s in series" :key="s.key">{{ s.label }}</th><th>{{ labels.total }}</th></tr></thead>
        <tbody>
          <tr v-for="bar in bars.filter(b => b.total)" :key="bar.start">
            <td>{{ rangeLabel(bar.start) }}</td>
            <td v-for="s in series" :key="s.key" class="activity-cell">{{ bar.values[s.key] || 0 }}</td>
            <td class="activity-cell">{{ bar.total }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </figure>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps({
  buckets: { type: Array, default: () => [] },     // [{ start, <seriesKey>: count }]
  binMs: { type: Number, required: true },
  series: { type: Array, required: true },          // [{ key, label, color }]
  title: { type: String, default: '' },
  subtitle: { type: String, default: '' },
  loading: { type: Boolean, default: false },
  coveredFrom: { type: Number, default: null },     // data before this time is not available (shaded)
  lang: { type: String, default: 'es' },
  labels: { type: Object, default: () => ({ total: 'Total', time: 'Time', table: 'Table', chart: 'Chart', empty: 'No events', zoomHint: '' }) },
})
const emit = defineEmits(['zoom'])

const HEIGHT = 170
const PAD_TOP = 8
const PAD_BOTTOM = 20
const PAD_LEFT = 40
const PAD_RIGHT = 8
const plotHeight = HEIGHT - PAD_TOP - PAD_BOTTOM

const plot = ref(null)
const width = ref(600)
const hover = ref(null)
const dragStart = ref(null)
const dragEnd = ref(null)
const showTable = ref(false)
let observer = null

onMounted(() => {
  observer = new ResizeObserver(entries => { width.value = Math.max(240, Math.floor(entries[0].contentRect.width)) })
  if (plot.value) observer.observe(plot.value)
})
watch(showTable, () => { if (!showTable.value) requestAnimationFrame(() => plot.value && observer?.observe(plot.value)) })
onBeforeUnmount(() => observer?.disconnect())

const totals = computed(() => Object.fromEntries(props.series.map(s => [s.key, props.buckets.reduce((sum, b) => sum + (b[s.key] || 0), 0)])))
const total = computed(() => Object.values(totals.value).reduce((a, b) => a + b, 0))
const maxValue = computed(() => niceMax(Math.max(1, ...props.buckets.map(b => props.series.reduce((sum, s) => sum + (b[s.key] || 0), 0)))))

function niceMax(value) {
  const power = 10 ** Math.floor(Math.log10(value))
  return [1, 2, 2.5, 5, 10].map(m => m * power).find(m => m >= value)
}
const yTicks = computed(() => [0, maxValue.value / 2, maxValue.value])
const y = value => PAD_TOP + plotHeight - (value / maxValue.value) * plotHeight

const step = computed(() => (width.value - PAD_LEFT - PAD_RIGHT) / Math.max(1, props.buckets.length))
const gap = computed(() => (step.value >= 6 ? 2 : step.value >= 3 ? 1 : 0))
const barWidth = computed(() => Math.max(1, step.value - gap.value))

// Stacked segments; only the top segment of a bar gets the 4px rounded data-end.
const bars = computed(() => props.buckets.map((bucket, index) => {
  const x = PAD_LEFT + index * step.value + gap.value / 2
  let base = PAD_TOP + plotHeight
  const values = Object.fromEntries(props.series.map(s => [s.key, bucket[s.key] || 0]))
  const visible = props.series.filter(s => values[s.key] > 0)
  const segments = visible.map((s, i) => {
    const h = (values[s.key] / maxValue.value) * plotHeight
    const top = base - h
    const isTop = i === visible.length - 1
    const segmentGap = isTop ? 0 : Math.min(2, h / 2) * (gap.value ? 1 : 0)
    // the 2px gap sits on top of each lower segment, so every stack stays anchored to the baseline
    const d = roundedTop(x, top + segmentGap, barWidth.value, Math.max(0.5, h - segmentGap), isTop ? Math.min(4, barWidth.value / 2, h) : 0)
    base = top
    return { key: s.key, color: s.color, d }
  })
  return { start: bucket.start, x, values, total: Object.values(values).reduce((a, b) => a + b, 0), segments }
}))

function roundedTop(x, yTop, w, h, r) {
  const bottom = yTop + h
  if (!r) return `M${x},${bottom}V${yTop}H${x + w}V${bottom}Z`
  return `M${x},${bottom}V${yTop + r}Q${x},${yTop} ${x + r},${yTop}H${x + w - r}Q${x + w},${yTop} ${x + w},${yTop + r}V${bottom}Z`
}

const locale = computed(() => (props.lang === 'en' ? 'en-US' : 'es-ES'))
const spansDays = computed(() => props.buckets.length > 1 && new Date(props.buckets[0].start).toDateString() !== new Date(props.buckets[props.buckets.length - 1].start).toDateString())

function tickLabel(ms) {
  const d = new Date(ms)
  if (props.binMs >= 86400000) return d.toLocaleDateString(locale.value, { day: '2-digit', month: '2-digit' })
  const time = d.toLocaleTimeString(locale.value, { hour: '2-digit', minute: '2-digit', ...(props.binMs < 60000 ? { second: '2-digit' } : {}) })
  return spansDays.value && props.binMs >= 3600000 ? `${d.toLocaleDateString(locale.value, { day: '2-digit', month: '2-digit' })} ${time}` : time
}

function rangeLabel(start) {
  const end = start + props.binMs
  const d = new Date(start)
  const day = d.toLocaleDateString(locale.value, { day: '2-digit', month: '2-digit' })
  const opts = { hour: '2-digit', minute: '2-digit', ...(props.binMs < 60000 ? { second: '2-digit' } : {}) }
  return `${day} ${d.toLocaleTimeString(locale.value, opts)} – ${new Date(end).toLocaleTimeString(locale.value, opts)}`
}

const xTicks = computed(() => {
  const count = Math.max(2, Math.min(7, Math.floor(width.value / 110)))
  const every = Math.max(1, Math.ceil(props.buckets.length / count))
  return props.buckets.filter((_, i) => i % every === 0).map((b, i) => ({ x: PAD_LEFT + i * every * step.value + step.value / 2, label: tickLabel(b.start) }))
})

function compact(value) {
  return value >= 1000 ? `${Math.round(value / 100) / 10}k` : String(Math.round(value))
}

// Bins before `coveredFrom` have no data source (e.g. not cached yet): shade them
// so an empty stretch is not read as "no activity".
const uncovered = computed(() => {
  if (props.coveredFrom == null || !props.buckets.length) return null
  const index = props.buckets.findIndex(b => b.start + props.binMs > props.coveredFrom)
  const count = index < 0 ? props.buckets.length : index
  return count > 0 ? { width: count * step.value } : null
})

const selection = computed(() => {
  if (dragStart.value == null || dragEnd.value == null || dragStart.value === dragEnd.value) return null
  const a = Math.min(dragStart.value, dragEnd.value)
  const b = Math.max(dragStart.value, dragEnd.value)
  return { x: PAD_LEFT + a * step.value, width: (b - a + 1) * step.value }
})

function finishDrag(index) {
  if (dragStart.value == null) return
  const a = Math.min(dragStart.value, index)
  const b = Math.max(dragStart.value, index)
  dragStart.value = null
  dragEnd.value = null
  const first = props.buckets[a]
  const last = props.buckets[b]
  if (first && last) emit('zoom', { from: first.start, to: last.start + props.binMs })
}

const tipStyle = computed(() => {
  const bar = bars.value[hover.value]
  if (!bar) return {}
  const left = bar.x + barWidth.value / 2
  return left > width.value - 190 ? { right: `${width.value - left + 8}px` } : { left: `${left + 8}px` }
})
</script>

<style scoped>
/* Level colors validated (dataviz validator) against the chart surface of each theme. */
.lh { --lh-error: #c62f2f; --lh-warn: #b08d1e; --lh-info: #4a90d9; margin: 0; display: flex; flex-direction: column; gap: 6px; }
:global([data-theme="light"]) .lh { --lh-error: #a8201a; --lh-warn: #a98400; --lh-info: #2b6cb0; }
.lh-head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; font-size: 12px; }
.lh-title { font-weight: 600; color: var(--text); }
.lh-sub { color: var(--text-dim); font-size: 11px; }
.lh-legend { display: flex; gap: 12px; flex-wrap: wrap; margin-left: auto; color: var(--text-dim); font-size: 11px; }
.lh-legend-item b { color: var(--text); font-weight: 600; }
.lh-switch { display: inline-flex; gap: 2px; }
.lh-swatch { display: inline-block; width: 9px; height: 9px; border-radius: 2px; margin-right: 4px; vertical-align: -1px; }
.lh-plot { position: relative; width: 100%; user-select: none; }
.lh-plot svg { display: block; max-width: none; }
.lh-grid line { stroke: var(--border); stroke-width: 1; opacity: .6; }
.lh-grid text, .lh-axis text { fill: var(--text-dim); font-size: 10px; }
.lh-axis line { stroke: var(--border); }
.lh-hit { fill: transparent; cursor: zoom-in; }
.lh-hit:hover { fill: color-mix(in srgb, var(--text) 6%, transparent); }
.lh-uncovered { fill: color-mix(in srgb, var(--text-dim) 10%, transparent); }
.lh-uncovered-label { fill: var(--text-dim); font-size: 11px; }
.lh-selection { fill: color-mix(in srgb, var(--accent) 15%, transparent); stroke: var(--accent); stroke-width: 1; }
.lh-tip { position: absolute; top: 4px; z-index: 5; min-width: 170px; padding: 6px 8px; border-radius: 6px; border: 1px solid var(--border); background: var(--bg-modal, var(--bg-row)); box-shadow: 0 6px 18px rgba(0, 0, 0, .25); font-size: 11px; pointer-events: none; }
.lh-tip-time { color: var(--text-dim); margin-bottom: 3px; }
.lh-tip-row { display: flex; align-items: center; gap: 4px; color: var(--text); }
.lh-tip-row b { margin-left: auto; padding-left: 10px; }
.lh-tip-total { border-top: 1px solid var(--border); margin-top: 3px; padding-top: 3px; }
.lh-tip-hint { color: var(--text-dim); margin-top: 3px; font-size: 10px; }
.lh-empty { position: absolute; inset: 0; display: grid; place-items: center; color: var(--text-dim); font-size: 12px; pointer-events: none; }
.lh-table-wrap { max-height: 220px; overflow: auto; }
</style>
