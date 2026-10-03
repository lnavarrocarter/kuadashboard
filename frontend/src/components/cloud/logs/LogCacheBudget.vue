<template>
  <div class="lcb" data-test="log-cache-budget">
    <span class="lcb-label">{{ t('logBudget.label') }}</span>
    <div class="lcb-bar" :title="data ? t('logBudget.used', { used: formatBytes(data.usage.bytes), budget: formatBytes(data.usage.budgetBytes) }) : ''">
      <div :style="{ width: `${percent}%` }" :class="{ full: percent >= 90 }"></div>
    </div>
    <span v-if="data" class="text-dim lcb-used">{{ t('logBudget.used', { used: formatBytes(data.usage.bytes), budget: formatBytes(data.usage.budgetBytes) }) }}</span>
    <select
      v-if="data && data.source !== 'env'" class="ctrl-select lcb-select" :value="data.mb" :disabled="busy"
      :aria-label="t('logBudget.label')" data-test="log-cache-budget-select" @change="save($event.target.value)"
    >
      <option v-for="choice in options" :key="choice.mb" :value="choice.mb" :disabled="!choice.allowed">
        {{ formatBytes(choice.mb * 1048576) }}{{ choice.allowed ? '' : ` · ${t(`plan.name_${choice.plan}`)}` }}
      </option>
    </select>
    <span v-else-if="data" class="msg-chip" :title="t('logBudget.envHint')">KUA_LOG_CACHE_MB</span>
    <span v-if="plan" class="msg-chip lcb-plan" :title="t(plan.source === 'env' ? 'plan.sourceEnv' : 'plan.sourceDefault')" data-test="plan-badge">{{ t(`plan.name_${plan.plan}`) }}</span>
    <span v-if="data?.capped" class="msg-chip warn">{{ t('logBudget.capped', { mb: data.mb }) }}</span>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useApi } from '../../../composables/useApi'
import { useI18n } from '../../../composables/useI18n'
import { useToast } from '../../../composables/useToast'
import { usePlan } from '../../../composables/usePlan'
import { formatBytes } from '../../../lib/awsLogs'

const emit = defineEmits(['changed'])
const { t } = useI18n()
const { apiFetch } = useApi()
const { toast } = useToast()
const { plan } = usePlan()
const data = ref(null)
const busy = ref(false)

const percent = computed(() => (data.value?.usage.budgetBytes ? Math.min(100, Math.round((data.value.usage.bytes / data.value.usage.budgetBytes) * 100)) : 0))
// Always offer the current value, even if it is not a standard size.
const options = computed(() => {
  const list = data.value?.choices || []
  return list.some(choice => choice.mb === data.value.mb) ? list : [{ mb: data.value.mb, allowed: true, plan: data.value.plan }, ...list]
})

async function load() {
  try {
    const response = await apiFetch('/api/system/log-cache-budget')
    data.value = response?.usage && Array.isArray(response.choices) ? response : null
  } catch { /* optional panel */ }
}

async function save(mb) {
  busy.value = true
  try {
    const response = await apiFetch('/api/system/log-cache-budget', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mb: Number(mb) }) })
    if (!response?.usage) throw new Error(t('logBudget.unavailable'))
    data.value = response
    toast(t('logBudget.saved', { size: formatBytes(data.value.bytes) }), 'success')
    emit('changed', data.value)
  } catch (err) {
    toast(err.message, 'error')
    await load()
  } finally {
    busy.value = false
  }
}

onMounted(load)
defineExpose({ load })
</script>

<style scoped>
.lcb { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 12px; }
.lcb-label { font-weight: 600; }
.lcb-bar { width: 140px; height: 6px; border-radius: 3px; background: var(--bg-hover); overflow: hidden; }
.lcb-bar div { height: 100%; background: var(--accent); }
.lcb-bar div.full { background: var(--yellow); }
.lcb-used { font-size: 11px; }
.lcb-select { max-width: 160px; }
.lcb-plan { text-transform: none; }
</style>
