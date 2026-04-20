<template>
  <div class="ebl-root">
    <div v-if="loading" class="empty-row">Loading metrics &amp; logs...</div>
    <div v-else-if="error" class="alert-error">{{ error }}</div>
    <template v-else>

      <!-- Metric cards -->
      <section class="ebl-section">
        <div class="ebl-section-title">CloudWatch Metrics ({{ rangeLabel }})</div>
        <div class="ebl-metrics-row">
          <div v-for="m in metricCards" :key="m.key" class="ebl-metric-card" :style="{ borderTopColor: m.color }">
            <div class="ebl-metric-label">{{ m.label }}</div>
            <div class="ebl-metric-value" :style="{ color: m.color }">{{ m.total }}</div>
            <div class="ebl-metric-sub">events</div>
          </div>
        </div>

        <!-- Mini sparklines per metric (SVG) -->
        <div v-if="hasDatapoints" class="ebl-sparklines">
          <div v-for="m in metricCards" :key="`sp-${m.key}`" class="ebl-sparkline-wrap">
            <div class="ebl-sparkline-label" :style="{ color: m.color }">{{ m.label }}</div>
            <svg v-if="m.points.length > 1" :width="sparkW" height="32" class="ebl-sparkline-svg">
              <polyline
                :points="sparkPoints(m.points)"
                fill="none"
                :stroke="m.color"
                stroke-width="1.5"
                stroke-linejoin="round"
              />
              <circle
                v-for="(p, i) in sparkDots(m.points)" :key="i"
                :cx="p.x" :cy="p.y" r="2.5"
                :fill="m.color"
              />
            </svg>
            <div v-else class="ebl-sparkline-empty">No data</div>
          </div>
        </div>
        <div v-else class="text-dim" style="font-size:11px;margin-top:4px">No metric datapoints in selected range.</div>
      </section>

      <!-- Log events -->
      <section class="ebl-section">
        <div class="ebl-section-title" style="display:flex;align-items:center;gap:8px">
          <span>Log Events</span>
          <span v-if="logGroupName" class="ebl-log-group-badge">{{ logGroupName }}</span>
          <span v-else class="text-dim" style="font-size:10px">(no CloudWatch Logs target configured)</span>
        </div>

        <div v-if="!logGroupName" class="ebl-log-hint">
          <p>To capture event payloads as logs, add a <strong>CloudWatch Logs</strong> target to this rule pointing to a log group.</p>
          <p style="margin-top:4px">Example log group name: <code>/aws/events/{{ busName }}</code></p>
        </div>

        <div v-else-if="!logEvents.length" class="empty-row">No log events found in selected range.</div>

        <div v-else class="ebl-log-list">
          <div v-for="(ev, i) in logEvents" :key="i" class="ebl-log-entry">
            <span class="ebl-log-ts">{{ formatTs(ev.timestamp) }}</span>
            <span v-if="ev.logStreamName" class="ebl-log-stream">{{ shortStream(ev.logStreamName) }}</span>
            <span class="ebl-log-msg">{{ ev.message }}</span>
          </div>
        </div>
      </section>

    </template>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  data:      { type: Object,  default: null },
  loading:   { type: Boolean, default: false },
  error:     { type: String,  default: null },
  minutes:   { type: Number,  default: 60 },
  busName:   { type: String,  default: '' },
  ruleName:  { type: String,  default: '' },
})

const sparkW = 240

const METRIC_META = [
  { key: 'MatchedEvents',     label: 'Matched Events',     color: '#60a5fa' },
  { key: 'TriggeredRules',    label: 'Triggered Rules',    color: '#34d399' },
  { key: 'FailedInvocations', label: 'Failed Invocations', color: '#f87171' },
  { key: 'ThrottledRules',    label: 'Throttled Rules',    color: '#fb923c' },
]

const rangeLabel = computed(() => {
  const m = props.minutes
  if (m <= 60)   return `last ${m} min`
  if (m <= 1440) return `last ${Math.round(m / 60)} h`
  return `last ${Math.round(m / 1440)} d`
})

const metricCards = computed(() => {
  if (!props.data?.metrics) return []
  return METRIC_META.map(m => ({
    ...m,
    points: props.data.metrics[m.key] || [],
    total:  props.data.totals?.[m.key] ?? 0,
  }))
})

const hasDatapoints = computed(() => metricCards.value.some(m => m.points.length > 0))

const logGroupName = computed(() => props.data?.logGroupName || null)
const logEvents    = computed(() => props.data?.logEvents    || [])

function sparkPoints(pts) {
  if (!pts.length) return ''
  const vals = pts.map(p => p.v)
  const maxV = Math.max(...vals, 1)
  const pad  = 4
  const h    = 28
  return pts.map((p, i) => {
    const x = pad + (i / Math.max(pts.length - 1, 1)) * (sparkW - pad * 2)
    const y = h - pad - ((p.v / maxV) * (h - pad * 2))
    return `${x},${y}`
  }).join(' ')
}

function sparkDots(pts) {
  if (!pts.length) return []
  const vals = pts.map(p => p.v)
  const maxV = Math.max(...vals, 1)
  const pad  = 4
  const h    = 28
  return pts.map((p, i) => ({
    x: pad + (i / Math.max(pts.length - 1, 1)) * (sparkW - pad * 2),
    y: h - pad - ((p.v / maxV) * (h - pad * 2)),
  }))
}

function formatTs(ts) {
  return new Date(ts).toLocaleString(undefined, {
    month: '2-digit', day: '2-digit',
    hour:  '2-digit', minute: '2-digit', second: '2-digit',
  })
}

function shortStream(s) {
  // log stream names can be long (/aws/events/... or UUID)
  const parts = s.split('/')
  return parts[parts.length - 1] || s
}
</script>

<style scoped>
.ebl-root { display: flex; flex-direction: column; gap: 16px; font-size: 12px; }
.ebl-section { display: flex; flex-direction: column; gap: 8px; }
.ebl-section-title {
  font-size: 10px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase;
  color: #555; border-bottom: 1px solid #222; padding-bottom: 4px;
}

/* Metric cards */
.ebl-metrics-row { display: flex; gap: 10px; flex-wrap: wrap; }
.ebl-metric-card {
  flex: 1; min-width: 120px; max-width: 180px;
  background: rgba(255,255,255,0.03); border: 1px solid #2a2a2a;
  border-top: 2px solid #555;
  border-radius: 6px; padding: 10px 14px; display: flex; flex-direction: column; gap: 2px;
}
.ebl-metric-label { font-size: 10px; color: #666; text-transform: uppercase; letter-spacing: 0.5px; }
.ebl-metric-value { font-size: 28px; font-weight: 700; line-height: 1; }
.ebl-metric-sub   { font-size: 10px; color: #555; }

/* Sparklines */
.ebl-sparklines { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 4px; }
.ebl-sparkline-wrap { display: flex; flex-direction: column; gap: 4px; }
.ebl-sparkline-label { font-size: 10px; font-weight: 600; letter-spacing: 0.3px; }
.ebl-sparkline-svg { display: block; background: rgba(255,255,255,0.02); border-radius: 3px; }
.ebl-sparkline-empty { font-size: 10px; color: #444; width: 240px; height: 32px; display:flex;align-items:center; }

/* Log group badge */
.ebl-log-group-badge {
  font-family: monospace; font-size: 10px; color: #7dd3fc;
  background: rgba(56,189,248,0.1); border: 1px solid rgba(56,189,248,0.25);
  padding: 1px 7px; border-radius: 3px;
}

/* Log hint */
.ebl-log-hint {
  background: rgba(251,191,36,0.07); border: 1px solid rgba(251,191,36,0.2);
  border-radius: 5px; padding: 10px 14px; color: #fcd34d; font-size: 11px; line-height: 1.5;
}
.ebl-log-hint strong { color: #fde68a; }
.ebl-log-hint code {
  font-family: monospace; background: rgba(0,0,0,0.3);
  padding: 1px 5px; border-radius: 3px; font-size: 11px;
}

/* Log events */
.ebl-log-list {
  display: flex; flex-direction: column; gap: 1px;
  background: #090909; border-radius: 5px; border: 1px solid #1e1e1e;
  max-height: 320px; overflow-y: auto; padding: 4px 0;
}
.ebl-log-entry {
  display: flex; gap: 8px; align-items: baseline; padding: 3px 10px;
  border-bottom: 1px solid rgba(255,255,255,0.03); flex-wrap: wrap;
}
.ebl-log-entry:hover { background: rgba(255,255,255,0.03); }
.ebl-log-ts     { font-family: monospace; font-size: 10px; color: #555; flex-shrink: 0; white-space: nowrap; }
.ebl-log-stream { font-family: monospace; font-size: 10px; color: #3b82f6; flex-shrink: 0; }
.ebl-log-msg    { font-family: monospace; font-size: 11px; color: #a8b5c8; word-break: break-all; flex: 1; }

.text-dim   { color: #555; }
.empty-row  { padding: 24px; text-align: center; color: #555; font-size: 12px; }
.alert-error { background: rgba(239,68,68,0.1); border:1px solid rgba(239,68,68,0.3); color:#fca5a5; border-radius:5px; padding:8px 12px; font-size:12px; }
</style>
