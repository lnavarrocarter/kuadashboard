<template>
  <section class="kuapp-summary" :aria-label="t('kuapps.summary.label')">
    <header class="kuapp-summary-bar">
      <span class="kuapp-summary-freshness">{{ freshnessLabel }}</span>
      <div class="range-control" role="group" :aria-label="t('apm.metricRange')">
        <button v-for="value in RANGES" :key="value" :class="{ active: range === value }" @click="range = value">{{ value }}</button>
      </div>
      <button class="btn sm btn-icon" :title="t('apm.refreshLocal')" :disabled="loading" @click="load"><i data-lucide="refresh-cw"></i></button>
      <button class="btn sm" data-test="summary-collect" :disabled="!hasSignals || !resources.length || collecting" @click="confirmCollect = true">
        <i :data-lucide="collecting ? 'loader-2' : 'cloud-download'"></i>{{ collecting ? t('apm.collecting') : t('apm.collectNow') }}
      </button>
    </header>

    <p v-if="error" class="kuapp-summary-error" role="alert">{{ error }}</p>
    <p v-if="collectError" class="kuapp-summary-error" role="alert">{{ collectError }}</p>

    <div class="kuapp-summary-cards">
      <button :class="['kuapp-card', healthTone]" data-test="summary-health" @click="$emit('open-signals', { hours: RANGE_HOURS[range], filter: healthTone === 'bad' ? 'issues' : 'observable' })">
        <span class="kuapp-card-label">{{ t('kuapps.summary.health', { range }) }}</span>
        <strong class="kuapp-card-value">{{ healthTitle }}</strong>
        <small>{{ healthDetail }}</small>
      </button>
      <button :class="['kuapp-card', structureTone]" data-test="summary-structure" @click="$emit('open-tab', 'review')">
        <span class="kuapp-card-label">{{ t('kuapps.summary.structure') }}</span>
        <strong class="kuapp-card-value">
          <template v-if="analysis">{{ analysis.score }}<small> / 100</small></template>
          <template v-else>—</template>
        </strong>
        <span v-if="analysis" class="kuapp-card-bar"><i :style="{ width: `${Math.max(0, Math.min(100, analysis.score))}%` }"></i></span>
        <small>{{ structureDetail }}</small>
      </button>
      <button :class="['kuapp-card', reviewCount ? 'attention' : 'ok']" data-test="summary-review" @click="$emit('open-tab', 'review')">
        <span class="kuapp-card-label">{{ t('kuapps.summary.pending') }}</span>
        <strong class="kuapp-card-value">{{ pendingTotal }}</strong>
        <small>{{ pendingDetail }}</small>
      </button>
      <button :class="['kuapp-card', coverageTone]" data-test="summary-coverage" @click="$emit('open-tab', 'resources')">
        <span class="kuapp-card-label" :title="t('kuapps.summary.coverageHint')">{{ t('kuapps.summary.coverage') }}</span>
        <strong class="kuapp-card-value">
          <template v-if="registryTotal">{{ coverage.withData }}<small> {{ t('kuapps.summary.ofTotal', { total: registryTotal }) }}</small></template>
          <template v-else>0</template>
        </strong>
        <span v-if="registryTotal" class="kuapp-card-bar"><i :style="{ width: `${coveragePercent}%` }"></i></span>
        <small>{{ coverageDetail }}</small>
      </button>
    </div>

    <!-- What to look at first, under the indicators: resource, evidence, since when and action (#239). -->
    <KUAppIssues
      v-if="application?.id && hasSignals"
      class="kuapp-issues"
      :application-id="application.id"
      :hours="RANGE_HOURS[range]"
      :limit="5"
      @action="issue => $emit('issue-action', issue)"
      @show-all="$emit('open-signals', { hours: RANGE_HOURS[range], filter: 'issues' })"
    />

    <BaseModal :show="confirmCollect" @close="confirmCollect = false">
      <template #title><i data-lucide="cloud-download"></i> {{ t('apm.collectTitle') }}</template>
      <!-- The same three questions as Signals (#239): what is read now, what comes from the local
           cache, and what costs. -->
      <div class="kuapp-collect-confirm" data-test="summary-collect-confirm">
        <p>{{ collectionDescription }}</p>
        <section>
          <h4>{{ t('obs.confirm.now') }}</h4>
          <ul>
            <li v-if="lambdaCount">{{ t('obs.confirm.lambdas', { n: formatNumber(lambdaCount), max: formatNumber(lambdaCount * 2) }) }}</li>
            <li v-if="cloudWatchResourceCount">{{ t('obs.confirm.cloudWatch', { n: formatNumber(cloudWatchResourceCount), metrics: formatNumber(cloudWatchEstimate.metricsPerCollection) }) }}</li>
            <li v-if="kubernetesCount">{{ t('obs.confirm.kubernetes', { n: formatNumber(kubernetesCount) }) }}</li>
            <li v-if="!lambdaCount && !cloudWatchResourceCount && !kubernetesCount">{{ t('obs.confirm.nothing') }}</li>
          </ul>
        </section>
        <section>
          <h4>{{ t('obs.confirm.cache') }}</h4>
          <p>{{ t('obs.confirm.cacheText') }}</p>
        </section>
        <section>
          <h4>{{ t('obs.confirm.cost') }}</h4>
          <p v-if="lambdaCount">{{ t('apm.costForecast', { count: formatNumber(lambdaCount), maximum: formatNumber(lambdaMonthlyMaximum) }) }}</p>
          <p v-if="cloudWatchEstimate.metricsPerCollection" data-test="summary-cloudwatch-cost">
            {{ t('apm.cloudWatchMonthlyEstimate', {
              metrics: formatNumber(cloudWatchEstimate.metricsPerCollection),
              requests: formatNumber(cloudWatchEstimate.requestsPerMonth),
              usd: formatNumber(cloudWatchEstimate.monthlyUsd, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
            }) }}
          </p>
          <p v-if="!lambdaCount && !cloudWatchEstimate.metricsPerCollection">{{ t('obs.confirm.noCost') }}</p>
          <small>{{ t('apm.collectionCostScope') }}</small>
        </section>
      </div>
      <template #footer>
        <button class="btn" :disabled="collecting" @click="confirmCollect = false">{{ t('action.cancel') }}</button>
        <button class="btn primary" data-test="summary-confirm-collect" :disabled="collecting" @click="confirmCollection">
          <i :data-lucide="collecting ? 'loader-2' : 'cloud-download'"></i>{{ collecting ? t('apm.collecting') : t('apm.confirmCollection') }}
        </button>
      </template>
    </BaseModal>
  </section>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { createIcons, icons } from 'lucide'
import BaseModal from '../BaseModal.vue'
import KUAppIssues from './KUAppIssues.vue'
import { useApi } from '../../composables/useApi'
import { formatNumber, useI18n } from '../../composables/useI18n'
import { buildResourceMetricSections, estimateCloudWatchMonthlyCost } from '../cloud/apm/metricCatalog'

// Compact Overview of a KUA Application (#171): four answers, each leading to the tab
// that has the detail. It reads the existing APM endpoints and never starts a collection
// itself: collection is confirmed here so starting it does not change workspace tabs.
const props = defineProps({
  application: { type: Object, default: null },
  provider: { type: String, default: 'generic' },
  // The profile the Observability routes accept for this application ('local' without provider).
  profileId: { type: String, default: '' },
  registry: { type: Object, default: () => ({ resources: [], relationships: [] }) },
  scopeWarnings: { type: Array, default: () => [] },
  reviewCount: { type: Number, default: 0 },
  collecting: { type: Boolean, default: false },
  collectError: { type: String, default: '' },
})
const emit = defineEmits(['open-tab', 'open-signals', 'issue-action', 'collect', 'suggestions', 'collection-estimate'])

const RANGES = ['6h', '24h', '7d']
const RANGE_MS = { '6h': 6 * 3600e3, '24h': 24 * 3600e3, '7d': 7 * 24 * 3600e3 }
const RANGE_HOURS = { '6h': 6, '24h': 24, '7d': 168 }
const THRESHOLD_LABELS = {
  errorRatePercent: 'apm.threshold.errorRate', durationMs: 'apm.threshold.duration',
  readyPodsPercent: 'apm.threshold.readyPods', restartDelta: 'apm.threshold.restarts',
  elb5xxRatePercent: 'apm.threshold.elb5xx', elbLatencyP95Ms: 'apm.threshold.elbLatency',
  elbGenerated5xxCount: 'apm.signal.elbGenerated5xx',
}

const { t } = useI18n()
const { apiFetch } = useApi()
const range = ref('24h')
const confirmCollect = ref(false)
const loading = ref(false)
const error = ref('')
const overview = ref(null)
const topology = ref(null)
let request = 0

const hasSignals = computed(() => !!props.application && !!(props.profileId || props.application.profileId))
const resources = computed(() => topology.value?.resources || [])
const lambdaCount = computed(() => resources.value.filter(resource => resource.type === 'lambda' && resource.enabled !== false).length)
const kubernetesCount = computed(() => resources.value.filter(resource => resource.type === 'kubernetes' && resource.enabled !== false).length)
const lambdaMonthlyMaximum = computed(() => lambdaCount.value * 48 * 30 * 2)
const cloudWatchEstimate = computed(() => estimateCloudWatchMonthlyCost(resources.value))
const cloudWatchResourceCount = computed(() => resources.value.filter(resource => resource.enabled !== false && ['elb', 'ec2', 's3'].includes(resource.type)).length)
watch([lambdaCount, cloudWatchEstimate], () => emit('collection-estimate', {
  lambdaCount: lambdaCount.value,
  lambdaMonthlyMaximum: lambdaMonthlyMaximum.value,
  ...cloudWatchEstimate.value,
  hasBillableReads: lambdaCount.value > 0 || cloudWatchEstimate.value.monthlyUsd > 0,
}), { immediate: true })
const collectionDescription = computed(() => [
  lambdaCount.value ? t('apm.collectDescriptionAws') : '',
  cloudWatchEstimate.value.metricsPerCollection ? t('apm.collectDescriptionCloudWatch') : '',
  kubernetesCount.value ? t('apm.collectDescriptionKubernetes') : '',
].filter(Boolean).join(' ') || t('apm.collectDescription'))
const analysis = computed(() => topology.value?.analysis || null)
const registryTotal = computed(() => props.registry?.resources?.length || resources.value.length)

const health = computed(() => overview.value?.health || null)
const healthTone = computed(() => !hasSignals.value || !health.value || health.value.status === 'unknown'
  ? 'unknown' : health.value.status === 'degraded' ? 'bad' : 'ok')
const healthTitle = computed(() => {
  if (!hasSignals.value) return t('kuapps.summary.noSignals')
  if (!health.value || health.value.status === 'unknown') return t('kuapps.summary.noData')
  return health.value.status === 'degraded' ? t('kuapps.summary.degraded') : t('kuapps.summary.healthy')
})
const healthDetail = computed(() => {
  if (!hasSignals.value) return t('kuapps.summary.noSignalsHint')
  const signal = health.value?.signals?.[0]
  if (signal) {
    const label = THRESHOLD_LABELS[signal.metric] ? t(THRESHOLD_LABELS[signal.metric]) : signal.metric
    // A count has no threshold to compare with (the load balancer's own 5xx errors).
    if (signal.comparison === 'count') return t('kuapps.summary.signalCount', { label, value: round(signal.value), count: health.value.signals.length })
    return t('kuapps.summary.signal', { label, value: round(signal.value), threshold: round(signal.threshold), count: health.value.signals.length })
  }
  if (!health.value || health.value.status === 'unknown') return t('kuapps.summary.noDataHint')
  return t('apm.healthHealthy')
})

const structureTone = computed(() => !analysis.value ? 'unknown' : analysis.value.score >= 80 ? 'ok' : analysis.value.score >= 50 ? 'attention' : 'bad')
const structureDetail = computed(() => {
  if (!hasSignals.value) return t('kuapps.summary.structureUnavailable')
  if (!analysis.value) return t('kuapps.summary.noDataHint')
  const findings = analysis.value.findings?.length || 0
  return findings
    ? t('kuapps.summary.findings', { count: findings, coverage: analysis.value.coveragePercent ?? 0 })
    : t('kuapps.summary.structureHealthy', { coverage: analysis.value.coveragePercent ?? 0 })
})

const suggestions = computed(() => analysis.value?.suggestions?.length || 0)
// reviewCount already includes the suggestions this summary reports through 'suggestions'.
const pendingTotal = computed(() => props.reviewCount)
const pendingDetail = computed(() => {
  const parts = []
  const relationships = (props.registry?.relationships || []).filter(item => item.status === 'suggested').length
  if (relationships) parts.push(t('kuapps.summary.pendingRelationships', { count: relationships }))
  if (suggestions.value) parts.push(t('kuapps.summary.pendingSuggestions', { count: suggestions.value }))
  if (props.scopeWarnings.length) parts.push(t('kuapps.summary.pendingScopes', { count: props.scopeWarnings.length }))
  return parts.join(' · ') || t('kuapps.review.nothing')
})

// Coverage that means data (#239): inventoried resources, the ones whose type KUA collects
// (compatible), the ones it can collect now (enabled: collection on and a profile reaches them),
// and the ones with recent data. Only the last one counts as covered.
const ENABLED_STATES = new Set(['current', 'partial', 'stale', 'no_data', 'error'])
const coverage = computed(() => {
  const registryResources = props.registry?.resources || []
  const states = registryResources.map(resource => resource.signals?.state).filter(Boolean)
  if (states.length) {
    return {
      compatible: states.filter(state => state !== 'unsupported').length,
      enabled: states.filter(state => ENABLED_STATES.has(state)).length,
      withData: states.filter(state => state === 'current' || state === 'partial').length,
      uncollected: [],
    }
  }
  // An older backend without signal states: what each type could collect, never shown as data.
  const sections = buildResourceMetricSections({ resources: resources.value })
  const compatible = sections.filter(section => section.collectsMetrics).reduce((sum, section) => sum + section.resourceCount, 0)
  return { compatible, enabled: null, withData: 0, uncollected: sections.filter(section => !section.collectsMetrics) }
})
const coveragePercent = computed(() => registryTotal.value ? Math.round(100 * coverage.value.withData / registryTotal.value) : 0)
// Green only when most of what can be collected has recent data, never for compatibility alone.
const coverageTone = computed(() => {
  if (!registryTotal.value) return 'unknown'
  const { withData, compatible } = coverage.value
  return compatible && withData / compatible >= 0.8 ? 'ok' : 'attention'
})
const coverageDetail = computed(() => {
  if (!registryTotal.value) return t('kuapps.noResourcesHint')
  if (!hasSignals.value) return t('kuapps.summary.noSignalsHint')
  const { compatible, enabled, withData } = coverage.value
  return enabled == null
    ? t('kuapps.summary.coverageCompatible', { compatible })
    : t('kuapps.summary.coverageBreakdown', { compatible, enabled, withData })
})

const freshnessLabel = computed(() => {
  const run = overview.value?.latestRun
  if (!hasSignals.value) return t('kuapps.summary.noSignals')
  if (!run) return t('apm.notCollected')
  return t('kuapps.summary.lastCollection', { status: t(`apm.status.${run.status}`), date: new Date(run.finishedAt || run.startedAt).toLocaleString() })
})

function confirmCollection() {
  confirmCollect.value = false
  emit('collect')
}

function round(value) {
  return Number.isFinite(Number(value)) ? Math.round(Number(value) * 100) / 100 : value
}

async function load() {
  const application = props.application
  const id = ++request
  overview.value = null
  topology.value = null
  error.value = ''
  emit('suggestions', 0)
  const profile = props.profileId || application?.profileId
  if (!application?.id || !profile) return
  loading.value = true
  const to = Date.now()
  const from = to - RANGE_MS[range.value]
  const base = `/api/observability/${props.provider}/applications/${encodeURIComponent(application.id)}`
  const headers = { 'X-Profile-Id': profile }
  try {
    const [nextOverview, nextTopology] = await Promise.all([
      apiFetch(`${base}/overview?from=${from}&to=${to}`, { headers }),
      apiFetch(`${base}/topology`, { headers }),
    ])
    if (id !== request) return
    overview.value = nextOverview
    topology.value = nextTopology
    emit('suggestions', nextTopology?.analysis?.suggestions?.length || 0)
  } catch (err) {
    if (id === request) error.value = err.message
  } finally {
    if (id === request) loading.value = false
    nextTick(() => createIcons({ icons }))
  }
}

watch(() => [props.application?.id, props.profileId, props.provider, range.value], load, { immediate: true })
defineExpose({ reload: load })
</script>

<style scoped>
.kuapp-summary { display: grid; gap: 10px; padding: 12px 18px 0; }
.kuapp-summary-bar { display: flex; align-items: center; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
.kuapp-summary-freshness { margin-right: auto; color: var(--text-dim); font-size: 12px; }
.kuapp-summary-bar svg { width: 13px; }
.kuapp-summary-error { margin: 0; color: var(--red); font-size: 12px; }
.kuapp-collect-confirm { display: grid; gap: 10px; max-width: 560px; }
.kuapp-collect-confirm p, .kuapp-collect-confirm small { margin: 0; line-height: 1.5; }
.kuapp-collect-confirm h4 { margin: 0 0 4px; font-size: 13px; }
.kuapp-collect-confirm ul { margin: 0; padding-left: 18px; }
.kuapp-collect-confirm small { color: var(--text-dim); }
.kuapp-issues { margin-top: 12px; }
.range-control { display: flex; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
.range-control button { height: 27px; min-width: 35px; border: 0; border-right: 1px solid var(--border); background: var(--bg-panel); color: var(--text-dim); font-size: 12px; cursor: pointer; }
.range-control button:last-child { border-right: 0; }
.range-control button.active { background: var(--accent); color: #fff; }
.kuapp-summary-cards { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
.kuapp-card { min-width: 0; padding: 11px 13px; display: flex; flex-direction: column; gap: 6px; border: 1px solid var(--border); border-radius: 7px; background: var(--bg-panel); color: var(--text); text-align: left; cursor: pointer; }
.kuapp-card:hover { border-color: var(--accent); }
.kuapp-card:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.kuapp-card-label { color: var(--text-dim); font-size: 12px; letter-spacing: .04em; text-transform: uppercase; }
.kuapp-card-value { font-size: 20px; font-variant-numeric: tabular-nums; }
.kuapp-card-value small { color: var(--text-dim); font-size: 12px; font-weight: 400; }
.kuapp-card > small { color: var(--text-dim); font-size: 12px; line-height: 1.4; overflow-wrap: anywhere; }
.kuapp-card-bar { height: 5px; border-radius: 3px; background: var(--bg-hover); overflow: hidden; }
.kuapp-card-bar i { display: block; height: 100%; background: var(--accent); }
.kuapp-card.ok { border-left: 3px solid var(--green); }
.kuapp-card.attention { border-left: 3px solid var(--yellow); }
.kuapp-card.bad { border-left: 3px solid var(--red); }
.kuapp-card.unknown { border-left: 3px solid var(--border); }
@media (max-width: 1100px) { .kuapp-summary-cards { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 620px) { .kuapp-summary-cards { grid-template-columns: minmax(0, 1fr); } .kuapp-summary { padding-inline: 10px; } }
</style>
