<template>
  <section class="obs" data-test="kuapp-signals">
    <!-- The one time range of the page: the aggregated view below follows it (#239). -->
    <header class="obs-bar">
      <div class="obs-range" role="group" :aria-label="t('obs.range')">
        <button v-for="option in RANGES" :key="option.hours" :class="['btn', 'sm', { primary: hours === option.hours }]" @click="hours = option.hours">{{ option.label }}</button>
      </div>
      <span v-if="data?.application?.latestRun" :class="['obs-run', data.application.latestRun.status]" data-test="observability-run">
        {{ t(`obs.run.${data.application.latestRun.status}`, data.application.latestRun.status) }} · {{ when(data.application.latestRun.finishedAt || data.application.latestRun.startedAt) }}
        <template v-if="failedCount"> · <button class="obs-link" data-test="observability-failed-filter" @click="showFailed">{{ t('obs.failedResources', { n: failedCount }) }}</button></template>
      </span>
      <span class="obs-spacer"></span>
      <button class="btn sm" :disabled="!data || collecting" data-test="observability-collect" :title="t('obs.collectHint')" @click="confirmCollect = true"><i data-lucide="radio-tower"></i>{{ collecting ? t('obs.collecting') : t('obs.collectNow') }}</button>
      <button class="btn sm btn-icon" :disabled="!applicationId || loading" :title="t('action.refresh')" @click="reload"><i data-lucide="refresh-cw"></i></button>
    </header>

    <p v-if="error" class="obs-error" role="alert">{{ error }}</p>
    <p v-else-if="data && data.application.pollingEnabled === false" class="obs-note" data-test="observability-collection-off">{{ t('obs.collectionOff') }}</p>

    <!-- Without the resource list (still loading, or it failed), the application overview stays. -->
    <slot v-if="!data" name="application" :range="rangeLabel" />
    <div v-else class="obs-body">
      <aside class="obs-list" :aria-label="t('obs.resources')">
        <div class="obs-filters">
          <input v-model.trim="search" class="ctrl-input" type="search" :placeholder="t('obs.search')" data-test="observability-search" />
          <select v-model="stateFilter" class="ctrl-select" :aria-label="t('obs.stateFilter')" data-test="observability-state-filter">
            <option value="issues">{{ t('obs.withIssues') }}</option>
            <option value="failed">{{ t('obs.failedFilter') }}</option>
            <option value="observable">{{ t('obs.observableOnly') }}</option>
            <option value="">{{ t('obs.allStates') }}</option>
            <option v-for="state in STATES" :key="state" :value="state">{{ t(`kuapps.signalState.${state}`) }}</option>
          </select>
        </div>
        <button :class="['obs-row', 'obs-row-app', { active: !selectedId }]" data-test="observability-application-overview" @click="selectedId = ''">
          <span class="obs-row-name"><i data-lucide="layout-dashboard"></i>{{ t('obs.wholeApplication') }}</span>
          <span v-if="issueList.length" class="obs-issue-count">{{ issueList.length }}</span>
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
            <span class="obs-row-name" :title="resource.name"><span v-if="issuesByResource.has(resource.id)" :class="['obs-dot', issuesByResource.get(resource.id)]"></span>{{ resource.name }}</span>
            <span :class="['obs-state', resource.signals.state]">{{ t(`kuapps.signalState.${resource.signals.state}`) }}</span>
          </button>
        </div>
        <p v-if="!groups.length" class="obs-empty">{{ t(stateFilter === 'issues' ? 'obs.noIssueResources' : 'obs.noMatches') }}</p>
      </aside>

      <main class="obs-detail">
        <KUAppResourceSignals
          v-if="selected"
          :key="selected.id"
          :application-id="applicationId"
          :resource="selected"
          :collection="data.application.collection"
          :hours="hours"
          @retry="confirmCollect = true"
          @open-kubernetes-logs="resource => $emit('open-kubernetes-logs', resource)"
        />
        <template v-else>
          <!-- The problems first; the aggregated metrics, log history and traces folded below. -->
          <KUAppIssues ref="issuesRef" :application-id="applicationId" :hours="hours" @loaded="issues = $event" @action="onIssue" />
          <details class="obs-aggregate" data-test="observability-aggregate">
            <summary>{{ t('obs.aggregate') }}</summary>
            <slot name="application" :range="rangeLabel" />
          </details>
        </template>
      </main>
    </div>

    <BaseModal :show="confirmCollect" @close="confirmCollect = false">
      <template #title>{{ t('apm.collectTitle') }}</template>
      <div class="obs-confirm" data-test="observability-collect-confirm">
        <section>
          <h4>{{ t('obs.confirm.now') }}</h4>
          <ul>
            <li v-if="plan.lambdas">{{ t('obs.confirm.lambdas', { n: plan.lambdas, max: plan.lambdas * 2 }) }}</li>
            <li v-if="plan.cloudWatch.resources">{{ t('obs.confirm.cloudWatch', { n: plan.cloudWatch.resources, metrics: plan.cloudWatch.metricsPerCollection }) }}</li>
            <li v-if="plan.kubernetes">{{ t('obs.confirm.kubernetes', { n: plan.kubernetes }) }}</li>
            <li v-if="!plan.lambdas && !plan.cloudWatch.resources && !plan.kubernetes">{{ t('obs.confirm.nothing') }}</li>
          </ul>
        </section>
        <section>
          <h4>{{ t('obs.confirm.cache') }}</h4>
          <p>{{ t('obs.confirm.cacheText') }}</p>
        </section>
        <section>
          <h4>{{ t('obs.confirm.cost') }}</h4>
          <p v-if="plan.lambdas">{{ t('apm.costForecast', { count: plan.lambdas, maximum: plan.lambdas * 2 * 48 * 30 }) }}</p>
          <p v-if="plan.cloudWatch.metricsPerCollection">{{ t('apm.cloudWatchMonthlyEstimate', { metrics: plan.cloudWatch.metricsPerCollection, requests: plan.cloudWatch.requestsPerMonth, usd: plan.cloudWatch.monthlyUsd.toFixed(2) }) }}</p>
          <p v-if="!plan.lambdas && !plan.cloudWatch.metricsPerCollection">{{ t('obs.confirm.noCost') }}</p>
        </section>
      </div>
      <template #footer>
        <button class="btn" @click="confirmCollect = false">{{ t('action.cancel') }}</button>
        <button class="btn primary" :disabled="collecting" data-test="observability-collect-confirmed" @click="collectNow">{{ t('obs.collectNow') }}</button>
      </template>
    </BaseModal>
  </section>
</template>

<script setup>
import { computed, nextTick, onMounted, onUpdated, ref, watch } from 'vue'
import { createIcons, icons } from 'lucide'
import { useApi } from '../../composables/useApi'
import { useI18n } from '../../composables/useI18n'
import { useToast } from '../../composables/useToast'
import { settings } from '../../composables/useSettings'
import BaseModal from '../BaseModal.vue'
import KUAppIssues from './KUAppIssues.vue'
import KUAppResourceSignals from './KUAppResourceSignals.vue'
import { apmResourceIcon, apmResourceLabel } from '../cloud/apm/resourcePresentation'
import { estimateCloudWatchMonthlyCost } from '../cloud/apm/metricCatalog'

// KUApps → Signals: what needs attention first, then each resource grouped by type (#239). Each
// resource is read with the profile and region its scope resolves to, never with a profile
// selected elsewhere in KUA. Actions that belong to another tab are emitted ("issue-action").
const props = defineProps({
  applicationId: { type: String, required: true },
  // The range and filter it opens with (e.g. from the Summary's health card).
  initialHours: { type: Number, default: 24 },
  initialFilter: { type: String, default: 'observable' },
})
const emit = defineEmits(['open-kubernetes-logs', 'issue-action', 'select-resource'])

const RANGES = [{ hours: 6, label: '6 h' }, { hours: 24, label: '24 h' }, { hours: 168, label: '7 d' }]
const RANGE_LABELS = { 6: '6h', 24: '24h', 168: '7d' }
const STATES = ['current', 'partial', 'stale', 'no_data', 'disabled', 'error', 'gone', 'no_connection', 'unsupported']
const SEVERITY = { critical: 0, warning: 1, info: 2 }
const { t } = useI18n()
const { apiFetch } = useApi()
const { toast } = useToast()

const applicationId = computed(() => props.applicationId)
const data = ref(null)
const issues = ref(null)
const loading = ref(false)
const error = ref('')
const search = ref('')
const stateFilter = ref(props.initialFilter)
const hours = ref(RANGE_LABELS[props.initialHours] ? props.initialHours : 24)
const rangeLabel = computed(() => RANGE_LABELS[hours.value])
const selectedId = ref('')
const collecting = ref(false)
const confirmCollect = ref(false)
const issuesRef = ref(null)

const when = iso => (iso ? new Date(iso).toLocaleString(settings.lang === 'es' ? 'es' : 'en-US', { dateStyle: 'short', timeStyle: 'short' }) : '')
const selected = computed(() => data.value?.resources.find(resource => resource.id === selectedId.value) || null)
const issueList = computed(() => issues.value?.issues || [])
// The worst severity per resource, for the dot in the list and the "with issues" filter.
const issuesByResource = computed(() => {
  const worst = new Map()
  for (const issue of issueList.value) {
    const current = worst.get(issue.resourceId)
    if (!current || SEVERITY[issue.severity] < SEVERITY[current]) worst.set(issue.resourceId, issue.severity)
  }
  return worst
})
const failedCount = computed(() => (data.value?.resources || []).filter(resource => resource.lastCollection?.status === 'failed').length)

const filtered = computed(() => {
  const query = search.value.toLowerCase()
  return (data.value?.resources || []).filter(resource => {
    if (query && !`${resource.name} ${resource.type} ${resource.kind || ''}`.toLowerCase().includes(query)) return false
    if (stateFilter.value === 'issues') return issuesByResource.value.has(resource.id)
    if (stateFilter.value === 'failed') return resource.lastCollection?.status === 'failed'
    if (stateFilter.value === 'observable') return resource.capabilities.metrics || resource.capabilities.logs
    return !stateFilter.value || resource.signals.state === stateFilter.value
  })
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

// What collecting now reads, what comes from the local cache, and what costs (#239).
const plan = computed(() => {
  const enabled = (data.value?.resources || []).filter(resource => resource.enabled !== false && !resource.access?.error)
  const cloudWatchResources = enabled.filter(resource => ['elb', 'ec2', 's3'].includes(resource.type))
  return {
    lambdas: enabled.filter(resource => resource.type === 'lambda').length,
    kubernetes: enabled.filter(resource => resource.type === 'kubernetes' && resource.capabilities.metrics).length,
    cloudWatch: { resources: cloudWatchResources.length, ...estimateCloudWatchMonthlyCost(cloudWatchResources) },
  }
})

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

async function loadIssues() {
  try {
    const response = await apiFetch(`/api/kua-apps/applications/${encodeURIComponent(applicationId.value)}/observability/issues?hours=${hours.value}`)
    issues.value = Array.isArray(response?.issues) ? response : null
  } catch { issues.value = null }
}

async function reload() {
  await Promise.all([load(), loadIssues()])
  issuesRef.value?.reload?.()
}

function selectResource(resource) {
  selectedId.value = resource.id
  emit('select-resource', resource.registryId)
}

function showFailed() {
  stateFilter.value = 'failed'
  selectedId.value = ''
}

// Issue actions that stay here; the others (review, scopes) belong to other tabs.
function onIssue(issue) {
  if (issue.action === 'open_signals') {
    const resource = data.value?.resources.find(item => item.id === issue.resourceId)
    if (resource) selectResource(resource)
  } else if (issue.action === 'retry') {
    confirmCollect.value = true
  } else {
    emit('issue-action', issue)
  }
}

// Collection runs where the application's collection lives; it never reads with another profile.
async function collectNow() {
  const { provider, profileId } = data.value.application.collection
  confirmCollect.value = false
  collecting.value = true
  try {
    await apiFetch(`/api/observability/${encodeURIComponent(provider)}/applications/${encodeURIComponent(applicationId.value)}/collect-now`, { method: 'POST', headers: { 'X-Profile-Id': profileId } })
    toast(t('obs.collected'), 'success')
  } catch (err) {
    toast(err.message, 'error')
  } finally {
    collecting.value = false
    await reload()
  }
}

watch(() => props.applicationId, () => { selectedId.value = ''; reload() })
watch(hours, loadIssues)
watch(() => [props.initialHours, props.initialFilter], ([nextHours, nextFilter]) => {
  if (RANGE_LABELS[nextHours]) hours.value = nextHours
  if (nextFilter) stateFilter.value = nextFilter
  selectedId.value = ''
})
onMounted(reload)
defineExpose({
  // The parent selects a resource (from the Map, Resources or an issue in the Summary).
  selectResourceById: id => { selectedId.value = id },
  selectByRegistryId: registryId => {
    const resource = data.value?.resources.find(item => item.registryId === registryId)
    if (resource) selectedId.value = resource.id
  },
  reload,
})
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
.obs-link { border: 0; padding: 0; background: none; color: inherit; text-decoration: underline; cursor: pointer; font: inherit; }
.obs-spacer { flex: 1; }
.obs-bar .btn svg { width: 14px; height: 14px; margin-right: 4px; vertical-align: -2px; }
.obs-body { display: grid; grid-template-columns: minmax(220px, 300px) minmax(0, 1fr); gap: 12px; min-height: 480px; }
.obs-list { display: flex; flex-direction: column; gap: 6px; overflow: auto; border: 1px solid var(--border); border-radius: 8px; padding: 8px; min-height: 0; max-height: calc(100vh - 220px); }
.obs-filters { display: flex; flex-direction: column; gap: 6px; }
.obs-count { margin: 0; font-size: 12px; color: var(--text-dim); }
.obs-group h4 { display: flex; align-items: center; gap: 6px; margin: 8px 0 4px; font-size: 12px; text-transform: uppercase; letter-spacing: .03em; color: var(--text-dim); }
.obs-group h4 svg { width: 13px; height: 13px; }
.obs-group h4 small { margin-left: auto; }
.obs-row { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 8px; border: 0; border-radius: 6px; background: transparent; color: var(--text); text-align: left; cursor: pointer; font-size: 13px; }
.obs-row:hover { background: color-mix(in srgb, var(--accent) 8%, transparent); }
.obs-row.active { background: color-mix(in srgb, var(--accent) 16%, transparent); }
.obs-row-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.obs-row-app { font-weight: 600; }
.obs-row-app svg { width: 13px; height: 13px; margin-right: 6px; vertical-align: -2px; }
.obs-issue-count { font-size: 11px; padding: 0 6px; border-radius: 999px; background: var(--warning, #d97706); color: #fff; }
.obs-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 6px; vertical-align: 1px; background: var(--text-dim); }
.obs-dot.critical { background: var(--danger, #dc2626); }
.obs-dot.warning { background: var(--warning, #d97706); }
.obs-state { flex: 0 0 auto; font-size: 11px; padding: 1px 6px; border-radius: 999px; border: 1px solid var(--border); color: var(--text-dim); white-space: nowrap; }
.obs-state.current { color: var(--success, #16a34a); border-color: currentColor; }
.obs-state.stale, .obs-state.partial, .obs-state.no_connection { color: var(--warning, #d97706); border-color: currentColor; }
.obs-state.gone, .obs-state.error { color: var(--danger, #dc2626); border-color: currentColor; }
.obs-detail { display: flex; flex-direction: column; gap: 10px; min-width: 0; overflow: auto; border: 1px solid var(--border); border-radius: 8px; padding: 12px; }
.obs-aggregate summary { cursor: pointer; font-size: 13px; color: var(--text-dim); margin-bottom: 8px; }
.obs-confirm { display: flex; flex-direction: column; gap: 10px; font-size: 13px; }
.obs-confirm h4 { margin: 0 0 4px; font-size: 13px; }
.obs-confirm ul { margin: 0; padding-left: 18px; }
.obs-confirm p { margin: 0 0 4px; }
.obs-empty, .obs-note, .obs-error { margin: 0; font-size: 12px; }
.obs-empty { color: var(--text-dim); }
.obs-note { color: var(--warning, #d97706); }
.obs-error { color: var(--danger, #dc2626); }
@media (max-width: 860px) { .obs-body { grid-template-columns: 1fr; } .obs-list { max-height: 320px; } }
</style>
