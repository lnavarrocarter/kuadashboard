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
      <span class="canvas-layout-controls">
        <select v-model="layoutMode" class="ctrl-select" title="Canvas arrangement">
          <option value="request-flow">Request flow</option>
          <option value="resource-type">Resource type sections</option>
        </select>
        <select v-if="layoutMode === 'request-flow'" v-model="layoutDirection" class="ctrl-select direction-select" title="Request flow direction">
          <option value="horizontal">Flow left to right</option>
          <option value="vertical">Flow top to bottom</option>
        </select>
        <button class="btn sm" :disabled="saving || !flowNodes.length" @click="arrangeFlow">
          <i :data-lucide="layoutMode === 'resource-type' ? 'rows-3' : 'layout-dashboard'"></i>
          {{ layoutMode === 'resource-type' ? 'Arrange by type' : 'Arrange flow' }}
        </button>
        <button :class="['btn', 'sm', { primary: showEdgeLabels }]" :disabled="!flowEdges.length" title="Toggle relationship labels" @click="showEdgeLabels = !showEdgeLabels">
          <i data-lucide="tags"></i> Labels
        </button>
      </span>
      <span class="canvas-hint">Drag between handles to connect components</span>
    </header>

    <div class="canvas-body">
      <VueFlow
        :nodes="displayNodes"
        :edges="displayEdges"
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
            <span :class="['node-icon', `node-icon--${presentationForType(data.resourceType).tone}`]">
              <i :data-lucide="presentationForType(data.resourceType).icon"></i>
            </span>
            <span>
              <strong class="node-title">
                <span v-if="data.method" :class="['api-method', `api-method--${data.method.toLowerCase()}`]">{{ data.method }}</span>
                {{ data.label }}
              </strong>
              <small>{{ typeLabel(data.resourceType) }}</small>
            </span>
          </div>
        </template>
        <template #node-resource-section="{ data }">
          <div class="resource-section">
            <span><i :data-lucide="presentationForType(data.resourceType).icon"></i> {{ typeLabel(data.resourceType) }}</span>
            <strong>{{ data.count }}</strong>
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
            <option v-for="option in editNodeTypes" :key="option.value" :value="option.value">{{ option.label }}</option>
          </select>
        </label>
        <small class="inspector-id">{{ selectedNode.id }}</small>
        <section v-if="selectedNodeReferences.length" class="component-references">
          <span class="inspector-section-title">References</span>
          <button
            v-for="reference in selectedNodeReferences"
            :key="reference.key"
            class="component-reference"
            @click="selectReferencedNode(reference.node)"
          >
            <i :data-lucide="reference.direction === 'outgoing' ? 'arrow-up-right' : 'arrow-down-left'"></i>
            <span>
              <strong>{{ referenceTitle(reference) }}</strong>
              <small>{{ referenceMeta(reference) }}</small>
            </span>
          </button>
        </section>
        <button
          v-if="selectedNode.resourceType === 'stepfunctions'"
          class="btn sm"
          @click="emit('inspect-workflow', selectedNode)"
        ><i data-lucide="workflow"></i> Workflow diagram</button>
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
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { createIcons, icons } from 'lucide'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import { MarkerType, useVueFlow, VueFlow } from '@vue-flow/core'
import { requestFlowLayout, resourceTypeLayout } from '../../lib/architectureLayout'
import { architectureResourcePresentation } from '../../lib/architectureResourcePresentation'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/controls/dist/style.css'

const props = defineProps({
  graph: { type: Object, required: true },
  saving: { type: Boolean, default: false },
})
const emit = defineEmits(['operation', 'inspect-workflow'])

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
const editNodeTypes = computed(() => nodeTypes.some(option => option.value === editDraft.resourceType)
  ? nodeTypes
  : [...nodeTypes, { value: editDraft.resourceType, label: typeLabel(editDraft.resourceType) }])
const flowNodes = ref([])
const flowEdges = ref([])
const layoutMode = ref('request-flow')
const layoutDirection = ref('horizontal')
const resourceSections = ref([])
const fitAfterSync = ref(false)
const showEdgeLabels = ref(false)
const { fitView, setCenter, setViewport } = useVueFlow()
const selectedNode = ref(null)
const selectedEdge = ref(null)
const selectedNodeReferences = computed(() => {
  if (!selectedNode.value || !props.graph?.document) return []
  const nodesById = new Map(props.graph.document.nodes.map(node => [node.id, node]))
  const references = props.graph.document.edges
    .filter(edge => edge.status !== 'rejected' && (edge.sourceNodeId === selectedNode.value.id || edge.targetNodeId === selectedNode.value.id))
    .map(edge => {
      const outgoing = edge.sourceNodeId === selectedNode.value.id
      const node = nodesById.get(outgoing ? edge.targetNodeId : edge.sourceNodeId)
      return node ? {
        key: `${edge.id}:${node.id}`,
        edge,
        node,
        direction: outgoing ? 'outgoing' : 'incoming',
        route: edge.evidence?.find(item => item.route)?.route || '',
      } : null
    })
    .filter(Boolean)
  const identity = reference => `${reference.direction}:${reference.node.kind || reference.node.resourceType}:${reference.node.name}`.toLowerCase()
  const semantic = new Set(references
    .filter(reference => reference.route || reference.edge.relationType !== 'depends_on')
    .map(identity))
  const unique = new Map()
  for (const reference of references) {
    if (reference.edge.relationType === 'depends_on' && semantic.has(identity(reference))) continue
    const key = `${identity(reference)}:${reference.route}:${reference.edge.relationType}`
    if (!unique.has(key)) unique.set(key, reference)
  }
  return [...unique.values()]
})
const focusedNodeIds = computed(() => selectedNode.value
  ? new Set([selectedNode.value.id, ...selectedNodeReferences.value.map(reference => reference.node.id)])
  : null)
const sectionNodes = computed(() => layoutMode.value === 'resource-type' ? resourceSections.value.map(section => ({
  id: `section:${section.type}`,
  type: 'resource-section',
  position: { x: section.x, y: section.y },
  data: { resourceType: section.type, count: section.count },
  style: { width: `${section.width}px`, height: `${section.height}px` },
  selectable: false,
  draggable: false,
  connectable: false,
  focusable: false,
  zIndex: -1,
})) : [])
function withoutOpacity(item) {
  const { opacity: _opacity, ...style } = item.style || {}
  return { ...item, style: Object.keys(style).length ? style : undefined }
}
const displayNodes = computed(() => [...sectionNodes.value, ...flowNodes.value.map(node => {
  const visible = withoutOpacity(node)
  return focusedNodeIds.value
    ? { ...visible, style: { ...visible.style, opacity: focusedNodeIds.value.has(node.id) ? 1 : 0.14 } }
    : visible
})])
const displayEdges = computed(() => flowEdges.value.map(edge => {
  const visible = withoutOpacity(edge)
  return focusedNodeIds.value
    ? {
        ...visible,
        style: {
          ...visible.style,
          opacity: edge.source === selectedNode.value.id || edge.target === selectedNode.value.id ? 1 : 0.035,
        },
      }
    : visible
}))

function manualId(prefix) {
  const value = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return `manual:${prefix}:${value}`
}

function syncGraph() {
  const document = props.graph?.document
  if (!document) return
  const columns = Math.min(10, Math.max(4, Math.ceil(Math.sqrt(document.nodes.length * 1.6))))
  flowNodes.value = document.nodes.map((node, index) => {
    const route = document.edges
      .filter(edge => edge.sourceNodeId === node.id && edge.status !== 'rejected')
      .flatMap(edge => edge.evidence || [])
      .find(item => item.route)
    return {
    id: node.id,
    position: document.layout[node.id] || {
      x: 80 + (index % columns) * 220,
      y: 70 + Math.floor(index / columns) * 150,
    },
      data: {
        label: route?.routePath || node.name || node.label || node.id,
        method: route?.method || '',
        resourceType: node.resourceType || 'service',
      },
    }
  })
  flowEdges.value = document.edges.filter(edge => edge.status !== 'rejected').map(edge => ({
    id: edge.id,
    source: edge.sourceNodeId,
    target: edge.targetNodeId,
    label: showEdgeLabels.value ? `${relationshipLabel(edge.relationType)} · ${relationshipStatus(edge.status)}` : undefined,
    markerEnd: MarkerType.ArrowClosed,
    animated: edge.status === 'suggested',
    type: layoutMode.value === 'resource-type' ? 'straight' : 'default',
    style: {
      ...(edge.status === 'suggested'
        ? { stroke: '#d29922', strokeDasharray: '6 4' }
        : edge.status === 'automatic' ? { stroke: '#2f81f7' } : {}),
      ...(layoutMode.value === 'resource-type' ? { strokeOpacity: 0.28, strokeWidth: 1.2 } : {}),
    },
  }))
  if (selectedNode.value) selectedNode.value = document.nodes.find(node => node.id === selectedNode.value.id) || null
  if (selectedEdge.value) selectedEdge.value = document.edges.find(edge => edge.id === selectedEdge.value.id) || null
  if (fitAfterSync.value) {
    fitAfterSync.value = false
    nextTick(() => document.nodes.length > 40
      ? setViewport({ x: 40, y: 40, zoom: 0.65 }, { duration: 250 })
      : fitView({ padding: 0.16, duration: 250 }))
  }
  refreshIcons()
}

function arrangeFlow() {
  if (props.saving || !props.graph?.document?.nodes?.length) return
  fitAfterSync.value = true
  if (layoutMode.value === 'resource-type') {
    const result = resourceTypeLayout(props.graph.document)
    resourceSections.value = result.sections
    clearSelection()
    emit('operation', {
      type: 'layout.set',
      value: result.layout,
    }, 'Arrange resources by type')
    return
  }
  resourceSections.value = []
  emit('operation', {
    type: 'layout.set',
    value: requestFlowLayout(props.graph.document, layoutDirection.value),
  }, `Arrange request flow ${layoutDirection.value === 'vertical' ? 'top to bottom' : 'left to right'}`)
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
  const flowNode = flowNodes.value.find(item => item.id === node.id)
  if (flowNode?.position) {
    nextTick(() => setCenter(flowNode.position.x + 80, flowNode.position.y + 30, { zoom: 0.85, duration: 250 }))
  }
  refreshIcons()
}

function selectReferencedNode(node) {
  selectNode({ node })
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

function referenceTitle(reference) {
  return reference.node.resourceType === 'api-route' && reference.route
    ? reference.route
    : reference.node.name
}

function referenceMeta(reference) {
  const relation = relationshipLabel(reference.edge.relationType)
  const type = typeLabel(reference.node.resourceType)
  return reference.route && reference.node.resourceType !== 'api-route'
    ? `${reference.route} · ${type}`
    : `${relation} · ${type}`
}

function typeLabel(resourceType) {
  return nodeTypes.find(option => option.value === resourceType)?.label || {
    lambda: 'Lambda', sqs: 'SQS queue', eventbridge: 'EventBridge rule', stepfunctions: 'Step Functions',
    ecs: 'ECS', s3: 'S3 bucket', iam: 'IAM role', 'iam-policy': 'IAM policy', policy: 'Resource policy',
    sns: 'SNS', dynamodb: 'DynamoDB', logs: 'CloudWatch Logs', secret: 'Secret',
    'api-route': 'API Gateway route', 'api-integration': 'API Gateway integration', apigateway: 'API Gateway', apigatewayv2: 'API Gateway V2',
  }[resourceType] || String(resourceType || 'AWS resource').replaceAll('-', ' ')
}

function relationshipStatus(status) {
  return { automatic: 'Automatic', suggested: 'Suggested', manual: 'Confirmed', stale: 'Stale' }[status] || status
}

function relationshipLabel(relationType) {
  return { depends_on: 'depends on', triggers: 'triggers', invokes: 'invokes', runs_on: 'runs on', routes_to: 'routes to' }[relationType]
    || String(relationType || 'depends_on').replaceAll('_', ' ')
}

const presentationForType = architectureResourcePresentation

function refreshIcons() {
  nextTick(() => createIcons({ icons }))
}

watch(() => props.graph, syncGraph, { deep: true, immediate: true })
watch(showEdgeLabels, syncGraph)
watch(layoutMode, mode => {
  if (mode !== 'resource-type') resourceSections.value = []
  syncGraph()
})
onMounted(refreshIcons)
</script>

<style scoped>
.architecture-canvas-shell { border: 1px solid var(--border); border-radius: 6px; overflow: hidden; background: var(--bg-panel); }
.canvas-toolbar { min-height: 48px; padding: 7px 9px; display: flex; align-items: center; gap: 8px; border-bottom: 1px solid var(--border); }
.canvas-toolbar .ctrl-input { width: min(240px, 32vw); }
.canvas-toolbar .ctrl-select { width: 145px; }
.canvas-layout-controls { display: flex; align-items: center; gap: 6px; }
.canvas-layout-controls .ctrl-select { width: 168px; }
.canvas-layout-controls .direction-select { width: 166px; }
.canvas-hint { margin-left: auto; color: var(--text-dim); font-size: 11px; }
.canvas-body { position: relative; height: clamp(420px, 58vh, 680px); }
.architecture-flow { width: 100%; height: 100%; background: var(--bg-panel); }
.architecture-node { min-width: 155px; display: flex; align-items: center; gap: 9px; color: var(--text); text-align: left; }
.architecture-node > span:last-child { display: flex; flex-direction: column; }
.node-title { display: flex; align-items: center; gap: 6px; }
.architecture-node small { margin-top: 2px; color: var(--text-dim); font-size: 10px; }
.resource-section { width: 100%; height: 100%; padding: 12px 16px; display: flex; align-items: flex-start; justify-content: space-between; border: 1px solid color-mix(in srgb, var(--border) 82%, #58a6ff); border-radius: 6px; background: color-mix(in srgb, var(--bg) 70%, transparent); color: var(--text-dim); pointer-events: none; }
.resource-section span { display: flex; align-items: center; gap: 7px; font-size: 11px; font-weight: 700; text-transform: uppercase; }
.resource-section span :deep(svg) { width: 14px; height: 14px; color: #58a6ff; }
.resource-section strong { min-width: 24px; padding: 2px 6px; border-radius: 10px; background: var(--bg-panel); color: var(--text); font-size: 10px; text-align: center; }
.node-icon { width: 30px; height: 30px; display: grid; place-items: center; flex: 0 0 30px; border: 1px solid transparent; border-radius: 5px; color: white; }
.node-icon :deep(svg) { width: 16px; height: 16px; }
.node-icon--compute { background: #d86613; }
.node-icon--application { background: #c71370; }
.node-icon--storage { background: #2f7d32; }
.node-icon--database { background: #3569a8; }
.node-icon--network { background: #6c4eb6; }
.node-icon--management { background: #39788f; }
.node-icon--neutral { background: #59636e; }
.node-icon--security-simple { border-color: #b74856; background: transparent; color: #d75a68; }
.api-method { min-width: 31px; padding: 2px 4px; border-radius: 3px; font-family: ui-monospace, monospace; font-size: 9px; line-height: 1; text-align: center; color: #fff; background: #6e7781; }
.api-method--get { background: #287f3b; }
.api-method--post { background: #2869a8; }
.api-method--put, .api-method--patch { background: #9a6700; }
.api-method--delete { background: #b4232d; }
.canvas-empty { position: absolute; inset: 48px 0 0; pointer-events: none; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 7px; color: var(--text-dim); text-align: center; }
.canvas-empty i { width: 34px; height: 34px; color: #2f81f7; }
.canvas-empty strong { color: var(--text); }
.canvas-inspector { position: absolute; top: 12px; right: 12px; width: 240px; padding: 12px; display: flex; flex-direction: column; gap: 11px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-panel); box-shadow: 0 12px 30px rgba(0, 0, 0, .22); }
.canvas-inspector header { display: flex; align-items: center; justify-content: space-between; }
.canvas-inspector header span, .relationship-direction { display: flex; align-items: center; gap: 6px; color: var(--text-dim); }
.canvas-inspector label { display: flex; flex-direction: column; gap: 5px; color: var(--text-dim); font-size: 11px; }
.canvas-inspector .ctrl-input, .canvas-inspector .ctrl-select { width: 100%; }
.inspector-id { color: var(--text-dim); word-break: break-all; }
.component-references { display: flex; flex-direction: column; gap: 5px; }
.inspector-section-title { color: var(--text-dim); font-size: 10px; font-weight: 700; text-transform: uppercase; }
.component-reference { width: 100%; padding: 7px; display: flex; align-items: center; gap: 7px; border: 1px solid var(--border); border-radius: 4px; background: var(--bg); color: var(--text); text-align: left; cursor: pointer; }
.component-reference:hover { border-color: #2f81f7; }
.component-reference > svg { width: 14px; height: 14px; flex: 0 0 14px; color: #58a6ff; }
.component-reference > span { min-width: 0; display: flex; flex-direction: column; }
.component-reference strong, .component-reference small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.component-reference small { margin-top: 2px; color: var(--text-dim); font-size: 10px; }
.inspector-actions { display: flex; justify-content: space-between; gap: 7px; }
.relationship-direction { padding: 3px 0; }
.relationship-status { width: fit-content; padding: 3px 6px; border-radius: 4px; font-size: 11px; font-weight: 700; }
.relationship-status.automatic { color: #58a6ff; background: color-mix(in srgb, #2f81f7 14%, transparent); }
.relationship-status.suggested { color: #d29922; background: color-mix(in srgb, #d29922 14%, transparent); }
.relationship-status.manual { color: #3fb950; background: color-mix(in srgb, #3fb950 14%, transparent); }
.relationship-evidence { color: var(--text-dim); overflow-wrap: anywhere; }
:deep(.vue-flow__node-default) { padding: 10px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); box-shadow: 0 4px 12px rgba(0, 0, 0, .18); }
:deep(.vue-flow__node-resource-section) { border: 0; background: transparent; box-shadow: none; pointer-events: none; }
:deep(.vue-flow__node.selected) { box-shadow: 0 0 0 2px #2f81f7; }
:deep(.vue-flow__handle) { width: 9px; height: 9px; background: #2f81f7; border: 2px solid var(--bg-panel); }
:deep(.vue-flow__edge-path) { stroke: #7d8590; stroke-width: 1.8; }
:deep(.vue-flow__edge.selected .vue-flow__edge-path) { stroke: #2f81f7; }
:deep(.vue-flow__node), :deep(.vue-flow__edge) { transition: opacity .16s ease; }
@media (max-width: 760px) {
  .canvas-toolbar { flex-wrap: wrap; }
  .canvas-toolbar .ctrl-input { width: calc(100% - 153px); }
  .canvas-layout-controls { width: 100%; }
  .canvas-layout-controls .ctrl-select { flex: 1; width: auto; }
  .canvas-hint { width: 100%; margin-left: 0; }
  .canvas-body { height: 500px; }
  .canvas-inspector { right: 8px; width: min(240px, calc(100% - 16px)); }
}
</style>