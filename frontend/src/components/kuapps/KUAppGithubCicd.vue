<template>
  <section class="kuapp-github" data-test="github-cicd">
    <header class="kuapp-github-head">
      <h4>{{ t('kuapps.github.title') }}</h4>
      <span v-if="connection" :class="['kuapp-github-chip', { ok: connection.authenticated }]" data-test="github-status">{{ statusLabel }}</span>
    </header>
    <p class="kuapp-github-explain"><strong>{{ t('kuapps.sync.what') }}</strong> {{ t('kuapps.github.explain') }}</p>
    <p v-if="error" class="kuapp-github-error" role="alert">{{ error }}</p>
    <p v-if="connection && !connection.authenticated" class="kuapp-github-error" role="alert" data-test="github-unavailable">{{ t(connection.available ? 'kuapps.github.notLoggedIn' : 'kuapps.github.notInstalled') }}</p>

    <template v-if="connection?.authenticated">
      <div class="kuapp-github-section kuapp-github-sync">
        <span class="kuapp-github-text"><strong>{{ t('kuapps.github.enable') }}</strong><small>{{ t('kuapps.github.enableHint') }}</small></span>
        <label class="kuapp-github-switch">
          <input v-model="enabled" type="checkbox" role="switch" :disabled="busy" :aria-label="t('kuapps.github.enable')" data-test="github-enabled" @change="save" />
          <span class="kuapp-github-track"></span>
        </label>
      </div>

      <div v-if="enabled" class="kuapp-github-section">
        <div class="kuapp-github-subhead"><strong>{{ t('kuapps.github.reposLabel') }}</strong><span class="kuapp-github-chip">{{ selected.length }}</span></div>
        <ul v-if="options.length" class="kuapp-github-list">
          <li v-for="name in options" :key="name">
            <label :class="{ on: selected.includes(name) }">
              <input v-model="selected" type="checkbox" :value="name" :disabled="busy" :data-test="`github-repo-${name}`" @change="save" />
              <span class="kuapp-github-check"><i data-lucide="check"></i></span>
              <span class="kuapp-github-repo">{{ name }}</span>
            </label>
          </li>
        </ul>
        <form class="kuapp-github-add" @submit.prevent="addManual">
          <input v-model.trim="manual" :placeholder="t('kuapps.github.manualPlaceholder')" :aria-label="t('kuapps.github.manualPlaceholder')" data-test="github-manual" />
          <button class="btn sm" type="submit" :disabled="busy || !manual"><i data-lucide="plus"></i>{{ t('kuapps.scopes.add') }}</button>
        </form>
      </div>

      <div v-if="enabled && selected.length && activity" class="kuapp-github-section">
        <div class="kuapp-github-subhead"><strong>{{ t('kuapps.github.recent') }}</strong></div>
        <p v-for="failure in activity.errors" :key="failure.repository" class="kuapp-github-error">{{ t('kuapps.github.repoError', failure) }}</p>
        <p v-if="activity.metrics" class="kuapp-github-metrics" data-test="github-metrics">{{ metricsText }}</p>
        <p v-if="!activity.events.length && !activity.errors.length" class="kuapp-github-pending">{{ t('kuapps.github.none') }}</p>
        <ul v-else-if="activity.events.length" class="kuapp-github-events">
          <li v-for="event in activity.events.slice(0, 6)" :key="event.id">
            <a v-if="event.url" :href="event.url" target="_blank" rel="noopener noreferrer">{{ event.repository }} #{{ event.number }} · {{ event.name }}</a>
            <span v-else>{{ event.repository }} #{{ event.number }} · {{ event.name }}</span>
            <small>{{ [event.conclusion, event.actor && `@${event.actor}`, when(event.at)].filter(Boolean).join(' · ') }}</small>
          </li>
        </ul>
      </div>
    </template>

    <footer class="kuapp-github-section">
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
.kuapp-github { display: grid; gap: 12px; padding: 12px; border: 1px solid var(--border); border-radius: 7px; background: var(--bg-panel); }
.kuapp-github-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.kuapp-github h4 { margin: 0; font-size: 13px; }
.kuapp-github-chip { padding: 2px 8px; border: 1px solid var(--border); border-radius: 10px; color: var(--text-dim); font-size: 12px; white-space: nowrap; }
.kuapp-github-chip.ok { border-color: var(--green); color: var(--green); }
.kuapp-github-explain { margin: 0; padding: 7px 10px; border-left: 3px solid var(--accent); background: color-mix(in srgb, var(--accent) 8%, transparent); color: var(--text-dim); font-size: 12px; line-height: 1.5; }
.kuapp-github-explain strong { color: var(--text); }
.kuapp-github-error { margin: 0; color: var(--red); font-size: 12px; }
.kuapp-github-section { display: grid; gap: 8px; padding-top: 12px; border-top: 1px solid var(--border); }
.kuapp-github-sync { grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 14px; }
.kuapp-github-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; font-size: 13px; }
.kuapp-github-text small, .kuapp-github-pending, .kuapp-github-events small { color: var(--text-dim); font-size: 12px; line-height: 1.5; }
.kuapp-github-switch { position: relative; display: inline-flex; cursor: pointer; flex: none; }
.kuapp-github-switch input { position: absolute; opacity: 0; width: 0; height: 0; }
.kuapp-github-track { position: relative; width: 36px; height: 20px; border-radius: 10px; background: var(--border); transition: background .2s; }
.kuapp-github-track::after { content: ''; position: absolute; top: 3px; left: 3px; width: 14px; height: 14px; border-radius: 50%; background: var(--text-dim); transition: transform .2s, background .2s; }
.kuapp-github-switch input:checked + .kuapp-github-track { background: var(--accent); }
.kuapp-github-switch input:checked + .kuapp-github-track::after { transform: translateX(16px); background: #fff; }
.kuapp-github-switch input:focus-visible + .kuapp-github-track { outline: 1px solid var(--accent); outline-offset: 2px; }
.kuapp-github-switch input:disabled + .kuapp-github-track { opacity: .5; }
.kuapp-github-subhead { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 13px; }
.kuapp-github-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; max-height: 210px; overflow: auto; }
.kuapp-github-list label { display: flex; align-items: center; gap: 10px; padding: 6px 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); cursor: pointer; font-size: 13px; }
.kuapp-github-list label:hover { border-color: var(--accent); }
.kuapp-github-list label.on { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 8%, var(--surface)); }
.kuapp-github-list input { position: absolute; opacity: 0; width: 0; height: 0; }
.kuapp-github-check { flex: none; width: 16px; height: 16px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid var(--border); border-radius: 4px; color: transparent; }
.kuapp-github-list label.on .kuapp-github-check { border-color: var(--accent); background: var(--accent); color: #fff; }
.kuapp-github-list input:focus-visible + .kuapp-github-check { outline: 1px solid var(--accent); outline-offset: 2px; }
.kuapp-github-check svg { width: 11px; height: 11px; }
.kuapp-github-repo { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.kuapp-github-add { display: flex; gap: 6px; }
.kuapp-github-add input { flex: 1; min-width: 0; height: 28px; padding: 0 8px; border: 1px solid var(--border); border-radius: 5px; background: var(--surface); color: var(--text); font-size: 12px; }
.kuapp-github-add input:focus { border-color: var(--accent); outline: 1px solid var(--accent); }
.kuapp-github-metrics { margin: 0; padding: 6px 10px; border-radius: 5px; background: var(--surface); font-size: 12px; }
.kuapp-github-events { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
.kuapp-github-events li { display: flex; flex-direction: column; gap: 1px; padding: 6px 8px; border-radius: 6px; background: var(--surface); font-size: 13px; }
.kuapp-github-events a { color: var(--text); text-decoration: none; overflow-wrap: anywhere; }
.kuapp-github-events a:hover { color: var(--accent); text-decoration: underline; }
.kuapp-github > footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.kuapp-github-pending { margin: 0; }
.kuapp-github svg { width: 13px; }
</style>
