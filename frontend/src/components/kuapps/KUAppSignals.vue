<template>
  <section class="obs" data-test="kuapp-signals">
    <header class="obs-bar">
      <div class="obs-range" role="group" :aria-label="t('obs.range')">
        <button v-for="option in RANGES" :key="option.hours" :class="['btn', 'sm', { primary: hours === option.hours }]" @click="hours = option.hours">{{ option.label }}</button>
      </div>
      <span v-if="data?.application?.latestRun" :class="['obs-run', data.application.latestRun.status]" data-test="observability-run">
        {{ t(`obs.run.${data.application.latestRun.status}`, data.application.latestRun.status) }} · {{ when(data.application.latestRun.finishedAt || data.application.latestRun.startedAt) }}
      </span>
      <span class="obs-spacer"></span>
      <button class="btn sm" :disabled="!data || collecting" data-test="observability-collect" :title="t('obs.collectHint')" @click="collectNow"><i data-lucide="radio-tower"></i>{{ collecting ? t('obs.collecting') : t('obs.collectNow') }}</button>
      <button class="btn sm btn-icon" :disabled="!applicationId || loading" :title="t('action.refresh')" @click="load"><i data-lucide="refresh-cw"></i></button>
    </header>

    <p v-if="error" class="obs-error" role="alert">{{ error }}</p>
    <p v-else-if="data && data.application.pollingEnabled === false" class="obs-note" data-test="observability-collection-off">{{ t('obs.collectionOff') }}</p>

    <!-- Without the resource list (still loading, or it failed), the application overview stays. -->
    <slot v-if="!data" name="application" :hours="hours" />
    <div v-else class="obs-body">
      <aside class="obs-list" :aria-label="t('obs.resources')">
        <div class="obs-filters">
          <input v-model.trim="search" class="ctrl-input" type="search" :placeholder="t('obs.search')" data-test="observability-search" />
          <select v-model="stateFilter" class="ctrl-select" :aria-label="t('obs.stateFilter')">
            <option value="">{{ t('obs.allStates') }}</option>
            <option value="observable">{{ t('obs.observableOnly') }}</option>
            <option v-for="state in STATES" :key="state" :value="state">{{ t(`kuapps.signalState.${state}`) }}</option>
          </select>
        </div>
        <!-- The whole application: aggregated metrics, log history and traces (KUApps passes them in). -->
        <button :class="['obs-row', 'obs-row-app', { active: !selectedId }]" data-test="observability-application-overview" @click="selectedId = ''">
          <span class="obs-row-name"><i data-lucide="layout-dashboard"></i>{{ t('obs.wholeApplication') }}</span>
        </button>
        <p class="obs-count">{{ t('obs.count', { shown: visibleCount, total: data.resources.length }) }}</p>
        <div v-for="group in groups" :key="group.type" class="obs-group" :data-test="`observability-group-${group.type}`">
          <h4><i :data-lucide="group.icon"></i>{{ group.label }} <small>{{ group.items.length }}</small></h4>
          <button
            v-for="resource in group.items" :key="resource.id"
            :class="['obs-row', { active: selected?.id === resource.id }]"
            :data-test="`observability-resource-${resource.id}`"
            @click="selectResource(resource)"
          >
            <span class="obs-row-name" :title="resource.name">{{ resource.name }}</span>
            <span :class="['obs-state', resource.signals.state]">{{ t(`kuapps.signalState.${resource.signals.state}`) }}</span>
          </button>
        </div>
        <p v-if="!groups.length" class="obs-empty">{{ t('obs.noMatches') }}</p>
      </aside>

      <main class="obs-detail">
        <template v-if="selected">
          <header class="obs-detail-head">
            <div>
              <h3>{{ selected.name }}</h3>
              <small>{{ resourceLabel(selected) }}<template v-if="location(selected)"> · {{ location(selected) }}</template></small>
            </div>
            <span :class="['obs-state', selected.signals.state]" :title="t(`kuapps.signalState.${selected.signals.state}.hint`)">{{ t(`kuapps.signalState.${selected.signals.state}`) }}</span>
          </header>
          <p v-if="selected.access.error" class="obs-note" data-test="observability-no-access">{{ t('apmLogs.noAccess') }}</p>
          <p v-else class="obs-dim">{{ t('obs.readWith', { profile: selected.access.profileId, region: selected.access.region || t('obs.profileRegion') }) }}</p>

          <nav class="obs-tabs" role="tablist">
            <button role="tab" :class="['obs-tab', { active: tab === 'metrics' }]" :aria-selected="tab === 'metrics'" data-test="observability-tab-metrics" @click="tab = 'metrics'">{{ t('obs.metrics') }}</button>
            <button role="tab" :class="['obs-tab', { active: tab === 'logs' }]" :aria-selected="tab === 'logs'" :disabled="!selected.capabilities.logs" data-test="observability-tab-logs" @click="tab = 'logs'">{{ t('obs.logs') }}</button>
          </nav>

          <section v-if="tab === 'metrics'" class="obs-metrics" data-test="observability-metrics">
            <p v-if="!selected.capabilities.metrics" class="obs-note">{{ t('obs.noMetricsForType') }}</p>
            <p v-else-if="metricsLoading" class="obs-dim">{{ t('common.loading') }}</p>
            <p v-else-if="metricsError" class="obs-error">{{ metricsError }}</p>
            <template v-else-if="charts.length">
              <div class="obs-kpis">
                <div v-for="kpi in kpis" :key="kpi.id" class="obs-kpi"><small>{{ kpi.label }}</small><strong>{{ kpi.value }}</strong></div>
              </div>
              <div class="obs-charts">
                <CloudMetricChart v-for="chart in charts" :key="chart.metric" :label="chart.label" :unit="chart.unit" :points="chart.points" :color="chart.color" :show-date="hours > 24" />
              </div>
            </template>
            <p v-else class="obs-note" data-test="observability-no-data">{{ t(`kuapps.signalState.${selected.signals.state}.hint`) }}</p>
          </section>

          <ApmApplicationLogs
            v-else
            :key="selected.id"
            :provider="data.application.collection.provider"
            :profile-id="data.application.collection.profileId"
            :application="data.application"
            :resources="[selected]"
            hide-resource-tabs
            @open-kubernetes-logs="resource => $emit('open-kubernetes-logs', resource)"
          />
        </template>
        <slot v-else name="application" :hours="hours" />
      </main>
    </div>
  </section>
</template>

<script setup>
import { computed, nextTick, onMounted, onUpdated, ref, watch } from 'vue'
import { createIcons, icons } from 'lucide'
import { useApi } from '../../composables/useApi'
import { useI18n } from '../../composables/useI18n'
import { useToast } from '../../composables/useToast'
import { settings } from '../../composables/useSettings'
import CloudMetricChart from '../cloud/CloudMetricChart.vue'
import ApmApplicationLogs from '../cloud/apm/ApmApplicationLogs.vue'
import { apmResourceIcon, apmResourceLabel, apmResourceLocation } from '../cloud/apm/resourcePresentation'
import { catalogFor, formatMetricValue } from '../cloud/apm/metricCatalog'

// KUApps → Signals: the application as a whole (the "application" slot) and each of its resources,
// grouped by type. Each resource is read with the profile and region its scope resolves to
// (GET /api/kua-apps/applications/:id/observability/resources), never with a profile selected
// elsewhere in KUA.
const props = defineProps({ applicationId: { type: String, required: true } })
defineEmits(['open-kubernetes-logs'])

const RANGES = [{ hours: 6, label: '6 h' }, { hours: 24, label: '24 h' }, { hours: 168, label: '7 d' }]
const STATES = ['current', 'partial', 'stale', 'no_data', 'disabled', 'error', 'no_connection', 'unsupported']
const { t } = useI18n()
const { apiFetch } = useApi()
const { toast } = useToast()

const applicationId = computed(() => props.applicationId)
const data = ref(null)
const loading = ref(false)
const error = ref('')
const search = ref('')
const stateFilter = ref('observable')
const hours = ref(24)
const selectedId = ref('')
const tab = ref('metrics')
const metrics = ref(null)
const metricsLoading = ref(false)
const metricsError = ref('')
const collecting = ref(false)

const when = iso => (iso ? new Date(iso).toLocaleString(settings.lang === 'es' ? 'es' : 'en-US', { dateStyle: 'short', timeStyle: 'short' }) : '')
const resourceLabel = resource => apmResourceLabel(resource)
const location = resource => apmResourceLocation(resource)
const selected = computed(() => data.value?.resources.find(resource => resource.id === selectedId.value) || null)

const filtered = computed(() => {
  const query = search.value.toLowerCase()
  return (data.value?.resources || []).filter(resource =>
    (!query || `${resource.name} ${resource.type} ${resource.kind || ''}`.toLowerCase().includes(query)) &&
    (!stateFilter.value || (stateFilter.value === 'observable'
      ? resource.capabilities.metrics || resource.capabilities.logs
      : resource.signals.state === stateFilter.value)))
})
const visibleCount = computed(() => filtered.value.length)
// One group per type, in the order the API returns (observable first, then type and name).
const groups = computed(() => {
  const byType = new Map()
  for (const resource of filtered.value) {
    const key = resource.type === 'kubernetes' ? `kubernetes:${resource.kind || ''}` : resource.type
    if (!byType.has(key)) byType.set(key, { type: key, label: apmResourceLabel(resource), icon: apmResourceIcon(resource), items: [] })
    byType.get(key).items.push(resource)
  }
  return [...byType.values()]
})

// Charts and KPIs of the selected resource from the metric catalog; counters add up, the rest average.
const metricsByName = computed(() => new Map((metrics.value?.metrics || []).map(metric => [metric.name, metric])))
const catalog = computed(() => (selected.value ? catalogFor(selected.value.type, selected.value.kind || '') : null))
const isAverage = name => /(_ms|_mb|_bytes|_cores|percent|utilization|latency|duration)/.test(name)
const charts = computed(() => {
  const listed = (catalog.value?.charts || []).filter(chart => metricsByName.value.has(chart.metric))
  const known = new Set(listed.map(chart => chart.metric))
  const others = [...metricsByName.value.keys()].filter(name => !known.has(name)).map(name => ({ metric: name, label: name, unit: '', color: '#8b949e' }))
  return [...listed.map(chart => ({ ...chart, label: t(chart.labelKey) })), ...others].map(chart => ({
    ...chart,
    points: metricsByName.value.get(chart.metric).points.map(point => ({ t: point.t, v: isAverage(chart.metric) ? point.average : point.sum })),
  }))
})
const kpis = computed(() => (catalog.value?.kpis || [])
  .filter(kpi => metricsByName.value.has(kpi.metric) && kpi.aggregate !== 'ratio' && kpi.aggregate !== 'pair')
  .map(kpi => {
    const points = metricsByName.value.get(kpi.metric).points
    const sum = points.reduce((total, point) => total + (point.sum || 0), 0)
    const count = points.reduce((total, point) => total + (point.count || 0), 0)
    return { id: kpi.id, label: t(kpi.labelKey), value: formatMetricValue(kpi.aggregate === 'average' ? (count ? sum / count : null) : sum, kpi.format) }
  }))

async function load() {
  if (!applicationId.value) return
  loading.value = true
  error.value = ''
  try {
    const response = await apiFetch(`/api/kua-apps/applications/${encodeURIComponent(applicationId.value)}/observability/resources`)
    data.value = response?.application && Array.isArray(response.resources) ? response : null
    if (!data.value) return
    // A resource that left the application falls back to the application overview.
    if (selectedId.value && !data.value.resources.some(resource => resource.id === selectedId.value)) selectedId.value = ''
  } catch (err) {
    error.value = err.message
    data.value = null
  } finally {
    loading.value = false
  }
}

async function loadMetrics() {
  metrics.value = null
  metricsError.value = ''
  const resource = selected.value
  if (!resource?.capabilities.metrics || tab.value !== 'metrics') return
  metricsLoading.value = true
  try {
    const to = Date.now()
    metrics.value = await apiFetch(`/api/kua-apps/applications/${encodeURIComponent(applicationId.value)}/observability/resources/${encodeURIComponent(resource.id)}/metrics?from=${to - hours.value * 3600000}&to=${to}`)
  } catch (err) {
    metricsError.value = err.message
  } finally {
    metricsLoading.value = false
  }
}

function selectResource(resource) {
  selectedId.value = resource.id
  if (tab.value === 'logs' && !resource.capabilities.logs) tab.value = 'metrics'
}

// Collection runs where the application's collection lives; it never reads with another profile.
async function collectNow() {
  const { provider, profileId } = data.value.application.collection
  collecting.value = true
  try {
    await apiFetch(`/api/observability/${encodeURIComponent(provider)}/applications/${encodeURIComponent(applicationId.value)}/collect-now`, { method: 'POST', headers: { 'X-Profile-Id': profileId } })
    toast(t('obs.collected'), 'success')
  } catch (err) {
    toast(err.message, 'error')
  } finally {
    collecting.value = false
    await load()
    await loadMetrics()
  }
}

watch(() => props.applicationId, () => { selectedId.value = ''; load() })
watch([selectedId, hours, tab], loadMetrics)
onMounted(load)
// The parent selects a resource (e.g. from the Map inspector).
defineExpose({ selectResourceById: id => { selectedId.value = id }, reload: load })
const refreshIcons = () => nextTick(() => createIcons({ icons }))
onMounted(refreshIcons)
onUpdated(refreshIcons)
</script>

<style scoped>
.obs { display: flex; flex-direction: column; gap: 10px; min-height: 0; }
.obs-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.obs-range { display: flex; gap: 4px; }
.obs-run { font-size: 12px; color: var(--text-dim); }
.obs-run.partial, .obs-run.budget_exhausted { color: var(--warning, #d97706); }
.obs-run.failed { color: var(--danger, #dc2626); }
.obs-spacer { flex: 1; }
.obs-bar .btn svg { width: 14px; height: 14px; margin-right: 4px; vertical-align: -2px; }
.obs-body { display: grid; grid-template-columns: minmax(220px, 300px) minmax(0, 1fr); gap: 12px; min-height: 480px; }
.obs-list { max-height: calc(100vh - 220px); }
.obs-list { display: flex; flex-direction: column; gap: 6px; overflow: auto; border: 1px solid var(--border); border-radius: 8px; padding: 8px; min-height: 0; }
.obs-filters { display: flex; flex-direction: column; gap: 6px; }
.obs-count { margin: 0; font-size: 11px; color: var(--text-dim); }
.obs-group h4 { display: flex; align-items: center; gap: 6px; margin: 8px 0 4px; font-size: 11px; text-transform: uppercase; letter-spacing: .03em; color: var(--text-dim); }
.obs-group h4 svg { width: 13px; height: 13px; }
.obs-group h4 small { margin-left: auto; }
.obs-row { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 8px; border: 0; border-radius: 6px; background: transparent; color: var(--text); text-align: left; cursor: pointer; font-size: 12px; }
.obs-row:hover { background: color-mix(in srgb, var(--accent) 8%, transparent); }
.obs-row.active { background: color-mix(in srgb, var(--accent) 16%, transparent); }
.obs-row-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.obs-row-app { font-weight: 600; }
.obs-row-app svg { width: 13px; height: 13px; margin-right: 6px; vertical-align: -2px; }
.obs-state { flex: 0 0 auto; font-size: 10px; padding: 1px 6px; border-radius: 999px; border: 1px solid var(--border); color: var(--text-dim); white-space: nowrap; }
.obs-state.current { color: var(--success, #16a34a); border-color: currentColor; }
.obs-state.stale, .obs-state.partial, .obs-state.no_connection { color: var(--warning, #d97706); border-color: currentColor; }
.obs-state.error { color: var(--danger, #dc2626); border-color: currentColor; }
.obs-detail { display: flex; flex-direction: column; gap: 8px; min-width: 0; overflow: auto; border: 1px solid var(--border); border-radius: 8px; padding: 12px; }
.obs-detail-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
.obs-detail-head h3 { margin: 0; font-size: 15px; overflow-wrap: anywhere; }
.obs-detail-head small { color: var(--text-dim); overflow-wrap: anywhere; }
.obs-tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--border); }
.obs-tab { padding: 6px 12px; border: 0; border-bottom: 2px solid transparent; background: transparent; color: var(--text-dim); cursor: pointer; font-size: 12px; }
.obs-tab.active { color: var(--text); border-bottom-color: var(--accent); }
.obs-tab:disabled { opacity: .4; cursor: default; }
.obs-kpis { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 8px; }
.obs-kpi { display: flex; flex-direction: column; gap: 2px; border: 1px solid var(--border); border-radius: 6px; padding: 8px; }
.obs-kpi small { color: var(--text-dim); font-size: 11px; }
.obs-charts { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 10px; }
.obs-empty, .obs-note, .obs-dim, .obs-error { margin: 0; font-size: 12px; }
.obs-empty, .obs-dim { color: var(--text-dim); }
.obs-note { color: var(--warning, #d97706); }
.obs-error { color: var(--danger, #dc2626); }
@media (max-width: 860px) { .obs-body { grid-template-columns: 1fr; } .obs-list { max-height: 320px; } }
</style>
