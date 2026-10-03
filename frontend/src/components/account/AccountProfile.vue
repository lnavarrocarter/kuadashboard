<template>
  <div class="acp" data-test="account-profile">
    <!-- KUA account: sign-in through the browser, plan and billing (routes/account.js) -->
    <section class="acp-card" data-test="account-card">
      <div class="acp-head">
        <img v-if="account?.user?.picture" :src="account.user.picture" alt="" class="acp-avatar" referrerpolicy="no-referrer" />
        <!-- Lucide swaps the <i> for an <svg>: Vue must own the node it toggles, or linking the account aborts the update -->
        <span v-else class="acp-icon"><i data-lucide="user-round"></i></span>
        <div>
          <h4>{{ t('account.title') }}</h4>
          <p v-if="account?.linked" class="text-dim" data-test="account-user">{{ t('account.linkedAs', { name: account.user.name, email: account.user.email }) }}</p>
          <p v-else class="text-dim">{{ t('account.notLinked') }}</p>
        </div>
        <span class="acp-actions">
          <template v-if="account?.linked">
            <button class="btn sm" :disabled="busy" data-test="account-refresh" @click="refreshAccount">{{ t('account.refresh') }}</button>
            <button class="btn sm" :disabled="busy" data-test="account-sign-out" @click="signOut">{{ t('account.signOut') }}</button>
          </template>
          <button v-else class="btn sm primary" :disabled="busy || waiting === 'login'" data-test="account-sign-in" @click="signIn">
            {{ waiting === 'login' ? t('account.waitingBrowser') : t('account.signIn') }}
          </button>
        </span>
      </div>
      <p v-if="waiting === 'login'" class="acp-note" data-test="account-waiting">{{ t('account.waitingLogin') }}</p>
      <p v-if="account?.stale" class="acp-note acp-warn">{{ t('account.stale') }}</p>
      <p v-if="error" class="acp-note acp-warn" data-test="account-error">{{ error }}</p>
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
      <!-- Upgrade and manage: only with a linked account -->
      <div v-if="account?.linked" class="acp-billing" data-test="account-billing">
        <div class="acp-interval" role="group" :aria-label="t('account.interval')">
          <button v-for="option in ['month', 'year']" :key="option" :class="['btn', 'sm', { accent: interval === option }]" :aria-pressed="interval === option" @click="interval = option">{{ t(`account.interval_${option}`) }}</button>
        </div>
        <button v-for="target in upgrades" :key="target" class="btn sm primary" :disabled="busy" :data-test="`account-upgrade-${target}`" @click="checkout(target)">
          {{ t('account.upgrade', { plan: t(`plan.name_${target}`), price: t(`account.price_${target}_${interval}`) }) }}
        </button>
        <button v-if="paid" class="btn sm" :disabled="busy" data-test="account-portal" @click="portal">{{ t('account.manage') }}</button>
      </div>
      <p v-if="waiting === 'payment'" class="acp-note" data-test="account-waiting-payment">{{ t('account.waitingPayment') }}</p>
      <p class="text-dim acp-note">{{ t(plan?.source === 'env' ? 'account.planHintEnv' : account?.linked ? 'account.planHintAccount' : 'account.planHint') }}</p>
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
import { computed, nextTick, onMounted, onUnmounted, onUpdated, ref } from 'vue'
import { createIcons, icons } from 'lucide'
import { api } from '../../composables/useApi'
import { useI18n } from '../../composables/useI18n'
import { usePlan } from '../../composables/usePlan'
import { formatBytes } from '../../lib/awsLogs'
import LogCacheBudget from '../cloud/logs/LogCacheBudget.vue'
import { openExternal } from '../../lib/openExternal'
import { useToast } from '../../composables/useToast'

const PLAN_ORDER = ['free', 'pro', 'team']

const { t } = useI18n()
const { plan, reload: reloadPlan } = usePlan()
const { toast } = useToast()
const account = ref(null)
const busy = ref(false)
const error = ref('')
// 'login' while the browser sign-in runs, 'payment' after opening the checkout.
const waiting = ref('')
const interval = ref('month')
let poll = null

const accountPlan = computed(() => account.value?.plan || 'free')
const upgrades = computed(() => PLAN_ORDER.slice(PLAN_ORDER.indexOf(accountPlan.value) + 1))
const paid = computed(() => accountPlan.value === 'pro' || accountPlan.value === 'team')

async function loadAccount() {
  try {
    const status = await api('GET', '/api/account')
    account.value = status && 'linked' in status ? status : null
  } catch { account.value = null }
}

async function run(action) {
  busy.value = true
  error.value = ''
  try { return await action() } catch (err) { error.value = err.message; return null } finally { busy.value = false }
}

function stopPolling() {
  clearInterval(poll)
  poll = null
  waiting.value = ''
}

/** Polls until `done(status)` or the time runs out (the browser step happens outside KUA). */
function pollAccount({ kind, refresh = false, everyMs, forMs, done }) {
  stopPolling()
  waiting.value = kind
  const until = Date.now() + forMs
  poll = setInterval(async () => {
    const status = refresh ? await api('POST', '/api/account/refresh').catch(() => null) : await api('GET', '/api/account').catch(() => null)
    if (status && 'linked' in status) account.value = status
    if (status && done(status)) {
      stopPolling()
      await reloadPlan()
    } else if (Date.now() > until) stopPolling()
  }, everyMs)
}

async function signIn() {
  const login = await run(() => api('POST', '/api/account/login'))
  if (!login?.url) return
  openExternal(login.url)
  pollAccount({ kind: 'login', everyMs: 2000, forMs: 5 * 60 * 1000, done: status => status.linked })
}

async function signOut() {
  const status = await run(() => api('POST', '/api/account/logout'))
  if (status) { account.value = status; await reloadPlan() }
}

async function refreshAccount() {
  const status = await run(() => api('POST', '/api/account/refresh'))
  if (status) { account.value = status; await reloadPlan() }
}

async function checkout(target) {
  const result = await run(() => api('POST', '/api/account/checkout', { plan: target, interval: interval.value }))
  if (!result?.url) return
  openExternal(result.url)
  const before = accountPlan.value
  // The plan changes when the billing webhook confirms the payment, not when the checkout opens.
  pollAccount({ kind: 'payment', refresh: true, everyMs: 5000, forMs: 10 * 60 * 1000, done: status => status.plan && status.plan !== before })
}

async function portal() {
  const result = await run(() => api('POST', '/api/account/portal'))
  if (result?.url) {
    openExternal(result.url)
    toast(t('account.portalOpened'), 'info')
  }
}

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
/**
 * Sign-in and payments finish in the browser: when the user comes back to KUA
 * (focus or visible again), read the account and, if it changed, the plan of
 * the whole app — the polling may have stopped while the window was hidden.
 */
async function onReturn() {
  if (document.visibilityState === 'hidden') return
  const before = JSON.stringify([account.value?.linked, account.value?.plan])
  await loadAccount()
  if (JSON.stringify([account.value?.linked, account.value?.plan]) !== before) {
    if (account.value?.linked && waiting.value === 'login') stopPolling()
    await reloadPlan()
  }
}

onMounted(() => {
  loadAccount(); loadMl(); loadUsage(); refreshIcons()
  window.addEventListener('focus', onReturn)
  document.addEventListener('visibilitychange', onReturn)
})
onUnmounted(() => {
  stopPolling()
  window.removeEventListener('focus', onReturn)
  document.removeEventListener('visibilitychange', onReturn)
})
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
.acp-avatar { width: 28px; height: 28px; border-radius: 50%; flex: none; }
.acp-icon { display: inline-flex; flex: none; }
.acp-warn { color: var(--yellow); }
.acp-billing { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.acp-interval { display: inline-flex; gap: 4px; margin-right: 6px; }
.acp-table-wrap { overflow-x: auto; }
.acp-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.acp-table th, .acp-table td { padding: 5px 8px; border-bottom: 1px solid var(--border); text-align: center; }
.acp-table th:first-child, .acp-table td:first-child { text-align: left; }
.acp-table .current { background: color-mix(in srgb, var(--accent) 10%, transparent); font-weight: 600; }
</style>
