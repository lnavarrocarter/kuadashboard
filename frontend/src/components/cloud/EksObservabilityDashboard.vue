<template>
  <Teleport to="body">
    <div v-if="open" class="eksobs-backdrop" @click.self="$emit('close')">
      <section class="eksobs-modal" role="dialog" aria-modal="true" aria-label="EKS observability dashboard">
        <header class="eksobs-header">
          <div>
            <div class="eksobs-eyebrow">EKS OBSERVABILITY</div>
            <div class="eksobs-title">
              {{ cluster?.name }}
              <span :class="statusClass">{{ dashboard?.cluster?.status || cluster?.status }}</span>
            </div>
            <div class="eksobs-subtitle">{{ dashboard?.cluster?.region || cluster?.region }} · Kubernetes {{ dashboard?.cluster?.version || cluster?.version }}</div>
          </div>
          <button class="eksobs-icon-btn" title="Close" @click="$emit('close')"><i data-lucide="x"></i></button>
        </header>

        <div class="eksobs-toolbar">
          <div class="eksobs-segment" aria-label="Group metrics by">
            <button v-for="option in groupOptions" :key="option.id"
              :class="{ active: groupBy === option.id }" :disabled="loading"
              @click="selectGroup(option.id)">{{ option.label }}</button>
          </div>
          <label class="eksobs-range">
            <span>Range</span>
            <select v-model.number="hours" :disabled="loading" @change="load">
              <option :value="1">1 hour</option>
              <option :value="3">3 hours</option>
              <option :value="6">6 hours</option>
              <option :value="12">12 hours</option>
              <option :value="24">24 hours</option>
              <option :value="72">3 days</option>
            </select>
          </label>
          <button class="eksobs-icon-btn" :disabled="loading" title="Refresh metrics" @click="load">
            <i data-lucide="refresh-cw" :class="{ spinning: loading }"></i>
          </button>
        </div>

        <main class="eksobs-body">
          <div v-if="loading && !dashboard" class="eksobs-loading">
            <i data-lucide="loader-circle" class="spinning"></i>
            <span>Discovering Container Insights metrics...</span>
          </div>
          <div v-else-if="error" class="eksobs-alert error">
            <i data-lucide="triangle-alert"></i><span>{{ error }}</span>
          </div>
          <template v-else-if="dashboard">
            <div class="eksobs-context">
              <div class="eksobs-tags">
                <span v-for="([key, value]) in tagEntries" :key="key"><strong>{{ key }}</strong>{{ value }}</span>
                <span v-if="!tagEntries.length" class="empty">No cluster tags</span>
              </div>
              <span v-if="dashboard.partial" class="eksobs-partial">Partial metric catalog</span>
            </div>

            <section class="eksobs-section">
              <div class="eksobs-section-heading">
                <div><span>COMPUTE STRUCTURE</span><strong>Node groups and architecture</strong></div>
                <small>{{ dashboard.nodegroups.length }} node group{{ dashboard.nodegroups.length === 1 ? '' : 's' }}</small>
              </div>
              <div v-if="dashboard.nodegroups.length" class="eksobs-nodegroups">
                <article v-for="nodegroup in dashboard.nodegroups" :key="nodegroup.name" class="eksobs-nodegroup">
                  <div class="eksobs-nodegroup-top">
                    <strong>{{ nodegroup.name }}</strong>
                    <span :class="nodegroup.status === 'ACTIVE' ? 'ok' : 'warn'">{{ nodegroup.status }}</span>
                  </div>
                  <div class="eksobs-architecture">{{ nodegroup.architecture }}</div>
                  <div class="eksobs-nodegroup-meta">{{ nodegroup.capacityType }} · {{ nodegroup.instanceTypes.join(', ') || nodegroup.amiType }}</div>
                  <div class="eksobs-scale">
                    <span>min <strong>{{ nodegroup.scaling.minSize ?? '-' }}</strong></span>
                    <span>desired <strong>{{ nodegroup.scaling.desiredSize ?? '-' }}</strong></span>
                    <span>max <strong>{{ nodegroup.scaling.maxSize ?? '-' }}</strong></span>
                  </div>
                </article>
              </div>
              <div v-else class="eksobs-inline-empty">No managed node groups found. The cluster may use Fargate, Karpenter, or self-managed nodes.</div>
            </section>

            <div v-if="!dashboard.containerInsightsAvailable" class="eksobs-onboarding">
              <i data-lucide="activity"></i>
              <div>
                <strong>Container Insights is not publishing metrics for this cluster</strong>
                <p>Enable the Amazon CloudWatch Observability add-on, then allow <code>cloudwatch:ListMetrics</code> and <code>cloudwatch:GetMetricData</code> for this profile.</p>
              </div>
            </div>
            <div v-else-if="!dashboard.availableGroupings.includes(groupBy)" class="eksobs-onboarding compact">
              <i data-lucide="filter-x"></i>
              <div>
                <strong>No {{ groupLabel.toLowerCase() }} dimension is available</strong>
                <p>Available groupings: {{ availableGroupingLabels }}.</p>
              </div>
            </div>
            <template v-else>
              <section class="eksobs-section">
                <div class="eksobs-section-heading">
                  <div><span>HEALTH SIGNALS</span><strong>Cluster totals grouped by {{ groupLabel.toLowerCase() }}</strong></div>
                  <small>{{ dashboard.source }} · {{ dashboard.period }}s resolution</small>
                </div>
                <div v-if="summaryEntries.length" class="eksobs-kpis">
                  <article v-for="([key, metric]) in summaryEntries" :key="key">
                    <span>{{ metric.label }}</span>
                    <strong>{{ formatMetric(metric.latest, metric.unit) }}</strong>
                  </article>
                </div>
                <div v-else class="eksobs-inline-empty">No datapoints were returned in this time range.</div>
              </section>

              <section v-if="summaryEntries.length" class="eksobs-charts">
                <CloudMetricChart v-for="([key, metric], index) in summaryEntries" :key="key"
                  :label="metric.label" :unit="metric.unit" :points="metric.points"
                  :color="chartColors[index % chartColors.length]" />
              </section>

              <section class="eksobs-section">
                <div class="eksobs-section-heading">
                  <div><span>BREAKDOWN</span><strong>{{ groupLabel }} signals</strong></div>
                  <small>{{ dashboard.groups.length }} group{{ dashboard.groups.length === 1 ? '' : 's' }}</small>
                </div>
                <div class="eksobs-table-wrap">
                  <table v-if="dashboard.groups.length" class="eksobs-table">
                    <thead><tr><th>{{ groupLabel }}</th><th v-for="key in metricKeys" :key="key">{{ metricLabel(key) }}</th></tr></thead>
                    <tbody><tr v-for="group in dashboard.groups" :key="group.name">
                      <td>{{ group.name }}</td>
                      <td v-for="key in metricKeys" :key="key">{{ formatGroupMetric(group.metrics[key]) }}</td>
                    </tr></tbody>
                  </table>
                  <div v-else class="eksobs-inline-empty">No groups returned datapoints in this range.</div>
                </div>
              </section>
            </template>
          </template>
        </main>
      </section>
    </div>
  </Teleport>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { createIcons, icons } from 'lucide'
import { useAwsStore } from '../../stores/useAwsStore'
import CloudMetricChart from './CloudMetricChart.vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  cluster: { type: Object, default: null },
})
defineEmits(['close'])

const awsStore = useAwsStore()
const dashboard = ref(null)
const loading = ref(false)
const error = ref('')
const hours = ref(3)
const groupBy = ref('namespace')
const groupOptions = [
  { id: 'namespace', label: 'Namespace' },
  { id: 'service', label: 'Service' },
  { id: 'pod', label: 'Pod' },
  { id: 'node', label: 'Node' },
]
const chartColors = ['#58a6ff', '#3fb950', '#d29922', '#f778ba', '#a371f7']

const groupLabel = computed(() => groupOptions.find(option => option.id === groupBy.value)?.label || groupBy.value)
const statusClass = computed(() => (dashboard.value?.cluster?.status || props.cluster?.status) === 'ACTIVE' ? 'status-ok' : 'status-warn')
const tagEntries = computed(() => Object.entries(dashboard.value?.cluster?.tags || props.cluster?.tags || {}))
const summaryEntries = computed(() => Object.entries(dashboard.value?.summary || {}))
const metricKeys = computed(() => [...new Set((dashboard.value?.groups || []).flatMap(group => Object.keys(group.metrics || {})))])
const availableGroupingLabels = computed(() => (dashboard.value?.availableGroupings || [])
  .map(id => groupOptions.find(option => option.id === id)?.label || id)
  .join(', '))

watch(() => [props.open, props.cluster?.name], ([isOpen]) => {
  if (!isOpen) return
  dashboard.value = null
  error.value = ''
  groupBy.value = 'namespace'
  hours.value = 3
  load()
}, { immediate: true })

async function load() {
  if (!props.cluster?.name || loading.value) return
  loading.value = true
  error.value = ''
  try {
    const result = await awsStore.fetchEksObservability(props.cluster.name, {
      hours: hours.value,
      groupBy: groupBy.value,
    })
    if (!result) throw new Error(awsStore.error || 'Failed to load EKS metrics')
    dashboard.value = result
  } catch (loadError) {
    error.value = loadError.message
  } finally {
    loading.value = false
    nextTick(() => createIcons({ icons }))
  }
}

function selectGroup(id) {
  if (groupBy.value === id) return
  groupBy.value = id
  load()
}

function formatMetric(value, unit) {
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

function metricLabel(key) {
  return dashboard.value?.groups.find(group => group.metrics?.[key])?.metrics[key].label || key
}

function formatGroupMetric(metric) {
  return metric ? formatMetric(metric.latest, metric.unit) : '-'
}
</script>

<style scoped>
.eksobs-backdrop { position: fixed; inset: 0; z-index: 900; display: grid; place-items: center; padding: 18px; background: rgba(1, 4, 9, .76); }
.eksobs-modal { width: min(1180px, 98vw); height: min(880px, 94vh); display: flex; flex-direction: column; overflow: hidden; border: 1px solid var(--border); border-radius: 8px; background: var(--bg); box-shadow: 0 24px 70px rgba(0, 0, 0, .55); }
.eksobs-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 16px 18px 13px; border-bottom: 1px solid var(--border); background: var(--surface); }
.eksobs-eyebrow, .eksobs-section-heading span { display: block; color: var(--accent); font-size: 10px; font-weight: 700; letter-spacing: .08em; }
.eksobs-title { display: flex; align-items: center; gap: 9px; margin-top: 3px; color: var(--text); font-size: 19px; font-weight: 700; }
.eksobs-title > span { font-size: 10px; }
.eksobs-subtitle { margin-top: 3px; color: var(--text-dim); font-size: 11px; }
.eksobs-toolbar { display: flex; align-items: center; gap: 10px; padding: 8px 18px; border-bottom: 1px solid var(--border); background: var(--bg-row); }
.eksobs-segment { display: flex; gap: 2px; }
.eksobs-segment button { min-width: 82px; height: 30px; border: 1px solid transparent; border-radius: 4px; background: transparent; color: var(--text-dim); cursor: pointer; font-size: 11px; }
.eksobs-segment button:hover { color: var(--text); background: rgba(139, 148, 158, .1); }
.eksobs-segment button.active { border-color: rgba(88, 166, 255, .4); background: rgba(88, 166, 255, .13); color: var(--accent); }
.eksobs-range { display: flex; align-items: center; gap: 7px; margin-left: auto; color: var(--text-dim); font-size: 11px; }
.eksobs-range select { height: 30px; border: 1px solid var(--border); border-radius: 4px; background: var(--surface); color: var(--text); padding: 0 8px; font-size: 11px; }
.eksobs-icon-btn { width: 30px; height: 30px; display: grid; place-items: center; flex: 0 0 auto; border: 1px solid var(--border); border-radius: 4px; background: transparent; color: var(--text-dim); cursor: pointer; }
.eksobs-icon-btn:hover { color: var(--text); background: rgba(139, 148, 158, .1); }
.eksobs-icon-btn:disabled { cursor: default; opacity: .55; }
.eksobs-icon-btn :deep(svg) { width: 15px; height: 15px; }
.eksobs-body { flex: 1; min-height: 0; overflow: auto; padding: 16px 18px 24px; }
.eksobs-loading { height: 100%; display: grid; place-content: center; justify-items: center; gap: 10px; color: var(--text-dim); font-size: 12px; }
.eksobs-loading :deep(svg) { width: 24px; height: 24px; color: var(--accent); }
.spinning { animation: eksobs-spin .8s linear infinite; }
@keyframes eksobs-spin { to { transform: rotate(360deg); } }
.eksobs-alert, .eksobs-onboarding { display: flex; align-items: flex-start; gap: 12px; border: 1px solid rgba(210, 153, 34, .35); border-radius: 8px; background: rgba(210, 153, 34, .07); padding: 14px; color: var(--text); }
.eksobs-alert.error { border-color: rgba(248, 81, 73, .4); background: rgba(248, 81, 73, .08); color: var(--red); }
.eksobs-onboarding.compact { margin-top: 12px; }
.eksobs-onboarding :deep(svg), .eksobs-alert :deep(svg) { width: 18px; height: 18px; flex: 0 0 auto; color: var(--yellow); }
.eksobs-onboarding p { margin: 4px 0 0; color: var(--text-dim); font-size: 12px; line-height: 1.45; }
.eksobs-onboarding code { padding: 1px 4px; border-radius: 3px; background: var(--bg-row); color: var(--text); }
.eksobs-context { min-height: 28px; display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; margin-bottom: 12px; }
.eksobs-tags { display: flex; flex-wrap: wrap; gap: 5px; }
.eksobs-tags > span { display: inline-flex; gap: 4px; border: 1px solid var(--border); border-radius: 4px; background: var(--bg-row); padding: 3px 7px; color: var(--text-dim); font-size: 10px; }
.eksobs-tags strong { color: var(--text); font-weight: 600; }
.eksobs-tags .empty { border-style: dashed; }
.eksobs-partial { color: var(--yellow); font-size: 10px; white-space: nowrap; }
.eksobs-section { margin-bottom: 16px; }
.eksobs-section-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; margin-bottom: 9px; }
.eksobs-section-heading strong { display: block; margin-top: 2px; color: var(--text); font-size: 13px; }
.eksobs-section-heading small { color: var(--text-dim); font-size: 10px; }
.eksobs-nodegroups { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 8px; }
.eksobs-nodegroup { min-width: 0; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-row); padding: 10px 11px; }
.eksobs-nodegroup-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 11px; }
.eksobs-nodegroup-top strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.eksobs-nodegroup-top span { font-size: 9px; }
.eksobs-nodegroup-top .ok { color: var(--green); }
.eksobs-nodegroup-top .warn { color: var(--yellow); }
.eksobs-architecture { margin-top: 8px; color: var(--accent); font-family: monospace; font-size: 18px; font-weight: 700; }
.eksobs-nodegroup-meta { min-height: 28px; margin-top: 2px; color: var(--text-dim); font-size: 10px; line-height: 1.4; }
.eksobs-scale { display: grid; grid-template-columns: repeat(3, 1fr); gap: 5px; margin-top: 8px; }
.eksobs-scale span { border-top: 1px solid var(--border); padding-top: 5px; color: var(--text-dim); font-size: 9px; }
.eksobs-scale strong { display: block; margin-top: 1px; color: var(--text); font-size: 12px; }
.eksobs-inline-empty { border: 1px dashed var(--border); border-radius: 8px; padding: 18px; color: var(--text-dim); text-align: center; font-size: 11px; }
.eksobs-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(145px, 1fr)); gap: 8px; }
.eksobs-kpis article { border-left: 3px solid var(--accent); border-radius: 4px; background: var(--bg-row); padding: 9px 11px; }
.eksobs-kpis span { display: block; color: var(--text-dim); font-size: 10px; }
.eksobs-kpis strong { display: block; margin-top: 3px; color: var(--text); font-size: 19px; }
.eksobs-charts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-bottom: 16px; }
.eksobs-table-wrap { overflow: auto; border: 1px solid var(--border); border-radius: 8px; }
.eksobs-table { width: 100%; border-collapse: collapse; font-size: 11px; }
.eksobs-table th { position: sticky; top: 0; background: var(--surface); color: var(--text-dim); padding: 7px 10px; text-align: right; font-weight: 600; }
.eksobs-table th:first-child { text-align: left; }
.eksobs-table td { border-top: 1px solid var(--border); padding: 7px 10px; color: var(--text-dim); text-align: right; }
.eksobs-table td:first-child { color: var(--text); text-align: left; font-family: monospace; }
@media (max-width: 720px) {
  .eksobs-backdrop { padding: 0; }
  .eksobs-modal { width: 100vw; height: 100vh; max-height: none; border: 0; border-radius: 0; }
  .eksobs-toolbar { align-items: stretch; flex-wrap: wrap; padding: 8px 10px; }
  .eksobs-segment { width: 100%; overflow-x: auto; }
  .eksobs-segment button { min-width: 76px; }
  .eksobs-range { margin-left: 0; }
  .eksobs-body { padding: 12px 10px 20px; }
  .eksobs-charts { grid-template-columns: 1fr; }
  .eksobs-section-heading { align-items: flex-start; flex-direction: column; }
}
</style>