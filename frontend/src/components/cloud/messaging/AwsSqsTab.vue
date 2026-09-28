<template>
  <div class="msg-tab">
    <div class="msg-hint">{{ t('sqs.costHint') }}</div>
    <div v-if="notice" class="activity-notice">
      <span>{{ notice.text }}</span>
      <button v-if="notice.access" class="btn sm" @click="emit('request-access', notice)">{{ t('awsAccess.requestAccess') }}</button>
    </div>
    <div v-if="awsStore.sqsTruncated" class="activity-notice">{{ t('awsMsg.truncated') }}</div>

    <div v-if="awsStore.loading && !awsStore.sqsQueues.length" class="empty-row">{{ t('common.loading') }}</div>
    <div v-else-if="!rows.length" class="empty-row">{{ search ? t('awsMsg.noMatches') : t('sqs.empty') }}</div>
    <table v-else class="cloud-table">
      <thead><tr>
        <th :class="thClass('name')" @click="sortBy('name')">{{ t('awsMsg.name') }} <span class="sort-icon">{{ sortIcon('name') }}</span></th>
        <th :class="thClass('healthRank')" @click="sortBy('healthRank')">{{ t('health.title') }} <span class="sort-icon">{{ sortIcon('healthRank') }}</span></th>
        <th :class="thClass('visible')" @click="sortBy('visible')" :title="t('sqs.visibleHint')">{{ t('sqs.visible') }} <span class="sort-icon">{{ sortIcon('visible') }}</span></th>
        <th :class="thClass('inFlight')" @click="sortBy('inFlight')" :title="t('sqs.inFlightHint')">{{ t('sqs.inFlight') }} <span class="sort-icon">{{ sortIcon('inFlight') }}</span></th>
        <th :class="thClass('sent24h')" @click="sortBy('sent24h')" :title="t('sqs.activityHint')">{{ t('sqs.sent24h') }} <span class="sort-icon">{{ sortIcon('sent24h') }}</span></th>
        <th :class="thClass('received24h')" @click="sortBy('received24h')">{{ t('sqs.received24h') }} <span class="sort-icon">{{ sortIcon('received24h') }}</span></th>
        <th :class="thClass('deleted24h')" @click="sortBy('deleted24h')">{{ t('sqs.deleted24h') }} <span class="sort-icon">{{ sortIcon('deleted24h') }}</span></th>
        <th>{{ t('sqs.dlq') }}</th>
        <th :class="thClass('encryption')" @click="sortBy('encryption')">{{ t('sqs.encryption') }} <span class="sort-icon">{{ sortIcon('encryption') }}</span></th>
        <th :class="thClass('retentionSeconds')" @click="sortBy('retentionSeconds')">{{ t('sqs.retention') }} <span class="sort-icon">{{ sortIcon('retentionSeconds') }}</span></th>
        <th></th>
      </tr></thead>
      <tbody>
        <template v-for="q in sortRows(rows)" :key="q.url">
          <tr :class="{ 'msg-selected': selected === q.name }">
            <td>
              <span class="msg-name">{{ q.name }}</span>
              <span v-if="q.fifo" class="msg-chip">FIFO</span>
              <span v-if="q.dlqFor.length" class="msg-chip warn" :title="t('sqs.isDlqFor', { list: q.dlqFor.join(', ') })">DLQ</span>
            </td>
            <td><HealthBadge :health="q.health" :loading="activityLoading" /></td>
            <td class="activity-cell"><span :class="q.dlqFor.length && q.visible ? 'status-err' : ''">{{ formatCount(q.visible, settings.lang) }}</span></td>
            <td class="activity-cell">{{ formatCount(q.inFlight, settings.lang) }}</td>
            <td class="activity-cell"><span :class="q.sent24h ? '' : 'text-dim'">{{ activityCell(q.sent24h) }}</span></td>
            <td class="activity-cell"><span :class="q.received24h ? '' : 'text-dim'">{{ activityCell(q.received24h) }}</span></td>
            <td class="activity-cell"><span :class="q.deleted24h ? '' : 'text-dim'">{{ activityCell(q.deleted24h) }}</span></td>
            <td>
              <span v-if="q.dlqArn" :title="q.dlqArn">{{ arnName(q.dlqArn) }} <span class="text-dim">· {{ t('sqs.maxReceive', { n: q.maxReceiveCount ?? '—' }) }}</span></span>
              <span v-else-if="!q.dlqFor.length" class="text-dim" :title="t('sqs.noDlqHint')">{{ t('sqs.noDlq') }}</span>
              <span v-else class="text-dim">—</span>
            </td>
            <td><span :class="q.encryption === 'none' ? 'status-warn' : 'text-dim'">{{ t(`sqs.enc_${q.encryption}`) }}</span></td>
            <td class="text-dim">{{ formatDuration(q.retentionSeconds) }}</td>
            <td><button class="btn sm" :aria-expanded="selected === q.name" @click="toggle(q.name)">{{ selected === q.name ? t('awsMsg.hide') : t('awsMsg.details') }}</button></td>
          </tr>
          <tr v-if="selected === q.name" class="msg-detail-row">
            <td colspan="11">
              <SqsQueueDetail :queue="q" :health="q.health" @request-access="emit('request-access', $event)" />
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
import SqsQueueDetail from './SqsQueueDetail.vue'
import { arnName, filterRows, formatCount, formatDuration, HEALTH_RANK } from './messagingFormat'

const props = defineProps({ search: { type: String, default: '' }, activityLoading: { type: Boolean, default: false } })
const emit = defineEmits(['request-access'])
const awsStore = useAwsStore()
const { t } = useI18n()
const { sortBy, sortRows, sortIcon, thClass } = useSortable()
const selected = ref(null)


const rows = computed(() => {
  const activity = awsStore.sqsActivity?.queues || {}
  return filterRows(awsStore.sqsQueues, props.search).map(q => {
    const a = activity[q.name]
    return { ...q, sent24h: a?.sent ?? null, received24h: a?.received ?? null, deleted24h: a?.deleted ?? null, health: a?.health || null, healthRank: HEALTH_RANK[a?.health?.status] ?? -1 }
  })
})

const notice = computed(() => {
  const a = awsStore.sqsActivity
  if (!a) return null
  if (a.failed) return { text: t('awsActivity.failed', { error: a.failed }), access: a.access }
  if (a.metricsError) return { text: t('awsMsg.metricsUnavailable', { reason: a.metricsError.error?.message || '' }), access: a.metricsError.access }
  return null
})

function activityCell(value) {
  if (value == null) return props.activityLoading ? '…' : '—'
  return formatCount(value, settings.lang)
}
function toggle(name) {
  selected.value = selected.value === name ? null : name
}
</script>

<style>
/* Shared by the SQS, SNS and SES tabs (not scoped, so the three reuse it). */
.msg-tab { display: flex; flex-direction: column; gap: 8px; }
.msg-hint { font-size: 11px; color: var(--text-dim); }
.msg-name { font-weight: 600; }
.msg-chip { display: inline-block; margin-left: 6px; padding: 0 6px; border-radius: 8px; font-size: 10px; font-weight: 700; color: var(--text-dim); border: 1px solid var(--border); vertical-align: middle; }
.msg-chip.warn { color: var(--yellow); border-color: color-mix(in srgb, var(--yellow) 50%, var(--border)); }
.msg-chip.ok { color: var(--green); border-color: color-mix(in srgb, var(--green) 50%, var(--border)); }
.msg-chip.err { color: var(--red); border-color: color-mix(in srgb, var(--red) 50%, var(--border)); }
.msg-selected td { background: var(--bg-sel); }
.cloud-table tr.msg-detail-row:hover td, .cloud-table tr.msg-detail-row td { background: var(--bg-row); }
.msg-detail { display: flex; flex-direction: column; gap: 12px; padding: 6px 2px; white-space: normal; }
.msg-facts { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 8px 16px; margin: 0; }
.msg-facts div { min-width: 0; }
.msg-facts dt { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .4px; color: var(--text-dim); }
.msg-facts dd { margin: 2px 0 0; font-size: 12px; color: var(--text); overflow-wrap: anywhere; }
.msg-subtable { width: 100%; border-collapse: collapse; font-size: 12px; }
.msg-subtable th { text-align: left; font-size: 11px; color: var(--text-dim); font-weight: 600; padding: 4px 6px; border-bottom: 1px solid var(--border); }
.msg-subtable td { padding: 4px 6px; border-bottom: 1px solid var(--border); overflow-wrap: anywhere; }
.msg-section { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.msg-section h5 { margin: 0; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .4px; color: var(--text-dim); }
.msg-columns { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px; }
.msg-list { margin: 0; padding-left: 16px; font-size: 12px; display: flex; flex-direction: column; gap: 3px; }
.msg-list li { overflow-wrap: anywhere; }
.msg-section-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 12px; }
.msg-code { font-family: monospace; font-size: 11px; padding: 0 4px; border-radius: 3px; background: var(--bg-hover); cursor: help; }
.msg-group { margin-right: 14px; }
</style>
