<template>
  <section class="architecture-canvas-shell">
    <header class="canvas-toolbar">
      <input
        v-model.trim="nodeDraft.name"
        class="ctrl-input"
        maxlength="120"
        placeholder="Component name"
        @keyup.enter="addNode"
      />
      <select v-model="nodeDraft.resourceType" class="ctrl-select" title="Component type">
        <option v-for="option in nodeTypes" :key="option.value" :value="option.value">{{ option.label }}</option>
      </select>
      <button class="btn sm primary" :disabled="saving || !nodeDraft.name" @click="addNode">
        <i data-lucide="plus"></i> Add component
      </button>
      <span class="canvas-hint">Drag between handles to connect components</span>
    </header>

    <div class="canvas-body">
      <VueFlow
        :nodes="flowNodes"
        :edges="flowEdges"
        class="architecture-flow"
        :default-viewport="{ x: 40, y: 40, zoom: 0.9 }"
        :min-zoom="0.25"
        :max-zoom="2"
        :delete-key-code="null"
        fit-view-on-init
        @connect="connectNodes"
        @node-click="selectNode"
        @edge-click="selectEdge"
        @node-drag-stop="persistPosition"
        @pane-click="clearSelection"
      >
        <Background pattern-color="var(--border)" :gap="24" />
        <Controls position="bottom-left" />
        <template #node-default="{ data }">
          <div class="architecture-node">
            <span class="node-icon"><i :data-lucide="iconForType(data.resourceType)"></i></span>
            <span><strong>{{ data.label }}</strong><small>{{ typeLabel(data.resourceType) }}</small></span>
          </div>
        </template>
      </VueFlow>

      <div v-if="!flowNodes.length" class="canvas-empty">
        <i data-lucide="boxes"></i>
        <strong>Add the first component</strong>
        <span>Build the application manually, then connect dependencies directly on the canvas.</span>
      </div>

      <aside v-if="selectedNode" class="canvas-inspector">
        <header>
          <span><i data-lucide="box"></i> Component</span>
          <button class="btn sm btn-icon" title="Close inspector" @click="clearSelection"><i data-lucide="x"></i></button>
        </header>
        <label>Name<input v-model.trim="editDraft.name" class="ctrl-input" maxlength="120" /></label>
        <label>Type
          <select v-model="editDraft.resourceType" class="ctrl-select">
            <option v-for="option in nodeTypes" :key="option.value" :value="option.value">{{ option.label }}</option>
          </select>
        </label>
        <small class="inspector-id">{{ selectedNode.id }}</small>
        <div class="inspector-actions">
          <button class="btn sm primary" :disabled="saving || !editDraft.name" @click="saveNode"><i data-lucide="check"></i> Save</button>
          <button class="btn sm danger" :disabled="saving" @click="removeNode"><i data-lucide="trash-2"></i> Delete</button>
        </div>
      </aside>

      <aside v-else-if="selectedEdge" class="canvas-inspector">
        <header>
          <span><i data-lucide="git-branch"></i> Relationship</span>
          <button class="btn sm btn-icon" title="Close inspector" @click="clearSelection"><i data-lucide="x"></i></button>
        </header>
        <strong>{{ nodeName(selectedEdge.sourceNodeId) }}</strong>
        <span class="relationship-direction"><i data-lucide="arrow-down"></i> {{ relationshipLabel(selectedEdge.relationType) }}</span>
        <strong>{{ nodeName(selectedEdge.targetNodeId) }}</strong>
        <span :class="['relationship-status', selectedEdge.status]">
          {{ relationshipStatus(selectedEdge.status) }} · {{ Math.round(selectedEdge.confidence * 100) }}% confidence
        </span>
        <small v-if="selectedEdge.evidence?.length" class="relationship-evidence">
          {{ selectedEdge.evidence[0].intrinsic || selectedEdge.evidence[0].type }} · {{ selectedEdge.evidence[0].path || 'Recorded evidence' }}
        </small>
        <div v-if="['automatic', 'suggested'].includes(selectedEdge.status)" class="inspector-actions">
          <button class="btn sm primary" :disabled="saving" @click="reviewEdge('accept')"><i data-lucide="check"></i> Accept</button>
          <button class="btn sm danger" :disabled="saving" @click="reviewEdge('reject')"><i data-lucide="x"></i> Reject</button>
        </div>
        <button v-else class="btn sm danger" :disabled="saving" @click="removeEdge"><i data-lucide="trash-2"></i> Delete relationship</button>
      </aside>
    </div>
  </section>
</template>

<script setup>
import { nextTick, onMounted, reactive, ref, watch } from 'vue'
import { createIcons, icons } from 'lucide'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import { MarkerType, VueFlow } from '@vue-flow/core'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/controls/dist/style.css'

const props = defineProps({
  graph: { type: Object, required: true },
  saving: { type: Boolean, default: false },
})
const emit = defineEmits(['operation'])

const nodeTypes = [
  { value: 'service', label: 'Service' },
  { value: 'api', label: 'API' },
  { value: 'database', label: 'Database' },
  { value: 'queue', label: 'Queue / topic' },
  { value: 'function', label: 'Function' },
  { value: 'storage', label: 'Storage' },
  { value: 'external', label: 'External system' },
]
const nodeDraft = reactive({ name: '', resourceType: 'service' })
const editDraft = reactive({ name: '', resourceType: 'service' })
const flowNodes = ref([])
const flowEdges = ref([])
const selectedNode = ref(null)
const selectedEdge = ref(null)

function manualId(prefix) {
  const value = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return `manual:${prefix}:${value}`
}

function syncGraph() {
  const document = props.graph?.document
  if (!document) return
  flowNodes.value = document.nodes.map((node, index) => ({
    id: node.id,
    position: document.layout[node.id] || { x: 80 + (index % 4) * 220, y: 70 + Math.floor(index / 4) * 150 },
    data: { label: node.name || node.label || node.id, resourceType: node.resourceType || 'service' },
  }))
  flowEdges.value = document.edges.filter(edge => edge.status !== 'rejected').map(edge => ({
    id: edge.id,
    source: edge.sourceNodeId,
    target: edge.targetNodeId,
    label: `${relationshipLabel(edge.relationType)} · ${relationshipStatus(edge.status)}`,
    markerEnd: MarkerType.ArrowClosed,
    animated: edge.status === 'suggested',
    style: edge.status === 'suggested'
      ? { stroke: '#d29922', strokeDasharray: '6 4' }
      : edge.status === 'automatic' ? { stroke: '#2f81f7' } : undefined,
  }))
  if (selectedNode.value) selectedNode.value = document.nodes.find(node => node.id === selectedNode.value.id) || null
  if (selectedEdge.value) selectedEdge.value = document.edges.find(edge => edge.id === selectedEdge.value.id) || null
  refreshIcons()
}

function addNode() {
  if (!nodeDraft.name || props.saving) return
  emit('operation', {
    type: 'node.upsert',
    value: { id: manualId('node'), name: nodeDraft.name, resourceType: nodeDraft.resourceType, manual: true },
  }, `Add ${nodeDraft.name}`)
  nodeDraft.name = ''
}

function connectNodes(connection) {
  if (props.saving || !connection.source || !connection.target || connection.source === connection.target) return
  emit('operation', {
    type: 'edge.upsert',
    value: {
      id: manualId('edge'),
      sourceNodeId: connection.source,
      targetNodeId: connection.target,
      relationType: 'depends_on',
      status: 'manual',
      confidence: 1,
      evidence: [],
    },
  }, 'Connect components')
}

function persistPosition({ node }) {
  if (props.saving || !node?.id || !node.position) return
  emit('operation', {
    type: 'layout.set',
    value: { [node.id]: { x: Math.round(node.position.x), y: Math.round(node.position.y) } },
  }, `Move ${nodeName(node.id)}`)
}

function selectNode({ node }) {
  selectedEdge.value = null
  selectedNode.value = props.graph.document.nodes.find(item => item.id === node.id) || null
  editDraft.name = selectedNode.value?.name || selectedNode.value?.label || ''
  editDraft.resourceType = selectedNode.value?.resourceType || 'service'
  refreshIcons()
}

function selectEdge({ edge }) {
  selectedNode.value = null
  selectedEdge.value = props.graph.document.edges.find(item => item.id === edge.id) || null
  refreshIcons()
}

function saveNode() {
  if (!selectedNode.value || !editDraft.name || props.saving) return
  emit('operation', {
    type: 'node.upsert',
    value: { id: selectedNode.value.id, name: editDraft.name, resourceType: editDraft.resourceType },
  }, `Update ${editDraft.name}`)
}

function removeNode() {
  if (!selectedNode.value || props.saving) return
  emit('operation', { type: 'node.remove', subjectId: selectedNode.value.id }, `Delete ${nodeName(selectedNode.value.id)}`)
  clearSelection()
}

function removeEdge() {
  if (!selectedEdge.value || props.saving) return
  emit('operation', { type: 'edge.remove', subjectId: selectedEdge.value.id }, 'Delete relationship')
  clearSelection()
}

function reviewEdge(decision) {
  if (!selectedEdge.value || props.saving) return
  emit('operation', {
    type: 'edge.review', subjectId: selectedEdge.value.id, value: { decision },
  }, `${decision === 'accept' ? 'Accept' : 'Reject'} inferred relationship`)
  clearSelection()
}

function clearSelection() {
  selectedNode.value = null
  selectedEdge.value = null
}

function nodeName(nodeId) {
  return props.graph.document.nodes.find(node => node.id === nodeId)?.name || nodeId
}

function typeLabel(resourceType) {
  return nodeTypes.find(option => option.value === resourceType)?.label || resourceType
}

function relationshipStatus(status) {
  return { automatic: 'Automatic', suggested: 'Suggested', manual: 'Confirmed', stale: 'Stale' }[status] || status
}

function relationshipLabel(relationType) {
  return { depends_on: 'depends on', triggers: 'triggers', invokes: 'invokes', runs_on: 'runs on' }[relationType]
    || String(relationType || 'depends_on').replaceAll('_', ' ')
}

function iconForType(resourceType) {
  return { api: 'braces', database: 'database', queue: 'list-end', function: 'square-function', storage: 'hard-drive', external: 'external-link' }[resourceType] || 'box'
}

function refreshIcons() {
  nextTick(() => createIcons({ icons }))
}

watch(() => props.graph, syncGraph, { deep: true, immediate: true })
onMounted(refreshIcons)
</script>

<style scoped>
.architecture-canvas-shell { border: 1px solid var(--border); border-radius: 6px; overflow: hidden; background: var(--bg-panel); }
.canvas-toolbar { min-height: 48px; padding: 7px 9px; display: flex; align-items: center; gap: 8px; border-bottom: 1px solid var(--border); }
.canvas-toolbar .ctrl-input { width: min(240px, 32vw); }
.canvas-toolbar .ctrl-select { width: 145px; }
.canvas-hint { margin-left: auto; color: var(--text-dim); font-size: 11px; }
.canvas-body { position: relative; height: clamp(420px, 58vh, 680px); }
.architecture-flow { width: 100%; height: 100%; background: var(--bg-panel); }
.architecture-node { min-width: 155px; display: flex; align-items: center; gap: 9px; color: var(--text); text-align: left; }
.architecture-node > span:last-child { display: flex; flex-direction: column; }
.architecture-node small { margin-top: 2px; color: var(--text-dim); font-size: 10px; }
.node-icon { width: 30px; height: 30px; display: grid; place-items: center; border-radius: 5px; background: #1f6feb; color: white; }
.node-icon :deep(svg) { width: 16px; height: 16px; }
.canvas-empty { position: absolute; inset: 48px 0 0; pointer-events: none; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 7px; color: var(--text-dim); text-align: center; }
.canvas-empty i { width: 34px; height: 34px; color: #2f81f7; }
.canvas-empty strong { color: var(--text); }
.canvas-inspector { position: absolute; top: 12px; right: 12px; width: 240px; padding: 12px; display: flex; flex-direction: column; gap: 11px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-panel); box-shadow: 0 12px 30px rgba(0, 0, 0, .22); }
.canvas-inspector header { display: flex; align-items: center; justify-content: space-between; }
.canvas-inspector header span, .relationship-direction { display: flex; align-items: center; gap: 6px; color: var(--text-dim); }
.canvas-inspector label { display: flex; flex-direction: column; gap: 5px; color: var(--text-dim); font-size: 11px; }
.canvas-inspector .ctrl-input, .canvas-inspector .ctrl-select { width: 100%; }
.inspector-id { color: var(--text-dim); word-break: break-all; }
.inspector-actions { display: flex; justify-content: space-between; gap: 7px; }
.relationship-direction { padding: 3px 0; }
.relationship-status { width: fit-content; padding: 3px 6px; border-radius: 4px; font-size: 11px; font-weight: 700; }
.relationship-status.automatic { color: #58a6ff; background: color-mix(in srgb, #2f81f7 14%, transparent); }
.relationship-status.suggested { color: #d29922; background: color-mix(in srgb, #d29922 14%, transparent); }
.relationship-status.manual { color: #3fb950; background: color-mix(in srgb, #3fb950 14%, transparent); }
.relationship-evidence { color: var(--text-dim); overflow-wrap: anywhere; }
:deep(.vue-flow__node-default) { padding: 10px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); box-shadow: 0 4px 12px rgba(0, 0, 0, .18); }
:deep(.vue-flow__node.selected) { box-shadow: 0 0 0 2px #2f81f7; }
:deep(.vue-flow__handle) { width: 9px; height: 9px; background: #2f81f7; border: 2px solid var(--bg-panel); }
:deep(.vue-flow__edge-path) { stroke: #7d8590; stroke-width: 1.8; }
:deep(.vue-flow__edge.selected .vue-flow__edge-path) { stroke: #2f81f7; }
@media (max-width: 760px) {
  .canvas-toolbar { flex-wrap: wrap; }
  .canvas-toolbar .ctrl-input { width: calc(100% - 153px); }
  .canvas-hint { width: 100%; margin-left: 0; }
  .canvas-body { height: 500px; }
  .canvas-inspector { right: 8px; width: min(240px, calc(100% - 16px)); }
}
</style>