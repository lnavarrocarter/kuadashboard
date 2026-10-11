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
        <div class="kuapp-github-subhead"><strong>{{ t('kuapps.github.reposLabel') }}</strong><span class="kuapp-github-chip">{{ selected.length + discovered.length }}</span></div>
        <p v-if="!selected.length && !discovered.length" class="kuapp-github-pending">{{ t('kuapps.github.noneSelected') }}</p>
        <div v-if="discovered.length" class="kuapp-github-group" data-test="github-discovered">
          <span class="kuapp-github-owner">{{ t('kuapps.github.discovered') }}</span>
          <ul class="kuapp-github-list">
            <li v-for="item in discovered" :key="item.repository" class="on" :data-test="`github-discovered-${item.repository}`">
              <span class="kuapp-github-repo">{{ item.repository }}</span>
              <span class="kuapp-github-chip">{{ t(`kuapps.github.source.${item.source}`) }}</span>
            </li>
          </ul>
          <small class="kuapp-github-pending">{{ t('kuapps.github.discoveredHint') }}</small>
        </div>
        <div v-for="group in selectedGroups" :key="group.owner" class="kuapp-github-group" data-test="github-selected">
          <span v-if="selectedGroups.length > 1" class="kuapp-github-owner">{{ group.owner }}</span>
          <ul class="kuapp-github-list">
            <li v-for="name in group.names" :key="name" class="on">
              <span class="kuapp-github-repo">{{ selectedGroups.length > 1 ? name.split('/')[1] : name }}</span>
              <button class="kuapp-github-remove" type="button" :disabled="busy" :aria-label="t('kuapps.github.remove', { name })" :data-test="`github-remove-${name}`" @click="remove(name)"><i data-lucide="x"></i></button>
            </li>
          </ul>
        </div>

        <div class="kuapp-github-search">
          <input v-model.trim="manual" :placeholder="t('kuapps.github.searchPlaceholder')" :aria-label="t('kuapps.github.searchPlaceholder')" autocomplete="off" data-test="github-manual" @input="onSearch" @keydown.enter.prevent="addManual" />
          <ul v-if="manual.length >= 3 && (suggestions.length || searching)" class="kuapp-github-suggest" data-test="github-suggestions">
            <li v-if="searching" class="kuapp-github-pending">{{ t('kuapps.github.searching') }}</li>
            <li v-for="name in suggestions" :key="name"><button type="button" :data-test="`github-suggest-${name}`" @click="add(name)"><i data-lucide="plus"></i>{{ name }}</button></li>
          </ul>
          <p v-else-if="manual.length > 0 && manual.length < 3" class="kuapp-github-pending">{{ t('kuapps.github.minLetters') }}</p>
        </div>

        <button v-if="!browsing" class="btn sm" type="button" :disabled="busy" data-test="github-browse" @click="browse"><i data-lucide="folder-search"></i>{{ t('kuapps.github.browse') }}</button>
        <div v-else class="kuapp-github-browse" data-test="github-browser">
          <label class="kuapp-github-owner-pick">{{ t('kuapps.github.owner') }}
            <select v-model="owner" :disabled="busy" data-test="github-owner" @change="loadOwner">
              <option value="" disabled>{{ t('kuapps.github.pickOwner') }}</option>
              <option v-for="item in owners" :key="item" :value="item">{{ item }}</option>
            </select>
          </label>
          <ul v-if="ownerRepos.length" class="kuapp-github-list kuapp-github-scroll">
            <li v-for="name in ownerRepos" :key="name" :class="{ on: selected.includes(name) }">
              <button type="button" class="kuapp-github-pick" :disabled="busy" :data-test="`github-repo-${name}`" @click="toggle(name)">
                <span class="kuapp-github-check"><i data-lucide="check"></i></span>
                <span class="kuapp-github-repo">{{ name.split('/')[1] }}</span>
              </button>
            </li>
          </ul>
          <p v-else-if="owner && !busy" class="kuapp-github-pending">{{ t('kuapps.github.noRepos') }}</p>
          <button class="btn sm" type="button" data-test="github-browse-close" @click="browsing = false">{{ t('kuapps.github.closeList') }}</button>
        </div>
      </div>

      <div v-if="enabled && (selected.length || discovered.length) && activity" class="kuapp-github-section">
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
const discovered = ref([])
const owners = ref([])
const owner = ref('')
const ownerRepos = ref([])
const browsing = ref(false)
const suggestions = ref([])
const searching = ref(false)
let searchTimer = null
let searchSeq = 0
const activity = ref(null)
const manual = ref('')
const busy = ref(false)
const error = ref('')
const base = () => `/api/kua-apps/applications/${encodeURIComponent(props.applicationId)}/github`
const when = iso => (iso ? new Date(iso).toLocaleString(settings.lang === 'es' ? 'es' : 'en-US', { dateStyle: 'short', timeStyle: 'short' }) : '')
const selectedGroups = computed(() => {
  const groups = new Map()
  for (const name of [...selected.value].sort((a, b) => a.localeCompare(b))) {
    const key = name.split('/')[0]
    groups.set(key, [...(groups.get(key) || []), name])
  }
  return [...groups].map(([ownerName, names]) => ({ owner: ownerName, names }))
})
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
    discovered.value = current.discovered || []
    if (connection.value.authenticated) {
      activity.value = enabled.value && (selected.value.length || discovered.value.length) ? await api('GET', `${base()}/activity${refresh ? '?refresh=true' : ''}`) : null
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
    discovered.value = result.discovered || []
    activity.value = enabled.value && (selected.value.length || discovered.value.length) ? await api('GET', `${base()}/activity`) : null
    emit('changed')
  } catch (err) {
    error.value = err.message
    const current = await api('GET', base()).catch(() => null)
    if (current) { enabled.value = current.enabled; selected.value = current.repositories }
  } finally {
    busy.value = false
  }
}

async function add(name) {
  if (!selected.value.includes(name)) selected.value = [...selected.value, name]
  manual.value = ''
  suggestions.value = []
  await save()
  nextTick(() => createIcons({ icons }))
}

const addManual = () => (/^[\w.-]+\/[\w.-]+$/.test(manual.value) ? add(manual.value) : undefined)

async function remove(name) {
  selected.value = selected.value.filter(item => item !== name)
  await save()
  nextTick(() => createIcons({ icons }))
}

const toggle = name => (selected.value.includes(name) ? remove(name) : add(name))

// Autocomplete from 3 letters, debounced; only the latest answer is shown.
function onSearch() {
  clearTimeout(searchTimer)
  suggestions.value = []
  if (manual.value.length < 3) { searching.value = false; return }
  searching.value = true
  const seq = ++searchSeq
  searchTimer = setTimeout(async () => {
    try {
      const result = await api('GET', `/api/kua-apps/github/repositories?q=${encodeURIComponent(manual.value)}`)
      if (seq === searchSeq) suggestions.value = result.repositories.filter(name => !selected.value.includes(name)).slice(0, 8)
    } catch { if (seq === searchSeq) suggestions.value = [] } finally {
      if (seq === searchSeq) { searching.value = false; nextTick(() => createIcons({ icons })) }
    }
  }, 250)
}

// The repository list is only fetched when asked, one owner (account or organization) at a time.
async function browse() {
  browsing.value = true
  busy.value = true
  try {
    owners.value = (await api('GET', '/api/kua-apps/github/owners')).owners
    if (owners.value.length === 1) { owner.value = owners.value[0]; await loadOwner() }
  } catch (err) { error.value = err.message; browsing.value = false } finally { busy.value = false; nextTick(() => createIcons({ icons })) }
}

async function loadOwner() {
  busy.value = true
  ownerRepos.value = []
  try {
    ownerRepos.value = (await api('GET', `/api/kua-apps/github/repositories?owner=${encodeURIComponent(owner.value)}`)).repositories
  } catch (err) { error.value = err.message } finally { busy.value = false; nextTick(() => createIcons({ icons })) }
}

watch(() => props.applicationId, () => { browsing.value = false; ownerRepos.value = []; load() }, { immediate: true })
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
.kuapp-github-group { display: grid; gap: 4px; }
.kuapp-github-owner { color: var(--text-dim); font-size: 11px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; }
.kuapp-github-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
.kuapp-github-scroll { max-height: 210px; overflow: auto; }
.kuapp-github-list li { display: flex; align-items: center; gap: 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); font-size: 13px; }
.kuapp-github-list li:hover { border-color: var(--accent); }
.kuapp-github-list li.on { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 8%, var(--surface)); }
.kuapp-github-list li > .kuapp-github-repo { padding: 6px 8px; flex: 1; }
.kuapp-github-pick { flex: 1; display: flex; align-items: center; gap: 10px; padding: 6px 8px; border: 0; background: none; color: var(--text); font: inherit; text-align: left; cursor: pointer; min-width: 0; }
.kuapp-github-check { flex: none; width: 16px; height: 16px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid var(--border); border-radius: 4px; color: transparent; }
.kuapp-github-list li.on .kuapp-github-check { border-color: var(--accent); background: var(--accent); color: #fff; }
.kuapp-github-check svg { width: 11px; height: 11px; }
.kuapp-github-repo { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.kuapp-github-list li > .kuapp-github-chip { margin-right: 8px; }
.kuapp-github-remove { border: 0; background: none; color: var(--text-dim); padding: 6px 8px; cursor: pointer; }
.kuapp-github-remove:hover { color: var(--red); }
.kuapp-github-search { position: relative; display: grid; gap: 4px; }
.kuapp-github-search input, .kuapp-github-owner-pick select { height: 28px; padding: 0 8px; border: 1px solid var(--border); border-radius: 5px; background: var(--surface); color: var(--text); font-size: 12px; min-width: 0; }
.kuapp-github-search input:focus, .kuapp-github-owner-pick select:focus { border-color: var(--accent); outline: 1px solid var(--accent); }
.kuapp-github-suggest { position: absolute; top: 30px; left: 0; right: 0; z-index: 5; list-style: none; margin: 0; padding: 4px; display: grid; gap: 2px; max-height: 220px; overflow: auto; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-panel); box-shadow: 0 6px 18px rgba(0, 0, 0, .25); }
.kuapp-github-suggest button { display: flex; align-items: center; gap: 8px; width: 100%; padding: 5px 8px; border: 0; border-radius: 4px; background: none; color: var(--text); font: inherit; font-size: 13px; text-align: left; cursor: pointer; }
.kuapp-github-suggest button:hover { background: color-mix(in srgb, var(--accent) 12%, transparent); }
.kuapp-github-browse { display: grid; gap: 8px; padding: 8px; border: 1px dashed var(--border); border-radius: 6px; }
.kuapp-github-owner-pick { display: grid; gap: 4px; color: var(--text-dim); font-size: 12px; }
.kuapp-github-metrics { margin: 0; padding: 6px 10px; border-radius: 5px; background: var(--surface); font-size: 12px; }
.kuapp-github-events { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
.kuapp-github-events li { display: flex; flex-direction: column; gap: 1px; padding: 6px 8px; border-radius: 6px; background: var(--surface); font-size: 13px; }
.kuapp-github-events a { color: var(--text); text-decoration: none; overflow-wrap: anywhere; }
.kuapp-github-events a:hover { color: var(--accent); text-decoration: underline; }
.kuapp-github > footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.kuapp-github-pending { margin: 0; }
.kuapp-github svg { width: 13px; }
</style>
