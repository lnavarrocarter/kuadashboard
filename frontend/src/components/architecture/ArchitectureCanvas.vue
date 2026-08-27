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
        <select v-model="providerFilter" class="ctrl-select provider-filter" title="Filter providers" @change="persistView">
          <option value="all">All providers</option>
          <option v-for="provider in availableProviders" :key="provider" :value="provider">{{ providerLabel(provider) }}</option>
        </select>
        <select v-if="availableKubeContexts.length" v-model="kubeContextFilter" class="ctrl-select" title="Filter Kubernetes context" @change="persistView">
          <option value="">All Kubernetes contexts</option>
          <option v-for="context in availableKubeContexts" :key="context" :value="context">{{ context }}</option>
        </select>
        <select v-if="availableNamespaces.length" v-model="namespaceFilter" class="ctrl-select" title="Filter Kubernetes namespace" @change="persistView">
          <option value="">All namespaces</option>
          <option v-for="namespace in availableNamespaces" :key="namespace" :value="namespace">{{ namespace }}</option>
        </select>
        <select v-model="layoutMode" class="ctrl-select" title="Canvas arrangement" @change="persistView">
          <option value="request-flow">Request flow</option>
          <option value="resource-type">Resource type sections</option>
        </select>
        <select v-if="layoutMode === 'request-flow'" v-model="layoutDirection" class="ctrl-select direction-select" title="Request flow direction" @change="persistView">
          <option value="horizontal">Flow left to right</option>
          <option value="vertical">Flow top to bottom</option>
        </select>
        <button class="btn sm" :disabled="saving || !flowNodes.length" @click="arrangeFlow">
          <i :data-lucide="layoutMode === 'resource-type' ? 'rows-3' : 'layout-dashboard'"></i>
          {{ layoutMode === 'resource-type' ? 'Arrange by type' : 'Arrange flow' }}
        </button>
        <button :class="['btn', 'sm', { primary: showEdgeLabels }]" :disabled="!flowEdges.length" title="Toggle relationship labels" @click="toggleEdgeLabels">
          <i data-lucide="tags"></i> Labels
        </button>
        <button :class="['btn', 'sm', { primary: showHealthOverlay }]" :disabled="!flowNodes.length" title="Toggle health/freshness overlay" @click="toggleHealthOverlay">
          <i data-lucide="heart-pulse"></i> Health
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
            <span
              v-if="data.health"
              :class="['node-health-badge', `node-health-badge--${data.health.status}`]"
              :title="data.health.label"
            ></span>
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
        <section v-if="selectedNode.kind || selectedNode.stackName || selectedNode.arn" class="component-metadata">
          <span v-if="selectedNode.kind"><small>CloudFormation type</small><strong>{{ selectedNode.kind }}</strong></span>
          <span v-if="selectedNode.stackName"><small>Stack</small><strong>{{ selectedNode.stackName }}</strong></span>
          <span v-if="selectedNode.logicalId"><small>Logical ID</small><strong>{{ selectedNode.logicalId }}</strong></span>
          <span v-if="selectedNode.arn"><small>ARN</small><strong>{{ selectedNode.arn }}</strong></span>
        </section>
        <section v-if="selectedNodeApiRoutes.length" class="api-gateway-routes">
          <span class="inspector-section-title">API Gateway routes</span>
          <button v-for="route in selectedNodeApiRoutes" :key="route.key" class="component-reference" @click="selectReferencedNode(route.node)">
            <i data-lucide="route"></i>
            <span>
              <strong>{{ route.route }}</strong>
              <small>{{ route.permissions }} Lambda permission{{ route.permissions === 1 ? '' : 's' }} · {{ route.node.name }}</small>
            </span>
          </button>
        </section>
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
        <section v-if="nodeActions.length" class="component-node-actions">
          <span class="inspector-section-title">Navigate</span>
          <button
            v-for="action in nodeActions"
            :key="action.key"
            class="btn sm"
            @click="emit('node-action', { action: action.key, node: selectedNode })"
          ><i :data-lucide="action.icon"></i> {{ action.label }}</button>
        </section>
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
const emit = defineEmits(['operation', 'inspect-workflow', 'node-action'])

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
const showHealthOverlay = ref(false)
const providerFilter = ref('all')
const kubeContextFilter = ref('')
const namespaceFilter = ref('')
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
const selectedNodeApiRoutes = computed(() => {
  if (!selectedNode.value || selectedNode.value.resourceType !== 'lambda') return []
  const nodesById = new Map(props.graph.document.nodes.map(node => [node.id, node]))
  const routes = new Map()
  for (const edge of props.graph.document.edges) {
    if (edge.status === 'rejected' || edge.targetNodeId !== selectedNode.value.id || edge.relationType !== 'routes_to') continue
    const node = nodesById.get(edge.sourceNodeId)
    const route = edge.evidence?.find(item => item.route)?.route || node?.name || 'API Gateway route'
    const permissions = edge.evidence?.filter(item => item.type === 'lambda_permission').length || 0
    const key = `${node?.id}:${route}`
    const current = routes.get(key)
    if (!current || permissions > current.permissions) routes.set(key, { key, node, route, permissions })
  }
  return [...routes.values()].filter(item => item.node).sort((left, right) => left.route.localeCompare(right.route))
})
const KUBE_LOG_KINDS = ['Deployment', 'StatefulSet', 'DaemonSet', 'Pod']
const KUBE_WORKLOAD_KINDS = ['Deployment', 'StatefulSet', 'DaemonSet']
const KUBE_DETAIL_KINDS = ['Pod', 'Deployment', 'StatefulSet', 'DaemonSet', 'Service', 'Ingress', 'ConfigMap', 'Secret', 'PersistentVolumeClaim']
const AWS_DETAIL_TYPES = ['lambda', 'ec2', 'eventbridge', 'stepfunctions']
const nodeActions = computed(() => {
  const node = selectedNode.value
  if (!node) return []
  const actions = []
  if (node.provider === 'kubernetes') {
    if (KUBE_LOG_KINDS.includes(node.kind)) {
      actions.push({ key: 'kubernetes-logs', label: 'View logs', icon: 'scroll-text' })
      actions.push({ key: 'kubernetes-log-suggestions', label: 'Suggest relationships from logs', icon: 'sparkles' })
    }
    if (KUBE_DETAIL_KINDS.includes(node.kind)) actions.push({ key: 'kubernetes-detail', label: 'View detail', icon: 'file-code-2' })
    if (KUBE_WORKLOAD_KINDS.includes(node.kind)) actions.push({ key: 'kubernetes-pods', label: 'View pods', icon: 'boxes' })
  } else if (AWS_DETAIL_TYPES.includes(node.resourceType)) {
    if (node.resourceType === 'lambda') actions.push({ key: 'aws-logs', label: 'View logs', icon: 'scroll-text' })
    actions.push({ key: 'aws-detail', label: 'Open in AWS view', icon: 'external-link' })
  }
  return actions
})
const focusedNodeIds = computed(() => selectedNode.value
  ? new Set([selectedNode.value.id, ...selectedNodeReferences.value.map(reference => reference.node.id)])
  : null)
const availableProviders = computed(() => [...new Set((props.graph?.document?.nodes || []).map(node => node.provider).filter(Boolean))].sort())
const availableKubeContexts = computed(() => [...new Set((props.graph?.document?.nodes || [])
  .filter(node => node.provider === 'kubernetes' && node.kubeContext).map(node => node.kubeContext))].sort())
const availableNamespaces = computed(() => [...new Set((props.graph?.document?.nodes || [])
  .filter(node => node.provider === 'kubernetes' && node.namespace).map(node => node.namespace))].sort())
const filteredGraphDocument = computed(() => {
  const document = props.graph?.document || { nodes: [], edges: [] }
  const nodes = (document.nodes || []).filter(node =>
    (providerFilter.value === 'all' || node.provider === providerFilter.value) &&
    (!kubeContextFilter.value || node.kubeContext === kubeContextFilter.value) &&
    (!namespaceFilter.value || node.namespace === namespaceFilter.value))
  const ids = new Set(nodes.map(node => node.id))
  return { ...document, nodes, edges: (document.edges || []).filter(edge => ids.has(edge.sourceNodeId) && ids.has(edge.targetNodeId)) }
})
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
  if (!focusedNodeIds.value) return visible
  const related = edge.source === selectedNode.value.id || edge.target === selectedNode.value.id
  return {
    ...visible,
    label: related && showEdgeLabels.value ? visible.label : undefined,
    labelStyle: related && showEdgeLabels.value ? { fill: '#f0f6fc', fontWeight: 700 } : undefined,
    labelBgStyle: related && showEdgeLabels.value ? { fill: '#1f6feb', fillOpacity: 0.92 } : undefined,
    style: {
      ...visible.style,
      opacity: related ? 1 : 0.035,
      ...(related && showEdgeLabels.value ? { stroke: '#1f6feb', strokeWidth: 2.4 } : {}),
    },
  }
}))

function manualId(prefix) {
  const value = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return `manual:${prefix}:${value}`
}

// Reuses health already captured by discovery (Kubernetes) and sync freshness state (AWS),
// without inventing new backend telemetry; opt-in via the Health toggle to keep dense diagrams readable.
function nodeHealthOverlay(node) {
  if (!showHealthOverlay.value) return null
  if (node.syncState === 'stale') return { status: 'stale', label: 'Stale — missing from the last sync' }
  const status = node.health?.status
  if (status === 'degraded') return { status: 'degraded', label: 'Degraded' }
  if (status === 'healthy') return { status: 'healthy', label: 'Healthy' }
  return null
}

function syncGraph(hydrateView = true) {
  const document = props.graph?.document
  if (!document) return
  if (hydrateView && document.view && typeof document.view === 'object') {
    if (document.view.layoutMode === 'resource-type' || document.view.layoutMode === 'request-flow') {
      layoutMode.value = document.view.layoutMode
    }
    if (document.view.layoutDirection === 'horizontal' || document.view.layoutDirection === 'vertical') {
      layoutDirection.value = document.view.layoutDirection
    }
    showEdgeLabels.value = document.view.showEdgeLabels === true
    showHealthOverlay.value = document.view.showHealthOverlay === true
    providerFilter.value = document.view.providerFilter || 'all'
    kubeContextFilter.value = document.view.kubeContextFilter || ''
    namespaceFilter.value = document.view.namespaceFilter || ''
  }
  const visibleDocument = filteredGraphDocument.value
  const visibleNodes = visibleDocument.nodes
  const visibleEdges = visibleDocument.edges
  resourceSections.value = layoutMode.value === 'resource-type' ? resourceTypeLayout(visibleDocument).sections : []
  const columns = Math.min(10, Math.max(4, Math.ceil(Math.sqrt(visibleNodes.length * 1.6))))
  flowNodes.value = visibleNodes.map((node, index) => {
    const route = visibleEdges
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
        health: nodeHealthOverlay(node),
      },
    }
  })
  flowEdges.value = visibleEdges.filter(edge => edge.status !== 'rejected').map(edge => ({
    id: edge.id,
    source: edge.sourceNodeId,
    target: edge.targetNodeId,
    label: showEdgeLabels.value ? relationshipLabel(edge.relationType) : undefined,
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
    const result = resourceTypeLayout(filteredGraphDocument.value)
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
    value: requestFlowLayout(filteredGraphDocument.value, layoutDirection.value),
  }, `Arrange request flow ${layoutDirection.value === 'vertical' ? 'top to bottom' : 'left to right'}`)
}

function persistView() {
  if (props.saving) return
  if (layoutMode.value === 'resource-type') resourceSections.value = resourceTypeLayout(props.graph.document).sections
  emit('operation', {
    type: 'view.set',
    value: {
      layoutMode: layoutMode.value,
      layoutDirection: layoutDirection.value,
      showEdgeLabels: showEdgeLabels.value,
      showHealthOverlay: showHealthOverlay.value,
      providerFilter: providerFilter.value,
      kubeContextFilter: kubeContextFilter.value,
      namespaceFilter: namespaceFilter.value,
    },
  }, 'Update canvas view')
}

function toggleEdgeLabels() {
  showEdgeLabels.value = !showEdgeLabels.value
  persistView()
}

function toggleHealthOverlay() {
  showHealthOverlay.value = !showHealthOverlay.value
  persistView()
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
    lambda: 'Lambda', layer: 'Lambda layer', sqs: 'SQS queue', eventbridge: 'EventBridge rule', stepfunctions: 'Step Functions',
    ecs: 'ECS', s3: 'S3 bucket', iam: 'IAM role', 'iam-policy': 'IAM policy', policy: 'Resource policy',
    sns: 'SNS', dynamodb: 'DynamoDB', logs: 'CloudWatch Logs', secret: 'Secret',
    kubernetes: 'Kubernetes cluster', deployment: 'Kubernetes Deployment', statefulset: 'Kubernetes StatefulSet',
    daemonset: 'Kubernetes DaemonSet', pod: 'Kubernetes Pod', service: 'Kubernetes Service', ingress: 'Kubernetes Ingress',
    configmap: 'Kubernetes ConfigMap', pvc: 'Kubernetes PersistentVolumeClaim',
    'api-route': 'API Gateway route', 'api-integration': 'API Gateway integration', apigateway: 'API Gateway', apigatewayv2: 'API Gateway V2',
  }[resourceType] || String(resourceType || 'AWS resource').replaceAll('-', ' ')
}

function providerLabel(provider) {
  return { aws: 'AWS', kubernetes: 'Kubernetes', gcp: 'GCP', vercel: 'Vercel', generic: 'General' }[provider] || provider
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

watch(() => props.graph, () => syncGraph(), { deep: true, immediate: true })
watch(layoutMode, mode => {
  if (mode !== 'resource-type') resourceSections.value = []
  syncGraph(false)
})
watch([providerFilter, kubeContextFilter, namespaceFilter, showHealthOverlay], () => syncGraph(false))
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
.architecture-node { min-width: 155px; display: flex; align-items: center; gap: 9px; color: var(--text); text-align: left; position: relative; }
.architecture-node > span:last-child { display: flex; flex-direction: column; }
.node-title { display: flex; align-items: center; gap: 6px; }
.architecture-node small { margin-top: 2px; color: var(--text-dim); font-size: 10px; }
.node-health-badge { position: absolute; top: -4px; right: -4px; width: 10px; height: 10px; border-radius: 50%; border: 2px solid var(--bg-panel); }
.node-health-badge--healthy { background: #3fb950; }
.node-health-badge--degraded { background: #d29922; }
.node-health-badge--stale { background: #6e7781; }
.component-metadata { display: grid; gap: 6px; padding: 8px 0; border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); }
.component-metadata > span { display: grid; grid-template-columns: 92px minmax(0, 1fr); gap: 7px; align-items: baseline; }
.component-metadata small { color: var(--text-dim); font-size: 10px; }
.component-metadata strong { overflow-wrap: anywhere; font-family: monospace; font-size: 10px; font-weight: 500; }
.api-gateway-routes { display: flex; flex-direction: column; gap: 5px; }
.resource-section { width: 100%; height: 100%; padding: 12px 16px; display: flex; align-items: flex-start; justify-content: space-between; border: 1px solid color-mix(in srgb, var(--border) 82%, #58a6ff); border-radius: 6px; background: color-mix(in srgb, var(--bg) 70%, transparent); color: var(--text-dim); pointer-events: none; }
.resource-section span { display: flex; align-items: center; gap: 7px; font-size: 11px; font-weight: 700; text-transform: uppercase; }
.resource-section span :deep(svg) { width: 14px; height: 14px; color: #58a6ff; }
.resource-section strong { min-width: 24px; padding: 2px 6px; border-radius: 10px; background: var(--bg-panel); color: var(--text); font-size: 10px; text-align: center; }
.node-icon { width: 30px; height: 30px; display: grid; place-items: center; flex: 0 0 30px; border: 1px solid transparent; border-radius: 5px; color: white; }
.node-icon :deep(svg) { width: 16px; height: 16px; }
.node-icon--compute { background: #d86613; }
.node-icon--kubernetes { background: #326ce5; }
.node-icon--kubernetes-network { background: #4b7bec; }
.node-icon--kubernetes-config { background: #64748b; }
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
.canvas-inspector { position: absolute; top: 12px; right: 12px; bottom: 12px; width: 260px; max-height: calc(100% - 24px); padding: 12px; display: flex; flex-direction: column; gap: 11px; overflow-y: auto; overscroll-behavior: contain; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-panel); box-shadow: 0 12px 30px rgba(0, 0, 0, .22); }
.canvas-inspector::-webkit-scrollbar { width: 8px; }
.canvas-inspector::-webkit-scrollbar-thumb { border-radius: 10px; background: color-mix(in srgb, var(--text-dim) 38%, transparent); }
.canvas-inspector header { display: flex; align-items: center; justify-content: space-between; }
.canvas-inspector header span, .relationship-direction { display: flex; align-items: center; gap: 6px; color: var(--text-dim); }
.canvas-inspector label { display: flex; flex-direction: column; gap: 5px; color: var(--text-dim); font-size: 11px; }
.canvas-inspector .ctrl-input, .canvas-inspector .ctrl-select { width: 100%; }
.inspector-id { color: var(--text-dim); word-break: break-all; }
.component-references { display: flex; flex-direction: column; gap: 5px; }
.component-node-actions { display: flex; flex-direction: column; gap: 5px; }
.component-node-actions .btn { justify-content: flex-start; }
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
  .canvas-inspector { right: 8px; bottom: 8px; width: min(260px, calc(100% - 16px)); max-height: calc(100% - 16px); }
}
</style>