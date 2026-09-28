<template>
  <div class="msg-tab">
    <div class="msg-hint">{{ t('sns.costHint') }}</div>
    <div v-for="n in notices" :key="n.text" class="activity-notice">
      <span>{{ n.text }}</span>
      <button v-if="n.access" class="btn sm" @click="emit('request-access', n)">{{ t('awsAccess.requestAccess') }}</button>
    </div>
    <div v-if="awsStore.snsTruncated" class="activity-notice">{{ t('awsMsg.truncated') }}</div>

    <div v-if="awsStore.loading && !awsStore.snsTopics.length" class="empty-row">{{ t('common.loading') }}</div>
    <div v-else-if="!rows.length" class="empty-row">{{ search ? t('awsMsg.noMatches') : t('sns.empty') }}</div>
    <table v-else class="cloud-table">
      <thead><tr>
        <th :class="thClass('name')" @click="sortBy('name')">{{ t('awsMsg.name') }} <span class="sort-icon">{{ sortIcon('name') }}</span></th>
        <th :class="thClass('subscriptionsConfirmed')" @click="sortBy('subscriptionsConfirmed')">{{ t('sns.subscriptions') }} <span class="sort-icon">{{ sortIcon('subscriptionsConfirmed') }}</span></th>
        <th>{{ t('sns.protocols') }}</th>
        <th :class="thClass('published24h')" @click="sortBy('published24h')" :title="t('sns.activityHint')">{{ t('sns.published24h') }} <span class="sort-icon">{{ sortIcon('published24h') }}</span></th>
        <th :class="thClass('delivered24h')" @click="sortBy('delivered24h')">{{ t('sns.delivered24h') }} <span class="sort-icon">{{ sortIcon('delivered24h') }}</span></th>
        <th :class="thClass('failed24h')" @click="sortBy('failed24h')">{{ t('sns.failed24h') }} <span class="sort-icon">{{ sortIcon('failed24h') }}</span></th>
        <th :class="thClass('logRank')" @click="sortBy('logRank')" :title="t('sns.loggingHint')">{{ t('sns.logging') }} <span class="sort-icon">{{ sortIcon('logRank') }}</span></th>
        <th></th>
      </tr></thead>
      <tbody>
        <template v-for="topic in sortRows(rows)" :key="topic.arn">
          <tr :class="{ 'msg-selected': selected === topic.arn }">
            <td>
              <span class="msg-name">{{ topic.name }}</span>
              <span v-if="topic.fifo" class="msg-chip">FIFO</span>
              <span v-if="topic.encrypted" class="msg-chip" :title="t('sns.encrypted')">KMS</span>
            </td>
            <td class="activity-cell">
              {{ formatCount(topic.subscriptionsConfirmed, settings.lang) }}
              <span v-if="topic.subscriptionsPending" class="status-warn" :title="t('sns.pendingHint')"> · {{ t('sns.pending', { n: topic.subscriptionsPending }) }}</span>
            </td>
            <td>
              <span v-for="p in topic.protocols" :key="p" class="msg-chip">{{ p }}</span>
              <span v-if="!topic.protocols.length" class="text-dim">—</span>
            </td>
            <td class="activity-cell"><span :class="topic.published24h ? '' : 'text-dim'">{{ activityCell(topic.published24h) }}</span></td>
            <td class="activity-cell"><span :class="topic.delivered24h ? '' : 'text-dim'">{{ activityCell(topic.delivered24h) }}</span></td>
            <td class="activity-cell"><span :class="topic.failed24h ? 'status-err' : 'text-dim'">{{ activityCell(topic.failed24h) }}</span></td>
            <td>
              <span :class="['log-badge', LOG_BADGE[topic.logStatus]]" :title="loggingTitle(topic)">{{ t(`sns.log_${topic.logStatus}`) }}</span>
            </td>
            <td><button class="btn sm" :aria-expanded="selected === topic.arn" @click="toggle(topic.arn)">{{ selected === topic.arn ? t('awsMsg.hide') : t('awsMsg.details') }}</button></td>
          </tr>
          <tr v-if="selected === topic.arn" class="msg-detail-row">
            <td colspan="8">
              <div class="msg-detail">
                <dl class="msg-facts">
                  <div><dt>ARN</dt><dd class="mono-xs">{{ topic.arn }}</dd></div>
                  <div v-if="topic.displayName"><dt>{{ t('sns.displayName') }}</dt><dd>{{ topic.displayName }}</dd></div>
                  <div>
                    <dt>{{ t('awsMsg.logs') }}</dt>
                    <dd>
                      <template v-if="topic.deliveryLogging?.enabled">
                        <div v-for="p in topic.deliveryLogging.protocols" :key="p.protocol">
                          {{ p.protocol }}: {{ [p.success ? t('sns.success') : null, p.failure ? t('sns.failure') : null].filter(Boolean).join(' + ') }}
                          <span v-if="p.sampleRate != null" class="text-dim">· {{ t('sns.sampleRate', { n: p.sampleRate }) }}</span>
                        </div>
                        <div v-for="g in topic.logGroups" :key="g" class="mono-xs text-dim">{{ g }}</div>
                      </template>
                      <span v-else class="text-dim">{{ t('sns.loggingOffHint') }}</span>
                    </dd>
                  </div>
                </dl>
                <table class="msg-subtable">
                  <thead><tr><th>{{ t('sns.protocol') }}</th><th>{{ t('sns.endpoint') }}</th><th>{{ t('sns.status') }}</th></tr></thead>
                  <tbody>
                    <tr v-for="sub in topic.subscriptions" :key="sub.arn + sub.endpoint">
                      <td>{{ sub.protocol }}</td>
                      <td class="mono-xs">{{ sub.endpoint }}</td>
                      <td><span :class="sub.pending ? 'status-warn' : 'status-ok'">{{ sub.pending ? t('sns.pendingConfirmation') : t('sns.confirmed') }}</span></td>
                    </tr>
                    <tr v-if="!topic.subscriptions.length"><td colspan="3" class="text-dim">{{ t('sns.noSubscriptions') }}</td></tr>
                  </tbody>
                </table>
                <AwsResourceMetrics
                  :resource-key="topic.name" :charts="charts" :empty-text="t('sns.noMetrics')"
                  :fetcher="() => awsStore.fetchSnsTopicMetrics(topic.name)"
                  @request-access="emit('request-access', $event)"
                />
              </div>
            </td>
          </tr>
        </template>
      </tbody>
    </table>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useAwsStore } from '../../../stores/useAwsStore'
import { useI18n } from '../../../composables/useI18n'
import { useSortable } from '../../../composables/useSortable'
import { settings } from '../../../composables/useSettings'
import AwsResourceMetrics from './AwsResourceMetrics.vue'
import { filterRows, formatCount } from './messagingFormat'

const props = defineProps({ search: { type: String, default: '' }, activityLoading: { type: Boolean, default: false } })
const emit = defineEmits(['request-access'])
const awsStore = useAwsStore()
const { t } = useI18n()
const { sortBy, sortRows, sortIcon, thClass } = useSortable()
const selected = ref(null)

const LOG_BADGE = { ok: 'ok', empty: 'empty', missing: 'missing', off: 'missing', unknown: 'empty', loading: 'empty' }
const LOG_RANK = { off: 0, missing: 1, unknown: 2, loading: 2, empty: 3, ok: 4 }

const charts = computed(() => [
  { key: 'published', label: t('sns.published'), color: '#58a6ff', stat: 'sum' },
  { key: 'delivered', label: t('sns.delivered'), color: '#3fb950', stat: 'sum' },
  { key: 'failed', label: t('sns.failed'), color: '#f85149', stat: 'sum' },
])

const rows = computed(() => {
  const activity = awsStore.snsActivity?.topics || {}
  return filterRows(awsStore.snsTopics, props.search).map(topic => {
    const a = activity[topic.name]
    // Until activity arrives, topics without delivery logging are already known to be "off".
    const logStatus = a?.logStatus || (topic.deliveryLogging?.enabled ? (props.activityLoading ? 'loading' : 'unknown') : 'off')
    return {
      ...topic,
      published24h: a?.messages?.published ?? null,
      delivered24h: a?.messages?.delivered ?? null,
      failed24h: a?.messages?.failed ?? null,
      logStatus,
      logRank: LOG_RANK[logStatus],
      logGroups: a?.logGroups || [],
    }
  })
})

const notices = computed(() => {
  const a = awsStore.snsActivity
  if (!a) return []
  if (a.failed) return [{ text: t('awsActivity.failed', { error: a.failed }), access: a.access }]
  return [
    a.metricsError && { text: t('awsMsg.metricsUnavailable', { reason: a.metricsError.error?.message || '' }), access: a.metricsError.access },
    a.logsError && { text: t('awsMsg.logsUnavailable', { reason: a.logsError.error?.message || '' }), access: a.logsError.access },
  ].filter(Boolean)
})

function activityCell(value) {
  if (value == null) return props.activityLoading ? '…' : '—'
  return formatCount(value, settings.lang)
}
function loggingTitle(topic) {
  const protocols = (topic.deliveryLogging?.protocols || []).map(p => p.protocol).join(', ')
  return `${t(`sns.logHint_${topic.logStatus}`)}${protocols ? ` · ${protocols}` : ''}`
}
function toggle(arn) {
  selected.value = selected.value === arn ? null : arn
}
</script>
