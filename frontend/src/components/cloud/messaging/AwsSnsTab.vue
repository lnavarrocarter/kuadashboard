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
        <th :class="thClass('name')" :aria-sort="ariaSort('name')"><button type="button" class="th-sort" @click="sortBy('name')">{{ t('awsMsg.name') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('name') }}</span></button></th>
        <th :class="thClass('healthRank')" :aria-sort="ariaSort('healthRank')"><button type="button" class="th-sort" @click="sortBy('healthRank')">{{ t('health.title') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('healthRank') }}</span></button></th>
        <th :class="thClass('subscriptionsConfirmed')" :aria-sort="ariaSort('subscriptionsConfirmed')"><button type="button" class="th-sort" @click="sortBy('subscriptionsConfirmed')">{{ t('sns.subscriptions') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('subscriptionsConfirmed') }}</span></button></th>
        <th>{{ t('sns.protocols') }}</th>
        <th :class="thClass('published24h')" :title="t('sns.activityHint')" :aria-sort="ariaSort('published24h')"><button type="button" class="th-sort" @click="sortBy('published24h')">{{ t('sns.published24h') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('published24h') }}</span></button></th>
        <th :class="thClass('delivered24h')" :aria-sort="ariaSort('delivered24h')"><button type="button" class="th-sort" @click="sortBy('delivered24h')">{{ t('sns.delivered24h') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('delivered24h') }}</span></button></th>
        <th :class="thClass('failed24h')" :aria-sort="ariaSort('failed24h')"><button type="button" class="th-sort" @click="sortBy('failed24h')">{{ t('sns.failed24h') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('failed24h') }}</span></button></th>
        <th :class="thClass('successRate')" :title="t('sns.successRateHint')" :aria-sort="ariaSort('successRate')"><button type="button" class="th-sort" @click="sortBy('successRate')">{{ t('sns.successRate') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('successRate') }}</span></button></th>
        <th :class="thClass('filtered24h')" :title="t('sns.filteredHint')" :aria-sort="ariaSort('filtered24h')"><button type="button" class="th-sort" @click="sortBy('filtered24h')">{{ t('sns.filtered24h') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('filtered24h') }}</span></button></th>
        <th :class="thClass('logRank')" :title="t('sns.loggingHint')" :aria-sort="ariaSort('logRank')"><button type="button" class="th-sort" @click="sortBy('logRank')">{{ t('sns.logging') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('logRank') }}</span></button></th>
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
            <td><HealthBadge :health="topic.health" :loading="activityLoading" /></td>
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
            <td class="activity-cell"><span :class="topic.successRate == null ? 'text-dim' : topic.successRate < 95 ? 'status-err' : topic.successRate < 100 ? 'status-warn' : ''">{{ topic.successRate == null ? '—' : `${topic.successRate}%` }}</span></td>
            <td class="activity-cell"><span :class="topic.filtered24h ? '' : 'text-dim'">{{ activityCell(topic.filtered24h) }}</span></td>
            <td>
              <span :class="['log-badge', LOG_BADGE[topic.logStatus]]" :title="loggingTitle(topic)">{{ t(`sns.log_${topic.logStatus}`) }}</span>
            </td>
            <td><button class="btn sm" :aria-expanded="selected === topic.arn" @click="toggle(topic.arn)">{{ selected === topic.arn ? t('awsMsg.hide') : t('awsMsg.details') }}</button></td>
          </tr>
          <tr v-if="selected === topic.arn" class="msg-detail-row">
            <td colspan="11">
              <SnsTopicDetail :topic="topic" :health="topic.health" @request-access="emit('request-access', $event)" />
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
import HealthBadge from './HealthBadge.vue'
import SnsTopicDetail from './SnsTopicDetail.vue'
import { filterRows, formatCount, HEALTH_RANK } from './messagingFormat'

const props = defineProps({ search: { type: String, default: '' }, activityLoading: { type: Boolean, default: false } })
const emit = defineEmits(['request-access'])
const awsStore = useAwsStore()
const { t } = useI18n()
const { sortBy, sortRows, sortIcon, thClass, ariaSort } = useSortable()
const selected = ref(null)

const LOG_BADGE = { ok: 'ok', empty: 'empty', missing: 'missing', off: 'missing', unknown: 'empty', loading: 'empty' }
const LOG_RANK = { off: 0, missing: 1, unknown: 2, loading: 2, empty: 3, ok: 4 }


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
      filtered24h: a?.messages?.filteredOut ?? null,
      successRate: a?.successRate ?? null,
      health: a?.health || null,
      healthRank: HEALTH_RANK[a?.health?.status] ?? -1,
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
