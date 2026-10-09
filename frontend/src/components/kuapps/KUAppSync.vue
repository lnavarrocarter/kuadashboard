<template>
  <section class="kuapp-sync">
    <header>
      <div><h4>{{ t('kuapps.sync.joinTitle') }}</h4></div>
      <span v-if="status?.lastSuccessAt" class="kuapp-sync-chip ok" data-test="sync-last">{{ t('kuapps.sync.lastRun', { date: new Date(status.lastSuccessAt).toLocaleString(), ms: status.lastDurationMs ?? 0 }) }}</span>
      <span v-else-if="available" class="kuapp-sync-chip">{{ t('kuapps.sync.never') }}</span>
    </header>
    <p class="kuapp-sync-explain"><strong>{{ t('kuapps.sync.what') }}</strong> {{ t('kuapps.sync.joinExplain') }}</p>
    <p v-if="status?.lastError" class="kuapp-sync-error" role="alert">{{ t('kuapps.sync.lastError', { date: new Date(status.lastErrorAt).toLocaleString(), error: status.lastError }) }}</p>
    <p v-if="error" class="kuapp-sync-error" role="alert">{{ error }}</p>
    <footer v-if="available">
      <span class="kuapp-sync-pending">{{ pendingLabel }}</span>
      <button v-if="canCreateArchitectureView" class="btn sm primary" data-test="sync-create-architecture" :disabled="running" @click="createArchitectureView">
        <i :data-lucide="running ? 'loader-2' : 'network'"></i>{{ running ? t('apmv.reconciling') : t('kuapps.sync.createArchitectureView') }}
      </button>
      <button v-if="pending" class="btn sm" @click="$emit('open-tab', 'review')">{{ t('kuapps.sync.openReview') }}</button>
      <button class="btn sm" data-test="sync-run" :disabled="running" @click="reconcile">
        <i :data-lucide="running ? 'loader-2' : 'git-merge'"></i>{{ running ? t('apmv.reconciling') : t('kuapps.sync.runNow') }}
      </button>
    </footer>
    <p v-else class="kuapp-sync-pending">{{ t('kuapps.sync.unavailable') }}</p>
    <!-- "N resources on one side only" names them and the next step for each side (#239). -->
    <details v-for="group in oneSided" :key="group.side" class="kuapp-sync-side" :data-test="`sync-one-sided-${group.side}`">
      <summary>{{ t(`kuapps.sync.side.${group.side}`, { n: group.resources.length }) }}</summary>
      <p class="kuapp-sync-next">{{ t(`kuapps.sync.side.${group.side}.next`) }}</p>
      <ul>
        <li v-for="resource in group.resources" :key="resource.id">
          <button class="kuapp-sync-resource" @click="$emit('select-resource', resource.id)"><strong>{{ resource.displayName }}</strong><small>{{ resource.provider }} · {{ resource.resourceType }}</small></button>
        </li>
      </ul>
    </details>
  </section>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { createIcons, icons } from 'lucide'
import { useApi } from '../../composables/useApi'
import { useI18n } from '../../composables/useI18n'
import { useArchitectureStore } from '../../stores/useArchitectureStore'

// The local join between Observability resources and Architecture nodes (the shared
// registry reconciliation), with what it does in plain words. No cloud call.
const props = defineProps({
  application: { type: Object, default: null },
  provider: { type: String, default: 'generic' },
  // The profile the Observability routes accept for this application ('local' without provider).
  profileId: { type: String, default: '' },
  architectureProfileId: { type: String, default: '' },
})
const emit = defineEmits(['open-tab', 'reconciled', 'select-resource'])
const { t } = useI18n()
const { apiFetch } = useApi()
const architectureStore = useArchitectureStore()
const status = ref(null)
const registryInfo = ref(null)
const running = ref(false)
const error = ref('')

const profile = computed(() => props.profileId || props.application?.profileId || '')
const available = computed(() => !!props.application && !!profile.value)
const base = computed(() => `/api/observability/${props.provider}/applications/${encodeURIComponent(props.application?.id || '')}/registry`)
const headers = computed(() => ({ 'X-Profile-Id': profile.value }))
const pending = computed(() => (status.value?.divergentResourceCount || 0) + (status.value?.divergentRelationshipCount || 0))
const linkedProjectIds = computed(() => {
  const value = registryInfo.value?.projectId
  return Array.isArray(value) ? value : value ? [value] : []
})
const oneSided = computed(() => {
  const divergent = (registryInfo.value?.resources || []).filter(resource => resource.divergent)
  const only = source => divergent.filter(resource => (resource.sources || []).includes(source))
  return [
    { side: 'observedOnly', resources: only('apm_resource') },
    { side: 'mapOnly', resources: only('architecture_node') },
  ].filter(group => group.resources.length)
})
const canCreateArchitectureView = computed(() => available.value && pending.value > 0 && !linkedProjectIds.value.length)
const pendingLabel = computed(() => pending.value
  ? t('kuapps.sync.pending', { resources: status.value?.divergentResourceCount || 0, relationships: status.value?.divergentRelationshipCount || 0 })
  : t('kuapps.sync.nothingPending'))

async function load() {
  status.value = null
  error.value = ''
  if (!available.value) return
  try {
    registryInfo.value = await apiFetch(base.value, { headers: headers.value })
    status.value = registryInfo.value?.syncStatus || null
  } catch (err) { error.value = err.message }
  nextTick(() => createIcons({ icons }))
}

async function reconcile() {
  running.value = true
  error.value = ''
  const applicationId = props.application?.id
  const operationToken = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const operationId = `registry:${applicationId}:${operationToken}`
  architectureStore.beginApplicationSync(applicationId, operationId)
  try {
    const result = await apiFetch(`${base.value}/reconcile`, { method: 'POST', headers: headers.value })
    status.value = result?.syncStatus || status.value
    if (registryInfo.value && Array.isArray(result?.resources)) registryInfo.value = { ...registryInfo.value, resources: result.resources }
    emit('reconciled', result)
  } catch (err) { error.value = err.message } finally {
    running.value = false
    architectureStore.endApplicationSync(applicationId, operationId)
    nextTick(() => createIcons({ icons }))
  }
}

async function createArchitectureView() {
  const applicationId = props.application?.id
  const projectProfileId = props.architectureProfileId || profile.value
  if (!applicationId || !projectProfileId || !canCreateArchitectureView.value) return
  if (!window.confirm(t('kuapps.sync.createArchitectureViewConfirm', { name: props.application.name, count: pending.value }))) return
  running.value = true
  error.value = ''
  const operationId = `registry-project:${applicationId}:${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`
  architectureStore.beginApplicationSync(applicationId, operationId)
  try {
    await apiFetch(`${base.value.replace(/\/registry$/, '')}/architecture-link/project`, {
      method: 'POST', headers: { 'X-Profile-Id': projectProfileId }, body: JSON.stringify({}),
    })
    await load()
    emit('reconciled')
  } catch (err) { error.value = err.message } finally {
    running.value = false
    architectureStore.endApplicationSync(applicationId, operationId)
    nextTick(() => createIcons({ icons }))
  }
}

watch(() => [props.application?.id, profile.value, props.provider], load, { immediate: true })
</script>

<style scoped>
.kuapp-sync { display: grid; gap: 8px; padding: 12px; border: 1px solid var(--border); border-radius: 7px; background: var(--bg-panel); }
.kuapp-sync > header { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.kuapp-sync h4 { margin: 0; font-size: 13px; }
.kuapp-sync-chip { padding: 2px 8px; border: 1px solid var(--border); border-radius: 10px; color: var(--text-dim); font-size: 12px; white-space: nowrap; }
.kuapp-sync-chip.ok { border-color: var(--green); color: var(--green); }
.kuapp-sync-explain { margin: 0; padding: 7px 10px; border-left: 3px solid var(--accent); background: color-mix(in srgb, var(--accent) 8%, transparent); color: var(--text-dim); font-size: 12px; line-height: 1.5; }
.kuapp-sync-side summary { cursor: pointer; font-size: 13px; }
.kuapp-sync-next { margin: 6px 0; color: var(--text-dim); font-size: 12px; }
.kuapp-sync-side ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; max-height: 240px; overflow: auto; }
.kuapp-sync-resource { width: 100%; display: flex; justify-content: space-between; gap: 8px; padding: 4px 6px; border: 0; border-radius: 4px; background: transparent; color: var(--text); text-align: left; cursor: pointer; font-size: 13px; }
.kuapp-sync-resource:hover { background: color-mix(in srgb, var(--accent) 8%, transparent); }
.kuapp-sync-resource small { color: var(--text-dim); font-size: 12px; }
.kuapp-sync-explain strong { color: var(--text); }
.kuapp-sync-error { margin: 0; color: var(--red); font-size: 12px; }
.kuapp-sync > footer { display: flex; align-items: center; gap: 8px; }
.kuapp-sync-pending { margin: 0 auto 0 0; color: var(--text-dim); font-size: 12px; }
.kuapp-sync svg { width: 13px; }
</style>
