<template>
  <div class="acp" data-test="account-profile">
    <!-- Account: linking to a KUA account arrives with sign-in (#35, #31) -->
    <section class="acp-card">
      <div class="acp-head">
        <i data-lucide="user-round"></i>
        <div>
          <h4>{{ t('account.title') }}</h4>
          <p class="text-dim">{{ t('account.notLinked') }}</p>
        </div>
        <button class="btn sm" disabled :title="t('account.signInSoon')" data-test="account-sign-in">{{ t('account.signIn') }}</button>
      </div>
      <p class="text-dim acp-note">{{ t('account.linkHint') }}</p>
    </section>

    <!-- Plan -->
    <section class="acp-card" data-test="account-plan">
      <div class="acp-head">
        <i data-lucide="badge-check"></i>
        <div>
          <h4>{{ t('account.planTitle') }} <span v-if="plan" class="msg-chip acp-plan" data-test="account-plan-name">{{ t(`plan.name_${plan.plan}`) }}</span></h4>
          <p class="text-dim">{{ plan ? t(plan.source === 'env' ? 'plan.sourceEnv' : 'plan.sourceDefault') : t('common.loading') }}</p>
        </div>
      </div>
      <div v-if="plan?.plans" class="acp-table-wrap">
        <table class="acp-table" data-test="account-plans">
          <thead>
            <tr>
              <th></th>
              <th v-for="name in PLAN_ORDER" :key="name" :class="{ current: plan.plan === name }">{{ t(`plan.name_${name}`) }}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{{ t('account.featureAdvisor') }}</td>
              <td v-for="name in PLAN_ORDER" :key="name" :class="{ current: plan.plan === name }">{{ yes(plan.plans[name].features.advisor) }}</td>
            </tr>
            <tr>
              <td>{{ t('account.featureCache') }}</td>
              <td v-for="name in PLAN_ORDER" :key="name" :class="{ current: plan.plan === name }">{{ formatBytes(plan.plans[name].limits.logCacheMaxMb * 1048576) }}</td>
            </tr>
            <tr>
              <td>{{ t('account.featureRefresh') }}</td>
              <td v-for="name in PLAN_ORDER" :key="name" :class="{ current: plan.plans[name] && plan.plan === name }">
                {{ plan.plans[name].features.logAutoRefresh ? t('account.everyMinutes', { n: plan.plans[name].limits.logRefreshMinMinutes }) : t('account.manual') }}
              </td>
            </tr>
            <tr>
              <td>{{ t('account.featureTeam') }}</td>
              <td v-for="name in PLAN_ORDER" :key="name" :class="{ current: plan.plan === name }">{{ plan.plans[name].features.teamSharing ? t('account.soon') : '—' }}</td>
            </tr>
            <tr>
              <td>{{ t('account.featureLocal') }}</td>
              <td v-for="name in PLAN_ORDER" :key="name" :class="{ current: plan.plan === name }">✓</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="text-dim acp-note">{{ t('account.planHint') }}</p>
    </section>

    <!-- Log cache size (capped by the plan) -->
    <section class="acp-card">
      <div class="acp-head">
        <i data-lucide="hard-drive"></i>
        <div>
          <h4>{{ t('account.cacheTitle') }}</h4>
          <p class="text-dim">{{ t('account.cacheHint') }}</p>
        </div>
      </div>
      <LogCacheBudget />
    </section>

    <!-- Local ML -->
    <section class="acp-card" data-test="account-ml">
      <div class="acp-head">
        <i data-lucide="sparkles"></i>
        <div>
          <h4>{{ t('awsLogs.ml.title') }}</h4>
          <p class="text-dim">{{ mlText }}</p>
        </div>
        <span class="acp-actions">
          <button v-if="ml && !ml.enabled" class="btn sm" :disabled="mlBusy" data-test="account-ml-enable" @click="setMl('enable')">{{ ml.downloaded ? t('awsLogs.ml.enable') : t('awsLogs.ml.enableDownload', { size: mb(ml.downloadBytes) }) }}</button>
          <button v-if="ml?.enabled" class="btn sm" :disabled="mlBusy" @click="setMl('disable')">{{ t('awsLogs.ml.disable') }}</button>
          <button v-if="ml?.downloaded" class="btn sm danger" :disabled="mlBusy" @click="setMl('remove')">{{ t('awsLogs.ml.remove', { size: mb(ml.diskBytes) }) }}</button>
        </span>
      </div>
    </section>

    <!-- What KUA spent on cloud APIs -->
    <section class="acp-card" data-test="account-usage">
      <div class="acp-head">
        <i data-lucide="receipt"></i>
        <div>
          <h4>{{ t('usage.title') }}</h4>
          <p class="text-dim">{{ usage ? t('account.usageMonth', { usd: usd(usage.totals.month.usd), calls: usage.totals.month.calls }) : t('common.loading') }}</p>
        </div>
      </div>
      <p class="text-dim acp-note">{{ t('account.usageHint') }}</p>
    </section>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, onUpdated, ref } from 'vue'
import { createIcons, icons } from 'lucide'
import { api } from '../../composables/useApi'
import { useI18n } from '../../composables/useI18n'
import { usePlan } from '../../composables/usePlan'
import { formatBytes } from '../../lib/awsLogs'
import LogCacheBudget from '../cloud/logs/LogCacheBudget.vue'

const PLAN_ORDER = ['free', 'pro', 'team']

const { t } = useI18n()
const { plan } = usePlan()
const ml = ref(null)
const mlBusy = ref(false)
const usage = ref(null)

const mb = bytes => Math.max(1, Math.round((bytes || 0) / 1048576))
const yes = value => (value ? '✓' : '—')
const usd = value => {
  const amount = Number(value) || 0
  return amount === 0 ? 'USD 0' : amount >= 0.01 ? `USD ${amount.toFixed(2)}` : `USD ${amount.toPrecision(2)}`
}
const mlText = computed(() => {
  if (!ml.value) return t('common.loading')
  if (!ml.value.enabled) return t('account.mlOff')
  return t('account.mlOn', { size: mb(ml.value.diskBytes) })
})

async function loadMl() {
  try {
    const status = await api('GET', '/api/system/ml')
    ml.value = status && 'enabled' in status ? status : null
  } catch { ml.value = null }
}

async function setMl(action) {
  mlBusy.value = true
  try {
    ml.value = action === 'enable'
      ? await api('POST', '/api/system/ml/enable')
      : await api('POST', '/api/system/ml/disable', { remove: action === 'remove' })
  } finally { mlBusy.value = false }
}

async function loadUsage() {
  try {
    const summary = await api('GET', '/api/system/usage?days=30')
    usage.value = summary?.totals?.month ? summary : null
  } catch { usage.value = null }
}

const refreshIcons = () => nextTick(() => createIcons({ icons }))
onMounted(() => { loadMl(); loadUsage(); refreshIcons() })
onUpdated(refreshIcons)
</script>

<style scoped>
.acp { display: flex; flex-direction: column; gap: 12px; }
.acp-card { border: 1px solid var(--border); border-radius: 8px; padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.acp-head { display: flex; gap: 10px; align-items: flex-start; flex-wrap: wrap; }
.acp-head > svg { width: 18px; height: 18px; color: var(--accent); flex: none; margin-top: 2px; }
.acp-head > div { flex: 1 1 220px; min-width: 0; }
.acp-head h4 { margin: 0; font-size: 13px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.acp-head p { margin: 2px 0 0; font-size: 11px; }
.acp-actions { display: flex; gap: 4px; flex-wrap: wrap; }
.acp-note { margin: 0; font-size: 11px; line-height: 1.5; }
.acp-plan { text-transform: none; font-size: 11px; }
.acp-table-wrap { overflow-x: auto; }
.acp-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.acp-table th, .acp-table td { padding: 5px 8px; border-bottom: 1px solid var(--border); text-align: center; }
.acp-table th:first-child, .acp-table td:first-child { text-align: left; }
.acp-table .current { background: color-mix(in srgb, var(--accent) 10%, transparent); font-weight: 600; }
</style>
