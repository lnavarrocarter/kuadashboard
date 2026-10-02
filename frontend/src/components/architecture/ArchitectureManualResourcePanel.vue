<template>
  <section class="manual-resource-panel">
    <header>
      <span><i data-lucide="square-plus"></i><strong>{{ t('archManual.title') }}</strong><small>{{ t('archManual.subtitle') }}</small></span>
      <button class="btn sm btn-icon" :title="t('archManual.close')" @click="$emit('close')"><i data-lucide="x"></i></button>
    </header>
    <form @submit.prevent="addResource">
      <label>{{ t('archManual.provider') }}
        <select v-model="draft.provider" class="ctrl-input">
          <option value="aws">AWS</option>
          <option value="kubernetes">Kubernetes</option>
          <option value="gcp">GCP</option>
          <option value="vercel">Vercel</option>
        </select>
      </label>
      <label>{{ t('archManual.name') }}<input v-model.trim="draft.name" class="ctrl-input" required maxlength="120" placeholder="orders-api" /></label>
      <label>{{ t('archManual.resourceType') }}<input v-model.trim="draft.resourceType" class="ctrl-input" required maxlength="80" :placeholder="typePlaceholder" /></label>
      <label>{{ t('archManual.nativeId') }}<input v-model.trim="draft.nativeId" class="ctrl-input" required maxlength="500" :placeholder="identifierPlaceholder" /></label>
      <label>{{ scopeLabel }}<input v-model.trim="draft.scopeId" class="ctrl-input" maxlength="200" :placeholder="scopePlaceholder" /></label>
      <label>{{ locationLabel }}<input v-model.trim="draft.location" class="ctrl-input" maxlength="120" :placeholder="locationPlaceholder" /></label>
      <label v-if="draft.provider === 'kubernetes'">Namespace<input v-model.trim="draft.namespace" class="ctrl-input" maxlength="120" placeholder="default" /></label>
      <label>{{ t('archManual.kind') }}<input v-model.trim="draft.kind" class="ctrl-input" maxlength="180" :placeholder="draft.resourceType || t('archManual.kindPlaceholder')" /></label>
      <footer>
        <span>{{ t('archManual.footer') }}</span>
        <button class="btn sm primary" :disabled="store.saving || !draft.name || !draft.resourceType || !draft.nativeId">
          <i data-lucide="plus"></i> {{ t('archManual.add') }}
        </button>
      </footer>
    </form>
  </section>
</template>

<script setup>
import { computed, nextTick, reactive } from 'vue'
import { createIcons, icons } from 'lucide'
import { useArchitectureStore } from '../../stores/useArchitectureStore'
import { useI18n } from '../../composables/useI18n'

const emit = defineEmits(['close', 'imported'])
const store = useArchitectureStore()
const { t } = useI18n()
const draft = reactive({ provider: 'aws', name: '', resourceType: 'ec2', nativeId: '', scopeId: '', location: 'us-east-1', namespace: '', kind: '' })

const typePlaceholder = computed(() => ({ aws: 'ec2', kubernetes: 'deployment', gcp: 'gcp-cloud-run', vercel: 'vercel-project' })[draft.provider])
const identifierPlaceholder = computed(() => t(`archManual.idPlaceholder.${draft.provider}`))
const scopeLabel = computed(() => t(`archManual.scope.${draft.provider}`))
const scopePlaceholder = computed(() => ({ aws: '123456789012', kubernetes: 'arn:aws:eks:region:account:cluster/name', gcp: 'my-project', vercel: 'team-slug' })[draft.provider])
const locationLabel = computed(() => draft.provider === 'kubernetes' ? t('archManual.location') : t('archManual.regionLocation'))
const locationPlaceholder = computed(() => draft.provider === 'kubernetes' ? t('archManual.locationPlaceholder') : 'us-east-1')

async function addResource() {
  const id = `manual:${draft.provider}:${globalThis.crypto?.randomUUID?.() || Date.now()}`
  const node = {
    id,
    name: draft.name,
    provider: draft.provider,
    resourceType: draft.resourceType,
    kind: draft.kind || draft.resourceType,
    nativeId: draft.nativeId,
    discoveryKey: draft.nativeId,
    manual: true,
    sourceId: null,
    evidence: [{ type: 'manual_resource', values: [draft.nativeId] }],
  }
  if (draft.provider === 'aws') {
    node.accountId = draft.scopeId
    node.region = draft.location
    if (draft.nativeId.startsWith('arn:')) node.arn = draft.nativeId
  } else if (draft.provider === 'kubernetes') {
    node.kubeContext = draft.scopeId
    node.namespace = draft.namespace
    node.location = draft.location
  } else {
    node.scopeId = draft.scopeId
    node.location = draft.location
  }
  const graph = await store.applyOperation({ type: 'node.upsert', value: node }, { reason: t('archManual.reason', { provider: draft.provider, name: draft.name }) })
  if (graph) {
    emit('imported', graph)
    nextTick(() => createIcons({ icons }))
  }
}
</script>

<style scoped>
.manual-resource-panel { margin-bottom: 12px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-panel); overflow: hidden; }
.manual-resource-panel > header { padding: 10px 12px; display: flex; align-items: center; justify-content: space-between; gap: 10px; border-bottom: 1px solid var(--border); }
.manual-resource-panel > header > span { display: flex; align-items: center; gap: 8px; }
.manual-resource-panel > header span > span { display: flex; flex-direction: column; }
.manual-resource-panel header small, .manual-resource-panel label, .manual-resource-panel footer { color: var(--text-dim); }
.manual-resource-panel form { padding: 12px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.manual-resource-panel label { display: flex; min-width: 0; flex-direction: column; gap: 4px; font-size: 11px; }
.manual-resource-panel footer { grid-column: 1 / -1; padding-top: 4px; display: flex; align-items: center; justify-content: space-between; gap: 10px; font-size: 10px; }
@media (max-width: 650px) { .manual-resource-panel form { grid-template-columns: 1fr; }.manual-resource-panel footer { align-items: stretch; flex-direction: column; } }
</style>