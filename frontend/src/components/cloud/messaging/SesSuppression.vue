<template>
  <div class="msg-section">
    <div v-if="error" class="activity-notice">
      <span>{{ t('ses.suppressionUnavailable', { reason: error.text }) }}</span>
      <button v-if="error.access" class="btn sm" @click="emit('request-access', error)">{{ t('awsAccess.requestAccess') }}</button>
    </div>
    <div v-else-if="!data" class="text-dim">{{ t('common.loading') }}</div>
    <template v-else>
      <div class="msg-section-head">
        <span>{{ t('ses.suppressionTotal', { n: data.total, bounce: data.byReason.BOUNCE, complaint: data.byReason.COMPLAINT }) }}</span>
        <span v-if="reasons.length" class="text-dim">{{ t('ses.suppressionAuto', { list: reasons.join(', ') }) }}</span>
        <span v-else class="status-warn">{{ t('ses.suppressionOff') }}</span>
      </div>
      <table v-if="data.items.length" class="msg-subtable">
        <thead><tr><th>{{ t('ses.email') }}</th><th>{{ t('ses.reason') }}</th><th>{{ t('ses.updated') }}</th></tr></thead>
        <tbody>
          <tr v-for="item in data.items" :key="item.email">
            <td>{{ item.email }}</td>
            <td><span :class="item.reason === 'COMPLAINT' ? 'status-err' : 'status-warn'">{{ t(`ses.reason_${item.reason}`) }}</span></td>
            <td class="text-dim">{{ formatDate(item.updatedAt, settings.lang) }}</td>
          </tr>
        </tbody>
      </table>
      <div v-if="data.total > data.items.length" class="text-dim msg-hint">{{ t('ses.suppressionShown', { n: data.items.length }) }}</div>
    </template>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { useAwsStore } from '../../../stores/useAwsStore'
import { useI18n } from '../../../composables/useI18n'
import { settings } from '../../../composables/useSettings'
import { formatDate } from './messagingFormat'

// Addresses SES will not send to (free API call).
defineProps({ reasons: { type: Array, default: () => [] } })
const emit = defineEmits(['request-access'])
const awsStore = useAwsStore()
const { t } = useI18n()
const data = ref(null)
const error = ref(null)

onMounted(async () => {
  try { data.value = await awsStore.fetchSesSuppression() } catch (e) { error.value = { text: e.message, access: e.details?.access || null } }
})
</script>
