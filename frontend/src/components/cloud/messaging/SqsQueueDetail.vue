<template>
  <div class="msg-detail">
    <div class="msg-section">
      <h5>{{ t('health.title') }}</h5>
      <HealthBadge :health="health" list />
    </div>

    <dl class="msg-facts">
      <div><dt>URL</dt><dd class="mono-xs">{{ queue.url }}</dd></div>
      <div><dt>ARN</dt><dd class="mono-xs">{{ queue.arn }}</dd></div>
      <div><dt>{{ t('sqs.delayed') }}</dt><dd>{{ formatCount(queue.delayed, settings.lang) }}</dd></div>
      <div><dt>{{ t('sqs.visibilityTimeout') }}</dt><dd>{{ formatDuration(queue.visibilityTimeout) }}</dd></div>
      <div><dt>{{ t('awsMsg.created') }}</dt><dd>{{ formatDate(queue.createdAt, settings.lang) }}</dd></div>
      <div v-if="queue.dlqFor.length"><dt>{{ t('sqs.redriveFrom') }}</dt><dd>{{ queue.dlqFor.join(', ') }}</dd></div>
      <template v-if="details">
        <div><dt>{{ t('sqs.receiveWait') }}</dt><dd>
          {{ formatDuration(details.config.receiveWaitSeconds) }}
          <span v-if="details.config.receiveWaitSeconds === 0" class="status-warn" :title="t('sqs.shortPollingHint')"> · {{ t('sqs.shortPolling') }}</span>
        </dd></div>
        <div><dt>{{ t('sqs.maxMessage') }}</dt><dd>{{ formatBytes(details.config.maxMessageBytes) }}</dd></div>
        <div><dt>{{ t('sqs.deliveryDelay') }}</dt><dd>{{ formatDuration(details.config.delaySeconds) }}</dd></div>
        <div v-if="queue.fifo"><dt>FIFO</dt><dd>{{ details.config.contentBasedDeduplication ? t('sqs.contentDedup') : t('sqs.explicitDedup') }}<template v-if="details.config.fifoThroughputLimit"> · {{ details.config.fifoThroughputLimit }}</template></dd></div>
        <div v-if="details.redriveAllow"><dt>{{ t('sqs.redriveAllow') }}</dt><dd>{{ details.redriveAllow.permission }}</dd></div>
      </template>
      <div><dt>{{ t('awsMsg.logs') }}</dt><dd class="text-dim">{{ t('sqs.logsNote') }}</dd></div>
    </dl>

    <div v-if="detailsError" class="activity-notice">
      <span>{{ t('awsMsg.detailsUnavailable', { reason: detailsError.text }) }}</span>
      <button v-if="detailsError.access" class="btn sm" @click="emit('request-access', detailsError)">{{ t('awsAccess.requestAccess') }}</button>
    </div>
    <div v-else-if="!details" class="text-dim msg-hint">{{ t('sqs.loadingDetails') }}</div>
    <template v-else>
      <div class="msg-columns">
        <div class="msg-section">
          <h5>{{ t('sqs.consumers') }}</h5>
          <div v-if="details.consumers == null" class="text-dim">{{ t('sqs.consumersUnknown') }}</div>
          <div v-else-if="!details.consumers.length" class="status-warn">{{ t('sqs.noConsumers') }}</div>
          <table v-else class="msg-subtable">
            <thead><tr><th>Lambda</th><th>{{ t('sns.status') }}</th><th>{{ t('sqs.batch') }}</th><th>{{ t('sqs.lastResult') }}</th></tr></thead>
            <tbody>
              <tr v-for="c in details.consumers" :key="c.functionArn">
                <td>{{ c.function }}</td>
                <td><span :class="c.state === 'Enabled' ? 'status-ok' : 'status-warn'">{{ c.state }}</span></td>
                <td>{{ c.batchSize ?? '—' }}<template v-if="c.maxConcurrency"> · {{ t('sqs.maxConcurrency', { n: c.maxConcurrency }) }}</template></td>
                <td :class="c.lastResult && c.lastResult !== 'OK' && c.lastResult !== 'No records processed' ? 'status-err' : 'text-dim'">{{ c.lastResult || '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="msg-section">
          <h5>{{ t('sqs.producers') }}</h5>
          <div v-if="!details.producers?.length" class="text-dim">{{ t('sqs.noProducers') }}</div>
          <ul v-else class="msg-list">
            <li v-for="p in details.producers" :key="p.topicArn">SNS · {{ p.topic }} <span v-if="p.pending" class="status-warn">({{ t('sns.pendingConfirmation') }})</span></li>
          </ul>
        </div>
      </div>

      <div class="msg-section">
        <h5>{{ t('awsMsg.accessPolicy') }}</h5>
        <div v-if="!details.policy.length" class="text-dim">{{ t('awsMsg.noPolicy') }}</div>
        <ul v-else class="msg-list">
          <li v-for="(st, i) in details.policy" :key="i">
            <span :class="st.effect === 'Allow' ? 'status-ok' : 'status-err'">{{ st.effect }}</span>
            {{ st.actions.join(', ') }} → <span :class="st.principals.includes('*') && !st.conditions.length ? 'status-warn' : ''">{{ st.principals.join(', ') }}</span>
            <span v-if="st.conditions.length" class="text-dim"> · {{ t('awsMsg.conditions', { list: st.conditions.join(', ') }) }}</span>
          </li>
        </ul>
      </div>

      <div v-if="details.tags && Object.keys(details.tags).length" class="msg-section">
        <h5>Tags</h5>
        <div class="tag-chips"><span v-for="(v, k) in details.tags" :key="k" class="tag-chip">{{ k }}={{ v }}</span></div>
      </div>
    </template>

    <AwsResourceMetrics
      :resource-key="queue.name" :charts="charts" :empty-text="t('sqs.noMetrics')"
      :fetcher="hours => awsStore.fetchSqsQueueMetrics(queue.name, hours)"
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
import { formatCount, formatDate, formatDuration } from './messagingFormat'
import { formatBytes } from '../dashboard/dashboardFormat'

const props = defineProps({ queue: { type: Object, required: true }, health: { type: Object, default: null } })
const emit = defineEmits(['request-access'])
const awsStore = useAwsStore()
const { t } = useI18n()
const details = ref(null)
const detailsError = ref(null)

const charts = computed(() => [
  { key: 'sent', label: t('sqs.sent'), color: '#58a6ff', stat: 'sum' },
  { key: 'received', label: t('sqs.received'), color: '#a371f7', stat: 'sum' },
  { key: 'deleted', label: t('sqs.deleted'), color: '#3fb950', stat: 'sum' },
  { key: 'emptyReceives', label: t('sqs.emptyReceives'), color: '#8b949e', stat: 'sum' },
  { key: 'visible', label: t('sqs.visibleMax'), color: '#d29922', stat: 'gauge' },
  { key: 'inFlight', label: t('sqs.inFlightMax'), color: '#db61a2', stat: 'gauge' },
  { key: 'oldestAge', label: t('sqs.oldestAge'), color: '#f85149', stat: 'gauge', unit: 's' },
])

onMounted(async () => {
  try {
    details.value = await awsStore.fetchSqsQueueDetails(props.queue)
  } catch (e) {
    detailsError.value = { text: e.message, access: e.details?.access || null }
  }
})
</script>
