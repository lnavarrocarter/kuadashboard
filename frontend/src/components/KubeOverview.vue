<template>
  <div class="kov">
    <div class="kov-toolbar">
      <div>
        <h2 class="resource-title">{{ t('sidebar.overview') }}</h2>
        <div class="kov-scope">
          {{ store.currentContext || 'cluster' }} · {{ store.namespace === 'all' ? 'todos los namespaces' : `namespace ${store.namespace}` }}
          <span v-if="overview" class="kov-updated">· actualizado {{ updatedLabel }}</span>
        </div>
      </div>
      <button class="btn btn-icon" :class="{ refreshing: loading }" :disabled="loading" title="Actualizar" @click="load()">
        <i data-lucide="refresh-cw"></i>
      </button>
    </div>

    <div v-if="!overview && loading" class="loading-state">Loading...</div>
    <div v-else-if="!overview && error" class="error-state">
      <i data-lucide="alert-triangle"></i><span>{{ error }}</span>
      <button class="btn sm" @click="load()">Retry</button>
    </div>

    <template v-else-if="overview">
      <!-- Headline tiles -->
      <div class="kov-tiles">
        <button class="kov-tile" title="Ver pods" @click="go('pods')">
          <span class="kov-tile-label">Pods</span>
          <span class="kov-tile-value">{{ pods.total ?? '—' }}</span>
          <span class="kov-tile-sub">{{ pods.ready ?? 0 }} listos · {{ pods.phases?.Running ?? 0 }} running</span>
        </button>
        <button class="kov-tile" :class="{ bad: pods.problemCount }" title="Ver pods con problemas" @click="go('pods', { quick: ['problems'] })">
          <span class="kov-tile-label"><StatusDot :level="pods.problemCount ? 'critical' : 'good'" />Pods con problemas</span>
          <span class="kov-tile-value">{{ pods.problemCount ?? '—' }}</span>
          <span class="kov-tile-sub">{{ pods.restarts ?? 0 }} reinicios en total</span>
        </button>
        <button class="kov-tile" :class="{ bad: nodes.notReady }" title="Ver nodos" @click="go('nodes', nodes.notReady ? { quick: ['not-ready'] } : {})">
          <span class="kov-tile-label"><StatusDot :level="nodes.error ? 'unknown' : nodes.notReady ? 'critical' : 'good'" />Nodos</span>
          <span class="kov-tile-value">{{ nodes.error ? '—' : `${nodes.ready}/${nodes.total}` }}</span>
          <span class="kov-tile-sub">{{ nodes.error ? 'sin permiso' : `${nodes.cordoned} cordoned · ${pressureCount} con presión` }}</span>
        </button>
        <button class="kov-tile" :class="{ warn: workloadsNotReady }" title="Ver deployments no listos" @click="go('deployments', { quick: ['not-ready'] })">
          <span class="kov-tile-label"><StatusDot :level="workloadsNotReady ? 'warning' : 'good'" />Workloads no listos</span>
          <span class="kov-tile-value">{{ overview.workloads.error ? '—' : workloadsNotReady }}</span>
          <span class="kov-tile-sub">de {{ workloadsTotal }} deployments, statefulsets y daemonsets</span>
        </button>
        <button class="kov-tile" :class="{ warn: events.warnings }" title="Ver eventos Warning y Critical" @click="go('events', { facets: ['critical', 'warning'] })">
          <span class="kov-tile-label"><StatusDot :level="events.warnings ? 'warning' : 'good'" />Warnings</span>
          <span class="kov-tile-value">{{ events.warnings ?? '—' }}</span>
          <span class="kov-tile-sub">en los últimos {{ events.windowMinutes ?? 60 }} min</span>
        </button>
      </div>

      <div class="kov-grid">
        <!-- Cluster usage -->
        <section class="kov-card">
          <h3>Uso del clúster</h3>
          <template v-if="nodes.usage">
            <div v-for="meter in usageMeters" :key="meter.label" class="kov-meter">
              <div class="kov-meter-head">
                <span>{{ meter.label }}</span>
                <span class="kov-meter-value">{{ meter.percent }}% <span class="kov-dim">{{ meter.detail }}</span></span>
              </div>
              <div class="kov-meter-track" :title="`${meter.label}: ${meter.percent}% (${meter.detail})`">
                <div class="kov-meter-fill" :class="usageLevel(meter.percent)" :style="{ width: `${Math.min(100, meter.percent)}%` }"></div>
              </div>
            </div>
            <p class="kov-note">Uso actual de metrics-server frente a la capacidad asignable de los nodos.</p>
          </template>
          <p v-else class="kov-notice">
            <i data-lucide="info"></i>
            La Metrics API (metrics-server) no está disponible, así que no hay uso de CPU ni memoria.
            <span v-if="overview.metrics.error" class="kov-dim">{{ overview.metrics.error }}</span>
          </p>
          <div class="kov-prom">
            <StatusDot :level="overview.prometheus.available ? 'good' : 'unknown'" />
            <span v-if="overview.prometheus.available">Prometheus detectado: <code>{{ overview.prometheus.service }}</code></span>
            <span v-else>No se detectó Prometheus en el clúster.</span>
          </div>
        </section>

        <!-- Pods by phase -->
        <section class="kov-card">
          <h3>Pods por estado</h3>
          <p v-if="pods.error" class="kov-notice"><i data-lucide="alert-triangle"></i>{{ pods.error }}</p>
          <template v-else>
            <div v-if="pods.total" class="kov-stack" role="img" :aria-label="phaseSummary">
              <div
                v-for="seg in phaseSegments" :key="seg.phase"
                :class="['kov-stack-seg', seg.level]" :style="{ flexGrow: seg.count }"
                :title="`${seg.phase}: ${seg.count} (${seg.percent}%)`"
              ></div>
            </div>
            <ul class="kov-legend">
              <li v-for="seg in phaseRows" :key="seg.phase">
                <span :class="['kov-swatch', seg.level]"></span>
                <span>{{ seg.phase }}</span>
                <span class="kov-legend-count">{{ seg.count }}</span>
              </li>
            </ul>
            <div v-if="reasonList.length" class="kov-reasons">
              <span class="kov-dim">Motivos:</span>
              <button
                v-for="r in reasonList" :key="r.reason" class="facet-chip kov-reason"
                :title="`Ver pods con ${r.reason}`" @click="go('pods', { filter: r.reason })"
              >{{ r.reason }} <span class="facet-count">{{ r.count }}</span></button>
            </div>
          </template>
        </section>

        <!-- Problem pods -->
        <section class="kov-card kov-wide">
          <h3>Pods con problemas <span v-if="pods.problemCount > pods.problems?.length" class="kov-dim">(top {{ pods.problems.length }} de {{ pods.problemCount }})</span></h3>
          <p v-if="!pods.problems?.length" class="kov-empty">Ningún pod con problemas.</p>
          <table v-else class="kov-table">
            <thead><tr><th>Pod</th><th>Namespace</th><th>Motivo</th><th class="num">Reinicios</th></tr></thead>
            <tbody>
              <tr v-for="p in pods.problems" :key="p.namespace + p.name" @click="go('pods', { filter: p.name })">
                <td class="kov-link">{{ p.name }}</td>
                <td>{{ p.namespace }}</td>
                <td><span class="badge failed">{{ p.reason }}</span></td>
                <td class="num">{{ p.restarts }}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <!-- Nodes -->
        <section class="kov-card kov-wide">
          <h3>Nodos</h3>
          <p v-if="nodes.error" class="kov-notice"><i data-lucide="alert-triangle"></i>{{ nodes.error }}</p>
          <table v-else class="kov-table">
            <thead><tr><th>Nodo</th><th>Estado</th><th>Roles</th><th>Condiciones</th><th>CPU</th><th>Memoria</th></tr></thead>
            <tbody>
              <tr v-for="n in nodes.items" :key="n.name" @click="go('nodes', { filter: n.name })">
                <td class="kov-link">{{ n.name }}</td>
                <td><span :class="['badge', n.ready ? (n.cordoned ? 'cordoned' : 'ready') : 'notready']">{{ n.ready ? (n.cordoned ? 'Cordoned' : 'Ready') : 'NotReady' }}</span></td>
                <td>{{ n.roles }}</td>
                <td>{{ n.pressures.length ? n.pressures.join(', ') : '—' }}</td>
                <td><MiniMeter :value="n.cpu?.percent" /></td>
                <td><MiniMeter :value="n.memory?.percent" /></td>
              </tr>
            </tbody>
          </table>
        </section>

        <!-- Workloads not ready -->
        <section class="kov-card">
          <h3>Workloads no listos</h3>
          <p v-if="overview.workloads.error" class="kov-notice"><i data-lucide="alert-triangle"></i>{{ overview.workloads.error }}</p>
          <p v-else-if="!notReadyWorkloads.length" class="kov-empty">Todos los workloads tienen sus réplicas listas.</p>
          <ul v-else class="kov-list">
            <li v-for="w in notReadyWorkloads" :key="w.kind + w.namespace + w.name" @click="go(w.kind, { filter: w.name, quick: ['not-ready'] })">
              <span class="kov-link">{{ w.name }}</span>
              <span class="kov-dim">{{ KIND_LABELS[w.kind] }}{{ w.namespace ? ` · ${w.namespace}` : '' }}</span>
              <span class="kov-list-value">{{ w.ready }}/{{ w.desired }}</span>
            </li>
          </ul>
        </section>

        <!-- Recent warnings -->
        <section class="kov-card">
          <h3>Warnings recientes</h3>
          <p v-if="events.error" class="kov-notice"><i data-lucide="alert-triangle"></i>{{ events.error }}</p>
          <p v-else-if="!events.recent?.length" class="kov-empty">Sin eventos Warning en la última hora.</p>
          <ul v-else class="kov-list">
            <li v-for="(e, i) in events.recent" :key="i" :title="e.message" @click="go('events', { filter: e.object.split('/')[1] || '' })">
              <span class="kov-link">{{ e.reason }}</span>
              <span class="kov-dim kov-ellipsis">{{ e.object }} · {{ e.message }}</span>
              <span class="kov-list-value">×{{ e.count }}</span>
            </li>
          </ul>
        </section>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick, h } from 'vue'
import { createIcons, icons } from 'lucide'
import { api } from '../composables/useApi'
import { useKubeStore } from '../stores/useKubeStore'
import { useI18n } from '../composables/useI18n'

const emit = defineEmits(['navigate'])
const store = useKubeStore()
const { t } = useI18n()

// Refreshing is driven by the app-wide auto-refresh setting; this clock only
// keeps the "updated … ago" label current.
const CLOCK_MS = 10000
const KIND_LABELS = { deployments: 'Deployment', statefulsets: 'StatefulSet', daemonsets: 'DaemonSet' }
const PHASE_LEVELS = { Running: 'good', Succeeded: 'done', Pending: 'warning', Failed: 'critical', Unknown: 'unknown' }

// Status dot: colour plus a text label from the surrounding tile, never colour alone.
const StatusDot = props => h('span', { class: ['kov-dot', props.level], 'aria-hidden': 'true' })
StatusDot.props = ['level']

const MiniMeter = props => props.value === null || props.value === undefined
  ? h('span', { class: 'kov-dim' }, '—')
  : h('span', { class: 'kov-mini', title: `${props.value}%` }, [
    h('span', { class: 'kov-mini-track' }, [h('span', { class: ['kov-mini-fill', usageLevel(props.value)], style: { width: `${Math.min(100, props.value)}%` } })]),
    h('span', { class: 'kov-mini-value' }, `${Math.round(props.value)}%`),
  ])
MiniMeter.props = ['value']

const overview = ref(null)
const loading = ref(false)
const error = ref(null)
const now = ref(Date.now())
let requestId = 0
let timer = null

const pods = computed(() => overview.value?.pods || {})
const nodes = computed(() => overview.value?.nodes || {})
const events = computed(() => overview.value?.events || {})
const pressureCount = computed(() => (nodes.value.items || []).filter(n => n.pressures.length).length)

const workloadKinds = computed(() => {
  const w = overview.value?.workloads
  return !w || w.error ? [] : Object.keys(KIND_LABELS).filter(kind => w[kind]).map(kind => [kind, w[kind]])
})
const workloadsNotReady = computed(() => workloadKinds.value.reduce((sum, [, w]) => sum + w.notReady, 0))
const workloadsTotal = computed(() => workloadKinds.value.reduce((sum, [, w]) => sum + w.total, 0))
const notReadyWorkloads = computed(() => workloadKinds.value.flatMap(([kind, w]) => w.items.map(item => ({ kind, ...item }))))

const phaseRows = computed(() => Object.entries(pods.value.phases || {}).map(([phase, count]) => ({
  phase, count, level: PHASE_LEVELS[phase] || 'unknown',
  percent: pods.value.total ? Math.round((count / pods.value.total) * 100) : 0,
})))
const phaseSegments = computed(() => phaseRows.value.filter(seg => seg.count > 0))
const phaseSummary = computed(() => phaseSegments.value.map(seg => `${seg.phase} ${seg.count}`).join(', '))
const reasonList = computed(() => Object.entries(pods.value.reasons || {})
  .map(([reason, count]) => ({ reason, count }))
  .sort((a, b) => b.count - a.count))

const usageMeters = computed(() => {
  const usage = nodes.value.usage
  if (!usage) return []
  return [
    { label: 'CPU', percent: usage.cpu.percent ?? 0, detail: `${formatCores(usage.cpu.usedNano)} / ${formatCores(usage.cpu.allocatableNano)} cores` },
    { label: 'Memoria', percent: usage.memory.percent ?? 0, detail: `${formatGiB(usage.memory.usedBytes)} / ${formatGiB(usage.memory.allocatableBytes)} GiB` },
  ]
})

const updatedLabel = computed(() => {
  const seconds = Math.max(0, Math.round((now.value - new Date(overview.value.generatedAt)) / 1000))
  return seconds < 60 ? `hace ${seconds}s` : `hace ${Math.round(seconds / 60)} min`
})

function formatCores(nano) { return (nano / 1e9).toFixed(nano >= 10e9 ? 0 : 1) }
function formatGiB(bytes) { return (bytes / 1024 ** 3).toFixed(1) }
function usageLevel(value) { return value >= 90 ? 'critical' : value >= 75 ? 'warning' : 'good' }

async function load({ background = false } = {}) {
  if (background && loading.value) return
  const id = ++requestId
  if (!background) loading.value = true
  try {
    const data = await api('GET', `/api/overview?namespace=${encodeURIComponent(store.namespace || 'all')}`)
    if (id !== requestId) return
    overview.value = data
    error.value = null
  } catch (e) {
    if (id !== requestId) return
    error.value = e.message
  } finally {
    if (id === requestId) loading.value = false
    nextTick(() => createIcons({ icons }))
  }
}

function go(resource, view = {}) {
  emit('navigate', { resource, ...view })
}


watch(() => [store.namespace, store.currentContext], () => {
  overview.value = null
  load()
})

onMounted(() => {
  load()
  timer = setInterval(() => { now.value = Date.now() }, CLOCK_MS)
})
onUnmounted(() => clearInterval(timer))

defineExpose({ load })
</script>

<style scoped>
.kov { display: flex; flex-direction: column; gap: 14px; padding: 14px 16px; overflow-y: auto; height: 100%; box-sizing: border-box; }
.kov-toolbar { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.kov-scope { color: var(--text-dim); font-size: 12px; margin-top: 2px; }
.kov-updated { opacity: .8; }
.kov-dim { color: var(--text-dim); }

.kov-tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 10px; }
.kov-tile {
  display: flex; flex-direction: column; gap: 4px; text-align: left;
  padding: 12px 14px; border: 1px solid var(--border); border-radius: 8px;
  background: var(--bg-panel); color: var(--text); cursor: pointer; font: inherit;
  transition: border-color .15s, background .15s;
}
.kov-tile:hover { border-color: var(--accent); background: var(--bg-hover); }
.kov-tile.bad { border-color: color-mix(in srgb, var(--red) 55%, var(--border)); }
.kov-tile.warn { border-color: color-mix(in srgb, var(--yellow) 45%, var(--border)); }
.kov-tile-label { display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 600; color: var(--text-dim); text-transform: uppercase; letter-spacing: .03em; }
.kov-tile-value { font-size: 26px; font-weight: 600; line-height: 1.1; font-variant-numeric: tabular-nums; }
.kov-tile-sub { font-size: 11px; color: var(--text-dim); }

.kov-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; background: var(--text-dim); }
.kov-dot.good { background: var(--green); }
.kov-dot.warning { background: var(--yellow); }
.kov-dot.critical { background: var(--red); }

.kov-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.kov-card { border: 1px solid var(--border); border-radius: 8px; background: var(--bg-panel); padding: 12px 14px; min-width: 0; }
.kov-wide { grid-column: 1 / -1; }
.kov-card h3 { margin: 0 0 10px; font-size: 12px; font-weight: 600; color: var(--text); }
.kov-empty { margin: 0; color: var(--text-dim); font-size: 12px; }
.kov-notice { display: flex; align-items: flex-start; gap: 6px; flex-wrap: wrap; margin: 0 0 8px; font-size: 12px; color: var(--text-dim); }
.kov-notice svg { width: 14px; height: 14px; flex: none; }
.kov-note { margin: 8px 0 0; font-size: 11px; color: var(--text-dim); }

.kov-meter + .kov-meter { margin-top: 10px; }
.kov-meter-head { display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 4px; }
.kov-meter-value { font-variant-numeric: tabular-nums; }
.kov-meter-track, .kov-mini-track { background: color-mix(in srgb, var(--text-dim) 18%, transparent); border-radius: 4px; overflow: hidden; }
.kov-meter-track { height: 8px; }
.kov-meter-fill, .kov-mini-fill { display: block; height: 100%; border-radius: 4px; background: var(--green); }
.kov-meter-fill.warning, .kov-mini-fill.warning { background: var(--yellow); }
.kov-meter-fill.critical, .kov-mini-fill.critical { background: var(--red); }
.kov-prom { display: flex; align-items: center; gap: 6px; margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--border); font-size: 12px; }
.kov-prom code { font-size: 11px; }

.kov-stack { display: flex; gap: 2px; height: 12px; margin-bottom: 10px; }
.kov-stack-seg { min-width: 4px; border-radius: 4px; background: var(--text-dim); }
.kov-stack-seg.good, .kov-swatch.good { background: var(--green); }
.kov-stack-seg.done, .kov-swatch.done { background: var(--teal); }
.kov-stack-seg.warning, .kov-swatch.warning { background: var(--yellow); }
.kov-stack-seg.critical, .kov-swatch.critical { background: var(--red); }
.kov-legend { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px 16px; font-size: 12px; }
.kov-legend li { display: flex; align-items: center; gap: 6px; }
.kov-legend-count { color: var(--text-dim); font-variant-numeric: tabular-nums; }
.kov-swatch { width: 10px; height: 10px; border-radius: 3px; background: var(--text-dim); }
.kov-reasons { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 12px; font-size: 12px; }
.kov-reason { --facet-color: var(--red); }

.kov-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.kov-table th { text-align: left; font-weight: 600; color: var(--text-dim); padding: 4px 8px; border-bottom: 1px solid var(--border); }
.kov-table td { padding: 5px 8px; border-bottom: 1px solid color-mix(in srgb, var(--border) 50%, transparent); }
.kov-table tbody tr { cursor: pointer; }
.kov-table tbody tr:hover td { background: var(--bg-hover); }
.kov-table .num { text-align: right; font-variant-numeric: tabular-nums; }
.kov-link { color: var(--accent); }

.kov-mini { display: inline-flex; align-items: center; gap: 6px; }
.kov-mini-track { width: 64px; height: 6px; }
.kov-mini-value { font-variant-numeric: tabular-nums; color: var(--text-dim); min-width: 32px; }

.kov-list { list-style: none; margin: 0; padding: 0; font-size: 12px; }
.kov-list li { display: flex; align-items: baseline; gap: 8px; padding: 5px 4px; border-bottom: 1px solid color-mix(in srgb, var(--border) 50%, transparent); cursor: pointer; min-width: 0; }
.kov-list li:hover { background: var(--bg-hover); }
.kov-list .kov-link { flex: none; }
.kov-ellipsis { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.kov-list-value { margin-left: auto; flex: none; font-variant-numeric: tabular-nums; color: var(--text-dim); }

@media (max-width: 900px) {
  .kov-grid { grid-template-columns: minmax(0, 1fr); }
  .kov-table th:nth-child(3), .kov-table td:nth-child(3) { display: none; }
}
</style>
