<template>
  <section class="kubernetes-discovery-panel">
    <header>
      <span><i data-lucide="ship-wheel"></i><strong>Add Kubernetes resources</strong><small>Choose a context, inspect topology evidence, then confirm resources.</small></span>
      <button class="btn sm btn-icon" title="Close Kubernetes discovery" @click="$emit('close')"><i data-lucide="x"></i></button>
    </header>

    <div v-if="store.discovering" class="kubernetes-progress" role="status" aria-live="polite">
      <i data-lucide="loader-2"></i>
      <span>{{ store.discoveryPhase === 'kubernetes-contexts' ? 'Loading Kubernetes contexts…' : 'Loading Kubernetes resources…' }}</span>
    </div>

    <template v-if="!store.kubernetesPreview">
      <div class="kubernetes-controls">
        <label>Context
          <select v-model="contextId" class="ctrl-input" :disabled="store.discovering">
            <option value="">Select a Kubernetes context</option>
            <option v-for="context in store.kubernetesContexts" :key="context.id" :value="context.id">{{ context.name }}</option>
          </select>
        </label>
        <label>Namespaces
          <input v-model.trim="namespaceFilter" class="ctrl-input" placeholder="orders, platform (optional)" :disabled="store.discovering" />
        </label>
        <button class="btn sm" :disabled="store.discovering" @click="loadContexts"><i data-lucide="refresh-cw"></i> Refresh contexts</button>
        <button class="btn sm primary" :disabled="store.discovering || !contextId" @click="previewResources"><i data-lucide="scan-search"></i> Preview resources</button>
      </div>
      <div v-if="!store.discovering && !store.kubernetesContexts.length" class="kubernetes-empty">No Kubernetes contexts are available for this profile.</div>
    </template>

    <template v-else>
      <div class="kubernetes-summary">
        <span><strong>{{ store.kubernetesPreview.nodes.length }}</strong> resources</span>
        <span><strong>{{ store.kubernetesPreview.relationships.length }}</strong> relationships</span>
        <span><strong>{{ degradedContexts }}</strong> degraded contexts</span>
        <button class="btn sm" @click="backToContexts"><i data-lucide="arrow-left"></i> Change context</button>
      </div>
      <div v-if="store.kubernetesPreview.failures.length" class="kubernetes-warning">
        {{ store.kubernetesPreview.failures.map(item => item.context).join(', ') }} could not be reached.
      </div>
      <div class="kubernetes-resource-list">
        <section v-for="group in resourceGroups" :key="group.type" class="kubernetes-resource-group">
          <header>
            <span><i :data-lucide="resourceIcon(group.type)"></i><strong>{{ resourceLabel(group.type) }}</strong><small>{{ group.nodes.length }}</small></span>
            <label><input type="checkbox" :checked="isGroupSelected(group)" @change="toggleGroup(group, $event.target.checked)" /> Select all</label>
          </header>
          <label v-for="node in group.nodes" :key="node.id" class="kubernetes-resource-row" :class="{ 'already-in-project': node.alreadyInGraph }">
            <input v-model="selectedNodeIds" type="checkbox" :value="node.id" :disabled="node.alreadyInGraph" />
            <i :data-lucide="resourceIcon(node.resourceType)"></i>
            <span><strong>{{ node.name }}</strong><small>{{ node.kind }} · {{ node.namespace || 'cluster scope' }}</small></span>
            <span v-if="node.alreadyInGraph" class="health already-badge">already in project</span>
            <span v-else :class="['health', node.health?.status]">{{ node.health?.status || 'unknown' }}</span>
          </label>
        </section>
      </div>
      <footer>
        <span>{{ selectedNodeIds.length }} selected</span>
        <button class="btn sm primary" :disabled="store.saving || !selectedNodeIds.length" @click="importResources">
          <i :data-lucide="store.saving ? 'loader-2' : 'download'"></i>{{ store.saving ? 'Drawing…' : 'Add to diagram' }}
        </button>
      </footer>
    </template>
  </section>
</template>

<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { createIcons, icons } from 'lucide'
import { useArchitectureStore } from '../../stores/useArchitectureStore'

const emit = defineEmits(['close', 'imported'])
const store = useArchitectureStore()
const contextId = ref('')
const selectedNodeIds = ref([])
const namespaceFilter = ref('')
const previewNodes = computed(() => (store.kubernetesPreview?.nodes || []).slice().sort((left, right) =>
  `${left.namespace}/${left.name}`.localeCompare(`${right.namespace}/${right.name}`)))
const resourceGroups = computed(() => {
  const groups = new Map()
  for (const node of previewNodes.value) {
    const type = node.resourceType || 'resource'
    const group = groups.get(type) || { type, nodes: [] }
    group.nodes.push(node)
    groups.set(type, group)
  }
  return [...groups.values()].sort((left, right) => resourceLabel(left.type).localeCompare(resourceLabel(right.type)))
})
const degradedContexts = computed(() => (store.kubernetesPreview?.health || []).filter(item => item.status === 'degraded').length)

async function loadContexts() {
  contextId.value = ''
  selectedNodeIds.value = []
  await store.loadKubernetesContexts()
  refreshIcons()
}

async function previewResources() {
  selectedNodeIds.value = []
  const namespaces = namespaceFilter.value.split(',').map(value => value.trim()).filter(Boolean)
  const preview = await store.previewKubernetesResources({ contexts: [contextId.value], namespaces })
  if (preview) selectedNodeIds.value = preview.nodes.filter(node => !node.alreadyInGraph).map(node => node.id)
  refreshIcons()
}

function isGroupSelected(group) {
  const selectableGroupNodes = group.nodes.filter(node => !node.alreadyInGraph)
  return selectableGroupNodes.length > 0 && selectableGroupNodes.every(node => selectedNodeIds.value.includes(node.id))
}

function toggleGroup(group, checked) {
  const ids = new Set(selectedNodeIds.value)
  for (const node of group.nodes) {
    if (node.alreadyInGraph) continue
    if (checked) ids.add(node.id)
    else ids.delete(node.id)
  }
  selectedNodeIds.value = [...ids]
}

function backToContexts() {
  store.kubernetesPreview = null
  selectedNodeIds.value = []
  refreshIcons()
}

async function importResources() {
  const graph = await store.importKubernetesResources({ selectedNodeIds: selectedNodeIds.value })
  if (graph) {
    emit('imported', graph)
    refreshIcons()
  }
}

function refreshIcons() { nextTick(() => createIcons({ icons })) }
function resourceIcon(type) {
  return {
    deployment: 'boxes', statefulset: 'database-zap', daemonset: 'rows-3', pod: 'container',
    service: 'network', ingress: 'route', configmap: 'file-cog', secret: 'key-round', pvc: 'hard-drive',
  }[type] || 'ship-wheel'
}
function resourceLabel(type) {
  return {
    deployment: 'Deployments', statefulset: 'StatefulSets', daemonset: 'DaemonSets', pod: 'Pods',
    service: 'Services', ingress: 'Ingress', configmap: 'ConfigMaps', secret: 'Secrets', pvc: 'Persistent volumes',
  }[type] || String(type || 'Resources').replaceAll('-', ' ')
}
watch(() => store.kubernetesPreview, refreshIcons)
onMounted(async () => { await loadContexts(); refreshIcons() })
</script>

<style scoped>
.kubernetes-discovery-panel { margin-bottom: 12px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-panel); overflow: hidden; }
.kubernetes-discovery-panel > header, .kubernetes-controls, .kubernetes-summary, .kubernetes-discovery-panel footer { padding: 10px 12px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--border); }
.kubernetes-discovery-panel > header { justify-content: space-between; }
.kubernetes-discovery-panel > header > span { display: flex; align-items: center; gap: 8px; }
.kubernetes-discovery-panel > header span > span { display: flex; flex-direction: column; }
.kubernetes-discovery-panel header small, .kubernetes-controls label, .kubernetes-resource-row small { color: var(--text-dim); }
.kubernetes-progress { min-height: 48px; padding: 8px 12px; display: flex; align-items: center; gap: 8px; color: #2f81f7; border-bottom: 1px solid var(--border); }
.kubernetes-progress > i { animation: spin 0.9s linear infinite; }
.kubernetes-controls { align-items: flex-end; }
.kubernetes-controls label { display: flex; flex: 1; flex-direction: column; gap: 4px; font-size: 11px; }
.kubernetes-empty, .kubernetes-warning { padding: 14px 12px; color: var(--text-dim); }
.kubernetes-warning { color: #d29922; }
.kubernetes-summary span { color: var(--text-dim); font-size: 11px; }
.kubernetes-summary strong { color: var(--text); }
.kubernetes-summary .btn { margin-left: auto; }
.kubernetes-resource-list { max-height: 300px; overflow: auto; }
.kubernetes-resource-group { border-bottom: 1px solid var(--border); }
.kubernetes-resource-group > header { min-height: 38px; padding: 6px 12px; display: flex; align-items: center; justify-content: space-between; gap: 10px; background: var(--bg-hover); color: var(--text-dim); }
.kubernetes-resource-group > header > span, .kubernetes-resource-group > header label { display: flex; align-items: center; gap: 6px; font-size: 10px; }
.kubernetes-resource-group > header strong { color: var(--text); }
.kubernetes-resource-group > header small { padding: 1px 5px; border-radius: 10px; background: var(--bg-panel); }
.kubernetes-resource-group > header i { width: 15px; height: 15px; color: #326ce5; }
.kubernetes-resource-row { min-height: 48px; padding: 8px 12px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--border); cursor: pointer; }
.kubernetes-resource-row:hover { background: var(--bg-hover); }
.kubernetes-resource-row > span:not(.health) { display: flex; flex: 1; min-width: 0; flex-direction: column; }
.kubernetes-resource-row > i { width: 17px; height: 17px; color: #326ce5; }
.kubernetes-resource-row strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.health { font-size: 10px; text-transform: capitalize; }
.health.healthy { color: #3fb950; }.health.degraded { color: #d29922; }
.health.already-badge { color: var(--text-dim); text-transform: none; }
.kubernetes-resource-row.already-in-project { cursor: default; opacity: 0.65; }
.kubernetes-discovery-panel footer { justify-content: space-between; border-bottom: 0; color: var(--text-dim); font-size: 11px; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (max-width: 650px) { .kubernetes-controls { align-items: stretch; flex-direction: column; } }
</style>
