<template>
  <div class="aoi">
    <p v-if="section === 'summary' && !insights && loading" class="aoi-loading">{{ t('awsInsights.loading') }}</p>
    <p v-else-if="section === 'summary' && !insights && error" class="aoi-notice"><i data-lucide="alert-triangle"></i>{{ t('awsInsights.failed', { error }) }}</p>

    <template v-else-if="insights">
      <div v-if="section === 'summary'" class="aoi-grid">
        <!-- Costs -->
        <section class="aoi-card">
          <div class="aoi-card-head">
            <h3>{{ t('awsInsights.costs') }}</h3>
            <span v-if="costs.status === 'ok' && costs.estimated" class="aoi-tag">{{ t('awsInsights.estimated') }}</span>
          </div>

          <template v-if="costs.status === 'ok'">
            <div class="aoi-figures">
              <div>
                <span class="aoi-label">{{ t('awsInsights.monthToDate') }}</span>
                <span class="aoi-big">{{ money(costs.monthToDate) }}</span>
              </div>
              <div v-if="costs.forecast?.monthEnd != null">
                <span class="aoi-label">{{ t('awsInsights.forecast') }}</span>
                <span class="aoi-mid">{{ money(costs.forecast.monthEnd) }}</span>
              </div>
              <div v-if="costs.lastMonth != null">
                <span class="aoi-label">{{ t('awsInsights.lastMonth') }}</span>
                <span class="aoi-mid">{{ money(costs.lastMonth) }}</span>
              </div>
            </div>

            <ul v-if="topCosts.length" class="aoi-bars">
              <li v-for="item in topCosts" :key="item.name" :title="item.name">
                <button class="aoi-bar-row" :disabled="!item.tab || item.partial" @click="item.tab && !item.partial && emit('open-tab', item.tab)">
                  <span class="aoi-bar-label">
                    {{ item.label }}
                    <span v-if="item.partial" class="aoi-tag">{{ t('awsInsights.partlyInKua') }}</span>
                    <span v-else-if="!item.tab" class="aoi-tag warn">{{ t('awsInsights.notInKua') }}</span>
                  </span>
                  <span class="aoi-bar-value">{{ money(item.monthToDate) }}</span>
                  <span class="aoi-bar-track"><span class="aoi-bar-fill" :style="{ width: `${barWidth(item.monthToDate)}%` }"></span></span>
                </button>
              </li>
            </ul>

            <p v-if="costs.source === 'cloudwatch-billing'" class="aoi-note">
              {{ t('awsInsights.billingFallback') }}
              <button v-if="costs.explorer?.access" class="aoi-link" @click="openAccess(costs.explorer)">{{ t('awsAccess.requestAccess') }}</button>
            </p>
            <div v-else class="aoi-cost-footer">
              <span>{{ t('awsInsights.costSource', { ago: agoLabel(costs.fetchedAt), next: untilLabel(costs.cachedUntil) }) }}</span>
              <button class="aoi-link" :disabled="refreshingCosts" :title="t('awsInsights.refreshCostsHint')" @click="emit('refresh-costs')">
                {{ refreshingCosts ? t('awsInsights.refreshingCosts') : t('awsInsights.refreshCosts') }}
              </button>
            </div>
          </template>
          <div v-else class="aoi-notice">
            <i data-lucide="lock"></i>
            <span>{{ t('awsInsights.costsUnavailable') }}</span>
            <button v-if="costs.access" class="aoi-link" @click="openAccess(costs)">{{ t('awsAccess.requestAccess') }}</button>
          </div>
        </section>

        <!-- Lambda activity -->
        <section class="aoi-card">
          <div class="aoi-card-head"><h3>{{ t('awsInsights.lambdaActivity') }}</h3></div>
          <template v-if="lambda.status === 'ok'">
            <div class="aoi-figures">
              <div><span class="aoi-label">{{ t('awsInsights.invocations') }}</span><span class="aoi-big">{{ num(lambda.invocations) }}</span></div>
              <div><span class="aoi-label">{{ t('awsInsights.errors') }}</span><span class="aoi-mid" :class="{ bad: lambda.errors }">{{ num(lambda.errors) }} <small>({{ lambda.errorRate }}%)</small></span></div>
              <div><span class="aoi-label">{{ t('awsInsights.throttles') }}</span><span class="aoi-mid" :class="{ bad: lambda.throttles }">{{ num(lambda.throttles) }}</span></div>
            </div>
            <CloudMetricChart
              v-if="lambda.series.invocations.length"
              :label="t('awsInsights.invocationsPerHour')" unit="count" :points="lambda.series.invocations"
              :x-tick-limit="6" color="#0e9de8"
            />
            <p v-else class="aoi-note">{{ t('awsInsights.noLambdaActivity') }}</p>
          </template>
          <div v-else class="aoi-notice">
            <i data-lucide="lock"></i><span>{{ errorText(lambda.error) }}</span>
            <button v-if="lambda.access" class="aoi-link" @click="openAccess(lambda)">{{ t('awsAccess.requestAccess') }}</button>
          </div>
        </section>
      </div>

      <!-- Services outside KUA -->
      <section v-if="section === 'uncovered'" class="aoi-card">
        <div class="aoi-card-head">
          <h3>{{ t('awsInsights.uncoveredTitle') }}</h3>
          <span class="aoi-dim">{{ t('awsInsights.uncoveredCount', { n: uncovered.length }) }}</span>
        </div>
        <p class="aoi-note">{{ t('awsInsights.uncoveredIntro') }}</p>
        <p v-if="!uncovered.length" class="aoi-note">{{ t('awsInsights.uncoveredNone') }}</p>
        <table v-else class="aoi-table">
          <thead>
            <tr>
              <th>{{ t('awsInsights.colService') }}</th>
              <th class="num">{{ t('awsInsights.colThisMonth') }}</th>
              <th class="num">{{ t('awsInsights.colLastMonth') }}</th>
              <th class="num">{{ t('awsInsights.colTagged') }}</th>
              <th class="num">{{ t('awsInsights.colChanges') }}</th>
              <th>{{ t('awsInsights.colDetectedBy') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in uncovered" :key="s.key" :class="{ partial: s.partial }">
              <td>
                {{ s.label }}
                <span v-if="s.partial" class="aoi-tag">{{ t('awsInsights.partlyInKua') }}</span>
                <span v-else-if="s.marketplace" class="aoi-tag">{{ t('awsInsights.marketplace') }}</span>
              </td>
              <td class="num">{{ s.sources.includes('cost') ? money(s.cost) : '—' }}</td>
              <td class="num">{{ s.sources.includes('cost') ? money(s.lastMonthCost) : '—' }}</td>
              <td class="num">{{ s.taggedResources || '—' }}</td>
              <td class="num">{{ s.recentChanges || '—' }}</td>
              <td><span v-for="src in s.sources" :key="src" class="aoi-tag">{{ t(`awsInsights.source.${src}`) }}</span></td>
            </tr>
          </tbody>
        </table>
        <ul class="aoi-sources">
          <li v-for="src in sourceNotes" :key="src.key" :class="{ warn: src.warn }">
            {{ src.text }}
            <button v-if="src.access" class="aoi-link" @click="openAccess(src.failure)">{{ t('awsAccess.requestAccess') }}</button>
          </li>
        </ul>
      </section>
    </template>

    <AwsAccessRequestModal
      :show="!!accessFailure"
      :access="accessFailure?.access || null"
      :message="accessFailure?.error?.message || ''"
      :identity="identity"
      @close="accessFailure = null"
    />
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useI18n } from '../../composables/useI18n'
import { settings } from '../../composables/useSettings'
import CloudMetricChart from './CloudMetricChart.vue'
import AwsAccessRequestModal from './AwsAccessRequestModal.vue'

const props = defineProps({
  // 'summary' = costs and Lambda activity; 'uncovered' = services outside KUA.
  section: { type: String, default: 'summary' },
  insights: { type: Object, default: null },
  loading: Boolean,
  error: { type: String, default: null },
  refreshingCosts: Boolean,
  identity: { type: Object, default: null },
  now: { type: Number, default: () => Date.now() },
})
const emit = defineEmits(['open-tab', 'refresh-costs'])
const { t } = useI18n()

const accessFailure = ref(null)
const costs = computed(() => props.insights?.costs || {})
const lambda = computed(() => props.insights?.usage?.lambda || {})
const uncovered = computed(() => props.insights?.uncovered?.services || [])

// Costs aggregated per KUA service (EC2 and "EC2 - Other" share a bar).
const topCosts = computed(() => {
  const byKey = new Map()
  for (const item of costs.value.byService || []) {
    const entry = byKey.get(item.key) || { ...item, monthToDate: 0 }
    entry.monthToDate += item.monthToDate
    byKey.set(item.key, entry)
  }
  return [...byKey.values()].filter(item => item.monthToDate >= 0.01).sort((a, b) => b.monthToDate - a.monthToDate).slice(0, 8)
})
const maxCost = computed(() => Math.max(...topCosts.value.map(item => item.monthToDate), 0))

const sourceNotes = computed(() => {
  const sources = props.insights?.uncovered?.sources || {}
  const notes = []
  const add = (key, failure, okText) => {
    if (!failure) return
    if (failure.status === 'ok') notes.push({ key, text: okText })
    else notes.push({ key, warn: true, text: t('awsInsights.sourceMissing', { source: t(`awsInsights.source.${key}`), reason: errorText(failure.error) }), access: !!failure.access, failure })
  }
  add('cost', sources.costs, t('awsInsights.sourceCostOk'))
  add('tags', sources.tags, t(sources.tags?.truncated ? 'awsInsights.sourceTagsTruncated' : 'awsInsights.sourceTagsOk', { n: sources.tags?.total ?? 0 }))
  add('cloudtrail', sources.cloudtrail, t(sources.cloudtrail?.truncated ? 'awsInsights.sourceTrailTruncated' : 'awsInsights.sourceTrailOk', { n: sources.cloudtrail?.total ?? 0 }))
  return notes
})

function money(value) {
  const currency = costs.value.currency || 'USD'
  return new Intl.NumberFormat(settings.lang === 'es' ? 'es' : 'en-US', { style: 'currency', currency, maximumFractionDigits: value >= 1000 ? 0 : 2 }).format(value || 0)
}
function num(value) {
  return new Intl.NumberFormat(settings.lang === 'es' ? 'es' : 'en-US').format(value || 0)
}
function barWidth(value) {
  return maxCost.value ? Math.max(2, (value / maxCost.value) * 100) : 0
}
function hours(ms) {
  return Math.max(0, Math.round(ms / 3600000))
}
function agoLabel(ts) {
  const h = hours(props.now - ts)
  return h < 1 ? t('awsInsights.justNow') : t('awsInsights.hoursAgo', { n: h })
}
function untilLabel(ts) {
  return t('awsInsights.inHours', { n: Math.max(1, hours(ts - props.now)) })
}
function errorText(err) {
  if (!err) return ''
  const keys = { denied: 'awsOverview.errorDenied', expired: 'awsOverview.errorExpired', timeout: 'awsOverview.errorTimeout' }
  return keys[err.kind] ? t(keys[err.kind]) : err.message
}
function openAccess(failure) {
  accessFailure.value = failure
}
</script>

<style scoped>
.aoi { display: flex; flex-direction: column; gap: 12px; }
.aoi-loading { margin: 0; font-size: 12px; color: var(--text-dim); }
.aoi-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.aoi-card { border: 1px solid var(--border); border-radius: 8px; background: var(--bg-panel); padding: 12px 14px; min-width: 0; display: flex; flex-direction: column; gap: 10px; }
.aoi-card-head { display: flex; align-items: center; gap: 8px; }
.aoi-card-head h3 { margin: 0; font-size: 12px; font-weight: 600; flex: 1; }
.aoi-dim { color: var(--text-dim); font-size: 12px; }
.aoi-label { display: block; font-size: 11px; font-weight: 600; color: var(--text-dim); text-transform: uppercase; letter-spacing: .03em; }
.aoi-figures { display: flex; flex-wrap: wrap; gap: 8px 28px; align-items: flex-end; }
.aoi-big { font-size: 26px; font-weight: 600; line-height: 1.1; font-variant-numeric: tabular-nums; }
.aoi-mid { font-size: 17px; font-weight: 600; font-variant-numeric: tabular-nums; }
.aoi-mid small { font-size: 12px; font-weight: 400; color: var(--text-dim); }
.aoi-mid.bad { color: var(--red); }
.aoi-tag { display: inline-block; margin-left: 4px; padding: 0 6px; border-radius: 9px; font-size: 10px; font-weight: 600; border: 1px solid var(--border); color: var(--text-dim); vertical-align: middle; }
.aoi-tag.warn { color: var(--yellow); border-color: color-mix(in srgb, var(--yellow) 45%, var(--border)); }
.aoi-note { margin: 0; font-size: 12px; color: var(--text-dim); }
.aoi-notice { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin: 0; font-size: 12px; color: var(--text-dim); }
.aoi-notice svg { width: 14px; height: 14px; }
.aoi-link { border: none; background: transparent; color: var(--accent); cursor: pointer; font: inherit; font-size: 12px; padding: 0; }
.aoi-link:disabled { color: var(--text-dim); cursor: default; }
.aoi-cost-footer { display: flex; justify-content: space-between; gap: 10px; flex-wrap: wrap; font-size: 11px; color: var(--text-dim); }

.aoi-bars { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.aoi-bar-row {
  display: grid; grid-template-columns: minmax(0, 1fr) auto; grid-template-rows: auto 6px; gap: 3px 10px; width: 100%;
  border: none; background: transparent; color: var(--text); font: inherit; text-align: left; padding: 2px 0; cursor: pointer;
}
.aoi-bar-row:disabled { cursor: default; }
.aoi-bar-row:not(:disabled):hover .aoi-bar-label { color: var(--accent); }
.aoi-bar-label { font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.aoi-bar-value { font-size: 12px; font-variant-numeric: tabular-nums; color: var(--text-dim); }
.aoi-bar-track { grid-column: 1 / -1; background: color-mix(in srgb, var(--text-dim) 16%, transparent); border-radius: 4px; overflow: hidden; }
.aoi-bar-fill { display: block; height: 100%; border-radius: 4px; background: var(--accent); }

.aoi-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.aoi-table th { text-align: left; font-weight: 600; color: var(--text-dim); padding: 4px 8px; border-bottom: 1px solid var(--border); }
.aoi-table td { padding: 5px 8px; border-bottom: 1px solid color-mix(in srgb, var(--border) 50%, transparent); }
.aoi-table .num { text-align: right; font-variant-numeric: tabular-nums; }
.aoi-table tr.partial td { color: var(--text-dim); }
.aoi-sources { margin: 0; padding-left: 16px; font-size: 11px; color: var(--text-dim); display: flex; flex-direction: column; gap: 2px; }
.aoi-sources li.warn { color: var(--yellow); }

@media (max-width: 1000px) {
  .aoi-grid { grid-template-columns: minmax(0, 1fr); }
}
</style>
