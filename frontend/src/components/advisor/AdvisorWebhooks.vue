<template>
  <div class="awh" data-test="advisor-webhooks">
    <p v-if="!allowed" class="awh-locked" data-test="advisor-webhooks-locked"><i data-lucide="lock"></i>{{ t('advisorWebhooks.locked') }}</p>

    <ul v-if="webhooks.length" class="awh-list">
      <li v-for="hook in webhooks" :key="hook.id" class="awh-item" :data-test="`advisor-webhook-${hook.id}`">
        <div class="awh-row">
          <strong>{{ hook.name }}</strong>
          <span class="awh-chip">{{ hook.kind === 'slack' ? 'Slack' : 'Teams' }}</span>
          <code class="awh-url">{{ hook.url }}</code>
        </div>
        <div class="awh-row">
          <select :value="hook.minSeverity" :disabled="!allowed || busy" @change="update(hook, { minSeverity: $event.target.value })">
            <option v-for="level in SEVERITIES" :key="level" :value="level">{{ t(`advisorWebhooks.severity.${level}`) }}</option>
          </select>
          <label class="awh-toggle"><input type="checkbox" :checked="hook.enabled" :disabled="!allowed || busy" @change="update(hook, { enabled: $event.target.checked })" /> {{ t('advisorWebhooks.enabled') }}</label>
          <button class="btn sm" :disabled="!allowed || busy" :data-test="`advisor-webhook-test-${hook.id}`" @click="sendTest(hook)">{{ t('advisorWebhooks.test') }}</button>
          <button class="btn sm danger" :disabled="busy" @click="remove(hook)">{{ t('advisorWebhooks.remove') }}</button>
        </div>
        <p v-if="hook.lastError" class="awh-warn">{{ t('advisorWebhooks.lastError', { error: hook.lastError }) }}</p>
        <p v-else-if="hook.lastSentAt" class="awh-dim">{{ t('advisorWebhooks.lastSent', { date: when(hook.lastSentAt) }) }}</p>
      </li>
    </ul>

    <form v-if="allowed" class="awh-form" data-test="advisor-webhook-form" @submit.prevent="add">
      <input v-model="draft.name" class="ctrl-input" maxlength="80" :placeholder="t('advisorWebhooks.name')" required />
      <select v-model="draft.kind" class="ctrl-select">
        <option value="slack">Slack</option>
        <option value="teams">Microsoft Teams</option>
      </select>
      <input v-model="draft.url" class="ctrl-input awh-url-input" type="url" :placeholder="t('advisorWebhooks.url')" required data-test="advisor-webhook-url" />
      <select v-model="draft.minSeverity" class="ctrl-select">
        <option v-for="level in SEVERITIES" :key="level" :value="level">{{ t(`advisorWebhooks.severity.${level}`) }}</option>
      </select>
      <select v-model="draft.lang" class="ctrl-select" :title="t('advisorWebhooks.lang')">
        <option value="en">English</option>
        <option value="es">Español</option>
      </select>
      <button type="submit" class="btn sm primary" :disabled="busy || !draft.name.trim() || !draft.url.trim()">{{ t('advisorWebhooks.add') }}</button>
      <span class="awh-dim awh-hint">{{ t(draft.kind === 'slack' ? 'advisorWebhooks.urlHintSlack' : 'advisorWebhooks.urlHintTeams') }}</span>
    </form>
    <p v-if="message" :class="message.ok ? 'awh-ok' : 'awh-warn'" data-test="advisor-webhooks-message">{{ message.text }}</p>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, onUpdated, reactive, ref } from 'vue'
import { createIcons, icons } from 'lucide'
import { api } from '../../composables/useApi'
import { useI18n } from '../../composables/useI18n'
import { usePlan } from '../../composables/usePlan'
import { settings } from '../../composables/useSettings'

const SEVERITIES = ['high', 'medium', 'all']
const { t } = useI18n()
const { plan } = usePlan()
// Posture alerts come from the Advisor, so webhooks follow its plans: Pro and Team.
const allowed = computed(() => !!plan.value?.features?.advisor)
const webhooks = ref([])
const busy = ref(false)
const message = ref(null)
const draft = reactive({ name: '', kind: 'slack', url: '', minSeverity: 'high', lang: settings.lang === 'es' ? 'es' : 'en' })

const when = iso => new Date(iso).toLocaleString(settings.lang === 'es' ? 'es' : 'en-US', { dateStyle: 'short', timeStyle: 'short' })

async function load() {
  try { webhooks.value = await api('GET', '/api/advisor/webhooks') } catch { webhooks.value = [] }
}

async function run(action, success) {
  busy.value = true
  message.value = null
  try {
    await action()
    if (success) message.value = { ok: true, text: success }
    await load()
  } catch (err) {
    message.value = { ok: false, text: err.message }
  } finally { busy.value = false }
}

const add = () => run(async () => {
  await api('POST', '/api/advisor/webhooks', { ...draft, name: draft.name.trim(), url: draft.url.trim() })
  draft.name = ''
  draft.url = ''
})
const update = (hook, changes) => run(() => api('PATCH', `/api/advisor/webhooks/${hook.id}`, changes))
const remove = hook => run(() => api('DELETE', `/api/advisor/webhooks/${hook.id}`))
const sendTest = hook => run(async () => {
  const result = await api('POST', `/api/advisor/webhooks/${hook.id}/test`)
  if (!result.ok) throw new Error(t('advisorWebhooks.lastError', { error: result.error }))
}, t('advisorWebhooks.testOk'))

const refreshIcons = () => nextTick(() => createIcons({ icons }))
onMounted(() => { load(); refreshIcons() })
onUpdated(refreshIcons)
</script>

<style scoped>
.awh { display: flex; flex-direction: column; gap: 8px; padding: 8px 0; }
.awh-locked { margin: 0; display: flex; gap: 6px; align-items: center; font-size: 12px; color: var(--text-dim); }
.awh-locked svg { width: 14px; height: 14px; }
.awh-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.awh-item { border: 1px solid var(--border); border-radius: 6px; padding: 8px 10px; display: flex; flex-direction: column; gap: 6px; font-size: 12px; }
.awh-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; min-width: 0; }
.awh-row select { font: inherit; font-size: 11px; color: var(--text); background: var(--bg); border: 1px solid var(--border); border-radius: 4px; padding: 2px 4px; }
.awh-chip { font-size: 10px; padding: 1px 6px; border-radius: 3px; border: 1px solid var(--border); color: var(--text-dim); }
.awh-url { font-size: 11px; color: var(--text-dim); overflow-wrap: anywhere; }
.awh-toggle { display: flex; gap: 4px; align-items: center; font-size: 11px; }
.awh-form { display: grid; grid-template-columns: minmax(120px, 1fr) minmax(130px, auto) minmax(200px, 2fr); gap: 6px; align-items: center; }
.awh-form .awh-url-input { min-width: 0; }
.awh-form .btn { justify-self: start; }
.awh-form .awh-hint { grid-column: 1 / -1; }
@media (max-width: 640px) { .awh-form { grid-template-columns: 1fr; } }
.awh-form .ctrl-input, .awh-form .ctrl-select { font-size: 12px; }
.awh-url-input { flex: 1 1 260px; min-width: 0; }
.awh-hint { flex-basis: 100%; }
.awh-dim { margin: 0; font-size: 11px; color: var(--text-dim); }
.awh-warn { margin: 0; font-size: 11px; color: var(--yellow); overflow-wrap: anywhere; }
.awh-ok { margin: 0; font-size: 11px; color: var(--green); }
</style>
