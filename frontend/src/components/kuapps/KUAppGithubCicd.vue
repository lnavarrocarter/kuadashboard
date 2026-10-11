<template>
  <section class="kuapp-github" data-test="github-cicd">
    <header>
      <div><h4>{{ t('kuapps.github.title') }}</h4></div>
      <span v-if="connection" :class="['kuapp-github-chip', { ok: connection.authenticated }]" data-test="github-status">{{ statusLabel }}</span>
    </header>
    <p class="kuapp-github-explain"><strong>{{ t('kuapps.sync.what') }}</strong> {{ t('kuapps.github.explain') }}</p>
    <p v-if="error" class="kuapp-github-error" role="alert">{{ error }}</p>
    <p v-if="connection && !connection.authenticated" class="kuapp-github-error" role="alert" data-test="github-unavailable">{{ t(connection.available ? 'kuapps.github.notLoggedIn' : 'kuapps.github.notInstalled') }}</p>

    <template v-if="connection?.authenticated">
      <label class="kuapp-github-toggle">
        <input v-model="enabled" type="checkbox" :disabled="busy" data-test="github-enabled" @change="save" />
        {{ t('kuapps.github.enable') }}
      </label>
      <div v-if="enabled" class="kuapp-github-repos">
        <span class="kuapp-github-label">{{ t('kuapps.github.reposLabel') }}</span>
        <ul v-if="options.length" class="kuapp-github-list">
          <li v-for="name in options" :key="name">
            <label><input v-model="selected" type="checkbox" :value="name" :disabled="busy" :data-test="`github-repo-${name}`" @change="save" /> {{ name }}</label>
          </li>
        </ul>
        <form class="kuapp-github-add" @submit.prevent="addManual">
          <input v-model.trim="manual" :placeholder="t('kuapps.github.manualPlaceholder')" :aria-label="t('kuapps.github.manualPlaceholder')" data-test="github-manual" />
          <button class="btn sm" type="submit" :disabled="busy || !manual"><i data-lucide="plus"></i>{{ t('kuapps.scopes.add') }}</button>
        </form>
      </div>
      <template v-if="enabled && activity">
        <p v-for="failure in activity.errors" :key="failure.repository" class="kuapp-github-error">{{ t('kuapps.github.repoError', failure) }}</p>
        <template v-if="selected.length && !activity.errors.length || activity.events.length">
          <p v-if="activity.metrics" class="kuapp-github-pending" data-test="github-metrics">{{ metricsText }}</p>
          <p v-if="!activity.events.length" class="kuapp-github-pending">{{ t('kuapps.github.none') }}</p>
          <ul v-else class="kuapp-github-events">
            <li v-for="event in activity.events.slice(0, 6)" :key="event.id">
              <a v-if="event.url" :href="event.url" target="_blank" rel="noopener noreferrer">{{ event.repository }} #{{ event.number }} · {{ event.name }}</a>
              <span v-else>{{ event.repository }} #{{ event.number }} · {{ event.name }}</span>
              <small>{{ [event.conclusion, event.actor && `@${event.actor}`, when(event.at)].filter(Boolean).join(' · ') }}</small>
            </li>
          </ul>
        </template>
      </template>
    </template>
    <footer>
      <span class="kuapp-github-pending">{{ t('kuapps.github.readOnly') }}</span>
      <button class="btn sm" :disabled="busy" data-test="github-refresh" @click="load(true)"><i :data-lucide="busy ? 'loader-2' : 'refresh-cw'"></i>{{ t('kuapps.github.recheck') }}</button>
    </footer>
  </section>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { createIcons, icons } from 'lucide'
import { api } from '../../composables/useApi'
import { useI18n } from '../../composables/useI18n'
import { settings } from '../../composables/useSettings'

// KUApps → Settings → Sync: whether this application syncs with GitHub (#238), and which
// repositories. It uses the GitHub CLI already logged in on this computer: no token is asked or kept.
const props = defineProps({ applicationId: { type: String, required: true } })
const emit = defineEmits(['changed'])
const { t } = useI18n()
const connection = ref(null)
const enabled = ref(false)
const selected = ref([])
const available = ref([])
const activity = ref(null)
const manual = ref('')
const busy = ref(false)
const error = ref('')
const base = () => `/api/kua-apps/applications/${encodeURIComponent(props.applicationId)}/github`
const when = iso => (iso ? new Date(iso).toLocaleString(settings.lang === 'es' ? 'es' : 'en-US', { dateStyle: 'short', timeStyle: 'short' }) : '')
const options = computed(() => [...new Set([...selected.value, ...available.value])].sort((a, b) => a.localeCompare(b)))
const statusLabel = computed(() => (connection.value?.authenticated
  ? t('kuapps.github.connectedAs', { login: connection.value.login || '—' })
  : t(connection.value?.available ? 'kuapps.github.notLoggedInShort' : 'kuapps.github.notInstalledShort')))
const metricsText = computed(() => {
  const metrics = activity.value?.metrics
  return t('kuapps.github.metrics', {
    days: metrics.days, deploys: metrics.deploys, perWeek: metrics.perWeek,
    lead: metrics.leadTimeHours == null ? t('kuapps.github.leadUnknown') : `${metrics.leadTimeHours} h`,
  })
})

async function load(refresh = false) {
  busy.value = true
  error.value = ''
  try {
    connection.value = await api('GET', `/api/kua-apps/github/connection${refresh ? '?refresh=true' : ''}`)
    const current = await api('GET', base())
    enabled.value = current.enabled
    selected.value = current.repositories
    if (connection.value.authenticated) {
      available.value = (await api('GET', '/api/kua-apps/github/repositories').catch(() => ({ repositories: [] }))).repositories
      activity.value = enabled.value && selected.value.length ? await api('GET', `${base()}/activity${refresh ? '?refresh=true' : ''}`) : null
    }
  } catch (err) {
    error.value = err.message
  } finally {
    busy.value = false
    nextTick(() => createIcons({ icons }))
  }
}

async function save() {
  busy.value = true
  error.value = ''
  try {
    const result = await api('PUT', base(), { enabled: enabled.value, repositories: selected.value })
    enabled.value = result.enabled
    selected.value = result.repositories
    activity.value = enabled.value && selected.value.length ? await api('GET', `${base()}/activity`) : null
    emit('changed')
  } catch (err) {
    error.value = err.message
    const current = await api('GET', base()).catch(() => null)
    if (current) { enabled.value = current.enabled; selected.value = current.repositories }
  } finally {
    busy.value = false
  }
}

async function addManual() {
  if (!selected.value.includes(manual.value)) selected.value = [...selected.value, manual.value]
  manual.value = ''
  await save()
}

watch(() => props.applicationId, () => load(), { immediate: true })
</script>

<style scoped>
.kuapp-github { display: grid; gap: 8px; padding: 12px; border: 1px solid var(--border); border-radius: 7px; background: var(--bg-panel); }
.kuapp-github > header { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.kuapp-github h4 { margin: 0; font-size: 13px; }
.kuapp-github-chip { padding: 2px 8px; border: 1px solid var(--border); border-radius: 10px; color: var(--text-dim); font-size: 12px; white-space: nowrap; }
.kuapp-github-chip.ok { border-color: var(--green); color: var(--green); }
.kuapp-github-explain { margin: 0; padding: 7px 10px; border-left: 3px solid var(--accent); background: color-mix(in srgb, var(--accent) 8%, transparent); color: var(--text-dim); font-size: 12px; line-height: 1.5; }
.kuapp-github-explain strong { color: var(--text); }
.kuapp-github-error { margin: 0; color: var(--red); font-size: 12px; }
.kuapp-github-toggle { display: flex; align-items: center; gap: 6px; font-size: 13px; }
.kuapp-github-toggle input, .kuapp-github-list input { width: 14px; height: 14px; margin: 0; }
.kuapp-github-repos { display: grid; gap: 6px; }
.kuapp-github-label { color: var(--text-dim); font-size: 12px; }
.kuapp-github-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; max-height: 200px; overflow: auto; }
.kuapp-github-list label { display: flex; align-items: center; gap: 6px; padding: 4px 6px; border-radius: 4px; font-size: 13px; }
.kuapp-github-list label:hover { background: color-mix(in srgb, var(--accent) 8%, transparent); }
.kuapp-github-add { display: flex; gap: 6px; }
.kuapp-github-add input { flex: 1; min-width: 0; height: 26px; padding: 0 7px; border: 1px solid var(--border); border-radius: 5px; background: var(--surface); color: var(--text); font-size: 12px; }
.kuapp-github-events { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; font-size: 13px; }
.kuapp-github-events li { display: flex; justify-content: space-between; gap: 8px; }
.kuapp-github-events small, .kuapp-github-pending { color: var(--text-dim); font-size: 12px; }
.kuapp-github-pending { margin: 0 auto 0 0; }
.kuapp-github > footer { display: flex; align-items: center; gap: 8px; }
.kuapp-github svg { width: 13px; }
</style>
