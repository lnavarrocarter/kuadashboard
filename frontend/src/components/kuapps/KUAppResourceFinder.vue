<template>
  <div class="kfind" data-test="kuapps-finder">
    <div class="kfind-tabs" role="tablist" :aria-label="t('kuapps.find.title')">
      <button v-for="tab in TABS" :key="tab" role="tab" :aria-selected="mode === tab" :class="['btn', 'sm', { primary: mode === tab }]" :data-test="`kuapps-find-tab-${tab}`" @click="setMode(tab)">
        {{ t(`kuapps.find.tab.${tab}`) }}<span v-if="tab === 'recommended' && suggestions.length" class="kfind-count">{{ suggestions.length }}</span>
      </button>
    </div>

    <!-- ── Recommended: related resources, with their evidence ── -->
    <section v-if="mode === 'recommended'" class="kfind-body">
      <p class="kfind-hint">{{ t('kuapps.find.recommendedHint') }}</p>
      <div v-if="loadingSuggestions" class="empty-row">{{ t('state.loading') }}</div>
      <div v-else-if="suggestionsError" class="activity-notice">{{ suggestionsError }}</div>
      <div v-else-if="!suggestions.length" class="empty-row" data-test="kuapps-find-no-suggestions">{{ t('kuapps.find.noSuggestions') }}</div>
      <ul v-else class="kfind-list">
        <li v-for="item in suggestions" :key="item.identityKey" :class="{ 'kfind-released': item.note === 'released' }" data-test="kuapps-find-suggestion">
          <label>
            <input type="checkbox" :checked="selected.has(keyOf(item.resource))" @change="toggle(item.resource)" />
            <span class="kfind-main">
              <strong>{{ item.resource.name }}</strong>
              <span class="kfind-type">{{ typeLabel(item.resource) }}</span>
              <span class="kfind-confidence" :title="t('kuapps.find.confidence')">{{ Math.round(item.confidence * 100) }}%</span>
              <span v-if="item.note === 'released'" class="kfind-chip warn" :title="t('kuapps.find.releasedHint')">{{ t('kuapps.find.released') }}</span>
            </span>
            <span class="kfind-evidence">{{ item.evidence.map(evidenceText).join(' · ') }}</span>
          </label>
          <button class="btn sm" :title="t('kuapps.find.dismissHint')" @click="dismiss(item)">{{ t('kuapps.find.dismiss') }}</button>
        </li>
      </ul>
      <p v-if="suggestionFailures.length" class="kfind-failures">{{ t('kuapps.find.failures', { list: suggestionFailures.map(item => `${item.source} (${item.code})`).join(', ') }) }}</p>
    </section>

    <!-- ── Search the account: catalog by type, text, ARN or full name ── -->
    <section v-else-if="mode === 'search'" class="kfind-body">
      <div class="kfind-form">
        <label>{{ t('kuapps.find.provider') }}
          <select v-model="provider" class="ctrl-select" data-test="kuapps-find-provider" @change="onProviderChange">
            <option v-for="value in PROVIDERS" :key="value" :value="value">{{ PROVIDER_LABELS[value] }}</option>
          </select>
        </label>
        <label v-if="provider !== 'kubernetes'">{{ t('kuapps.find.profile') }}
          <select v-model="profile" class="ctrl-select" data-test="kuapps-find-profile">
            <option value="">{{ t('kuapps.find.chooseProfile') }}</option>
            <option v-for="item in profilesOf(provider)" :key="item.id" :value="item.id">{{ item.name }}</option>
          </select>
        </label>
        <label v-else>{{ t('kuapps.find.context') }}
          <select v-model="context" class="ctrl-select" data-test="kuapps-find-context">
            <option value="">{{ t('kuapps.find.chooseContext') }}</option>
            <option v-for="item in contexts" :key="item.id" :value="item.id">{{ item.name }}</option>
          </select>
        </label>
        <label>{{ t('kuapps.find.type') }}
          <select v-model="type" class="ctrl-select" data-test="kuapps-find-type">
            <option value="">{{ t('kuapps.find.allTypes') }}</option>
            <option v-for="item in types" :key="item.type" :value="item.type">{{ item.label || item.kind || item.type }}</option>
          </select>
        </label>
        <label class="kfind-grow">{{ t('kuapps.find.search') }}
          <input v-model.trim="query" class="ctrl-input" :placeholder="searchPlaceholder" data-test="kuapps-find-query" @keydown.enter="search()" />
        </label>
        <button class="btn sm primary" :disabled="!canSearch || searching" data-test="kuapps-find-search" @click="search()">{{ searching ? t('kuapps.find.searching') : t('kuapps.find.searchAction') }}</button>
      </div>
      <p class="kfind-hint">{{ t('kuapps.find.searchHint') }}</p>
      <div v-if="searchError" class="activity-notice">{{ searchError }}</div>
      <p v-if="result?.arn || result?.name" class="kfind-hint">{{ result.found ? t('kuapps.find.found') : t('kuapps.find.notFound') }}</p>
      <ul v-if="items.length" class="kfind-list" data-test="kuapps-find-results">
        <li v-for="item in items" :key="keyOf(item.attach)">
          <label>
            <input type="checkbox" :checked="selected.has(keyOf(item.attach))" @change="toggle(item.attach)" />
            <span class="kfind-main">
              <strong>{{ item.name }}</strong>
              <span class="kfind-type">{{ typeLabel(item.attach, item) }}</span>
              <span v-if="item.namespace" class="kfind-type">{{ item.namespace }}</span>
              <span v-if="item.region || item.location" class="kfind-type">{{ item.region || item.location }}</span>
            </span>
            <span class="kfind-evidence mono-xs">{{ item.arn || item.key }}</span>
          </label>
        </li>
      </ul>
      <div v-else-if="result && !searching" class="empty-row">{{ t('kuapps.find.noResults') }}</div>
      <div v-if="result" class="kfind-more">
        <span class="kfind-hint">{{ t('kuapps.find.showing', { shown: items.length, total: result.total }) }}</span>
        <button v-if="result.nextCursor" class="btn sm" :disabled="searching" @click="search(result.nextCursor)">{{ t('kuapps.find.more') }}</button>
      </div>
      <p v-if="result?.failures?.length" class="kfind-failures">{{ t('kuapps.find.failures', { list: result.failures.map(item => `${item.type} (${item.code})`).join(', ') }) }}</p>
    </section>

    <footer v-if="mode !== 'map'" class="kfind-footer">
      <span>{{ t('kuapps.find.selected', { count: selected.size }) }}</span>
      <button class="btn sm primary" :disabled="!selected.size || attaching" data-test="kuapps-find-attach" @click="attach">
        {{ attaching ? t('kuapps.find.attaching') : t('kuapps.find.attach', { count: selected.size }) }}
      </button>
    </footer>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useApi } from '../../composables/useApi'
import { useI18n } from '../../composables/useI18n'
import { useToast } from '../../composables/useToast'

const props = defineProps({
  applicationId: { type: String, required: true },
  // The profile and provider the add panel already chose (a verified scope or the application's own).
  profileId: { type: String, default: '' },
  profileProvider: { type: String, default: '' },
  kubeContext: { type: String, default: '' },
  // recommended | search | map: the map when the panel was opened from the Map.
  initialMode: { type: String, default: 'recommended' },
})
const emit = defineEmits(['attached', 'mode'])
const { t } = useI18n()
const { apiFetch } = useApi()
const { toast } = useToast()

const TABS = ['recommended', 'search', 'map']
const PROVIDERS = ['aws', 'gcp', 'kubernetes']
const PROVIDER_LABELS = { aws: 'AWS', gcp: 'GCP', kubernetes: 'Kubernetes' }
const mode = ref(TABS.includes(props.initialMode) ? props.initialMode : 'recommended')

// Selected resources by identity, ready for the attach request.
const selection = reactive(new Map())
const selected = computed(() => selection)
const keyOf = resource => `${resource.provider}|${resource.type}|${resource.kind || ''}|${resource.key}`
function toggle(resource) {
  const key = keyOf(resource)
  if (selection.has(key)) selection.delete(key)
  else selection.set(key, resource)
}

function setMode(next) {
  mode.value = next
  emit('mode', next)
  if (next === 'search' && !types.value.length) loadTypes()
}

// ── Recommendations ──
const suggestions = ref([])
const suggestionFailures = ref([])
const suggestionsError = ref('')
const loadingSuggestions = ref(false)
async function loadSuggestions() {
  loadingSuggestions.value = true
  suggestionsError.value = ''
  try {
    const data = await apiFetch(`/api/kua-apps/applications/${encodeURIComponent(props.applicationId)}/recommendations`)
    suggestions.value = data.suggestions || []
    suggestionFailures.value = data.failures || []
    if (!suggestions.value.length && mode.value === 'recommended') setMode('search')
  } catch (error) {
    suggestionsError.value = error.message
  } finally { loadingSuggestions.value = false }
}
async function dismiss(item) {
  try {
    await apiFetch(`/api/kua-apps/applications/${encodeURIComponent(props.applicationId)}/recommendations/dismiss`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identityKey: item.identityKey }),
    })
    selection.delete(keyOf(item.resource))
    suggestions.value = suggestions.value.filter(suggestion => suggestion.identityKey !== item.identityKey)
  } catch (error) { toast(error.message, 'error') }
}
const EVIDENCE = new Set(['asl_reference', 'lambda_environment_variable', 'elb_target_group', 'target_group_target', 'ec2_attachment', 'eks_context', 'kubernetes_node', 'workload_volume', 'pvc_binding', 'csi_volume', 'released_volume'])
function evidenceText(evidence) {
  return EVIDENCE.has(evidence.type) ? t(`kuapps.find.ev.${evidence.type}`, { from: evidence.from || '', variable: evidence.variable || '', state: evidence.statePath || '' }) : evidence.type
}

// ── Catalog search ──
const provider = ref(PROVIDERS.includes(props.profileProvider) ? props.profileProvider : 'aws')
const profile = ref(props.profileId || '')
const context = ref(props.kubeContext || '')
const type = ref('')
const query = ref('')
const types = ref([])
const profiles = ref([])
const contexts = ref([])
const result = ref(null)
const items = ref([])
const searching = ref(false)
const searchError = ref('')

const profilesOf = value => profiles.value.filter(item => item.provider === value)
const canSearch = computed(() => (provider.value === 'kubernetes' ? !!context.value : !!profile.value))
const searchPlaceholder = computed(() => t(`kuapps.find.placeholder.${provider.value}`))

async function loadTypes() {
  try { types.value = (await apiFetch(`/api/kua-apps/catalog/${provider.value}/types`)).types || [] } catch { types.value = [] }
}
async function loadProfiles() {
  const [stored, awsLocal, gcpLocal, kube] = await Promise.all([
    apiFetch('/api/cloud/envs/profiles').catch(() => []),
    apiFetch('/api/cloud/aws/local-profiles').catch(() => []),
    apiFetch('/api/cloud/gcp/gcloud-configs').catch(() => []),
    apiFetch('/api/architecture/kubernetes/contexts').catch(() => ({ contexts: [] })),
  ])
  profiles.value = [
    ...(Array.isArray(stored) ? stored : []).filter(item => ['aws', 'gcp'].includes(item.provider)).map(item => ({ id: item.id, name: item.name, provider: item.provider })),
    ...(Array.isArray(awsLocal) ? awsLocal : []).map(item => ({ id: `local:${item.name}`, name: `${item.name} (CLI)`, provider: 'aws' })),
    ...(Array.isArray(gcpLocal) ? gcpLocal : []).map(item => ({ id: `local:${item.name}`, name: `${item.name} (gcloud)`, provider: 'gcp' })),
  ]
  contexts.value = kube?.contexts || []
}
function onProviderChange() {
  type.value = ''
  result.value = null
  items.value = []
  if (!profilesOf(provider.value).some(item => item.id === profile.value)) profile.value = provider.value === props.profileProvider ? props.profileId : ''
  loadTypes()
}

async function search(cursor = null) {
  if (!canSearch.value) return
  searching.value = true
  searchError.value = ''
  try {
    const params = new URLSearchParams()
    if (cursor) params.set('cursor', cursor)
    if (provider.value === 'kubernetes') params.set('context', context.value)
    else params.set('profile', profile.value)
    if (!cursor) {
      if (type.value) params.set('types', type.value)
      const text = query.value
      // A pasted ARN or full resource name resolves one resource; anything else filters by text.
      if (provider.value === 'aws' && text.startsWith('arn:')) params.set('arn', text)
      else if (provider.value === 'gcp' && /^(\/\/[^/]+\/)?projects\//.test(text)) params.set('name', text)
      else if (text) params.set('search', text)
    }
    const data = await apiFetch(`/api/kua-apps/catalog/${provider.value}?${params}`)
    result.value = data
    items.value = cursor ? [...items.value, ...(data.items || [])] : (data.items || [])
  } catch (error) {
    searchError.value = error.message
  } finally { searching.value = false }
}

function typeLabel(resource, item = null) {
  if (resource.provider === 'kubernetes') return resource.kind || item?.kind || 'Kubernetes'
  return resource.type
}

// ── Attach the selection ──
const attaching = ref(false)
async function attach() {
  attaching.value = true
  try {
    const data = await apiFetch(`/api/kua-apps/applications/${encodeURIComponent(props.applicationId)}/resources/attach`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resources: [...selection.values()] }),
    })
    const added = data.items.filter(item => item.outcome === 'attached').length
    const failed = data.items.filter(item => item.outcome === 'failed')
    toast(t('kuapps.find.attached', { count: added, scopes: data.scopesAdded?.length || 0 }), failed.length ? 'warn' : 'success')
    if (failed.length) toast(t('kuapps.find.attachFailed', { list: failed.map(item => `${item.name}: ${item.error}`).join('; ') }), 'error')
    selection.clear()
    emit('attached', data)
    loadSuggestions()
  } catch (error) {
    toast(error.message, 'error')
  } finally { attaching.value = false }
}

watch(() => props.applicationId, () => { selection.clear(); loadSuggestions() })
onMounted(() => { loadSuggestions(); loadProfiles(); loadTypes() })
defineExpose({ mode, setMode })
</script>

<style scoped>
.kfind { display: flex; flex-direction: column; gap: 10px; min-height: 0; }
.kfind-tabs { display: flex; gap: 6px; flex-wrap: wrap; }
.kfind-count { margin-left: 6px; padding: 0 6px; border-radius: 999px; background: var(--bg-soft, rgba(127, 127, 127, .2)); font-size: 11px; }
.kfind-body { display: flex; flex-direction: column; gap: 8px; min-height: 0; overflow: auto; }
.kfind-hint { color: var(--text-dim); font-size: 12px; margin: 0; }
.kfind-form { display: flex; gap: 8px; flex-wrap: wrap; align-items: flex-end; }
.kfind-form label { display: flex; flex-direction: column; gap: 3px; font-size: 12px; color: var(--text-dim); }
.kfind-grow { flex: 1 1 200px; }
.kfind-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.kfind-list li { display: flex; gap: 8px; align-items: flex-start; justify-content: space-between; padding: 6px 8px; border: 1px solid var(--border); border-radius: 6px; }
.kfind-list label { display: grid; grid-template-columns: auto 1fr; gap: 2px 8px; cursor: pointer; min-width: 0; flex: 1; }
.kfind-list input { grid-row: span 2; margin-top: 3px; }
.kfind-main { display: flex; gap: 6px; align-items: baseline; flex-wrap: wrap; min-width: 0; }
.kfind-type { color: var(--text-dim); font-size: 11px; }
.kfind-confidence { font-size: 11px; color: var(--text-dim); }
.kfind-evidence { color: var(--text-dim); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.kfind-chip { font-size: 10px; padding: 0 6px; border-radius: 4px; border: 1px solid var(--border); }
.kfind-chip.warn, .kfind-released .kfind-main strong { color: var(--warn, #d29922); }
.kfind-failures { color: var(--warn, #d29922); font-size: 12px; margin: 0; }
.kfind-more { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.kfind-footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding-top: 8px; border-top: 1px solid var(--border); }
</style>
