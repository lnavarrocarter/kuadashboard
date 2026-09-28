<template>
  <div class="msg-tab">
    <div class="msg-hint">{{ t('ses.costHint', { region: ses?.region || '—' }) }}</div>
    <div v-for="n in notices" :key="n.text" class="activity-notice">
      <span>{{ n.text }}</span>
      <button v-if="n.access" class="btn sm" @click="emit('request-access', n)">{{ t('awsAccess.requestAccess') }}</button>
    </div>

    <div v-if="awsStore.loading && !ses" class="empty-row">{{ t('common.loading') }}</div>
    <template v-else-if="ses">
      <div class="ses-health">
        <HealthBadge :health="health" />
        <HealthBadge :health="health" list />
      </div>

      <!-- Account: sending state and quota -->
      <div class="ses-cards">
        <div class="ses-card">
          <span class="ses-card-label">{{ t('ses.sending') }}</span>
          <strong v-if="account" :class="account.sendingEnabled ? 'status-ok' : 'status-err'">{{ account.sendingEnabled ? t('ses.enabled') : t('ses.paused') }}</strong>
          <strong v-else class="text-dim">—</strong>
          <span v-if="account" class="ses-card-sub">{{ account.productionAccess ? t('ses.production') : t('ses.sandbox') }}<template v-if="account.enforcementStatus"> · {{ account.enforcementStatus }}</template></span>
        </div>
        <div class="ses-card">
          <span class="ses-card-label">{{ t('ses.quota24h') }}</span>
          <strong v-if="account">{{ formatCount(account.sentLast24Hours, settings.lang) }} / {{ formatCount(account.max24HourSend, settings.lang) }}</strong>
          <strong v-else class="text-dim">—</strong>
          <div v-if="account && account.max24HourSend" class="ses-bar" role="img" :aria-label="t('ses.quotaUsed', { pct: quotaPct })">
            <span :style="{ width: `${Math.min(100, quotaPct)}%` }" :class="{ warn: quotaPct >= 80 }"></span>
          </div>
        </div>
        <div class="ses-card">
          <span class="ses-card-label">{{ t('ses.maxRate') }}</span>
          <strong v-if="account">{{ t('ses.perSecond', { n: formatCount(account.maxSendRate, settings.lang) }) }}</strong>
          <strong v-else class="text-dim">—</strong>
        </div>
        <div v-for="kpi in KPIS" :key="kpi.key" class="ses-card">
          <span class="ses-card-label">{{ t(`ses.kpi_${kpi.key}`) }} · 24h</span>
          <strong :class="kpi.bad && totals[kpi.key] ? 'status-err' : ''">{{ metricsLoading && !metrics ? '…' : formatCount(totals[kpi.key], settings.lang) }}</strong>
          <span v-if="kpi.rate && rate(kpi.rate) != null" :class="['ses-card-sub', rateClass(kpi.rate)]" :title="t(`ses.threshold_${kpi.rate}`)">{{ t('ses.reputation', { pct: rate(kpi.rate) }) }}</span>
          <span v-else-if="kpi.key === 'delivery' && deliveryRate != null" class="ses-card-sub">{{ t('ses.deliveryRate', { pct: deliveryRate }) }}</span>
        </div>
      </div>

      <div v-if="!ses.eventLogging" class="activity-notice">{{ t('ses.noEventLogging') }}</div>

      <details class="ses-charts" @toggle="chartsOpen = $event.target.open">
        <summary>{{ t('ses.charts') }}</summary>
        <AwsResourceMetrics
          v-if="chartsOpen" class="ses-panel" resource-key="ses-account" :charts="charts"
          :fetcher="hours => awsStore.fetchSesSeries(hours)" @request-access="emit('request-access', $event)"
        />
      </details>

      <details class="ses-charts" @toggle="suppressionOpen = $event.target.open">
        <summary>{{ t('ses.suppression') }}</summary>
        <SesSuppression v-if="suppressionOpen" class="ses-panel" :reasons="account?.suppressedReasons || []" @request-access="emit('request-access', $event)" />
      </details>

      <!-- Identities -->
      <h4 class="ses-h">{{ t('ses.identities', { n: ses.identities.length }) }}</h4>
      <div v-if="ses.identitiesTruncated" class="activity-notice">{{ t('ses.identitiesTruncated') }}</div>
      <div v-if="!identities.length" class="empty-row">{{ search ? t('awsMsg.noMatches') : t('ses.emptyIdentities') }}</div>
      <table v-else class="cloud-table">
        <thead><tr>
          <th :class="thClass('name')" @click="sortBy('name')">{{ t('ses.identity') }} <span class="sort-icon">{{ sortIcon('name') }}</span></th>
          <th :class="thClass('type')" @click="sortBy('type')">{{ t('ses.type') }} <span class="sort-icon">{{ sortIcon('type') }}</span></th>
          <th :class="thClass('verification')" @click="sortBy('verification')">{{ t('ses.verification') }} <span class="sort-icon">{{ sortIcon('verification') }}</span></th>
          <th :class="thClass('dkim')" @click="sortBy('dkim')">DKIM <span class="sort-icon">{{ sortIcon('dkim') }}</span></th>
          <th :title="t('ses.spfHint')">SPF / MAIL FROM</th>
          <th>{{ t('ses.configSet') }}</th>
          <th></th>
        </tr></thead>
        <tbody>
          <template v-for="id in sortRows(identities)" :key="id.name">
            <tr :class="{ 'msg-selected': selected === id.name }">
              <td>
                <span class="msg-name">{{ id.name }}</span>
                <span v-if="!id.sendingEnabled" class="msg-chip err">{{ t('ses.sendingOff') }}</span>
              </td>
              <td class="text-dim">{{ t(`ses.type_${id.type}`) }}</td>
              <td><span :class="statusClass(id.verification)">{{ statusText(id.verification) }}</span></td>
              <td><span v-if="id.type === 'domain' || id.dkim !== 'DISABLED'" :class="statusClass(id.dkim)">{{ statusText(id.dkim) }}</span><span v-else class="text-dim">—</span></td>
              <td>
                <span v-if="id.mailFrom" :class="statusClass(id.mailFrom.status)" :title="id.mailFrom.domain">{{ statusText(id.mailFrom.status) }}</span>
                <span v-else class="text-dim" :title="t('ses.spfDefaultHint')">{{ t('ses.spfDefault') }}</span>
              </td>
              <td :class="id.configurationSet ? '' : 'text-dim'">{{ id.configurationSet || '—' }}</td>
              <td><button class="btn sm" :aria-expanded="selected === id.name" @click="toggle(id.name)">{{ selected === id.name ? t('awsMsg.hide') : t('awsMsg.details') }}</button></td>
            </tr>
            <tr v-if="selected === id.name" class="msg-detail-row">
              <td colspan="7">
                <div class="msg-detail">
                  <dl class="msg-facts">
                    <div><dt>{{ t('ses.verification') }}</dt><dd>{{ statusText(id.verification) }}</dd></div>
                    <div><dt>DKIM</dt><dd>{{ statusText(id.dkim) }}</dd></div>
                    <div><dt>MAIL FROM</dt><dd>{{ id.mailFrom ? `${id.mailFrom.domain} · ${statusText(id.mailFrom.status)}` : t('ses.spfDefaultHint') }}</dd></div>
                    <div>
                      <dt>{{ t('awsMsg.logs') }}</dt>
                      <dd>
                        <template v-if="destinationsFor(id).length">
                          <div v-for="d in destinationsFor(id)" :key="d.name">
                            <span :class="d.enabled ? 'status-ok' : 'text-dim'">{{ d.type }}</span> · {{ d.name }}
                            <span class="text-dim">({{ d.events.join(', ') }})</span>
                          </div>
                        </template>
                        <span v-else class="text-dim">{{ id.configurationSet ? t('ses.setWithoutDestinations') : t('ses.noConfigSetHint') }}</span>
                      </dd>
                    </div>
                  </dl>
                  <div v-if="!id.detailLoaded" class="text-dim">{{ t('ses.detailNotLoaded') }}</div>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>

      <!-- Configuration sets -->
      <h4 class="ses-h">{{ t('ses.configSets', { n: ses.configurationSets.length }) }}</h4>
      <div v-if="!ses.configurationSets.length" class="empty-row">{{ t('ses.emptySets') }}</div>
      <table v-else class="cloud-table">
        <thead><tr><th>{{ t('awsMsg.name') }}</th><th>{{ t('ses.destinations') }}</th><th></th></tr></thead>
        <tbody>
          <template v-for="set in ses.configurationSets" :key="set.name">
          <tr :class="{ 'msg-selected': selectedSet === set.name }">
            <td class="msg-name">{{ set.name }}</td>
            <td>
              <span v-if="set.destinations == null" class="text-dim">{{ t('ses.destinationsUnknown') }}</span>
              <span v-else-if="!set.destinations.length" class="status-warn">{{ t('ses.noDestinations') }}</span>
              <span v-for="d in set.destinations || []" :key="d.name" :class="['msg-chip', d.enabled ? 'ok' : '']" :title="`${d.name}: ${d.events.join(', ')}${d.target ? ` → ${d.target}` : ''}`">
                {{ d.type }}{{ d.enabled ? '' : ` (${t('ses.disabled')})` }}
              </span>
            </td>
            <td>
              <button v-if="hasCloudWatch(set)" class="btn sm" :aria-expanded="selectedSet === set.name" @click="selectedSet = selectedSet === set.name ? null : set.name">
                {{ selectedSet === set.name ? t('awsMsg.hide') : t('ses.setMetrics') }}
              </button>
            </td>
          </tr>
          <tr v-if="selectedSet === set.name" class="msg-detail-row">
            <td colspan="3"><SesConfigSetMetrics :name="set.name" @request-access="emit('request-access', $event)" /></td>
          </tr>
          </template>
        </tbody>
      </table>
    </template>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import AwsResourceMetrics from './AwsResourceMetrics.vue'
import HealthBadge from './HealthBadge.vue'
import SesSuppression from './SesSuppression.vue'
import SesConfigSetMetrics from './SesConfigSetMetrics.vue'
import { useAwsStore } from '../../../stores/useAwsStore'
import { useI18n } from '../../../composables/useI18n'
import { useSortable } from '../../../composables/useSortable'
import { settings } from '../../../composables/useSettings'
import { filterRows, formatCount } from './messagingFormat'

const props = defineProps({ search: { type: String, default: '' }, metricsLoading: { type: Boolean, default: false } })
const emit = defineEmits(['request-access'])
const awsStore = useAwsStore()
const { t } = useI18n()
const { sortBy, sortRows, sortIcon, thClass } = useSortable()
const selected = ref(null)
const selectedSet = ref(null)
const chartsOpen = ref(false)
const suppressionOpen = ref(false)

const KPIS = [
  { key: 'send' }, { key: 'delivery' },
  { key: 'bounce', bad: true, rate: 'bounceRate' }, { key: 'complaint', bad: true, rate: 'complaintRate' },
  { key: 'reject', bad: true }, { key: 'renderingFailure', bad: true },
]
// AWS review thresholds (lib/awsMessagingCatalog.js): warning / at risk.
const THRESHOLDS = { bounceRate: [0.05, 0.10], complaintRate: [0.001, 0.005] }

const ses = computed(() => awsStore.sesData)
const account = computed(() => ses.value?.account || null)
const metrics = computed(() => (awsStore.sesMetrics?.failed ? null : awsStore.sesMetrics))
const totals = computed(() => metrics.value?.totals || {})
const quotaPct = computed(() => {
  const a = account.value
  return a?.max24HourSend ? Math.round((a.sentLast24Hours / a.max24HourSend) * 1000) / 10 : 0
})
const identities = computed(() => filterRows(ses.value?.identities || [], props.search))
const charts = computed(() => [
  { key: 'send', label: t('ses.kpi_send'), color: '#58a6ff', stat: 'sum' },
  { key: 'delivery', label: t('ses.kpi_delivery'), color: '#3fb950', stat: 'sum' },
  { key: 'bounce', label: t('ses.kpi_bounce'), color: '#d29922', stat: 'sum' },
  { key: 'complaint', label: t('ses.kpi_complaint'), color: '#f85149', stat: 'sum' },
  { key: 'reject', label: t('ses.kpi_reject'), color: '#db61a2', stat: 'sum' },
  { key: 'bounceRate', label: t('ses.bounceRateChart'), color: '#d29922', stat: 'gauge', unit: 'ratio' },
  { key: 'complaintRate', label: t('ses.complaintRateChart'), color: '#f85149', stat: 'gauge', unit: 'ratio' },
])
// Health with the latest rates comes with the metrics; before that, the account-only one.
const health = computed(() => metrics.value?.health || ses.value?.health || null)
const deliveryRate = computed(() => {
  const sent = totals.value.send
  return sent ? Math.round((totals.value.delivery / sent) * 1000) / 10 : null
})
function rateClass(key) {
  const value = metrics.value?.rates?.[key]
  const [warn, critical] = THRESHOLDS[key]
  if (value == null) return ''
  return value >= critical ? 'status-err' : value >= warn ? 'status-warn' : ''
}
function hasCloudWatch(set) {
  return (set.destinations || []).some(d => d.type === 'cloudwatch' && d.enabled)
}

const notices = computed(() => {
  const list = []
  if (ses.value?.accountError) list.push({ text: t('ses.accountUnavailable', { reason: ses.value.accountError.error?.message || '' }), access: ses.value.accountError.access })
  const m = awsStore.sesMetrics
  if (m?.failed) list.push({ text: t('awsMsg.metricsUnavailable', { reason: m.failed }), access: m.access })
  return list
})

// Latest hourly reputation rate (SES publishes it as a fraction).
function rate(key) {
  const points = metrics.value?.series?.[key] || []
  const last = points.at(-1)
  return last ? (last.v * 100).toFixed(2) : null
}
function statusClass(status) {
  if (status === 'SUCCESS') return 'status-ok'
  if (status === 'PENDING' || status === 'NOT_STARTED' || status === 'TEMPORARY_FAILURE') return 'status-warn'
  if (status === 'FAILED') return 'status-err'
  return 'text-dim'
}
function statusText(status) {
  return status ? t(`ses.status_${status}`) : '—'
}
function destinationsFor(identity) {
  const set = (ses.value?.configurationSets || []).find(s => s.name === identity.configurationSet)
  return set?.destinations || []
}
function toggle(name) {
  selected.value = selected.value === name ? null : name
}
</script>

<style scoped>
.ses-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
.ses-card { display: flex; flex-direction: column; gap: 3px; padding: 8px 10px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-row); min-width: 0; }
.ses-card-label { font-size: 11px; color: var(--text-dim); }
.ses-card strong { font-size: 16px; font-variant-numeric: tabular-nums; }
.ses-card-sub { font-size: 11px; color: var(--text-dim); }
.ses-bar { height: 6px; border-radius: 3px; background: var(--border); overflow: hidden; }
.ses-bar span { display: block; height: 100%; background: var(--accent); }
.ses-bar span.warn { background: var(--yellow); }
.ses-h { margin: 8px 0 0; font-size: 12px; color: var(--text); }
.ses-charts summary { cursor: pointer; font-size: 12px; color: var(--text-dim); }
.ses-health { display: flex; align-items: flex-start; gap: 12px; padding: 8px 10px; border: 1px solid var(--border); border-radius: 6px; }
.ses-panel { margin-top: 8px; }
</style>
