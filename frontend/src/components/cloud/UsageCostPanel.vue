<template>
  <!-- Optional: hidden when the spend tracking is off (Help & Options → Account) -->
  <section v-if="!disabled" class="ucp" :class="{ compact }" data-test="usage-cost">
    <header class="ucp-head">
      <div class="ucp-title">
        <i data-lucide="receipt"></i>
        <div>
          <h3>{{ t('usage.title') }}</h3>
          <p>{{ t(service ? 'usage.subtitleService' : 'usage.subtitle', { service }) }}</p>
        </div>
      </div>
      <div class="ucp-controls">
        <select v-model.number="days" class="ctrl-select" :aria-label="t('usage.period')" @change="load">
          <option v-for="n in [7, 30, 90]" :key="n" :value="n">{{ t('usage.lastDays', { n }) }}</option>
        </select>
        <select v-if="profileId" v-model="scope" class="ctrl-select" :aria-label="t('usage.scope')" @change="load">
          <option value="profile">{{ t('usage.thisProfile') }}</option>
          <option value="all">{{ t('usage.allProfiles') }}</option>
        </select>
        <button class="btn btn-icon" :title="t('usage.refresh')" :disabled="loading" @click="load"><i data-lucide="refresh-cw"></i></button>
      </div>
    </header>

    <p v-if="error" class="activity-notice">{{ error }}</p>
    <p v-else-if="!data" class="text-dim ucp-note">{{ t('common.loading') }}</p>
    <template v-else>
      <div class="ucp-kpis">
        <div class="ucp-kpi" data-test="usage-today"><b>{{ usd(data.totals.today.usd) }}</b><span>{{ t('usage.today') }}</span></div>
        <div class="ucp-kpi" data-test="usage-month"><b>{{ usd(data.totals.month.usd) }}</b><span>{{ t('usage.month') }}</span></div>
        <div class="ucp-kpi"><b>{{ usd(data.totals.window.usd) }}</b><span>{{ t('usage.window', { n: data.days, calls: data.totals.window.calls }) }}</span></div>
        <div v-if="data.totals.window.potentialUsd > 0" class="ucp-kpi dim" :title="t('usage.potentialHint')">
          <b>{{ usd(data.totals.window.potentialUsd) }}</b><span>{{ t('usage.potential') }}</span>
        </div>
      </div>

      <p v-if="!data.byOperation.length" class="text-dim ucp-note" data-test="usage-empty">{{ t('usage.empty', { n: data.days }) }}</p>
      <div v-else class="ucp-table-wrap">
        <table class="ucp-table" data-test="usage-operations">
          <thead>
            <tr><th>{{ t('usage.operation') }}</th><th class="num">{{ t('usage.calls') }}</th><th>{{ t('usage.calculation') }}</th><th class="num">{{ t('usage.cost') }}</th></tr>
          </thead>
          <tbody>
            <tr v-for="row in data.byOperation" :key="row.service + row.operation">
              <td><b>{{ row.service }}</b> · {{ row.operation }}</td>
              <td class="num">{{ formatNumber(row.calls) }}</td>
              <td class="ucp-formula">
                {{ quantity(row) }} × {{ unitPrice(row) }} = {{ usd(row.usd || row.potentialUsd) }}
                <span v-if="row.freeTier" class="ucp-free">{{ t('usage.freeTier', { note: row.freeTier }) }}</span>
              </td>
              <td class="num" :class="{ dim: !row.usd }">{{ usd(row.usd) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="data.byFeature.length && !compact" class="ucp-features">
        <span class="text-dim">{{ t('usage.byFeature') }}</span>
        <span v-for="row in data.byFeature" :key="row.feature" class="msg-chip">{{ t(`usage.feature.${row.feature}`) }} · {{ usd(row.usd) }}</span>
      </div>

      <details v-if="data.recent.length" class="ucp-recent">
        <summary>{{ t('usage.recent', { n: data.recent.length }) }}</summary>
        <ul>
          <li v-for="(row, i) in data.recent" :key="i">
            <span class="text-dim">{{ formatTime(row.at) }}</span>
            <span>{{ row.service }} · {{ row.operation }}<template v-if="row.ref"> <code>{{ row.ref }}</code></template></span>
            <span class="ucp-formula">{{ quantity(row) }} × {{ unitPrice(row) }} = {{ usd(row.usd || row.potentialUsd) }}<template v-if="!row.usd && row.potentialUsd"> ({{ t('usage.inFreeTier') }})</template></span>
          </li>
        </ul>
      </details>
      <p class="text-dim ucp-note">{{ t('usage.disclaimer') }}</p>
    </template>
  </section>
</template>

<script setup>
import { nextTick, onMounted, onUpdated, ref, watch } from 'vue'
import { createIcons, icons } from 'lucide'
import { useApi } from '../../composables/useApi'
import { formatNumber, useI18n } from '../../composables/useI18n'
import { settings } from '../../composables/useSettings'

const props = defineProps({
  // Profile of the current view; the panel can show it or every profile.
  profileId: { type: String, default: '' },
  // Only one service (e.g. "CloudWatch Logs" in the Logs tab).
  service: { type: String, default: '' },
  compact: { type: Boolean, default: false },
})

const { t } = useI18n()
const { apiFetch } = useApi()
const data = ref(null)
const disabled = ref(false)
const error = ref('')
const loading = ref(false)
const days = ref(30)
const scope = ref('profile')

/** USD with enough decimals to show sub-cent API costs (USD 0.00002). */
function usd(value) {
  const amount = Number(value) || 0
  if (amount === 0) return 'USD 0'
  if (amount >= 1) return `USD ${amount.toFixed(2)}`
  const digits = Math.min(8, Math.max(2, 1 - Math.floor(Math.log10(amount)) + 1))
  return `USD ${amount.toFixed(digits).replace(/0+$/, '')}`
}

const GB_UNITS = new Set(['GB', 'GB scanned'])
function quantity(row) {
  if (GB_UNITS.has(row.unit)) {
    const mb = row.quantity * 1024
    return mb < 1024 ? `${formatNumber(Math.round(mb * 100) / 100)} MB` : `${formatNumber(Math.round(row.quantity * 1000) / 1000)} GB`
  }
  if (row.unit === 'TB scanned') return `${formatNumber(Math.round(row.quantity * 1024 * 1000) / 1000)} GB`
  return `${formatNumber(Math.round(row.quantity * 1000) / 1000)} ${t(`usage.unit.${row.unit.replace(/\s+/g, '_')}`)}`
}
function unitPrice(row) {
  if (GB_UNITS.has(row.unit)) return `${usd(row.unitPrice)}/GB`
  if (row.unit === 'TB scanned') return `${usd(row.unitPrice / 1024)}/GB`
  return usd(row.unitPrice)
}
const formatTime = at => new Date(at).toLocaleString(settings.lang === 'es' ? 'es' : 'en-US', { dateStyle: 'short', timeStyle: 'short' })

async function load() {
  loading.value = true
  error.value = ''
  const params = new URLSearchParams({ days: String(days.value) })
  if (props.profileId && scope.value === 'profile') params.set('profile', props.profileId)
  if (props.service) params.set('service', props.service)
  try {
    const response = await apiFetch(`/api/system/usage?${params}`)
    disabled.value = response?.enabled === false
    if (disabled.value) { data.value = null; return }
    // An unexpected answer (older backend, proxy page) must not break the overview.
    if (!response?.totals || !Array.isArray(response.byOperation)) throw new Error(t('usage.unavailable'))
    data.value = response
  } catch (err) {
    error.value = err.message
  } finally {
    loading.value = false
  }
}

watch(() => props.profileId, load)
const refreshIcons = () => nextTick(() => createIcons({ icons }))
onMounted(() => { load(); refreshIcons() })
onUpdated(refreshIcons)
defineExpose({ load })
</script>

<style scoped>
.ucp { border: 1px solid var(--border); border-radius: 8px; background: var(--bg-panel, var(--bg)); padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.ucp-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; flex-wrap: wrap; }
.ucp-title { display: flex; gap: 10px; align-items: flex-start; min-width: 0; }
.ucp-title > svg { width: 20px; height: 20px; color: var(--accent); flex: none; margin-top: 2px; }
.ucp-title h3 { margin: 0; font-size: 14px; }
.ucp-title p { margin: 2px 0 0; font-size: 11px; color: var(--text-dim); }
.ucp-controls { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.ucp-kpis { display: flex; gap: 8px; flex-wrap: wrap; }
.ucp-kpi { border: 1px solid var(--border); border-radius: 6px; padding: 6px 10px; display: flex; flex-direction: column; min-width: 120px; }
.ucp-kpi b { font-size: 15px; font-variant-numeric: tabular-nums; }
.ucp-kpi span { font-size: 11px; color: var(--text-dim); }
.ucp-kpi.dim b { color: var(--text-dim); }
.ucp-table-wrap { overflow-x: auto; }
.ucp-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.ucp-table th { text-align: left; font-weight: 600; color: var(--text-dim); font-size: 11px; padding: 4px 6px; border-bottom: 1px solid var(--border); }
.ucp-table td { padding: 5px 6px; border-bottom: 1px solid var(--border); vertical-align: top; }
.ucp-table .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.ucp-table .dim { color: var(--text-dim); }
.ucp-formula { font-variant-numeric: tabular-nums; }
.ucp-free { display: block; font-size: 10px; color: var(--text-dim); }
.ucp-features { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; font-size: 11px; }
.ucp-recent summary { cursor: pointer; font-size: 12px; }
.ucp-recent ul { list-style: none; margin: 6px 0 0; padding: 0; display: flex; flex-direction: column; gap: 3px; font-size: 11px; }
.ucp-recent li { display: flex; gap: 8px; flex-wrap: wrap; }
.ucp-recent code { font-size: 10px; }
.ucp-note { margin: 0; font-size: 11px; }
.ucp.compact { padding: 8px 10px; gap: 6px; }
@media (max-width: 640px) { .ucp-kpi { min-width: calc(50% - 4px); } }
</style>
