<template>
  <div class="msg-detail">
    <div class="msg-section">
      <h5>{{ t('health.title') }}</h5>
      <HealthBadge :health="health" list />
    </div>

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
          </template>
          <span v-else class="text-dim">{{ t('sns.log_off') }}</span>
        </dd>
      </div>
      <div v-if="details?.deliveryPolicy?.http?.defaultHealthyRetryPolicy">
        <dt>{{ t('sns.retryPolicy') }}</dt>
        <dd>{{ t('sns.retries', { n: details.deliveryPolicy.http.defaultHealthyRetryPolicy.numRetries ?? '—' }) }}</dd>
      </div>
      <div v-if="topic.fifo && details"><dt>FIFO</dt><dd>{{ details.contentBasedDeduplication ? t('sqs.contentDedup') : t('sqs.explicitDedup') }}<template v-if="details.archivePolicy"> · {{ t('sns.archive', { days: details.archivePolicy.MessageRetentionPeriod ?? '—' }) }}</template></dd></div>
    </dl>

    <div v-if="detailsError" class="activity-notice">
      <span>{{ t('awsMsg.detailsUnavailable', { reason: detailsError.text }) }}</span>
      <button v-if="detailsError.access" class="btn sm" @click="emit('request-access', detailsError)">{{ t('awsAccess.requestAccess') }}</button>
    </div>

    <div class="msg-section">
      <h5>{{ t('sns.subscriptions') }}</h5>
      <table class="msg-subtable">
        <thead><tr><th>{{ t('sns.protocol') }}</th><th>{{ t('sns.endpoint') }}</th><th>{{ t('sns.status') }}</th><th>{{ t('sns.filter') }}</th><th>{{ t('sns.raw') }}</th><th>DLQ</th></tr></thead>
        <tbody>
          <tr v-for="sub in subscriptions" :key="sub.arn + sub.endpoint">
            <td>{{ sub.protocol }}</td>
            <td class="mono-xs">{{ sub.endpoint }}</td>
            <td><span :class="sub.pending ? 'status-warn' : 'status-ok'">{{ sub.pending ? t('sns.pendingConfirmation') : t('sns.confirmed') }}</span></td>
            <td>
              <code v-if="sub.filterPolicy" class="msg-code" :title="JSON.stringify(sub.filterPolicy, null, 2)">{{ filterSummary(sub) }}</code>
              <span v-else class="text-dim">{{ sub.detailLoaded || !details ? '—' : '' }}</span>
            </td>
            <td>{{ sub.rawDelivery == null ? '—' : sub.rawDelivery ? t('common.yes') : t('common.no') }}</td>
            <td>
              <span v-if="sub.dlqArn" :title="sub.dlqArn">{{ arnName(sub.dlqArn) }}</span>
              <span v-else-if="sub.detailLoaded && !sub.pending" class="status-warn" :title="t('sns.noDlqHint')">{{ t('sqs.noDlq') }}</span>
              <span v-else class="text-dim">—</span>
            </td>
          </tr>
          <tr v-if="!subscriptions.length"><td colspan="6" class="text-dim">{{ t('sns.noSubscriptions') }}</td></tr>
        </tbody>
      </table>
      <div v-if="details?.subscriptionsTruncated" class="text-dim msg-hint">{{ t('sns.subscriptionsTruncated') }}</div>
    </div>

    <!-- Delivery status logs -->
    <div class="msg-section">
      <div class="msg-section-head">
        <h5>{{ t('sns.deliveryLogs') }}</h5>
        <template v-if="topic.deliveryLogging?.enabled">
          <div class="btn-toggle-group">
            <button :class="['btn', 'sm', { active: logStatus === 'all' }]" @click="setLogStatus('all')">{{ t('sns.logsAll') }}</button>
            <button :class="['btn', 'sm', { active: logStatus === 'failure' }]" @click="setLogStatus('failure')">{{ t('sns.logsFailures') }}</button>
          </div>
          <button class="btn sm" :disabled="logsLoading" @click="loadLogs(!!logs)">{{ logs ? t('action.refresh') : t('sns.loadLogs') }}</button>
          <span class="text-dim msg-hint">{{ t('sns.logsCost') }}</span>
        </template>
      </div>
      <div v-if="!topic.deliveryLogging?.enabled" class="text-dim">{{ t('sns.loggingOffHint') }}</div>
      <template v-else>
        <div v-if="logsError" class="activity-notice">
          <span>{{ t('awsMsg.logsUnavailable', { reason: logsError.text }) }}</span>
          <button v-if="logsError.access" class="btn sm" @click="emit('request-access', logsError)">{{ t('awsAccess.requestAccess') }}</button>
        </div>
        <div v-else-if="logsLoading && !logs" class="text-dim">{{ t('common.loading') }}</div>
        <template v-else-if="logs">
          <div class="text-dim msg-hint">
            <span v-for="g in logs.groups" :key="g.name" class="msg-group">
              <span class="mono-xs">{{ g.name }}</span>
              <span :class="g.exists === false ? 'status-warn' : ''"> · {{ g.exists === false ? t('sns.groupMissing') : t('sns.groupEvents', { n: g.count }) }}</span>
            </span>
          </div>
          <table v-if="logs.events.length" class="msg-subtable">
            <thead><tr><th>{{ t('sns.when') }}</th><th>{{ t('sns.status') }}</th><th>{{ t('sns.destination') }}</th><th>{{ t('sns.response') }}</th><th>{{ t('sns.attempts') }}</th><th>{{ t('sns.dwell') }}</th></tr></thead>
            <tbody>
              <tr v-for="(e, i) in logs.events" :key="i">
                <td style="white-space:nowrap">{{ formatDate(e.timestamp, settings.lang) }}</td>
                <td><span :class="e.status === 'SUCCESS' ? 'status-ok' : 'status-err'">{{ e.status }}</span><span v-if="e.statusCode != null" class="text-dim"> · {{ e.statusCode }}</span></td>
                <td class="mono-xs">{{ e.destination || '—' }}</td>
                <td class="mono-xs">{{ e.providerResponse || e.raw || '—' }}</td>
                <td>{{ e.attempts ?? '—' }}</td>
                <td>{{ e.dwellTimeMs != null ? `${e.dwellTimeMs} ms` : '—' }}</td>
              </tr>
            </tbody>
          </table>
          <div v-else class="text-dim">{{ t('sns.noLogEvents') }}</div>
        </template>
      </template>
    </div>

    <div v-if="details?.policy?.length" class="msg-section">
      <h5>{{ t('awsMsg.accessPolicy') }}</h5>
      <ul class="msg-list">
        <li v-for="(st, i) in details.policy" :key="i">
          <span :class="st.effect === 'Allow' ? 'status-ok' : 'status-err'">{{ st.effect }}</span>
          {{ st.actions.join(', ') }} → <span :class="st.principals.includes('*') && !st.conditions.length ? 'status-warn' : ''">{{ st.principals.join(', ') }}</span>
          <span v-if="st.conditions.length" class="text-dim"> · {{ t('awsMsg.conditions', { list: st.conditions.join(', ') }) }}</span>
        </li>
      </ul>
    </div>

    <AwsResourceMetrics
      :resource-key="topic.name" :charts="charts" :empty-text="t('sns.noMetrics')"
      :fetcher="hours => awsStore.fetchSnsTopicMetrics(topic.name, hours)"
      @request-access="emit('request-access', $event)"
    />
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useAwsStore } from '../../../stores/useAwsStore'
import { useI18n } from '../../../composables/useI18n'
import { settings } from '../../../composables/useSettings'
import AwsResourceMetrics from './AwsResourceMetrics.vue'
import HealthBadge from './HealthBadge.vue'
import { arnName, formatDate } from './messagingFormat'

const props = defineProps({ topic: { type: Object, required: true }, health: { type: Object, default: null } })
const emit = defineEmits(['request-access'])
const awsStore = useAwsStore()
const { t } = useI18n()
const details = ref(null)
const detailsError = ref(null)
const logs = ref(null)
const logsLoading = ref(false)
const logsError = ref(null)
const logStatus = ref('all')

// Subscriptions from the list until the detail (filters, raw delivery, DLQ) arrives.
const subscriptions = computed(() => details.value?.subscriptions || props.topic.subscriptions || [])
const charts = computed(() => [
  { key: 'published', label: t('sns.published'), color: '#58a6ff', stat: 'sum' },
  { key: 'delivered', label: t('sns.delivered'), color: '#3fb950', stat: 'sum' },
  { key: 'failed', label: t('sns.failed'), color: '#f85149', stat: 'sum' },
  { key: 'filteredOut', label: t('sns.filteredOut'), color: '#8b949e', stat: 'sum' },
  { key: 'redrivenToDlq', label: t('sns.redrivenToDlq'), color: '#d29922', stat: 'sum' },
  { key: 'failedToRedriveToDlq', label: t('sns.failedToRedrive'), color: '#db61a2', stat: 'sum' },
  { key: 'publishSize', label: t('sns.publishSize'), color: '#a371f7', stat: 'gauge', unit: 'bytes' },
])

function filterSummary(sub) {
  const keys = Object.keys(sub.filterPolicy || {})
  return `${keys.slice(0, 3).join(', ')}${keys.length > 3 ? '…' : ''}${sub.filterScope === 'MessageBody' ? ' (body)' : ''}`
}

async function loadLogs(force = false) {
  logsLoading.value = true
  logsError.value = null
  try {
    logs.value = await awsStore.fetchSnsDeliveryLogs(props.topic, { status: logStatus.value, force })
  } catch (e) {
    logsError.value = { text: e.message, access: e.details?.access || null }
  } finally {
    logsLoading.value = false
  }
}
function setLogStatus(value) {
  if (logStatus.value === value) return
  logStatus.value = value
  if (logs.value) loadLogs()
}

onMounted(async () => {
  try {
    details.value = await awsStore.fetchSnsTopicDetails(props.topic)
  } catch (e) {
    detailsError.value = { text: e.message, access: e.details?.access || null }
  }
})
</script>
