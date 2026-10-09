<template>
  <div class="krs" data-test="kuapp-resource-signals">
    <p v-if="loadingResource" class="krs-dim">{{ t('common.loading') }}</p>
    <p v-else-if="!current" class="krs-dim" data-test="resource-signals-unknown">{{ t('kuapps.resourceSignals.notObserved') }}</p>
    <template v-else>
      <header v-if="!compact" class="krs-head">
        <div>
          <h3>{{ current.name }}</h3>
          <small>{{ resourceLabel(current) }}<template v-if="location(current)"> · {{ location(current) }}</template></small>
        </div>
        <span :class="['krs-state', current.signals.state]" :title="t(`kuapps.signalState.${current.signals.state}.hint`)">{{ t(`kuapps.signalState.${current.signals.state}`) }}</span>
      </header>
      <p v-if="current.access.error" class="krs-note" data-test="observability-no-access">{{ t('apmLogs.noAccess') }}</p>
      <p v-else class="krs-dim">{{ t('obs.readWith', { profile: current.access.profileId, region: current.access.region || t('obs.profileRegion') }) }}</p>
      <!-- Why its last collection failed and how to recover (#239). -->
      <div v-if="current.lastCollection?.status === 'failed'" class="krs-failure" role="alert" data-test="resource-last-failure">
        <span>{{ t('kuapps.resourceSignals.lastFailed', { when: ago(t, current.lastCollection.at), cause: failureCause }) }}</span>
        <button class="btn sm" data-test="resource-retry" @click="$emit('retry', current)">{{ t('kuapps.issue.action.retry') }}</button>
      </div>

      <nav class="krs-tabs" role="tablist">
        <button role="tab" :class="['krs-tab', { active: tab === 'metrics' }]" :aria-selected="tab === 'metrics'" :tabindex="tab === 'metrics' ? 0 : -1" data-test="observability-tab-metrics" @click="tab = 'metrics'" @keydown="moveTab">{{ t('obs.metrics') }}</button>
        <button role="tab" :class="['krs-tab', { active: tab === 'logs' }]" :aria-selected="tab === 'logs'" :tabindex="tab === 'logs' ? 0 : -1" :disabled="!current.capabilities.logs" data-test="observability-tab-logs" @click="tab = 'logs'" @keydown="moveTab">{{ t('obs.logs') }}</button>
      </nav>

      <section v-if="tab === 'metrics'" class="krs-metrics" data-test="observability-metrics">
        <p v-if="!current.capabilities.metrics" class="krs-note">{{ t('obs.noMetricsForType') }}</p>
        <p v-else-if="metricsLoading" class="krs-dim">{{ t('common.loading') }}</p>
        <p v-else-if="metricsError" class="krs-error">{{ metricsError }}</p>
        <template v-else-if="charts.length">
          <div v-if="kpis.length" class="krs-kpis">
            <div v-for="kpi in kpis" :key="kpi.id" class="krs-kpi"><small>{{ kpi.label }}</small><strong>{{ kpi.value }}</strong></div>
          </div>
          <div :class="['krs-charts', { compact }]">
            <CloudMetricChart v-for="chart in charts" :key="chart.metric" :label="chart.label" :unit="chart.unit" :points="chart.points" :color="chart.color" :show-date="hours > 24" :x-tick-limit="compact ? 3 : 7" />
          </div>
          <details v-if="missingCharts.length" class="krs-missing" data-test="resource-empty-charts">
            <summary>{{ t('apm.emptyCharts', { n: missingCharts.length }) }}</summary>
            <span>{{ missingCharts.join(' · ') }}</span>
          </details>
        </template>
        <p v-else class="krs-note" data-test="observability-no-data">{{ t(`kuapps.signalState.${current.signals.state}.hint`) }}</p>
      </section>

      <ApmApplicationLogs
        v-else
        :key="current.id"
        :provider="collection.provider"
        :profile-id="collection.profileId"
        :application="{ id: applicationId }"
        :resources="[current]"
        hide-resource-tabs
        @open-kubernetes-logs="resource => $emit('open-kubernetes-logs', resource)"
      />
    </template>
  </div>
</template>

<script setup>
import { moveTab } from '../../lib/tablistKeys'
import { computed, ref, watch } from 'vue'
import { useApi } from '../../composables/useApi'
import { useI18n } from '../../composables/useI18n'
import CloudMetricChart from '../cloud/CloudMetricChart.vue'
import ApmApplicationLogs from '../cloud/apm/ApmApplicationLogs.vue'
import { apmResourceLabel, apmResourceLocation } from '../cloud/apm/resourcePresentation'
import { catalogFor, formatMetricValue } from '../cloud/apm/metricCatalog'
import { ago } from '../../lib/kuappIssues'

// The signals of one resource, the same in Signals, Resources and the Map (#239): metrics and logs
// read with the profile and region of its own scope, and why its last collection failed. Pass the
// resource from GET .../observability/resources, or its registry id and it is looked up.
const props = defineProps({
  applicationId: { type: String, required: true },
  resource: { type: Object, default: null },
  registryId: { type: String, default: '' },
  collection: { type: Object, default: () => ({ provider: 'generic', profileId: 'local' }) },
  hours: { type: Number, default: 24 },
  compact: { type: Boolean, default: false },
})
defineEmits(['retry', 'open-kubernetes-logs'])

const { t } = useI18n()
const { apiFetch } = useApi()
const looked = ref(null)
const loadingResource = ref(false)
const tab = ref('metrics')
const metrics = ref(null)
const metricsLoading = ref(false)
const metricsError = ref('')
const current = computed(() => props.resource || looked.value)
const resourceLabel = resource => apmResourceLabel(resource)
const location = resource => apmResourceLocation(resource)
const failureCause = computed(() => [current.value?.lastCollection?.errorCode, current.value?.lastCollection?.message].filter(Boolean).join(': ') || t('kuapps.issue.unknownCause'))

async function lookUp() {
  looked.value = null
  if (props.resource || !props.registryId) return
  loadingResource.value = true
  try {
    const data = await apiFetch(`/api/kua-apps/applications/${encodeURIComponent(props.applicationId)}/observability/resources`)
    looked.value = (data?.resources || []).find(item => item.registryId === props.registryId) || null
  } catch { looked.value = null } finally { loadingResource.value = false }
}

// Charts and KPIs from the metric catalog; counters add up, the rest average. Catalog charts without
// data in the range are folded instead of drawn empty.
const metricsByName = computed(() => new Map((metrics.value?.metrics || []).map(metric => [metric.name, metric])))
const catalog = computed(() => (current.value ? catalogFor(current.value.type, current.value.kind || '') : null))
const isAverage = name => /(_ms|_mb|_bytes|_cores|percent|utilization|latency|duration)/.test(name)
const charts = computed(() => {
  const listed = (catalog.value?.charts || []).filter(chart => metricsByName.value.has(chart.metric))
  const known = new Set(listed.map(chart => chart.metric))
  const others = [...metricsByName.value.keys()].filter(name => !known.has(name)).map(name => ({ metric: name, label: name, unit: '', color: '#8b949e' }))
  return [...listed.map(chart => ({ ...chart, label: t(chart.labelKey, chart.params) })), ...others].map(chart => ({
    ...chart,
    points: metricsByName.value.get(chart.metric).points.map(point => ({ t: point.t, v: isAverage(chart.metric) ? point.average : point.sum })),
  }))
})
const missingCharts = computed(() => (catalog.value?.charts || []).filter(chart => !metricsByName.value.has(chart.metric)).map(chart => t(chart.labelKey, chart.params)))
const kpis = computed(() => (catalog.value?.kpis || [])
  .filter(kpi => metricsByName.value.has(kpi.metric) && kpi.aggregate !== 'ratio' && kpi.aggregate !== 'pair')
  .map(kpi => {
    const points = metricsByName.value.get(kpi.metric).points
    const sum = points.reduce((total, point) => total + (point.sum || 0), 0)
    const count = points.reduce((total, point) => total + (point.count || 0), 0)
    return { id: kpi.id, label: t(kpi.labelKey), value: formatMetricValue(kpi.aggregate === 'average' ? (count ? sum / count : null) : sum, kpi.format) }
  }))

async function loadMetrics() {
  metrics.value = null
  metricsError.value = ''
  const resource = current.value
  if (!resource?.capabilities.metrics || tab.value !== 'metrics') return
  metricsLoading.value = true
  try {
    const to = Date.now()
    metrics.value = await apiFetch(`/api/kua-apps/applications/${encodeURIComponent(props.applicationId)}/observability/resources/${encodeURIComponent(resource.id)}/metrics?from=${to - props.hours * 3600000}&to=${to}`)
  } catch (err) {
    metricsError.value = err.message
  } finally {
    metricsLoading.value = false
  }
}

watch(() => [props.applicationId, props.registryId, props.resource?.id], lookUp, { immediate: true })
watch(() => [current.value?.id, props.hours, tab.value], () => {
  if (tab.value === 'logs' && current.value && !current.value.capabilities.logs) tab.value = 'metrics'
  loadMetrics()
}, { immediate: true })
defineExpose({ reload: () => { lookUp(); loadMetrics() } })
</script>

<style scoped>
.krs { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.krs-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
.krs-head h3 { margin: 0; font-size: 15px; overflow-wrap: anywhere; }
.krs-head small { color: var(--text-dim); font-size: 12px; overflow-wrap: anywhere; }
.krs-state { flex: 0 0 auto; font-size: 12px; padding: 1px 6px; border-radius: 999px; border: 1px solid var(--border); color: var(--text-dim); white-space: nowrap; }
.krs-state.current { color: var(--success, #16a34a); border-color: currentColor; }
.krs-state.stale, .krs-state.partial, .krs-state.no_connection { color: var(--warning, #d97706); border-color: currentColor; }
.krs-state.gone, .krs-state.error { color: var(--danger, #dc2626); border-color: currentColor; }
.krs-failure { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; padding: 6px 8px; border: 1px solid var(--warning, #d97706); border-radius: 6px; font-size: 12px; }
.krs-failure span { overflow-wrap: anywhere; min-width: 0; }
.krs-tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--border); }
.krs-tab { padding: 6px 12px; border: 0; border-bottom: 2px solid transparent; background: transparent; color: var(--text-dim); cursor: pointer; font-size: 12px; }
.krs-tab.active { color: var(--text); border-bottom-color: var(--accent); }
.krs-tab:disabled { opacity: .4; cursor: default; }
.krs-kpis { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 8px; }
.krs-kpi { display: flex; flex-direction: column; gap: 2px; border: 1px solid var(--border); border-radius: 6px; padding: 8px; }
.krs-kpi small { color: var(--text-dim); font-size: 12px; }
.krs-charts { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 10px; }
.krs-charts.compact { grid-template-columns: 1fr; }
.krs-missing { font-size: 12px; color: var(--text-dim); }
.krs-missing summary { cursor: pointer; }
.krs-dim, .krs-note, .krs-error { margin: 0; font-size: 12px; }
.krs-dim { color: var(--text-dim); }
.krs-note { color: var(--warning, #d97706); }
.krs-error { color: var(--danger, #dc2626); }
</style>
