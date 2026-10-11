<template>
  <div class="kuapps-review-group kgh" data-test="github-cicd">
    <div class="kuapps-review-group-heading">
      <strong>{{ t('kuapps.github.title') }}</strong>
      <span>{{ connection.connected ? (connection.login ? t('kuapps.github.connectedAs', { login: connection.login }) : t('kuapps.github.connected')) : t('kuapps.github.notConnected') }}</span>
    </div>
    <p class="kgh-hint">{{ t('kuapps.github.hint') }}</p>
    <p v-if="error" class="kgh-warn" role="alert">{{ error }}</p>

    <form v-if="!connection.connected" class="kgh-row" @submit.prevent="connect">
      <label>{{ t('kuapps.github.tokenLabel') }}
        <input v-model="token" type="password" autocomplete="off" spellcheck="false" data-test="github-token" />
      </label>
      <button class="btn sm primary" type="submit" :disabled="busy || !token.trim()" data-test="github-connect">{{ t('kuapps.github.connect') }}</button>
    </form>
    <template v-else>
      <label class="kgh-repos">{{ t('kuapps.github.reposLabel') }}
        <textarea v-model="reposText" rows="3" spellcheck="false" data-test="github-repos"></textarea>
      </label>
      <div class="kgh-row">
        <button class="btn sm primary" :disabled="busy" data-test="github-save" @click="saveRepositories">{{ t('kuapps.github.saveRepos') }}</button>
        <button class="btn sm" :disabled="busy" data-test="github-disconnect" @click="disconnect">{{ t('kuapps.github.disconnect') }}</button>
      </div>
      <template v-if="activity">
        <p v-for="failure in activity.errors" :key="failure.repository" class="kgh-warn">{{ t('kuapps.github.repoError', failure) }}</p>
        <template v-if="repositories.length">
          <p v-if="activity.metrics" class="kgh-hint" data-test="github-metrics">{{ metricsText }}</p>
          <strong class="kgh-sub">{{ t('kuapps.github.recent') }}</strong>
          <p v-if="!activity.events.length" class="kgh-hint">{{ t('kuapps.github.none') }}</p>
          <ul v-else class="kgh-events">
            <li v-for="event in activity.events.slice(0, 8)" :key="event.id">
              <a v-if="event.url" :href="event.url" target="_blank" rel="noopener noreferrer">{{ event.repository }} #{{ event.number }} · {{ event.name }}</a>
              <span v-else>{{ event.repository }} #{{ event.number }} · {{ event.name }}</span>
              <small>{{ [event.conclusion, event.actor && `@${event.actor}`, when(event.at)].filter(Boolean).join(' · ') }}</small>
            </li>
          </ul>
        </template>
      </template>
    </template>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { api } from '../../composables/useApi'
import { useI18n } from '../../composables/useI18n'
import { useToast } from '../../composables/useToast'
import { settings } from '../../composables/useSettings'

// KUApps → Review: GitHub CI/CD plugin (#238). Read-only; the token never comes back from the server.
const props = defineProps({ applicationId: { type: String, required: true } })
const emit = defineEmits(['changed'])
const { t } = useI18n()
const { toast } = useToast()
const connection = ref({ connected: false, login: null })
const repositories = ref([])
const reposText = ref('')
const activity = ref(null)
const token = ref('')
const busy = ref(false)
const error = ref('')
const base = () => `/api/kua-apps/applications/${encodeURIComponent(props.applicationId)}/github`
const when = iso => (iso ? new Date(iso).toLocaleString(settings.lang === 'es' ? 'es' : 'en-US', { dateStyle: 'short', timeStyle: 'short' }) : '')
const metricsText = computed(() => {
  const metrics = activity.value?.metrics
  return t('kuapps.github.metrics', {
    days: metrics.days, deploys: metrics.deploys, perWeek: metrics.perWeek,
    lead: metrics.leadTimeHours == null ? t('kuapps.github.leadUnknown') : `${metrics.leadTimeHours} h`,
  })
})

async function load() {
  error.value = ''
  try {
    connection.value = await api('GET', '/api/kua-apps/github/connection')
    repositories.value = (await api('GET', `${base()}/repositories`)).repositories || []
    reposText.value = repositories.value.join('\n')
    activity.value = connection.value.connected && repositories.value.length ? await api('GET', `${base()}/activity`) : null
  } catch (err) {
    error.value = err.message
  }
}

async function run(action, message) {
  busy.value = true
  error.value = ''
  try {
    await action()
    if (message) toast(message, 'success')
    await load()
    emit('changed')
  } catch (err) {
    error.value = err.message
  } finally {
    busy.value = false
  }
}

const connect = () => run(async () => {
  await api('PUT', '/api/kua-apps/github/connection', { token: token.value.trim() })
  token.value = ''
})
const disconnect = () => run(() => api('DELETE', '/api/kua-apps/github/connection'))
const saveRepositories = () => run(
  () => api('PUT', `${base()}/repositories`, { repositories: reposText.value.split('\n').map(line => line.trim()).filter(Boolean) }),
  t('kuapps.github.reposSaved'),
)

watch(() => props.applicationId, load, { immediate: true })
</script>

<style scoped>
.kgh-hint { margin: 0 0 6px; font-size: 12px; color: var(--text-dim); }
.kgh-warn { margin: 0 0 6px; font-size: 12px; color: var(--warning, #d97706); }
.kgh-row { display: flex; gap: 8px; align-items: flex-end; flex-wrap: wrap; margin-bottom: 6px; }
.kgh-row label, .kgh-repos { display: flex; flex-direction: column; gap: 4px; font-size: 12px; flex: 1; min-width: 220px; }
.kgh-repos { margin-bottom: 6px; }
.kgh-repos textarea { font-family: var(--mono, monospace); }
.kgh-sub { font-size: 12px; }
.kgh-events { list-style: none; margin: 4px 0 0; padding: 0; display: flex; flex-direction: column; gap: 4px; font-size: 12px; }
.kgh-events li { display: flex; flex-direction: column; }
.kgh-events small { color: var(--text-dim); }
</style>
