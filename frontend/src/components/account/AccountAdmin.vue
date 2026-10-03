<template>
  <!-- Administrators of the KUA service: give Pro or Team without payment (control plane /api/admin) -->
  <section class="acp-card" data-test="account-admin">
    <div class="acp-head">
      <i data-lucide="shield-check"></i>
      <div>
        <h4>{{ t('accountAdmin.title') }}</h4>
        <p class="text-dim">{{ t('accountAdmin.hint') }}</p>
      </div>
    </div>
    <form class="adm-search" @submit.prevent="load">
      <input v-model.trim="email" type="email" class="ctrl-input" :placeholder="t('accountAdmin.emailPlaceholder')" data-test="admin-email" />
      <button class="btn sm" :disabled="busy" data-test="admin-search">{{ email ? t('accountAdmin.search') : t('accountAdmin.latest') }}</button>
    </form>
    <p v-if="error" class="acp-note acp-warn" data-test="admin-error">{{ error }}</p>
    <p v-if="items && !items.length" class="text-dim acp-note">{{ t('accountAdmin.none') }}</p>
    <ul v-if="items?.length" class="adm-list" data-test="admin-accounts">
      <li v-for="item in items" :key="item.user.id">
        <div class="adm-row">
          <div class="adm-who">
            <strong>{{ item.user.email }}</strong>
            <small class="text-dim">{{ item.user.name }}</small>
          </div>
          <span class="adm-plan" :data-test="`admin-plan-${item.user.id}`">{{ planName(item.plan) }} · {{ t(`accountAdmin.source_${item.source}`) }}</span>
          <span class="adm-actions">
            <button class="btn sm" :disabled="busy" :data-test="`admin-grant-open-${item.user.id}`" @click="openForm(item)">{{ t('accountAdmin.grant') }}</button>
            <button v-if="item.grant" class="btn sm danger" :disabled="busy" :data-test="`admin-revoke-${item.user.id}`" @click="revoke(item)">{{ t('accountAdmin.revoke') }}</button>
          </span>
        </div>
        <p v-if="item.subscription" class="text-dim adm-detail">{{ t('accountAdmin.paid', { plan: planName(item.subscription.plan), status: item.subscription.status }) }}</p>
        <p v-if="item.grant" class="text-dim adm-detail">
          {{ t(item.grant.expiresAt ? 'accountAdmin.grantedUntil' : 'accountAdmin.granted', { plan: planName(item.grant.plan), date: day(item.grant.expiresAt), by: item.grant.grantedBy }) }}
          <template v-if="item.grant.reason"> · {{ item.grant.reason }}</template>
          <template v-if="!item.grant.active"> · {{ t('accountAdmin.expired') }}</template>
        </p>
        <form v-if="form.userId === item.user.id" class="adm-form" :data-test="`admin-grant-form-${item.user.id}`" @submit.prevent="grant(item)">
          <select v-model="form.plan" class="ctrl-select" :aria-label="t('accountAdmin.plan')">
            <option value="pro">Pro</option>
            <option value="team">Team</option>
          </select>
          <label class="text-dim">{{ t('accountAdmin.until') }} <input v-model="form.expiresAt" type="date" class="ctrl-input" :min="tomorrow" /></label>
          <input v-model.trim="form.reason" class="ctrl-input" maxlength="200" :placeholder="t('accountAdmin.reason')" />
          <button class="btn sm primary" :disabled="busy" :data-test="`admin-grant-save-${item.user.id}`">{{ t('accountAdmin.save') }}</button>
          <button type="button" class="btn sm" @click="form.userId = ''">{{ t('common.cancel') }}</button>
        </form>
      </li>
    </ul>
  </section>
</template>

<script setup>
import { reactive, ref } from 'vue'
import { api } from '../../composables/useApi'
import { useI18n } from '../../composables/useI18n'
import { settings } from '../../composables/useSettings'

const emit = defineEmits(['changed'])
const { t } = useI18n()
const email = ref('')
const items = ref(null)
const error = ref('')
const busy = ref(false)
const form = reactive({ userId: '', plan: 'pro', expiresAt: '', reason: '' })
const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10)

const planName = plan => t(`plan.name_${plan || 'free'}`)
const day = at => (at ? new Date(at).toLocaleDateString(settings.lang === 'es' ? 'es' : 'en-US', { dateStyle: 'medium' }) : '')

async function run(action) {
  busy.value = true
  error.value = ''
  try { return await action() } catch (err) { error.value = err.message; return null } finally { busy.value = false }
}

async function load() {
  const result = await run(() => api('GET', `/api/account/admin/accounts${email.value ? `?${new URLSearchParams({ email: email.value })}` : ''}`))
  if (result) items.value = Array.isArray(result.items) ? result.items : []
}

function openForm(item) {
  Object.assign(form, { userId: item.user.id, plan: item.grant?.plan || 'pro', expiresAt: item.grant?.expiresAt?.slice(0, 10) || '', reason: item.grant?.reason || '' })
}

function replace(updated) {
  items.value = items.value.map(item => (item.user.id === updated.user.id ? updated : item))
  emit('changed', updated)
}

async function grant(item) {
  const body = { plan: form.plan, reason: form.reason, expiresAt: form.expiresAt ? `${form.expiresAt}T23:59:59Z` : null }
  const updated = await run(() => api('PUT', `/api/account/admin/accounts/${encodeURIComponent(item.user.id)}/grant`, body))
  if (updated?.user) { form.userId = ''; replace(updated) }
}

async function revoke(item) {
  const updated = await run(() => api('DELETE', `/api/account/admin/accounts/${encodeURIComponent(item.user.id)}/grant`))
  if (updated?.user) replace(updated)
}
</script>

<style scoped>
.adm-search, .adm-form { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; margin-top: 8px; }
.adm-search input { flex: 1; min-width: 200px; }
.adm-list { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.adm-list li { border: 1px solid var(--border); border-radius: 6px; padding: 6px 10px; }
.adm-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.adm-who { display: flex; flex-direction: column; flex: 1; min-width: 160px; overflow-wrap: anywhere; }
.adm-plan { font-size: 12px; }
.adm-actions { display: flex; gap: 6px; }
.adm-detail { margin: 4px 0 0; font-size: 11px; }
.adm-form label { display: inline-flex; gap: 4px; align-items: center; font-size: 12px; }
</style>
