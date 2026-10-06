<template>
  <section class="kuapp-scopes">
    <header class="kuapp-scopes-heading">
      <span><strong>{{ t('kuapps.scopes.title') }}</strong><small>{{ t('kuapps.scopes.hint') }}</small></span>
      <button class="btn sm" :disabled="busy" @click="adding = !adding"><i data-lucide="plus"></i> {{ t('kuapps.scopes.add') }}</button>
    </header>

    <div v-if="attention" class="kuapp-scopes-warning" role="status">
      <i data-lucide="triangle-alert"></i>
      <span>{{ t('kuapps.scopes.bindWarning', { count: attention }) }}</span>
    </div>

    <form v-if="adding" class="kuapp-scope-form" @submit.prevent="addScope">
      <select v-model="draft.provider" :aria-label="t('kuapps.scopes.provider')">
        <option v-for="provider in PROVIDERS" :key="provider" :value="provider">{{ providerName(provider) }}</option>
        <option value="other">{{ t('kuapps.scopes.otherProvider') }}</option>
      </select>
      <input v-if="draft.provider === 'other'" v-model.trim="draft.customProvider" :placeholder="t('kuapps.scopes.providerId')" :aria-label="t('kuapps.scopes.providerId')" />
      <input v-model.trim="draft.scopeId" :placeholder="scopeIdPlaceholder" :aria-label="t('kuapps.scopes.scopeId')" />
      <input v-if="draft.provider !== 'kubernetes'" v-model.trim="draft.location" :placeholder="t('kuapps.scopes.location')" :aria-label="t('kuapps.scopes.location')" />
      <input v-model.trim="draft.label" :placeholder="t('kuapps.scopes.label')" :aria-label="t('kuapps.scopes.label')" />
      <button class="btn sm primary" type="submit" :disabled="busy">{{ t('kuapps.scopes.save') }}</button>
      <button class="btn sm" type="button" @click="adding = false">{{ t('kuapps.scopes.cancel') }}</button>
    </form>

    <p v-if="error" class="kuapp-scopes-error">{{ error }}</p>
    <p v-if="loading && !view" class="kuapp-scopes-empty">{{ t('kuapps.scopes.loading') }}</p>
    <p v-else-if="view && !view.scopes?.length" class="kuapp-scopes-empty">{{ t('kuapps.scopes.empty') }}</p>

    <ul v-if="view?.scopes?.length" class="kuapp-scope-list">
      <li v-for="scope in view.scopes" :key="scope.key" class="kuapp-scope">
        <span class="kuapp-scope-provider">{{ providerName(scope.provider) }}</span>
        <span class="kuapp-scope-name">
          <strong>{{ scope.label || scope.scopeId || t('kuapps.scopes.pendingAccount') }}</strong>
          <small>
            <template v-if="scope.label && scope.scopeId">{{ scope.scopeId }} · </template>{{ scope.location || t('kuapps.scopes.noLocation') }}
          </small>
        </span>
        <span :class="['kuapp-scope-status', statusOf(scope)]" :title="bindingOf(scope)?.lastError || ''">{{ t(`kuapps.scopes.status.${statusOf(scope)}`) }}</span>
        <span class="kuapp-scope-binding">
          <select v-model="selection[scope.key]" :aria-label="t('kuapps.scopes.profile')" :disabled="busy">
            <option value="">{{ t('kuapps.scopes.chooseProfile') }}</option>
            <option v-for="option in profileOptions(scope.provider)" :key="option.id" :value="option.id">{{ option.name }}</option>
          </select>
          <button class="btn sm" :disabled="busy || !selection[scope.key]" @click="bind(scope)">{{ t('kuapps.scopes.bind') }}</button>
          <button v-if="bindingOf(scope)" class="btn sm" :disabled="busy" :title="t('kuapps.scopes.verify')" @click="verify(scope)"><i data-lucide="refresh-cw"></i></button>
          <button v-if="bindingOf(scope)" class="btn sm" :disabled="busy" :title="t('kuapps.scopes.unbind')" @click="unbind(scope)"><i data-lucide="unlink"></i></button>
          <button class="btn sm danger" :disabled="busy" :title="t('kuapps.scopes.remove')" @click="removeScope(scope)"><i data-lucide="trash-2"></i></button>
        </span>
      </li>
    </ul>
  </section>
</template>

<script setup>
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { createIcons, icons } from 'lucide'
import { api } from '../../composables/useApi'
import { useI18n } from '../../composables/useI18n'
import { useEnvStore } from '../../stores/useEnvStore'

// Portable scopes of a KUA Application and the local profile bound to each (#149).
// Bindings stay on this computer; the server verifies them with free reads only.
const props = defineProps({
  applicationId: { type: String, required: true },
})
const emit = defineEmits(['changed'])

const PROVIDERS = ['aws', 'gcp', 'kubernetes', 'vercel']
const { t } = useI18n()
const envStore = useEnvStore()
const view = ref(null)
const loading = ref(false)
const busy = ref(false)
const error = ref('')
const adding = ref(false)
const selection = reactive({})
const draft = reactive({ provider: 'aws', customProvider: '', scopeId: '', location: '', label: '' })
const localProfiles = reactive({ aws: [], gcp: [], kubernetes: [] })
const loadedProviders = new Set()

const attention = computed(() => (view.value?.warnings || []).filter(warning => warning.kind !== 'duplicate_name').length)
const scopeIdPlaceholder = computed(() => t(`kuapps.scopes.scopeIdHint.${PROVIDERS.includes(draft.provider) ? draft.provider : 'other'}`))

function providerName(provider) {
  return { aws: 'AWS', gcp: 'GCP', kubernetes: 'Kubernetes', vercel: 'Vercel' }[provider] || provider
}

function bindingOf(scope) {
  return view.value?.local?.bindings?.find(binding => binding.scopeKey === scope.key) || null
}

function statusOf(scope) {
  return bindingOf(scope)?.status === 'migrated' ? 'unverified' : (bindingOf(scope)?.status || 'unbound')
}

// Profiles this computer has for a provider: stored connections plus local CLI profiles.
function profileOptions(provider) {
  const stored = (Array.isArray(envStore.profiles) ? envStore.profiles : []).filter(profile => profile.provider === provider).map(profile => ({ id: profile.id, name: profile.name }))
  return [...stored, ...(localProfiles[provider] || [])]
}

async function loadProfiles(providers) {
  if (!envStore.profiles.length) await envStore.fetchProfiles?.().catch(() => {})
  for (const provider of providers) {
    if (loadedProviders.has(provider)) continue
    loadedProviders.add(provider)
    try {
      if (provider === 'aws') localProfiles.aws = (await api('GET', '/api/cloud/aws/local-profiles')).map(item => ({ id: `local:${item.name}`, name: `${item.name} (~/.aws)` }))
      if (provider === 'gcp') localProfiles.gcp = (await api('GET', '/api/cloud/gcp/gcloud-configs')).map(item => ({ id: `local:${item.name}`, name: `${item.name} (gcloud)` }))
      if (provider === 'kubernetes') localProfiles.kubernetes = ((await api('GET', '/api/contexts')).contexts || []).map(item => ({ id: item.name, name: item.name }))
    } catch { /* the stored connections are still offered */ }
  }
}

function syncSelection() {
  for (const scope of view.value?.scopes || []) selection[scope.key] = bindingOf(scope)?.profileId || ''
}

async function load() {
  if (!props.applicationId) { view.value = null; return }
  loading.value = true
  try {
    const result = await api('GET', `/api/kua-apps/applications/${encodeURIComponent(props.applicationId)}`)
    view.value = Array.isArray(result?.scopes) ? result : null
    error.value = ''
    syncSelection()
    if (view.value) loadProfiles([...new Set(view.value.scopes.map(scope => scope.provider))])
  } catch (err) {
    error.value = err.message
  } finally {
    loading.value = false
    nextTick(() => createIcons({ icons }))
  }
}

// Writes carry the revision that was read; a newer change is reloaded instead of overwritten.
async function run(work) {
  busy.value = true
  error.value = ''
  try {
    const result = await work()
    view.value = result?.application || (result?.scopes ? result : view.value)
    syncSelection()
    emit('changed', view.value)
  } catch (err) {
    if (err.details?.code === 'REVISION_CONFLICT') { await load(); error.value = t('kuapps.scopes.conflict') }
    else if (err.details?.code === 'SCOPE_IN_USE') error.value = t('kuapps.scopes.inUse')
    else error.value = err.message
  } finally {
    busy.value = false
    nextTick(() => createIcons({ icons }))
  }
}

const base = () => `/api/kua-apps/applications/${encodeURIComponent(props.applicationId)}`
const scopePath = scope => `${base()}/scopes/${encodeURIComponent(scope.key)}`

function addScope() {
  const provider = draft.provider === 'other' ? draft.customProvider.toLowerCase() : draft.provider
  return run(async () => {
    const result = await api('POST', `${base()}/scopes`, {
      provider, scopeId: draft.scopeId, location: draft.provider === 'kubernetes' ? '' : draft.location, label: draft.label,
      expectedRevision: view.value?.revision,
    })
    Object.assign(draft, { customProvider: '', scopeId: '', location: '', label: '' })
    adding.value = false
    loadProfiles([provider])
    return result
  })
}

const bind = scope => run(() => api('PUT', `${scopePath(scope)}/binding`, { profileId: selection[scope.key] }))
const verify = scope => run(() => api('POST', `${scopePath(scope)}/binding/verify`))
const unbind = scope => run(() => api('DELETE', `${scopePath(scope)}/binding`))
function removeScope(scope) {
  if (!confirm(t('kuapps.scopes.confirmRemove', { scope: scope.label || scope.scopeId || providerName(scope.provider) }))) return
  return run(() => api('DELETE', `${scopePath(scope)}?expectedRevision=${view.value?.revision ?? ''}`))
}

watch(() => props.applicationId, load, { immediate: true })
defineExpose({ reload: load })
</script>

<style scoped>
.kuapp-scopes { flex: none; display: flex; flex-direction: column; gap: 8px; padding: 10px 18px; border-bottom: 1px solid var(--border); }
.kuapp-scopes-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.kuapp-scopes-heading > span { display: flex; flex-direction: column; gap: 2px; }
.kuapp-scopes-heading small, .kuapp-scopes-empty { color: var(--text-dim); font-size: 10px; }
.kuapp-scopes-heading svg, .kuapp-scope svg, .kuapp-scopes-warning svg { width: 13px; }
.kuapp-scopes-warning { display: flex; align-items: center; gap: 8px; padding: 7px 10px; border: 1px solid var(--yellow); border-radius: 6px; color: var(--text); font-size: 11px; }
.kuapp-scopes-warning svg { color: var(--yellow); flex: none; }
.kuapp-scopes-error { margin: 0; color: var(--red); font-size: 11px; }
.kuapp-scopes-empty { margin: 0; }
.kuapp-scope-form { display: flex; flex-wrap: wrap; gap: 6px; }
.kuapp-scope-form input, .kuapp-scope-form select, .kuapp-scope-binding select { min-width: 0; height: 26px; padding: 0 7px; border: 1px solid var(--border); border-radius: 5px; background: var(--surface); color: var(--text); font-size: 11px; }
.kuapp-scope-form input { flex: 1 1 120px; }
.kuapp-scope-list { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 4px; }
.kuapp-scope { display: grid; grid-template-columns: 76px minmax(0, 1fr) auto auto; align-items: center; gap: 10px; padding: 6px 8px; border-radius: 6px; background: var(--surface); }
.kuapp-scope-provider { color: var(--accent); font-size: 10px; font-weight: 700; text-transform: uppercase; }
.kuapp-scope-name { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.kuapp-scope-name strong, .kuapp-scope-name small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.kuapp-scope-name small { color: var(--text-dim); font-size: 9px; }
.kuapp-scope-status { padding: 2px 7px; border: 1px solid currentColor; border-radius: 10px; font-size: 9px; white-space: nowrap; }
.kuapp-scope-status.verified { color: var(--green); }
.kuapp-scope-status.unverified, .kuapp-scope-status.unbound { color: var(--yellow); }
.kuapp-scope-status.mismatch { color: var(--red); }
.kuapp-scope-binding { display: flex; align-items: center; gap: 4px; }
.kuapp-scope-binding select { max-width: 190px; }
@media (max-width: 900px) {
  .kuapp-scope { grid-template-columns: 64px minmax(0, 1fr) auto; }
  .kuapp-scope-binding { grid-column: 1 / -1; flex-wrap: wrap; }
}
</style>
