<template>
  <div class="aoi">
    <p v-if="section === 'summary' && !insights && loading" class="aoi-loading">{{ t('awsInsights.loading') }}</p>
    <p v-else-if="section === 'summary' && !insights && error" class="aoi-notice"><i data-lucide="alert-triangle"></i>{{ t('awsInsights.failed', { error }) }}</p>

    <template v-else-if="insights">
      <!-- Operational attention: services with failures in the activity window, linked to the affected resources -->
      <section v-if="section === 'summary' && incidents.length" class="aoi-incidents" data-test="incidents">
        <div class="aoi-section-head">
          <h3>{{ t('awsIncident.title') }}</h3>
          <span class="aoi-dim">{{ t('awsIncident.window') }}</span>
        </div>
        <ul>
          <li v-for="item in incidents" :key="item.id" :data-test="`incident-${item.id}`">
            <span class="aoi-incident-text"><strong>{{ item.title }}</strong> {{ item.text }}</span>
            <button class="btn sm" @click="emit('open-tab', { tab: item.tab, incident: item.filter })">{{ item.filter ? t('awsIncident.viewAffected') : t('awsIncident.openService') }}</button>
          </li>
        </ul>
      </section>

      <div v-if="section === 'summary'" class="aoi-grid">
        <!-- Costs -->
        <section class="aoi-card aoi-costs">
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

      </div>

      <!-- Activity, last 24h: one card per service that has data -->
      <section v-if="section === 'summary'" class="aoi-activity">
        <div class="aoi-section-head">
          <h3>{{ t('awsInsights.activity') }}</h3>
          <span class="aoi-dim">{{ t('awsInsights.activityHint') }}</span>
        </div>
        <div v-if="usage.cloudwatch" class="aoi-notice">
          <i data-lucide="lock"></i><span>{{ t('awsInsights.cloudwatchUnavailable', { reason: errorText(usage.cloudwatch.error) }) }}</span>
          <button v-if="usage.cloudwatch.access" class="aoi-link" @click="openAccess(usage.cloudwatch)">{{ t('awsAccess.requestAccess') }}</button>
        </div>
        <p v-else-if="!activityCards.length" class="aoi-note">{{ t('awsInsights.noActivity') }}</p>
        <div class="aoi-kpis">
          <button
            v-for="card in activityCards" :key="card.id"
            :class="['aoi-kpi', { clickable: !!card.tab, warn: card.warn }]"
            :disabled="!card.tab"
            :title="card.tab ? t('awsOverview.openService', { service: card.title }) : ''"
            @click="card.tab && emit('open-tab', card.tab)"
          >
            <span class="aoi-kpi-head">
              <span class="aoi-kpi-title">{{ card.title }}</span>
              <span v-if="card.outside" class="aoi-tag warn">{{ t('awsInsights.notInKua') }}</span>
            </span>
            <span class="aoi-kpi-main">
              <span class="aoi-kpi-value" :class="{ bad: card.mainBad }">{{ card.main }}</span>
              <span class="aoi-kpi-caption">{{ card.mainLabel }}</span>
            </span>
            <span class="aoi-kpi-facts">
              <span v-for="fact in card.facts" :key="fact.label" :class="{ bad: fact.bad }">
                <span class="aoi-dim">{{ fact.label }}</span> {{ fact.value }}
              </span>
            </span>
            <Sparkline v-if="card.series?.length > 1" :points="card.series" :label="card.seriesLabel" />
            <span v-if="card.note" class="aoi-kpi-note">{{ card.note }}</span>
            <span
              v-if="card.access" class="aoi-link" role="button" tabindex="0"
              @click.stop="openAccess(card.access)" @keydown.enter.stop="openAccess(card.access)"
            >{{ t('awsAccess.requestAccess') }}</span>
          </button>
        </div>
      </section>

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
import { ref, computed, h } from 'vue'
import { useI18n } from '../../composables/useI18n'
import { settings } from '../../composables/useSettings'
import AwsAccessRequestModal from './AwsAccessRequestModal.vue'

const props = defineProps({
  // 'summary' = costs and activity; 'uncovered' = services outside KUA.
  section: { type: String, default: 'summary' },
  // Resource counts from the overview (e.g. { eks: 1 }), to explain missing metrics.
  resourceCounts: { type: Object, default: () => ({}) },
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
const usage = computed(() => props.insights?.usage || {})

// Tiny trend line; the value range is in the tooltip, the card holds the numbers.
const Sparkline = ({ points, label }) => {
  const values = points.map(p => p.v)
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const span = hi - lo || 1
  const coords = values.map((v, i) => `${(i / (values.length - 1)) * 100},${34 - ((v - lo) / span) * 30}`).join(' ')
  // Inline presentation: scoped styles do not reach elements built with h().
  return h('svg', { class: 'aoi-spark', viewBox: '0 0 100 36', preserveAspectRatio: 'none', role: 'img', 'aria-label': label, style: { width: '100%', height: '36px', display: 'block' } },
    [h('title', label), h('polyline', {
      points: coords, fill: 'none', stroke: 'var(--accent)', 'stroke-width': 2,
      'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'vector-effect': 'non-scaling-stroke',
    })])
}
Sparkline.props = ['points', 'label']

function bytes(value) {
  if (value == null) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  let n = value
  let unit = 0
  while (n >= 1000 && unit < units.length - 1) { n /= 1000; unit += 1 }
  return `${new Intl.NumberFormat(settings.lang === 'es' ? 'es' : 'en-US', { maximumFractionDigits: n >= 100 ? 0 : 1 }).format(n)} ${units[unit]}`
}
function pct(value) {
  return value == null ? '—' : `${value}%`
}
function ms(value) {
  if (value < 1000) return `${value} ms`
  return value < 60000 ? `${(value / 1000).toFixed(1)} s` : `${(value / 60000).toFixed(1)} min`
}
function duration(seconds) {
  if (!seconds) return '0 min'
  return seconds >= 3600 ? `${(seconds / 3600).toFixed(1)} h` : `${Math.round(seconds / 60)} min`
}
function seriesLabel(name, points, format) {
  const values = points.map(p => p.v)
  return t('awsInsights.seriesRange', { name, min: format(Math.min(...values)), max: format(Math.max(...values)) })
}

// Failures in the activity window. `filter` means the tab can show only the
// affected resources; the others open the service.
const incidents = computed(() => {
  const u = usage.value
  const items = []
  // Without CloudWatch only Glue (its own API) can report failures.
  const metrics = u.cloudwatch ? {} : u
  if (metrics.lambda?.errors > 0) {
    items.push({ id: 'lambda', tab: 'lambda', filter: true, title: 'Lambda', text: t('awsIncident.lambda', { n: num(u.lambda.errors), rate: u.lambda.errorRate }) })
  }
  if (metrics.elb?.errors5xx > 0) {
    items.push({ id: 'elb', tab: 'elb', filter: true, title: t('awsInsights.loadBalancers'), text: t('awsIncident.elb', { n: num(u.elb.errors5xx), elb: num(u.elb.elbGenerated5xx || 0) }) })
  }
  const sfnFailed = (metrics.stepfn?.failed || 0) + (metrics.stepfn?.timedOut || 0)
  if (sfnFailed > 0) {
    items.push({ id: 'stepfn', tab: 'stepfn', filter: true, title: 'Step Functions', text: t('awsIncident.stepfn', { n: num(sfnFailed) }) })
  }
  if (metrics.eventbridge?.failed > 0) {
    items.push({ id: 'eventbridge', tab: 'eventbridge', filter: false, title: 'EventBridge', text: t('awsIncident.eventbridge', { n: num(u.eventbridge.failed) }) })
  }
  if (metrics.eks?.failedNodes > 0) {
    items.push({ id: 'eks', tab: 'eks', filter: false, title: 'EKS', text: t('awsIncident.eks', { n: num(u.eks.failedNodes) }) })
  }
  if (u.glue?.status === 'ok' && u.glue.failed > 0) {
    items.push({ id: 'glue', tab: 'glue', filter: false, title: 'Glue', text: t('awsIncident.glue', { n: num(u.glue.failed) }) })
  }
  return items
})

const activityCards = computed(() => {
  const u = usage.value
  if (u.cloudwatch) return glueCard(u.glue) ? [glueCard(u.glue)] : []
  const cards = []
  if (u.lambda?.present) {
    cards.push({
      id: 'lambda', tab: 'lambda', title: 'Lambda',
      main: num(u.lambda.invocations), mainLabel: t('awsInsights.invocations'),
      facts: [
        { label: t('awsInsights.errors'), value: `${num(u.lambda.errors)} (${u.lambda.errorRate}%)`, bad: u.lambda.errors > 0 },
        { label: t('awsInsights.throttles'), value: num(u.lambda.throttles), bad: u.lambda.throttles > 0 },
      ],
      series: u.lambda.series, seriesLabel: seriesLabel(t('awsInsights.invocationsPerHour'), u.lambda.series, num),
    })
  }
  if (u.ec2?.present) {
    cards.push({
      id: 'ec2', tab: 'ec2', title: 'EC2',
      main: pct(u.ec2.cpuAvg), mainLabel: t('awsInsights.cpuAvg'), mainBad: u.ec2.cpuAvg >= 80,
      facts: [
        { label: t('awsInsights.cpuPeak'), value: pct(u.ec2.cpuPeak), bad: u.ec2.cpuPeak >= 90 },
        { label: t('awsInsights.cpuNow'), value: pct(u.ec2.cpuNow) },
      ],
      series: u.ec2.series, seriesLabel: seriesLabel(t('awsInsights.cpuAvgPerHour'), u.ec2.series, v => `${v.toFixed(1)}%`),
    })
  }
  if (u.elb?.present) {
    const onlyElb5xx = u.elb.elbGenerated5xx > u.elb.requests
    cards.push({
      id: 'elb', tab: 'elb', title: t('awsInsights.loadBalancers'), warn: u.elb.errors5xx > 0,
      main: num(u.elb.requests), mainLabel: t('awsInsights.requests'),
      facts: [
        // A rate over 100% is meaningless: 5xx generated by the load balancer are not in RequestCount.
        { label: '5xx', value: u.elb.errorRate != null && u.elb.errorRate <= 100 ? `${num(u.elb.errors5xx)} (${u.elb.errorRate}%)` : num(u.elb.errors5xx), bad: u.elb.errors5xx > 0 },
        ...(u.elb.latencyMs != null ? [{ label: t('awsInsights.latency'), value: `${num(u.elb.latencyMs)} ms` }] : []),
        ...(u.elb.nlbBytes != null ? [{ label: 'NLB', value: bytes(u.elb.nlbBytes) }] : []),
      ],
      note: onlyElb5xx ? t('awsInsights.elbGenerated5xx', { n: num(u.elb.elbGenerated5xx) }) : '',
      series: u.elb.series, seriesLabel: seriesLabel(t('awsInsights.requestsPerHour'), u.elb.series || [], num),
    })
  }
  if (u.eks?.present) {
    cards.push({
      id: 'eks', tab: 'eks', title: 'EKS', warn: u.eks.failedNodes > 0,
      main: num(u.eks.nodes), mainLabel: t('awsInsights.nodes'),
      facts: [
        { label: t('awsInsights.failedNodes'), value: num(u.eks.failedNodes), bad: u.eks.failedNodes > 0 },
        { label: 'CPU', value: pct(u.eks.cpuAvg) },
        { label: t('awsInsights.memory'), value: pct(u.eks.memoryAvg) },
      ],
      series: u.eks.series, seriesLabel: seriesLabel(t('awsInsights.cpuAvgPerHour'), u.eks.series, v => `${v.toFixed(1)}%`),
    })
  } else if (props.resourceCounts.eks > 0) {
    cards.push({ id: 'eks', tab: 'eks', title: 'EKS', main: num(props.resourceCounts.eks), mainLabel: t('awsInsights.clusters'), facts: [], note: t('awsInsights.eksNoInsights') })
  }
  if (u.rds?.present) {
    const lowStorage = u.rds.freeStorageMin != null && u.rds.freeStorageMin < 5e9
    cards.push({
      id: 'rds', tab: 'rds', title: 'RDS', warn: lowStorage || u.rds.cpuPeak >= 90,
      main: pct(u.rds.cpuAvg), mainLabel: t('awsInsights.cpuAvg'), mainBad: u.rds.cpuAvg >= 80,
      facts: [
        { label: t('awsInsights.cpuPeak'), value: pct(u.rds.cpuPeak), bad: u.rds.cpuPeak >= 90 },
        { label: t('awsInsights.connections'), value: num(u.rds.connections) },
        { label: t('awsInsights.freeStorageMin'), value: bytes(u.rds.freeStorageMin), bad: lowStorage },
      ],
      note: lowStorage ? t('awsInsights.lowStorage') : '',
      series: u.rds.series, seriesLabel: seriesLabel(t('awsInsights.cpuAvgPerHour'), u.rds.series, v => `${v.toFixed(1)}%`),
    })
  }
  if (u.dynamodb?.present) {
    cards.push({
      id: 'dynamodb', tab: 'dynamodb', title: 'DynamoDB', warn: u.dynamodb.throttled > 0 || u.dynamodb.systemErrors > 0,
      main: num(u.dynamodb.readUnits), mainLabel: t('awsInsights.readUnits'),
      facts: [
        { label: t('awsInsights.writeUnits'), value: num(u.dynamodb.writeUnits) },
        { label: t('awsInsights.throttled'), value: num(u.dynamodb.throttled), bad: u.dynamodb.throttled > 0 },
        ...(u.dynamodb.systemErrors ? [{ label: t('awsInsights.systemErrors'), value: num(u.dynamodb.systemErrors), bad: true }] : []),
        ...(u.dynamodb.latencyMs != null ? [{ label: t('awsInsights.latency'), value: `${u.dynamodb.latencyMs} ms` }] : []),
      ],
      series: u.dynamodb.series, seriesLabel: seriesLabel(t('awsInsights.readUnitsPerHour'), u.dynamodb.series, num),
    })
  }
  if (u.stepfn?.present) {
    const failed = u.stepfn.failed + u.stepfn.timedOut
    cards.push({
      id: 'stepfn', tab: 'stepfn', title: 'Step Functions', warn: failed > 0,
      main: num(u.stepfn.started), mainLabel: t('awsInsights.executions'),
      facts: [
        { label: t('awsInsights.succeeded'), value: num(u.stepfn.succeeded) },
        { label: t('awsInsights.runsFailed'), value: num(u.stepfn.failed), bad: u.stepfn.failed > 0 },
        ...(u.stepfn.timedOut ? [{ label: t('awsInsights.timedOut'), value: num(u.stepfn.timedOut), bad: true }] : []),
        ...(u.stepfn.avgDurationMs != null ? [{ label: t('awsInsights.avgDuration'), value: ms(u.stepfn.avgDurationMs) }] : []),
      ],
      series: u.stepfn.series, seriesLabel: seriesLabel(t('awsInsights.executionsPerHour'), u.stepfn.series, num),
    })
  }
  if (u.eventbridge?.present) {
    cards.push({
      id: 'eventbridge', tab: 'eventbridge', title: 'EventBridge', warn: u.eventbridge.failed > 0,
      main: num(u.eventbridge.invocations), mainLabel: t('awsInsights.ruleInvocations'),
      facts: [
        { label: t('awsInsights.runsFailed'), value: num(u.eventbridge.failed), bad: u.eventbridge.failed > 0 },
        { label: t('awsInsights.matchedEvents'), value: num(u.eventbridge.matched) },
      ],
      series: u.eventbridge.series, seriesLabel: seriesLabel(t('awsInsights.invocationsPerHour'), u.eventbridge.series, num),
    })
  }
  const glue = glueCard(u.glue)
  if (glue) cards.push(glue)
  if (u.cloudfront?.present) {
    cards.push({
      id: 'cloudfront', tab: 'cloudfront', title: 'CloudFront', warn: u.cloudfront.error5xxRate > 1,
      main: num(u.cloudfront.requests), mainLabel: t('awsInsights.requests'),
      facts: [
        { label: t('awsInsights.downloaded'), value: bytes(u.cloudfront.bytes) },
        ...(u.cloudfront.error4xxRate != null ? [{ label: '4xx', value: `${u.cloudfront.error4xxRate}%` }] : []),
        ...(u.cloudfront.error5xxRate != null ? [{ label: '5xx', value: `${u.cloudfront.error5xxRate}%`, bad: u.cloudfront.error5xxRate > 1 }] : []),
      ],
      series: u.cloudfront.series, seriesLabel: seriesLabel(t('awsInsights.requestsPerHour'), u.cloudfront.series, num),
    })
  }
  if (u.s3?.present) {
    cards.push({
      id: 's3', tab: 's3', title: 'S3',
      main: bytes(u.s3.bytes), mainLabel: t('awsInsights.storage'),
      facts: [{ label: t('awsInsights.objects'), value: num(u.s3.objects) }],
      note: t('awsInsights.s3Note', { date: u.s3.asOf ? new Date(u.s3.asOf).toLocaleDateString(settings.lang === 'es' ? 'es' : 'en-US') : '—' }),
    })
  }
  return cards
})

function glueCard(glue) {
  if (!glue) return null
  if (glue.status !== 'ok') {
    return glue.error?.kind === 'denied'
      ? { id: 'glue', tab: 'glue', title: 'Glue', main: '—', mainLabel: t('awsInsights.jobRuns'), facts: [], note: errorText(glue.error), access: glue.access ? glue : null }
      : null
  }
  if (!glue.present) return null
  const failing = glue.failedJobs.slice(0, 3).map(item => `${item.job} (${item.count})`).join(', ')
  return {
    id: 'glue', tab: 'glue', title: 'Glue', warn: glue.failed > 0,
    main: `${num(glue.runs)}${glue.truncated ? '+' : ''}`, mainLabel: t('awsInsights.jobRuns'),
    facts: [
      { label: t('awsInsights.succeeded'), value: num(glue.succeeded) },
      { label: t('awsInsights.runsFailed'), value: num(glue.failed), bad: glue.failed > 0 },
      { label: t('awsInsights.running'), value: num(glue.running) },
      { label: t('awsInsights.execTime'), value: duration(glue.executionSeconds) },
    ],
    note: failing ? t('awsInsights.failingJobs', { jobs: failing }) : t('awsInsights.glueJobs', { n: num(glue.jobs) }),
  }
}
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
.aoi-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; }
.aoi-costs .aoi-bars { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px 28px; }
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

.aoi-activity { display: flex; flex-direction: column; gap: 8px; }
.aoi-incidents { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; padding: 10px 12px; border: 1px solid color-mix(in srgb, var(--yellow) 40%, transparent); border-radius: 8px; }
.aoi-incidents ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.aoi-incidents li { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; font-size: 12px; }
.aoi-incident-text { flex: 1; min-width: 200px; }
.aoi-section-head { display: flex; align-items: baseline; gap: 10px; }
.aoi-section-head h3 { margin: 0; font-size: 12px; font-weight: 600; }
.aoi-kpis { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 10px; }
.aoi-kpi {
  display: flex; flex-direction: column; gap: 6px; text-align: left; min-width: 0;
  padding: 12px 14px; border: 1px solid var(--border); border-radius: 8px;
  background: var(--bg-panel); color: var(--text); font: inherit; cursor: default;
}
.aoi-kpi.clickable { cursor: pointer; }
.aoi-kpi.clickable:hover { border-color: var(--accent); background: var(--bg-hover); }
.aoi-kpi.warn { border-color: color-mix(in srgb, var(--yellow) 45%, var(--border)); }
.aoi-kpi-head { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
.aoi-kpi-title { font-size: 12px; font-weight: 600; color: var(--text-dim); }
.aoi-kpi-main { display: flex; align-items: baseline; gap: 8px; }
.aoi-kpi-value { font-size: 24px; font-weight: 600; line-height: 1.1; font-variant-numeric: tabular-nums; }
.aoi-kpi-value.bad { color: var(--red); }
.aoi-kpi-caption { font-size: 11px; color: var(--text-dim); }
.aoi-kpi-facts { display: flex; flex-wrap: wrap; gap: 2px 14px; font-size: 12px; font-variant-numeric: tabular-nums; }
.aoi-kpi-facts .bad { color: var(--red); }
.aoi-kpi-note { font-size: 11px; color: var(--text-dim); }
.aoi-kpi.warn .aoi-kpi-note { color: var(--yellow); }

@media (max-width: 900px) {
  .aoi-costs .aoi-bars { grid-template-columns: minmax(0, 1fr); }
}
</style>
