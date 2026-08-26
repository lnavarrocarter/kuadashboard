<template>
  <section class="manual-resource-panel">
    <header>
      <span><i data-lucide="square-plus"></i><strong>Add manual resource</strong><small>Record a confirmed component not supplied by discovery.</small></span>
      <button class="btn sm btn-icon" title="Close manual resource" @click="$emit('close')"><i data-lucide="x"></i></button>
    </header>
    <form @submit.prevent="addResource">
      <label>Provider
        <select v-model="draft.provider" class="ctrl-input">
          <option value="aws">AWS</option>
          <option value="kubernetes">Kubernetes</option>
          <option value="gcp">GCP</option>
          <option value="vercel">Vercel</option>
        </select>
      </label>
      <label>Name<input v-model.trim="draft.name" class="ctrl-input" required maxlength="120" placeholder="orders-api" /></label>
      <label>Resource type<input v-model.trim="draft.resourceType" class="ctrl-input" required maxlength="80" :placeholder="typePlaceholder" /></label>
      <label>Native identifier<input v-model.trim="draft.nativeId" class="ctrl-input" required maxlength="500" :placeholder="identifierPlaceholder" /></label>
      <label>{{ scopeLabel }}<input v-model.trim="draft.scopeId" class="ctrl-input" maxlength="200" :placeholder="scopePlaceholder" /></label>
      <label>{{ locationLabel }}<input v-model.trim="draft.location" class="ctrl-input" maxlength="120" :placeholder="locationPlaceholder" /></label>
      <label v-if="draft.provider === 'kubernetes'">Namespace<input v-model.trim="draft.namespace" class="ctrl-input" maxlength="120" placeholder="default" /></label>
      <label>Kind<input v-model.trim="draft.kind" class="ctrl-input" maxlength="180" :placeholder="draft.resourceType || 'EC2 instance'" /></label>
      <footer>
        <span>Manual resources are never changed by discovery or sync.</span>
        <button class="btn sm primary" :disabled="store.saving || !draft.name || !draft.resourceType || !draft.nativeId">
          <i data-lucide="plus"></i> Add to diagram
        </button>
      </footer>
    </form>
  </section>
</template>

<script setup>
import { computed, nextTick, reactive } from 'vue'
import { createIcons, icons } from 'lucide'
import { useArchitectureStore } from '../../stores/useArchitectureStore'

const emit = defineEmits(['close', 'imported'])
const store = useArchitectureStore()
const draft = reactive({ provider: 'aws', name: '', resourceType: 'ec2', nativeId: '', scopeId: '', location: 'us-east-1', namespace: '', kind: '' })

const typePlaceholder = computed(() => ({ aws: 'ec2', kubernetes: 'deployment', gcp: 'gcp-cloud-run', vercel: 'vercel-project' })[draft.provider])
const identifierPlaceholder = computed(() => ({ aws: 'i-0123456789abcdef0 or ARN', kubernetes: 'Kubernetes UID', gcp: 'resource URL or ID', vercel: 'project ID or URL' })[draft.provider])
const scopeLabel = computed(() => ({ aws: 'Account', kubernetes: 'Context', gcp: 'Project', vercel: 'Team' })[draft.provider])
const scopePlaceholder = computed(() => ({ aws: '123456789012', kubernetes: 'arn:aws:eks:region:account:cluster/name', gcp: 'my-project', vercel: 'team-slug' })[draft.provider])
const locationLabel = computed(() => draft.provider === 'kubernetes' ? 'Location' : 'Region / location')
const locationPlaceholder = computed(() => draft.provider === 'kubernetes' ? 'cluster or zone' : 'us-east-1')

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
  const graph = await store.applyOperation({ type: 'node.upsert', value: node }, { reason: `Add manual ${draft.provider} resource ${draft.name}` })
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