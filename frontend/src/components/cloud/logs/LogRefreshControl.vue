<template>
  <span class="lrc" data-test="log-refresh">
    <select
      class="ctrl-select lrc-select" :value="minutes ?? 'off'" :disabled="busy || !plan"
      :aria-label="t('logRefresh.label')" :title="hint" data-test="log-refresh-select"
      @change="change($event.target.value)"
    >
      <option value="off">{{ t('logRefresh.off') }}</option>
      <option v-for="choice in choices" :key="choice.minutes" :value="choice.minutes" :disabled="!choice.allowed">
        {{ t('logRefresh.every', { n: choice.minutes }) }}{{ choice.allowed ? '' : ` · ${t(`plan.name_${choice.required}`)}` }}
      </option>
    </select>
    <span v-if="minutes" class="text-dim lrc-meta" data-test="log-refresh-meta">
      {{ t('logRefresh.requests', { n: requestsPerDay }) }}<template v-if="nextAt"> · {{ t('logRefresh.next', { time: formatTime(nextAt, settings.lang) }) }}</template>
    </span>
    <span v-else-if="plan && !plan.features.logAutoRefresh" class="msg-chip lrc-plan" :title="t('logRefresh.planHint')">{{ t('plan.name_pro') }}</span>
  </span>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useApi } from '../../../composables/useApi'
import { useI18n } from '../../../composables/useI18n'
import { useToast } from '../../../composables/useToast'
import { settings } from '../../../composables/useSettings'
import { usePlan, requiredPlanFor } from '../../../composables/usePlan'
import { formatTime } from '../../../lib/awsLogs'
import { useLogApi } from './logApi'

const props = defineProps({
  group: { type: String, required: true },
  profileId: { type: String, default: '' },
  // Current interval of the group (null = off)
  minutes: { type: Number, default: null },
  lastSyncAt: { type: Number, default: null },
  // Pages read per refresh, for the requests estimate (Kubernetes: containers)
  pagesPerSync: { type: Number, default: 1 },
})
const emit = defineEmits(['updated'])

const { t } = useI18n()
const { apiFetch } = useApi()
const { toast } = useToast()
const { plan } = usePlan()
const logApi = useLogApi()
const busy = ref(false)

const choices = computed(() => (plan.value?.refreshChoices || [1, 5, 15, 30, 60]).map(minutes => {
  const allowed = !!plan.value?.features.logAutoRefresh && minutes >= (plan.value.limits.logRefreshMinMinutes || 0)
  const required = requiredPlanFor(plan.value?.plans, p => p.features.logAutoRefresh && minutes >= (p.limits.logRefreshMinMinutes || 0))
  return { minutes, allowed, required }
}))
const effective = computed(() => (props.minutes ? Math.max(props.minutes, plan.value?.limits.logRefreshMinMinutes || props.minutes) : null))
const requestsPerDay = computed(() => (effective.value ? Math.ceil((24 * 60) / effective.value) * Math.max(1, props.pagesPerSync) : 0))
const nextAt = computed(() => (effective.value && props.lastSyncAt && plan.value?.features.logAutoRefresh ? props.lastSyncAt + effective.value * 60000 : null))
const hint = computed(() => t(logApi.provider === 'kubernetes' ? 'logRefresh.hintKube' : 'logRefresh.hintAws'))

async function change(value) {
  busy.value = true
  try {
    const group = await apiFetch(`${logApi.base}/log-cache`, {
      method: 'PATCH',
      headers: { 'X-Profile-Id': props.profileId, 'Content-Type': 'application/json' },
      body: JSON.stringify({ group: props.group, refreshMinutes: value === 'off' ? null : Number(value) }),
    })
    emit('updated', group)
    toast(value === 'off' ? t('logRefresh.turnedOff') : t('logRefresh.turnedOn', { n: value }), 'success')
  } catch (err) {
    toast(err.message, 'error')
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
.lrc { display: inline-flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.lrc-select { max-width: 150px; }
.lrc-meta { font-size: 11px; }
.lrc-plan { font-size: 10px; }
</style>
