<template>
  <section class="architecture-canvas-shell">
    <header class="canvas-toolbar">
      <div class="canvas-toolbar-row canvas-create-controls">
        <input
          v-model.trim="nodeDraft.name"
          class="ctrl-input"
          maxlength="120"
          :placeholder="t('archCanvas.componentName')"
          @keyup.enter="addNode"
        />
        <select v-model="nodeDraft.resourceType" class="ctrl-select" :title="t('archCanvas.componentType')">
          <option v-for="option in nodeTypes" :key="option.value" :value="option.value">{{ option.label }}</option>
        </select>
        <button class="btn sm primary" :disabled="saving || !nodeDraft.name" @click="addNode">
          <i data-lucide="plus"></i> {{ t('archCanvas.addComponent') }}
        </button>
        <span class="canvas-hint">{{ t('archCanvas.dragHint') }}</span>
      </div>
      <div class="canvas-toolbar-row canvas-layout-controls">
        <label class="canvas-search"><i data-lucide="search"></i><input v-model.trim="nodeSearch" type="search" data-test="canvas-search" :placeholder="t('archCanvas.searchResources')" :aria-label="t('archCanvas.searchResources')" :title="t('archCanvas.searchEnterHint')" @keydown.enter.prevent="goToSearchMatch" /></label>
        <select v-model="layoutMode" class="ctrl-select" :title="t('archCanvas.arrangement')" @change="persistView">
          <option value="request-flow">{{ t('archCanvas.layout.requestFlow') }}</option>
          <option value="system-domains">{{ t('archCanvas.layout.systemDomains') }}</option>
          <option value="resource-type">{{ t('archCanvas.layout.resourceType') }}</option>
          <option value="provider-lanes">{{ t('archCanvas.layout.providerLanes') }}</option>
          <option value="provider-resource">{{ t('archCanvas.layout.providerResource') }}</option>
        </select>
        <select v-if="layoutMode === 'request-flow'" v-model="layoutDirection" class="ctrl-select direction-select" :title="t('archCanvas.flowDirection')" @change="persistView">
          <option value="horizontal">{{ t('archCanvas.flowLeftRight') }}</option>
          <option value="vertical">{{ t('archCanvas.flowTopBottom') }}</option>
        </select>
        <button class="btn sm" :disabled="saving || !flowNodes.length" @click="arrangeFlow">
          <i :data-lucide="['resource-type', 'provider-resource', 'system-domains'].includes(layoutMode) ? 'rows-3' : layoutMode === 'provider-lanes' ? 'columns-3' : 'layout-dashboard'"></i>
          {{ layoutMode === 'system-domains' ? t('archCanvas.arrangeDomains') : layoutMode === 'resource-type' ? t('archCanvas.arrangeByType') : layoutMode === 'provider-resource' ? t('archCanvas.arrangeSections') : layoutMode === 'provider-lanes' ? t('archCanvas.arrangeLanes') : t('archCanvas.arrangeFlow') }}
        </button>
      </div>
      <details class="canvas-control-disclosure" :open="activeFilterCount > 0">
        <summary><i data-lucide="filter"></i><span>{{ t('archCanvas.filters') }}</span><strong>{{ activeFilterCount || t('archCanvas.allResources') }}</strong></summary>
        <div class="canvas-toolbar-row canvas-filter-controls">
          <select v-model="systemDomainFilter" class="ctrl-select" :title="t('archCanvas.filterSystemDomain')" @change="persistView">
            <option value="all">{{ t('archCanvas.allSystemDomains') }}</option>
            <option v-for="domain in availableSystemDomains" :key="domain" :value="domain">{{ systemDomainLabel(domain) }}</option>
          </select>
          <select v-model="providerFilter" class="ctrl-select provider-filter" :title="t('archCanvas.filterProviders')" @change="persistView">
            <option value="all">{{ t('archCanvas.allProviders') }}</option>
            <option v-for="provider in availableProviders" :key="provider" :value="provider">{{ providerLabel(provider) }}</option>
          </select>
          <select v-if="availableKubeContexts.length" v-model="kubeContextFilter" class="ctrl-select" :title="t('archCanvas.filterKubeContext')" @change="persistView">
            <option value="">{{ t('archCanvas.allKubeContexts') }}</option>
            <option v-for="context in availableKubeContexts" :key="context" :value="context">{{ context }}</option>
          </select>
          <select v-if="availableNamespaces.length" v-model="namespaceFilter" class="ctrl-select" :title="t('archCanvas.filterNamespace')" @change="persistView">
            <option value="">{{ t('archCanvas.allNamespaces') }}</option>
            <option v-for="namespace in availableNamespaces" :key="namespace" :value="namespace">{{ namespace }}</option>
          </select>
          <select v-model="relationTypeFilter" class="ctrl-select" :title="t('archCanvas.filterRelationType')" @change="persistView">
            <option value="all">{{ t('archCanvas.allRelationTypes') }}</option>
            <option v-for="type in availableRelationTypes" :key="type" :value="type">{{ relationshipLabel(type) }}</option>
          </select>
          <select v-model="relationStatusFilter" class="ctrl-select" :title="t('archCanvas.filterRelationStatus')" @change="persistView">
            <option value="all">{{ t('archCanvas.allRelationStatuses') }}</option>
            <option v-for="status in availableRelationStatuses" :key="status" :value="status">{{ relationshipStatus(status) }}</option>
          </select>
        </div>
      </details>
      <details v-if="hiddenNodes.length" class="canvas-control-disclosure" data-test="hidden-nodes">
        <summary><i data-lucide="eye-off"></i><span>{{ t('archCanvas.hiddenNodes') }}</span><strong>{{ hiddenNodes.length }}</strong></summary>
        <ul class="canvas-hidden-list">
          <li v-for="node in hiddenNodes" :key="node.id">
            <span>{{ node.name || node.id }}</span>
            <button class="btn sm" :disabled="saving" :data-test="`show-node-${node.id}`" @click="showNode(node)"><i data-lucide="eye"></i> {{ t('archCanvas.showNode') }}</button>
          </li>
        </ul>
      </details>
      <details class="canvas-control-disclosure">
        <summary><i data-lucide="layers-3"></i><span>{{ t('archCanvas.mapLayers') }}</span><strong>{{ activeLayerCount }}</strong></summary>
        <div class="canvas-toolbar-row canvas-action-controls">
        <button :class="['btn', 'sm', { primary: showEdgeLabels }]" :disabled="!flowEdges.length" :title="t('archCanvas.toggleLabels')" @click="toggleEdgeLabels">
          <i data-lucide="tags"></i> {{ t('archCanvas.labels') }}
        </button>
        <button :class="['btn', 'sm', { primary: showHealthOverlay }]" :disabled="!flowNodes.length" :title="t('archCanvas.toggleHealth')" @click="toggleHealthOverlay">
          <i data-lucide="heart-pulse"></i> {{ t('archCanvas.health') }}
        </button>
        <button :class="['btn', 'sm', { primary: showMetricsOverlay }]" :disabled="metricsLoading || !flowNodes.length" :title="t('archCanvas.toggleMetrics')" @click="toggleMetricsOverlay">
          <i :data-lucide="metricsLoading ? 'loader-2' : 'chart-no-axes-combined'"></i> {{ t('archCanvas.metrics') }}
        </button>
        <button :class="['btn', 'sm', { primary: showCollectionOverlay }]" :disabled="collectionLoading || !flowNodes.length" :title="t('archCanvas.toggleCollection')" @click="toggleCollectionOverlay">
          <i :data-lucide="collectionLoading ? 'loader-2' : 'radio-tower'"></i> {{ t('archCanvas.collection') }}
        </button>
        <button :class="['btn', 'sm', { primary: showTraceOverlay }]" :disabled="traceLoading || !traceEnabled || !flowNodes.length" :title="t('archCanvas.toggleTrace')" @click="toggleTraceOverlay">
          <i :data-lucide="traceLoading ? 'loader-2' : 'route'"></i> {{ t('archCanvas.trace') }}
        </button>
        <button :class="['btn', 'sm', { primary: showEventsOverlay }]" :disabled="eventsLoading || !flowNodes.length" :title="t('archCanvas.toggleEvents')" @click="toggleEventsOverlay">
          <i :data-lucide="eventsLoading ? 'loader-2' : 'triangle-alert'"></i> {{ t('archCanvas.events') }}
        </button>
        <button :class="['btn', 'sm', { primary: showRolloutsOverlay }]" :disabled="rolloutsLoading || !hasDeployments" :title="t('archCanvas.toggleRollouts')" @click="toggleRolloutsOverlay">
          <i :data-lucide="rolloutsLoading ? 'loader-2' : 'rocket'"></i> {{ t('archCanvas.rollouts') }}
        </button>
        <button :class="['btn', 'sm', { primary: showSecurityOverlay }]" :disabled="securityLoading || !hasSecurityNodes" :title="t('archCanvas.toggleSecurity')" @click="toggleSecurityOverlay">
          <i :data-lucide="securityLoading ? 'loader-2' : 'shield-alert'"></i> {{ t('archCanvas.security') }}
        </button>
        <button class="btn sm" :disabled="exporting || !flowNodes.length" :title="t('archCanvas.exportPdfHint')" @click="exportPdf">
          <i data-lucide="printer"></i> {{ t('archCanvas.exportPdf') }}
        </button>
        <button class="btn sm" :disabled="!flowNodes.length" :title="t('archCanvas.exportMermaidHint')" @click="exportMermaid">
          <i data-lucide="file-code"></i> {{ t('archCanvas.exportMermaid') }}
        </button>
        <span v-if="showTraceOverlay && trace" class="trace-overlay-status">
          <i data-lucide="route"></i> {{ trace.executionName || t('archCanvas.latestTrace') }} · {{ t('archCanvas.traceNodes', { n: trace.nodeIds.length }) }}
          <button class="btn sm" type="button" @click="clearTraceOverlay">{{ t('archCanvas.clear') }}</button>
        </span>
        </div>
      </details>
    </header>

    <div ref="canvasBodyRef" class="canvas-body">
      <VueFlow
        :nodes="displayNodes"
        :edges="displayEdges"
        class="architecture-flow"
        :default-viewport="{ x: 40, y: 40, zoom: 0.9 }"
        :min-zoom="0.25"
        :max-zoom="2"
        :delete-key-code="null"
        @init="fitReadable()"
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
            <span v-if="data.metrics" class="node-metrics">
              <small v-if="data.metrics.loading">{{ t('archCanvas.loadingMetrics') }}</small>
              <small v-else-if="!data.metrics.items.length">{{ t('archCanvas.noMetricData') }}</small>
              <span v-else v-for="metric in data.metrics.items" :key="metric.key" class="node-metric">
                <small>{{ metric.label }}</small><strong>{{ metric.value }}</strong>
              </span>
            </span>
            <span v-if="data.collection" :class="['node-collection', `node-collection--${data.collection.status}`]" :title="data.collection.detail">
              <i :data-lucide="data.collection.icon"></i>{{ data.collection.label }}
            </span>
            <span v-if="data.trace" class="node-trace-badge" :title="data.trace.detail">
              <i data-lucide="route"></i>{{ data.trace.sequence }}
            </span>
            <span v-if="data.events" class="node-events-badge" :title="data.events.detail">
              <i data-lucide="triangle-alert"></i>{{ data.events.count }}
            </span>
            <span v-if="data.rollout" :class="['node-rollout-badge', `node-rollout-badge--${data.rollout.status}`]" :title="data.rollout.detail">
              <i data-lucide="rocket"></i>R{{ data.rollout.revision }}
            </span>
            <span v-if="data.security" :class="['node-security-badge', `node-security-badge--${data.security.severity}`]" :title="data.security.detail">
              <i data-lucide="shield-alert"></i>{{ data.security.count }}
            </span>
          </div>
        </template>
        <template #node-resource-section="{ data }">
          <div class="resource-section">
            <span><i :data-lucide="presentationForType(data.resourceType).icon"></i> {{ data.label || typeLabel(data.resourceType) }}</span>
            <strong>{{ data.count }}</strong>
          </div>
        </template>
      </VueFlow>

      <div v-if="!flowNodes.length" class="canvas-empty">
        <i data-lucide="boxes"></i>
        <strong>{{ t('archCanvas.emptyTitle') }}</strong>
        <span>{{ t('archCanvas.emptyHint') }}</span>
      </div>

      <aside v-if="selectedNode" class="canvas-inspector">
        <header>
          <span><i data-lucide="box"></i> {{ t('archCanvas.component') }}</span>
          <button class="btn sm btn-icon" data-test="canvas-zoom-neighbors" :title="t('archCanvas.zoomNeighbors')" :aria-label="t('archCanvas.zoomNeighbors')" @click="zoomToNeighbors()"><i data-lucide="scan-search"></i></button>
          <button class="btn sm btn-icon" :title="t('archCanvas.closeInspector')" @click="clearSelection"><i data-lucide="x"></i></button>
        </header>
        <label>{{ t('archCanvas.name') }}<input v-model.trim="editDraft.name" class="ctrl-input" maxlength="120" /></label>
        <label>{{ t('archCanvas.type') }}
          <select v-model="editDraft.resourceType" class="ctrl-select">
            <option v-for="option in editNodeTypes" :key="option.value" :value="option.value">{{ option.label }}</option>
          </select>
        </label>
        <small class="inspector-id">{{ selectedNode.id }}</small>
        <section v-if="selectedNode.kind || selectedNode.stackName || selectedNode.arn" class="component-metadata">
          <span v-if="selectedNode.kind"><small>{{ t('archCanvas.cfnType') }}</small><strong>{{ selectedNode.kind }}</strong></span>
          <span v-if="selectedNode.stackName"><small>Stack</small><strong>{{ selectedNode.stackName }}</strong></span>
          <span v-if="selectedNode.logicalId"><small>Logical ID</small><strong>{{ selectedNode.logicalId }}</strong></span>
          <span v-if="selectedNode.arn"><small>ARN</small><strong>{{ selectedNode.arn }}</strong></span>
        </section>
        <section v-if="selectedNodeApiRoutes.length" class="api-gateway-routes">
          <span class="inspector-section-title">{{ t('archCanvas.apiRoutes') }}</span>
          <button v-for="route in selectedNodeApiRoutes" :key="route.key" class="component-reference" @click="selectReferencedNode(route.node)">
            <i data-lucide="route"></i>
            <span>
              <strong>{{ route.route }}</strong>
              <small>{{ t(route.permissions === 1 ? 'archCanvas.lambdaPermission' : 'archCanvas.lambdaPermissions', { n: route.permissions }) }} · {{ route.node.name }}</small>
            </span>
          </button>
        </section>
        <section v-if="selectedNodeReferences.length" class="component-references">
          <span class="inspector-section-title">{{ t('archCanvas.references') }}</span>
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
        ><i data-lucide="workflow"></i> {{ t('archCanvas.workflowDiagram') }}</button>
        <section v-if="nodeActions.length" class="component-node-actions">
          <span class="inspector-section-title">{{ t('archCanvas.navigate') }}</span>
          <button
            v-for="action in nodeActions"
            :key="action.key"
            class="btn sm"
            @click="emit('node-action', { action: action.key, node: selectedNode })"
          ><i :data-lucide="action.icon"></i> {{ action.label }}</button>
        </section>
        <!-- Removing a node only edits this diagram: it never deletes infrastructure (#151). -->
        <div v-if="confirmingRemoval" class="inspector-confirm" data-test="remove-node-confirm" role="alert">
          <p>{{ t(isResourceNode(selectedNode) ? 'archCanvas.hideNodeExplain' : 'archCanvas.removeDrawingExplain') }}</p>
          <div class="inspector-actions">
            <button class="btn sm" :disabled="saving" @click="confirmingRemoval = false">{{ t('common.cancel') }}</button>
            <button class="btn sm danger" :disabled="saving" data-test="remove-node-confirmed" @click="removeNode">{{ t('archCanvas.removeNode') }}</button>
          </div>
        </div>
        <div v-else class="inspector-actions">
          <button class="btn sm primary" :disabled="saving || !editDraft.name" @click="saveNode"><i data-lucide="check"></i> {{ t('archCanvas.save') }}</button>
          <button class="btn sm danger" :disabled="saving" data-test="remove-node" @click="confirmingRemoval = true"><i :data-lucide="isResourceNode(selectedNode) ? 'eye-off' : 'x-circle'"></i> {{ t('archCanvas.removeNode') }}</button>
        </div>
      </aside>

      <aside v-else-if="selectedEdge" class="canvas-inspector">
        <header>
          <span><i data-lucide="git-branch"></i> {{ t('archCanvas.relationship') }}</span>
          <button class="btn sm btn-icon" :title="t('archCanvas.closeInspector')" @click="clearSelection"><i data-lucide="x"></i></button>
        </header>
        <strong>{{ nodeName(selectedEdge.sourceNodeId) }}</strong>
        <span class="relationship-direction"><i data-lucide="arrow-down"></i> {{ relationshipLabel(selectedEdge.relationType) }}</span>
        <strong>{{ nodeName(selectedEdge.targetNodeId) }}</strong>
        <span :class="['relationship-status', selectedEdge.status]">
          {{ relationshipStatus(selectedEdge.status) }} · {{ t('archCanvas.confidence', { pct: Math.round(selectedEdge.confidence * 100) }) }}
        </span>
        <small v-if="selectedEdge.evidence?.length" class="relationship-evidence">
          {{ selectedEdge.evidence[0].intrinsic || selectedEdge.evidence[0].type }} · {{ selectedEdge.evidence[0].path || t('archCanvas.recordedEvidence') }}
        </small>
        <div v-if="['automatic', 'suggested'].includes(selectedEdge.status)" class="inspector-actions">
          <button class="btn sm primary" :disabled="saving" @click="reviewEdge('accept')"><i data-lucide="check"></i> {{ t('archCanvas.accept') }}</button>
          <button class="btn sm danger" :disabled="saving" @click="reviewEdge('reject')"><i data-lucide="x"></i> {{ t('archCanvas.reject') }}</button>
        </div>
        <button v-else class="btn sm danger" :disabled="saving" @click="removeEdge"><i data-lucide="trash-2"></i> {{ t('archCanvas.deleteRelationship') }}</button>
      </aside>
    </div>
  </section>
</template>

<script setup>
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { createIcons, icons } from 'lucide'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import { getRectOfNodes, getTransformForBounds, MarkerType, useVueFlow, VueFlow } from '@vue-flow/core'
import { toPng } from 'html-to-image'
import { jsPDF } from 'jspdf'
import { useToast } from '../../composables/useToast'
import { useI18n } from '../../composables/useI18n'
import { providerLaneLayout, providerResourceLayout, requestFlowLayout, resourceTypeLayout, SYSTEM_DOMAIN_ORDER, systemDomainForNode, systemDomainLayout } from '../../lib/architectureLayout'
import { architectureResourcePresentation } from '../../lib/architectureResourcePresentation'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/controls/dist/style.css'

const props = defineProps({
  graph: { type: Object, required: true },
  saving: { type: Boolean, default: false },
  observabilityEnabled: { type: Boolean, default: false },
  metrics: { type: Object, default: () => ({}) },
  metricsLoading: { type: Boolean, default: false },
  collection: { type: Object, default: () => ({}) },
  collectionLoading: { type: Boolean, default: false },
  traceEnabled: { type: Boolean, default: false },
  trace: { type: Object, default: null },
  traceLoading: { type: Boolean, default: false },
  events: { type: Object, default: () => ({}) },
  eventsLoading: { type: Boolean, default: false },
  rollouts: { type: Object, default: () => ({}) },
  rolloutsLoading: { type: Boolean, default: false },
  security: { type: Object, default: () => ({}) },
  securityLoading: { type: Boolean, default: false },
})
const emit = defineEmits(['operation', 'inspect-workflow', 'node-action', 'request-metrics', 'request-trace', 'request-events', 'request-rollouts', 'request-security', 'resource-selected'])

const { t } = useI18n()
const nodeTypes = computed(() => [
  { value: 'service', label: t('archCanvas.nodeType.service') },
  { value: 'api', label: 'API' },
  { value: 'database', label: t('archCanvas.nodeType.database') },
  { value: 'queue', label: t('archCanvas.nodeType.queue') },
  { value: 'function', label: t('archCanvas.nodeType.function') },
  { value: 'storage', label: t('archCanvas.nodeType.storage') },
  { value: 'external', label: t('archCanvas.nodeType.external') },
])
const nodeDraft = reactive({ name: '', resourceType: 'service' })
const editDraft = reactive({ name: '', resourceType: 'service' })
const editNodeTypes = computed(() => nodeTypes.value.some(option => option.value === editDraft.resourceType)
  ? nodeTypes.value
  : [...nodeTypes.value, { value: editDraft.resourceType, label: typeLabel(editDraft.resourceType) }])
const flowNodes = ref([])
const flowEdges = ref([])
const layoutMode = ref('request-flow')
// Above this many resources a map without a chosen arrangement opens grouped by domain (#239).
const LARGE_MAP_NODES = 40
let largeMapDefaultApplied = false
const layoutDirection = ref('horizontal')
const resourceSections = ref([])
const fitAfterSync = ref(false)
const showEdgeLabels = ref(false)
const showHealthOverlay = ref(false)
const showMetricsOverlay = ref(false)
const showCollectionOverlay = ref(false)
const showTraceOverlay = ref(false)
const showEventsOverlay = ref(false)
const showRolloutsOverlay = ref(false)
const showSecurityOverlay = ref(false)
const providerFilter = ref('all')
const kubeContextFilter = ref('')
const namespaceFilter = ref('')
const relationTypeFilter = ref('all')
const relationStatusFilter = ref('all')
const systemDomainFilter = ref('all')
const nodeSearch = ref('')
const exporting = ref(false)
const canvasBodyRef = ref(null)
const { fitView, setCenter, getNodes } = useVueFlow()
const { toast } = useToast()
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
    const route = edge.evidence?.find(item => item.route)?.route || node?.name || t('archCanvas.type.apiRoute')
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
const OBSERVABILITY_KUBE_KINDS = ['Pod', 'Deployment', 'StatefulSet', 'DaemonSet']
const nodeActions = computed(() => {
  const node = selectedNode.value
  if (!node) return []
  const actions = []
  if (node.provider === 'kubernetes') {
    if (KUBE_LOG_KINDS.includes(node.kind)) {
      actions.push({ key: 'kubernetes-logs', label: t('archCanvas.action.viewLogs'), icon: 'scroll-text' })
      actions.push({ key: 'inline-logs', label: t('archCanvas.action.viewLogsHere'), icon: 'panel-right' })
      actions.push({ key: 'kubernetes-log-suggestions', label: t('archCanvas.action.suggestFromLogs'), icon: 'sparkles' })
    }
    if (KUBE_DETAIL_KINDS.includes(node.kind)) actions.push({ key: 'kubernetes-detail', label: t('archCanvas.action.viewDetail'), icon: 'file-code-2' })
    if (KUBE_WORKLOAD_KINDS.includes(node.kind)) actions.push({ key: 'kubernetes-pods', label: t('archCanvas.action.viewPods'), icon: 'boxes' })
    if (props.observabilityEnabled && OBSERVABILITY_KUBE_KINDS.includes(node.kind)) {
      actions.push({ key: 'observability-metrics', label: t('archCanvas.action.viewMetrics'), icon: 'chart-no-axes-combined' })
      actions.push({ key: 'inline-metrics', label: t('archCanvas.action.viewMetricsHere'), icon: 'panel-right' })
    }
  } else if (AWS_DETAIL_TYPES.includes(node.resourceType)) {
    if (node.resourceType === 'lambda') {
      actions.push({ key: 'aws-logs', label: t('archCanvas.action.viewLogs'), icon: 'scroll-text' })
      actions.push({ key: 'inline-logs', label: t('archCanvas.action.viewLogsHere'), icon: 'panel-right' })
    }
    actions.push({ key: 'aws-detail', label: t('archCanvas.action.openAws'), icon: 'external-link' })
    if (props.observabilityEnabled && ['lambda', 'ec2'].includes(node.resourceType)) {
      actions.push({ key: 'observability-metrics', label: t('archCanvas.action.viewMetrics'), icon: 'chart-no-axes-combined' })
      actions.push({ key: 'inline-metrics', label: t('archCanvas.action.viewMetricsHere'), icon: 'panel-right' })
    }
    if (props.observabilityEnabled && node.resourceType === 'stepfunctions') {
      actions.push({ key: 'observability-traces', label: t('archCanvas.action.viewTraces'), icon: 'route' })
    }
  }
  return actions
})
const focusedNodeIds = computed(() => selectedNode.value
  ? new Set([selectedNode.value.id, ...selectedNodeReferences.value.map(reference => reference.node.id)])
  : null)
const availableProviders = computed(() => [...new Set((props.graph?.document?.nodes || []).map(node => node.provider).filter(Boolean))].sort())
const availableSystemDomains = computed(() => SYSTEM_DOMAIN_ORDER.filter(domain =>
  (props.graph?.document?.nodes || []).some(node => systemDomainForNode(node) === domain)))
const hasDeployments = computed(() => (props.graph?.document?.nodes || []).some(node => node.provider === 'kubernetes' && node.kind === 'Deployment'))
const hasSecurityNodes = computed(() => (props.graph?.document?.nodes || []).some(node => ['aws', 'kubernetes'].includes(node.provider)))
const availableKubeContexts = computed(() => [...new Set((props.graph?.document?.nodes || [])
  .filter(node => node.provider === 'kubernetes' && node.kubeContext).map(node => node.kubeContext))].sort())
const availableNamespaces = computed(() => [...new Set((props.graph?.document?.nodes || [])
  .filter(node => node.provider === 'kubernetes' && node.namespace).map(node => node.namespace))].sort())
const availableRelationTypes = computed(() => [...new Set((props.graph?.document?.edges || [])
  .map(edge => edge.relationType || 'depends_on'))].sort((left, right) => relationshipLabel(left).localeCompare(relationshipLabel(right))))
const availableRelationStatuses = computed(() => [...new Set((props.graph?.document?.edges || [])
  .map(edge => edge.status || 'automatic'))].sort())
const activeFilterCount = computed(() => [
  nodeSearch.value.trim(),
  providerFilter.value !== 'all',
  systemDomainFilter.value !== 'all',
  Boolean(kubeContextFilter.value),
  Boolean(namespaceFilter.value),
  relationTypeFilter.value !== 'all',
  relationStatusFilter.value !== 'all',
].filter(Boolean).length)
const activeLayerCount = computed(() => [
  showEdgeLabels.value, showHealthOverlay.value, showMetricsOverlay.value, showCollectionOverlay.value,
  showTraceOverlay.value, showEventsOverlay.value, showRolloutsOverlay.value, showSecurityOverlay.value,
].filter(Boolean).length)
const filteredGraphDocument = computed(() => {
  const document = props.graph?.document || { nodes: [], edges: [] }
  const query = nodeSearch.value.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase()
  const nodes = (document.nodes || []).filter(node => !node.hidden &&
    (providerFilter.value === 'all' || node.provider === providerFilter.value) &&
    (systemDomainFilter.value === 'all' || systemDomainForNode(node) === systemDomainFilter.value) &&
    (!kubeContextFilter.value || node.kubeContext === kubeContextFilter.value) &&
    (!namespaceFilter.value || node.namespace === namespaceFilter.value) &&
    (!query || `${node.name || ''} ${node.label || ''} ${node.kind || ''} ${node.resourceType || ''} ${node.provider || ''}`
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().includes(query)))
  const ids = new Set(nodes.map(node => node.id))
  return { ...document, nodes, edges: (document.edges || []).filter(edge =>
    ids.has(edge.sourceNodeId) && ids.has(edge.targetNodeId) &&
    (relationTypeFilter.value === 'all' || (edge.relationType || 'depends_on') === relationTypeFilter.value) &&
    (relationStatusFilter.value === 'all' || (edge.status || 'automatic') === relationStatusFilter.value)) }
})
const traceNodeIds = computed(() => new Set(props.trace?.nodeIds || []))
const traceEdgeIds = computed(() => new Set(props.trace?.edgeIds || []))
const smartSpacing = computed(() => {
  const expanded = showMetricsOverlay.value || showCollectionOverlay.value || showTraceOverlay.value || showEventsOverlay.value || showRolloutsOverlay.value || showSecurityOverlay.value
  const denseLabels = showEdgeLabels.value && flowEdges.value.length > 20
  const extraY = (showMetricsOverlay.value ? 54 : 0) + (showCollectionOverlay.value ? 28 : 0) + (showTraceOverlay.value ? 24 : 0) + (showEventsOverlay.value ? 28 : 0) + (denseLabels ? 18 : 0)
  const extraX = (showMetricsOverlay.value ? 58 : 0) + (showCollectionOverlay.value ? 34 : 0) + (showEventsOverlay.value ? 34 : 0) + (denseLabels ? 24 : 0)
  return {
    requestXGap: 280 + extraX,
    requestYGap: 130 + extraY,
    requestVerticalXGap: 240 + Math.floor(extraX * 0.8),
    requestVerticalYGap: 150 + extraY,
    gridXGap: 220 + extraX,
    gridYGap: 120 + extraY,
    laneXGap: 240 + extraX,
    laneYGap: 122 + extraY,
    providerResourceXGap: 220 + extraX,
    providerResourceYGap: 120 + extraY,
    expanded,
  }
})
const sectionNodes = computed(() => ['resource-type', 'provider-lanes', 'provider-resource', 'system-domains'].includes(layoutMode.value) ? resourceSections.value.map(section => ({
  id: `section:${section.type}`,
  type: 'resource-section',
  position: { x: section.x, y: section.y },
  data: { resourceType: section.resourceType || section.type, label: sectionLabel(section), count: section.count },
  style: { width: `${section.width}px`, height: `${section.height}px` },
  selectable: false,
  draggable: false,
  connectable: false,
  focusable: false,
  zIndex: section.zIndex ?? -1,
})) : [])
function withoutOpacity(item) {
  const { opacity: _opacity, ...style } = item.style || {}
  return { ...item, style: Object.keys(style).length ? style : undefined }
}
const displayNodes = computed(() => [...sectionNodes.value, ...flowNodes.value.map(node => {
  const visible = withoutOpacity(node)
  let opacity = 1
  if (focusedNodeIds.value) opacity = focusedNodeIds.value.has(node.id) ? 1 : 0.14
  if (showTraceOverlay.value && props.trace) opacity = traceNodeIds.value.has(node.id) ? opacity : Math.min(opacity, 0.18)
  return opacity === 1 ? visible : { ...visible, style: { ...visible.style, opacity } }
})])
const displayEdges = computed(() => flowEdges.value.map(edge => {
  const visible = withoutOpacity(edge)
  const traceActive = showTraceOverlay.value && props.trace
  if (!focusedNodeIds.value && !traceActive) return visible
  const related = focusedNodeIds.value && (edge.source === selectedNode.value.id || edge.target === selectedNode.value.id)
  const traceRelated = traceActive && traceEdgeIds.value.has(edge.id)
  let opacity = 1
  if (focusedNodeIds.value) opacity = related ? 1 : 0.035
  if (traceActive) opacity = traceRelated ? opacity : Math.min(opacity, 0.1)
  return {
    ...visible,
    label: related && showEdgeLabels.value ? visible.label : undefined,
    labelStyle: related && showEdgeLabels.value ? { fill: '#f0f6fc', fontWeight: 700 } : undefined,
    labelBgStyle: related && showEdgeLabels.value ? { fill: '#1f6feb', fillOpacity: 0.92 } : undefined,
    style: {
      ...visible.style,
      opacity,
      ...(related && showEdgeLabels.value ? { stroke: '#1f6feb', strokeWidth: 2.4 } : {}),
      ...(traceRelated ? { stroke: '#f778ba', strokeWidth: 3, opacity: 1 } : {}),
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
  if (node.syncState === 'stale') return { status: 'stale', label: t('archCanvas.health.stale') }
  const status = node.health?.status
  if (status === 'degraded') return { status: 'degraded', label: t('archCanvas.health.degraded') }
  if (status === 'healthy') return { status: 'healthy', label: t('archCanvas.health.healthy') }
  return null
}

function nodeMetricsOverlay(node) {
  if (!showMetricsOverlay.value) return null
  return props.metrics[node.id] || { loading: props.metricsLoading, items: [] }
}

function nodeCollectionOverlay(node) {
  if (!showCollectionOverlay.value) return null
  return props.collection[node.id] || { loading: props.collectionLoading, status: 'unknown', label: props.collectionLoading ? t('archCanvas.collection.loading') : t('archCanvas.collection.noData'), icon: props.collectionLoading ? 'loader-2' : 'circle-help', detail: t('archCanvas.collection.noStatus') }
}

function nodeTraceOverlay(node) {
  if (!showTraceOverlay.value || !props.trace) return null
  const sequence = traceNodeIds.value.has(node.id) ? props.trace.nodeIds.indexOf(node.id) + 1 : 0
  return sequence ? { sequence, detail: t('archCanvas.traceStep', { trace: props.trace.executionName || t('archCanvas.latestTrace'), n: sequence }) } : null
}

// Kubernetes Warning Events, already collected by discovery — opt-in overlay projects them
// onto the node they're `regarding`, no data means no badge (unlike Metrics/Collection).
function nodeEventsOverlay(node) {
  if (!showEventsOverlay.value) return null
  return props.events[node.id] || null
}

function nodeRolloutOverlay(node) {
  if (!showRolloutsOverlay.value || node.provider !== 'kubernetes' || node.kind !== 'Deployment') return null
  return props.rollouts[node.id] || null
}

function nodeSecurityOverlay(node) {
  if (!showSecurityOverlay.value) return null
  return props.security[node.id] || null
}

function fallbackPosition(index, columns) {
  return {
    x: 80 + (index % columns) * smartSpacing.value.gridXGap,
    y: 70 + Math.floor(index / columns) * (smartSpacing.value.gridYGap + 30),
  }
}

function computedLayout(document, visibleDocument) {
  if (layoutMode.value === 'system-domains') return systemDomainLayout(visibleDocument, smartSpacing.value).layout
  if (layoutMode.value === 'resource-type') return resourceTypeLayout(visibleDocument, smartSpacing.value).layout
  if (layoutMode.value === 'provider-lanes') return providerLaneLayout(visibleDocument, smartSpacing.value).layout
  if (layoutMode.value === 'provider-resource') return providerResourceLayout(visibleDocument, smartSpacing.value).layout
  return smartSpacing.value.expanded ? requestFlowLayout(visibleDocument, layoutDirection.value, smartSpacing.value) : document.layout || {}
}

function syncGraph(hydrateView = true) {
  const document = props.graph?.document
  if (!document) return
  // Once per canvas: a later refresh keeps what the user arranged locally.
  if (hydrateView && !largeMapDefaultApplied && !['resource-type', 'request-flow', 'provider-lanes', 'provider-resource', 'system-domains'].includes(document.view?.layoutMode)) {
    largeMapDefaultApplied = true
    if ((document.nodes || []).length > LARGE_MAP_NODES) layoutMode.value = 'system-domains'
  }
  if (hydrateView && document.view && typeof document.view === 'object') {
    if (['resource-type', 'request-flow', 'provider-lanes', 'provider-resource', 'system-domains'].includes(document.view.layoutMode)) {
      layoutMode.value = document.view.layoutMode
    }
    if (document.view.layoutDirection === 'horizontal' || document.view.layoutDirection === 'vertical') {
      layoutDirection.value = document.view.layoutDirection
    }
    showEdgeLabels.value = document.view.showEdgeLabels === true
    showHealthOverlay.value = document.view.showHealthOverlay === true
    showMetricsOverlay.value = document.view.showMetricsOverlay === true
    showCollectionOverlay.value = document.view.showCollectionOverlay === true
    showTraceOverlay.value = document.view.showTraceOverlay === true
    showEventsOverlay.value = document.view.showEventsOverlay === true
    showRolloutsOverlay.value = document.view.showRolloutsOverlay === true
    showSecurityOverlay.value = document.view.showSecurityOverlay === true
    providerFilter.value = document.view.providerFilter || 'all'
    systemDomainFilter.value = document.view.systemDomainFilter || 'all'
    kubeContextFilter.value = document.view.kubeContextFilter || ''
    namespaceFilter.value = document.view.namespaceFilter || ''
    relationTypeFilter.value = document.view.relationTypeFilter || 'all'
    relationStatusFilter.value = document.view.relationStatusFilter || 'all'
  }
  const visibleDocument = filteredGraphDocument.value
  const visibleNodes = visibleDocument.nodes
  const visibleEdges = visibleDocument.edges
  resourceSections.value = layoutMode.value === 'system-domains' ? systemDomainLayout(visibleDocument, smartSpacing.value).sections
    : layoutMode.value === 'resource-type'
    ? resourceTypeLayout(visibleDocument, smartSpacing.value).sections
    : layoutMode.value === 'provider-lanes' ? providerLaneLayout(visibleDocument, smartSpacing.value).sections
      : layoutMode.value === 'provider-resource' ? providerResourceLayout(visibleDocument, smartSpacing.value).sections : []
  const columns = Math.min(10, Math.max(4, Math.ceil(Math.sqrt(visibleNodes.length * 1.6))))
  const autoLayout = computedLayout(document, visibleDocument)
  flowNodes.value = visibleNodes.map((node, index) => {
    const route = visibleEdges
      .filter(edge => edge.sourceNodeId === node.id && edge.status !== 'rejected')
      .flatMap(edge => edge.evidence || [])
      .find(item => item.route)
    return {
    id: node.id,
    position: autoLayout[node.id] || document.layout[node.id] || fallbackPosition(index, columns),
      data: {
        label: route?.routePath || node.name || node.label || node.id,
        method: route?.method || '',
        resourceType: node.resourceType || 'service',
        health: nodeHealthOverlay(node),
        metrics: nodeMetricsOverlay(node),
        collection: nodeCollectionOverlay(node),
        trace: nodeTraceOverlay(node),
        events: nodeEventsOverlay(node),
        rollout: nodeRolloutOverlay(node),
        security: nodeSecurityOverlay(node),
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
    type: ['provider-lanes', 'provider-resource', 'system-domains'].includes(layoutMode.value) ? 'step' : layoutMode.value === 'resource-type' ? 'straight' : 'default',
    style: {
      ...(edge.status === 'suggested'
        ? { stroke: '#d29922', strokeDasharray: '6 4' }
        : edge.status === 'automatic' ? { stroke: '#2f81f7' } : {}),
      ...(['resource-type', 'provider-lanes', 'provider-resource', 'system-domains'].includes(layoutMode.value) ? { strokeOpacity: 0.28, strokeWidth: 1.2 } : {}),
    },
  }))
  if (selectedNode.value) selectedNode.value = document.nodes.find(node => node.id === selectedNode.value.id) || null
  if (selectedEdge.value) selectedEdge.value = document.edges.find(edge => edge.id === selectedEdge.value.id) || null
  if (fitAfterSync.value) {
    fitAfterSync.value = false
    nextTick(() => fitReadable({ duration: 250 }))
  }
  refreshIcons()
}

function arrangeFlow() {
  if (props.saving || !props.graph?.document?.nodes?.length) return
  fitAfterSync.value = true
  if (['resource-type', 'provider-lanes', 'provider-resource', 'system-domains'].includes(layoutMode.value)) {
    const result = layoutMode.value === 'provider-lanes'
      ? providerLaneLayout(filteredGraphDocument.value, smartSpacing.value)
      : layoutMode.value === 'provider-resource' ? providerResourceLayout(filteredGraphDocument.value, smartSpacing.value)
        : layoutMode.value === 'system-domains' ? systemDomainLayout(filteredGraphDocument.value, smartSpacing.value) : resourceTypeLayout(filteredGraphDocument.value, smartSpacing.value)
    resourceSections.value = result.sections
    clearSelection()
    emit('operation', {
      type: 'layout.set',
      value: result.layout,
    }, layoutMode.value === 'provider-lanes' ? t('archCanvas.op.arrangeLanes') : layoutMode.value === 'provider-resource' ? t('archCanvas.op.arrangeSections') : layoutMode.value === 'system-domains' ? t('archCanvas.op.arrangeDomains') : t('archCanvas.op.arrangeByType'))
    return
  }
  resourceSections.value = []
  emit('operation', {
    type: 'layout.set',
    value: requestFlowLayout(filteredGraphDocument.value, layoutDirection.value, smartSpacing.value),
  }, layoutDirection.value === 'vertical' ? t('archCanvas.op.arrangeFlowTopBottom') : t('archCanvas.op.arrangeFlowLeftRight'))
}

function persistView() {
  if (props.saving) return
  if (layoutMode.value === 'system-domains') resourceSections.value = systemDomainLayout(filteredGraphDocument.value, smartSpacing.value).sections
  if (layoutMode.value === 'resource-type') resourceSections.value = resourceTypeLayout(props.graph.document, smartSpacing.value).sections
  if (layoutMode.value === 'provider-lanes') resourceSections.value = providerLaneLayout(props.graph.document, smartSpacing.value).sections
  if (layoutMode.value === 'provider-resource') resourceSections.value = providerResourceLayout(props.graph.document, smartSpacing.value).sections
  emit('operation', {
    type: 'view.set',
    value: {
      layoutMode: layoutMode.value,
      layoutDirection: layoutDirection.value,
      showEdgeLabels: showEdgeLabels.value,
      showHealthOverlay: showHealthOverlay.value,
      showMetricsOverlay: showMetricsOverlay.value,
      showCollectionOverlay: showCollectionOverlay.value,
      showTraceOverlay: showTraceOverlay.value,
      showEventsOverlay: showEventsOverlay.value,
      showRolloutsOverlay: showRolloutsOverlay.value,
      showSecurityOverlay: showSecurityOverlay.value,
      providerFilter: providerFilter.value,
      systemDomainFilter: systemDomainFilter.value,
      kubeContextFilter: kubeContextFilter.value,
      namespaceFilter: namespaceFilter.value,
      relationTypeFilter: relationTypeFilter.value,
      relationStatusFilter: relationStatusFilter.value,
    },
  }, t('archCanvas.op.updateView'))
}

function toggleEdgeLabels() {
  showEdgeLabels.value = !showEdgeLabels.value
  persistView()
}

function toggleHealthOverlay() {
  showHealthOverlay.value = !showHealthOverlay.value
  persistView()
}

function toggleMetricsOverlay() {
  showMetricsOverlay.value = !showMetricsOverlay.value
  if (showMetricsOverlay.value && !Object.keys(props.metrics).length) emit('request-metrics')
  persistView()
}

function toggleCollectionOverlay() {
  showCollectionOverlay.value = !showCollectionOverlay.value
  if (showCollectionOverlay.value && !Object.keys(props.collection).length) emit('request-metrics')
  persistView()
}

function toggleTraceOverlay() {
  showTraceOverlay.value = !showTraceOverlay.value
  if (showTraceOverlay.value && !props.trace) emit('request-trace')
  persistView()
}

function clearTraceOverlay() {
  showTraceOverlay.value = false
  persistView()
}

function toggleEventsOverlay() {
  showEventsOverlay.value = !showEventsOverlay.value
  if (showEventsOverlay.value && !Object.keys(props.events).length) emit('request-events')
  persistView()
}

function toggleRolloutsOverlay() {
  showRolloutsOverlay.value = !showRolloutsOverlay.value
  if (showRolloutsOverlay.value && !Object.keys(props.rollouts).length) emit('request-rollouts')
  persistView()
}

function toggleSecurityOverlay() {
  showSecurityOverlay.value = !showSecurityOverlay.value
  if (showSecurityOverlay.value && !Object.keys(props.security).length) emit('request-security')
  persistView()
}

function addNode() {
  if (!nodeDraft.name || props.saving) return
  emit('operation', {
    type: 'node.upsert',
    value: { id: manualId('node'), name: nodeDraft.name, resourceType: nodeDraft.resourceType, manual: true },
  }, t('archCanvas.op.add', { name: nodeDraft.name }))
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
  }, t('archCanvas.op.connect'))
}

function persistPosition({ node }) {
  if (props.saving || !node?.id || !node.position) return
  emit('operation', {
    type: 'layout.set',
    value: { [node.id]: { x: Math.round(node.position.x), y: Math.round(node.position.y) } },
  }, t('archCanvas.op.move', { name: nodeName(node.id) }))
}

function selectNode({ node }) {
  selectedEdge.value = null
  selectedNode.value = props.graph.document.nodes.find(item => item.id === node.id) || null
  if (selectedNode.value) emit('resource-selected', selectedNode.value)
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
  }, t('archCanvas.op.update', { name: editDraft.name }))
}

const confirmingRemoval = ref(false)
watch(selectedNode, () => { confirmingRemoval.value = false })

// A node that is a real resource (it has a native identity) is only hidden in this view: it stays
// in the application with its membership, signals and history (#146). A drawing is removed.
function isResourceNode(node) {
  return !!(node?.registryResourceId || node?.arn || node?.nativeId || node?.discoveryKey)
}
const hiddenNodes = computed(() => (props.graph?.document?.nodes || []).filter(node => node.hidden))

function removeNode() {
  if (!selectedNode.value || props.saving) return
  const name = nodeName(selectedNode.value.id)
  if (isResourceNode(selectedNode.value)) {
    emit('operation', { type: 'node.hide', subjectId: selectedNode.value.id }, t('archCanvas.op.hideNode', { name }))
  } else {
    emit('operation', { type: 'node.remove', subjectId: selectedNode.value.id }, t('archCanvas.op.removeNode', { name }))
  }
  confirmingRemoval.value = false
  clearSelection()
}

function showNode(node) {
  if (props.saving) return
  emit('operation', { type: 'node.show', subjectId: node.id }, t('archCanvas.op.showNode', { name: node.name || node.id }))
}

function removeEdge() {
  if (!selectedEdge.value || props.saving) return
  emit('operation', { type: 'edge.remove', subjectId: selectedEdge.value.id }, t('archCanvas.deleteRelationship'))
  clearSelection()
}

function reviewEdge(decision) {
  if (!selectedEdge.value || props.saving) return
  emit('operation', {
    type: 'edge.review', subjectId: selectedEdge.value.id, value: { decision },
  }, decision === 'accept' ? t('archCanvas.op.acceptInferred') : t('archCanvas.op.rejectInferred'))
  clearSelection()
}

// A large map opens at a readable size around its centre instead of shrinking to fit (#239).
const READABLE_ZOOM = 0.6
function fitReadable(options = {}) {
  return fitView({ padding: 0.16, minZoom: READABLE_ZOOM, maxZoom: 1.1, ...options })
}

// The selected resource and its neighbours, already highlighted, fill the view.
function zoomToNeighbors() {
  if (!focusedNodeIds.value) return
  const ids = [...focusedNodeIds.value].filter(id => flowNodes.value.some(node => node.id === id))
  if (ids.length) fitView({ nodes: ids, padding: 0.3, minZoom: READABLE_ZOOM, maxZoom: 1.2, duration: 250 })
}

// Enter in the search selects the first visible match and brings its neighbours into view.
function goToSearchMatch() {
  const match = filteredGraphDocument.value.nodes[0]
  if (!match) return
  selectNode({ node: { id: match.id } })
  nextTick(zoomToNeighbors)
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
  return nodeTypes.value.find(option => option.value === resourceType)?.label || {
    lambda: 'Lambda', layer: 'Lambda layer', sqs: t('archCanvas.type.sqs'), eventbridge: t('archCanvas.type.eventbridge'), stepfunctions: 'Step Functions',
    ecs: 'ECS', loadbalancer: t('archCanvas.type.loadBalancer'), targetgroup: t('archCanvas.type.targetGroup'),
    s3: t('archCanvas.type.s3'), iam: t('archCanvas.type.iam'), 'iam-policy': t('archCanvas.type.iamPolicy'), policy: t('archCanvas.type.policy'),
    sns: 'SNS', dynamodb: 'DynamoDB', logs: 'CloudWatch Logs', secret: t('archCanvas.type.secret'),
    kubernetes: t('archCanvas.type.kubernetes'), deployment: 'Kubernetes Deployment', statefulset: 'Kubernetes StatefulSet',
    daemonset: 'Kubernetes DaemonSet', pod: 'Kubernetes Pod', service: 'Kubernetes Service', ingress: 'Kubernetes Ingress',
    configmap: 'Kubernetes ConfigMap', pvc: 'Kubernetes PersistentVolumeClaim',
    'api-route': t('archCanvas.type.apiRoute'), 'api-integration': t('archCanvas.type.apiIntegration'), apigateway: 'API Gateway', apigatewayv2: 'API Gateway V2',
  }[resourceType] || (resourceType ? String(resourceType).replaceAll('-', ' ') : t('archCanvas.type.awsResource'))
}

function providerLabel(provider) {
  return { aws: 'AWS', kubernetes: 'Kubernetes', gcp: 'GCP', vercel: 'Vercel', generic: 'General' }[provider] || provider
}

function sectionLabel(section) {
  if (section.domain) return systemDomainLabel(section.domain)
  return section.provider && section.resourceType
    ? `${providerLabel(section.provider)} / ${sectionResourceLabel(section.provider, section.resourceType)}`
    : section.label || typeLabel(section.type)
}

function systemDomainLabel(domain) {
  return t(`archCanvas.domain.${domain}`)
}

function sectionResourceLabel(provider, resourceType) {
  if (provider === 'kubernetes') {
    return {
      deployment: 'Kubernetes Deployment', statefulset: 'Kubernetes StatefulSet', daemonset: 'Kubernetes DaemonSet',
      pod: 'Kubernetes Pod', service: 'Kubernetes Service', ingress: 'Kubernetes Ingress', node: 'Kubernetes Node',
      configmap: 'Kubernetes ConfigMap', secret: 'Kubernetes Secret', pvc: 'Kubernetes PersistentVolumeClaim',
    }[resourceType] || typeLabel(resourceType)
  }
  return typeLabel(resourceType)
}

function relationshipStatus(status) {
  return ['automatic', 'suggested', 'manual', 'stale'].includes(status) ? t(`archCanvas.status.${status}`) : status
}

const RELATION_TYPES = ['depends_on', 'triggers', 'invokes', 'runs_on', 'routes_to', 'references', 'accesses']
function relationshipLabel(relationType) {
  const type = relationType || 'depends_on'
  return RELATION_TYPES.includes(type) ? t(`archCanvas.rel.${type}`) : String(type).replaceAll('_', ' ')
}

const presentationForType = architectureResourcePresentation

function refreshIcons() {
  nextTick(() => createIcons({ icons }))
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

// Renders the entire graph (unclipped, ignoring the current scroll/zoom) into one large
// raster image, then embeds it in a PDF page sized to the diagram so nothing gets cut off.
const MAX_EXPORT_DIMENSION = 6000 // px; keeps very large diagrams fast to render instead of timing out
const EXPORT_TIMEOUT_MS = 90000

function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_resolve, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ])
}

async function exportPdf() {
  if (exporting.value || !flowNodes.value.length) return
  const viewportEl = canvasBodyRef.value?.querySelector('.vue-flow__viewport')
  const nodes = getNodes.value
  if (!viewportEl || !nodes.length) return
  exporting.value = true
  try {
    const padding = 60
    const nodesBounds = getRectOfNodes(nodes)
    const rawWidth = Math.max(900, Math.round(nodesBounds.width + padding * 2))
    const rawHeight = Math.max(600, Math.round(nodesBounds.height + padding * 2))
    const scale = Math.min(1, MAX_EXPORT_DIMENSION / Math.max(rawWidth, rawHeight))
    const imageWidth = Math.round(rawWidth * scale)
    const imageHeight = Math.round(rawHeight * scale)
    // The image already reserves `padding` px of margin around the bounds above, so no
    // extra fractional padding is needed here (vue-flow treats this arg as a ratio, not px).
    const { x, y, zoom } = getTransformForBounds(nodesBounds, imageWidth, imageHeight, 0.02, 2, 0)
    const backgroundColor = getComputedStyle(document.documentElement).getPropertyValue('--bg-panel').trim() || '#ffffff'
    const dataUrl = await withTimeout(toPng(viewportEl, {
      backgroundColor,
      width: imageWidth,
      height: imageHeight,
      pixelRatio: scale < 1 ? 1 : 2,
      skipFonts: true,
      style: {
        width: `${imageWidth}px`,
        height: `${imageHeight}px`,
        transform: `translate(${x}px, ${y}px) scale(${zoom})`,
      },
    }), EXPORT_TIMEOUT_MS, 'PDF export timed out')
    const pdf = new jsPDF({
      orientation: imageWidth >= imageHeight ? 'landscape' : 'portrait',
      unit: 'px',
      format: [imageWidth, imageHeight],
    })
    pdf.addImage(dataUrl, 'PNG', 0, 0, imageWidth, imageHeight)
    pdf.save(`${graphFileName()}.pdf`)
  } catch {
    toast(t('archCanvas.exportFailed'), 'error')
  } finally {
    exporting.value = false
  }
}

function graphFileName() {
  return (props.graph?.name || props.graph?.title || 'architecture-diagram').toString().trim().toLowerCase().replaceAll(/[^a-z0-9-]+/g, '-') || 'architecture-diagram'
}

function mermaidId(nodeId) {
  return `n${String(nodeId).replaceAll(/[^a-zA-Z0-9]/g, '_')}`
}

function mermaidLabel(text) {
  return String(text || '').replaceAll('"', "'")
}

function exportMermaid() {
  const document_ = filteredGraphDocument.value
  if (!document_.nodes.length) return
  const direction = layoutMode.value === 'request-flow' && layoutDirection.value === 'vertical' ? 'TD' : 'LR'
  const lines = [`flowchart ${direction}`]
  for (const node of document_.nodes) {
    const label = mermaidLabel(`${node.name || node.label || node.id} [${typeLabel(node.resourceType)}]`)
    lines.push(`  ${mermaidId(node.id)}["${label}"]`)
  }
  for (const edge of document_.edges) {
    if (edge.status === 'rejected') continue
    lines.push(`  ${mermaidId(edge.sourceNodeId)} -->|${mermaidLabel(relationshipLabel(edge.relationType))}| ${mermaidId(edge.targetNodeId)}`)
  }
  downloadBlob(`${graphFileName()}.mmd`, new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' }))
}

watch(() => props.graph, () => syncGraph(), { deep: true, immediate: true })
watch(layoutMode, mode => {
  if (!['resource-type', 'provider-lanes', 'provider-resource', 'system-domains'].includes(mode)) resourceSections.value = []
  syncGraph(false)
})
watch([nodeSearch, providerFilter, systemDomainFilter, kubeContextFilter, namespaceFilter, relationTypeFilter, relationStatusFilter, showHealthOverlay, showMetricsOverlay, showCollectionOverlay, showTraceOverlay, showEventsOverlay, showRolloutsOverlay, showSecurityOverlay, () => props.metrics, () => props.metricsLoading, () => props.collection, () => props.collectionLoading, () => props.trace, () => props.events, () => props.eventsLoading, () => props.rollouts, () => props.rolloutsLoading, () => props.security, () => props.securityLoading], () => syncGraph(false), { deep: true })
onMounted(refreshIcons)
</script>

<style scoped>
.architecture-canvas-shell { border: 1px solid var(--border); border-radius: 6px; overflow: hidden; background: var(--bg-panel); }
.canvas-toolbar { min-height: 48px; padding: 8px 9px; display: flex; flex-direction: column; align-items: stretch; gap: 7px; border-bottom: 1px solid var(--border); }
.canvas-toolbar-row { min-width: 0; display: flex; align-items: center; gap: 6px; }
.canvas-toolbar .ctrl-input { flex: 1 1 210px; min-width: 150px; max-width: 280px; }
.canvas-toolbar .ctrl-select { flex: 0 1 150px; min-width: 118px; }
.canvas-create-controls { min-height: 30px; }
.canvas-layout-controls { flex-wrap: wrap; }
.canvas-action-controls { flex-wrap: wrap; }
.canvas-control-disclosure { border-top: 1px solid var(--border); }
.canvas-control-disclosure summary { min-height: 34px; padding: 5px 9px; display: flex; align-items: center; gap: 7px; color: var(--text-dim); font-size: 11px; cursor: pointer; list-style: none; }
.canvas-control-disclosure summary::-webkit-details-marker { display: none; }
.canvas-control-disclosure summary::before { content: '›'; width: 12px; color: var(--text-dim); font-size: 17px; line-height: 1; transition: transform .16s ease; }
.canvas-control-disclosure[open] summary::before { transform: rotate(90deg); }
.canvas-control-disclosure summary :deep(svg) { width: 14px; height: 14px; }
.canvas-control-disclosure summary strong { margin-left: auto; color: var(--text); font-size: 10px; font-weight: 600; }
.canvas-filter-controls, .canvas-action-controls { padding: 8px 9px; }
.canvas-filter-controls { flex-wrap: wrap; }
.canvas-filter-controls .ctrl-select { flex: 1 1 160px; }
.canvas-search { min-height: 32px; padding: 0 8px; display: flex; flex: 1 1 220px; align-items: center; gap: 7px; border: 1px solid var(--border); border-radius: 4px; background: var(--bg); color: var(--text-dim); }
.canvas-search:focus-within { border-color: #2f81f7; }
.canvas-search :deep(svg) { width: 14px; height: 14px; flex: none; }
.canvas-search input { width: 100%; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--text); font: inherit; }
.canvas-search input::placeholder { color: var(--text-dim); }
.canvas-layout-controls .ctrl-select { flex-basis: 168px; }
.canvas-layout-controls .direction-select { width: 166px; }
.canvas-toolbar-row .btn { flex: 0 0 auto; white-space: nowrap; }
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
.node-metrics { display: flex; flex-wrap: wrap; gap: 4px 7px; margin-left: 4px; padding-left: 6px; border-left: 1px solid var(--border); color: var(--text-dim); font-size: 9px; }
.node-metric { display: inline-flex; align-items: baseline; gap: 3px; }
.node-metric small { margin: 0; font-size: 8px; }
.node-metric strong { color: var(--text); font-size: 9px; }
.node-collection { display: inline-flex; align-items: center; gap: 3px; margin-left: 4px; padding: 2px 5px; border-radius: 8px; background: var(--bg-panel); color: var(--text-dim); font-size: 8px; }
.node-collection--completed { color: #3fb950; }
.node-collection--partial { color: #d29922; }
.node-collection--failed, .node-collection--budget_exhausted { color: #f85149; }
.node-collection :deep(svg) { width: 10px; height: 10px; }
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
.canvas-hidden-list { list-style: none; margin: 6px 0 0; padding: 0; display: flex; flex-direction: column; gap: 4px; max-height: 220px; overflow: auto; }
.canvas-hidden-list li { display: flex; justify-content: space-between; align-items: center; gap: 8px; font-size: 12px; }
.canvas-hidden-list li span { overflow-wrap: anywhere; min-width: 0; }
.inspector-confirm { display: flex; flex-direction: column; gap: 6px; border: 1px solid var(--warning, #d97706); border-radius: 6px; padding: 8px; }
.inspector-confirm p { margin: 0; font-size: 12px; overflow-wrap: anywhere; }
.relationship-direction { padding: 3px 0; }
.relationship-status { width: fit-content; padding: 3px 6px; border-radius: 4px; font-size: 11px; font-weight: 700; }
.relationship-status.automatic { color: #58a6ff; background: color-mix(in srgb, #2f81f7 14%, transparent); }
.relationship-status.suggested { color: #d29922; background: color-mix(in srgb, #d29922 14%, transparent); }
.relationship-status.manual { color: #3fb950; background: color-mix(in srgb, #3fb950 14%, transparent); }
.relationship-evidence { color: var(--text-dim); overflow-wrap: anywhere; }
.trace-overlay-status { display: inline-flex; align-items: center; gap: 5px; color: #f778ba; font-size: 10px; }
.trace-overlay-status > svg { width: 13px; height: 13px; }
.trace-overlay-status .btn { min-height: 22px; padding: 2px 6px; color: var(--text-dim); }
.node-trace-badge { display: inline-flex; align-items: center; gap: 3px; padding: 2px 5px; border-radius: 9px; color: #f778ba; background: color-mix(in srgb, #f778ba 14%, transparent); font-size: 9px; font-weight: 700; }
.node-trace-badge > svg { width: 11px; height: 11px; }
.node-events-badge { display: inline-flex; align-items: center; gap: 3px; padding: 2px 5px; border-radius: 9px; color: #d29922; background: color-mix(in srgb, #d29922 14%, transparent); font-size: 9px; font-weight: 700; }
.node-events-badge > svg { width: 11px; height: 11px; }
.node-rollout-badge { display: inline-flex; align-items: center; gap: 3px; padding: 2px 5px; border-radius: 9px; font-size: 9px; font-weight: 700; }
.node-rollout-badge--ready { color: #3fb950; background: color-mix(in srgb, #3fb950 14%, transparent); }
.node-rollout-badge--degraded { color: #d29922; background: color-mix(in srgb, #d29922 14%, transparent); }
.node-rollout-badge > svg { width: 11px; height: 11px; }
.node-security-badge { display: inline-flex; align-items: center; gap: 3px; padding: 2px 5px; border-radius: 9px; font-size: 9px; font-weight: 700; }
.node-security-badge > svg { width: 11px; height: 11px; }
.node-security-badge--high { color: #f85149; background: color-mix(in srgb, #f85149 14%, transparent); }
.node-security-badge--medium { color: #d29922; background: color-mix(in srgb, #d29922 14%, transparent); }
.node-security-badge--low { color: #58a6ff; background: color-mix(in srgb, #58a6ff 14%, transparent); }
:deep(.vue-flow__node-default) { padding: 10px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); box-shadow: 0 4px 12px rgba(0, 0, 0, .18); }
:deep(.vue-flow__node-resource-section) { border: 0; background: transparent; box-shadow: none; pointer-events: none; }
:deep(.vue-flow__node.selected) { box-shadow: 0 0 0 2px #2f81f7; }
:deep(.vue-flow__handle) { width: 9px; height: 9px; background: #2f81f7; border: 2px solid var(--bg-panel); }
:deep(.vue-flow__edge-path) { stroke: #7d8590; stroke-width: 1.8; }
:deep(.vue-flow__edge.selected .vue-flow__edge-path) { stroke: #2f81f7; }
:deep(.vue-flow__node), :deep(.vue-flow__edge) { transition: opacity .16s ease; }
@media (max-width: 760px) {
  .canvas-toolbar-row { flex-wrap: wrap; }
  .canvas-toolbar .ctrl-input { max-width: none; }
  .canvas-layout-controls .ctrl-select { flex: 1 1 172px; width: auto; }
  .canvas-layout-controls .direction-select { flex-basis: 166px; }
  .canvas-hint { width: 100%; margin-left: 0; }
  .canvas-body { height: 500px; }
  .canvas-inspector { right: 8px; bottom: 8px; width: min(260px, calc(100% - 16px)); max-height: calc(100% - 16px); }
}

@media (max-width: 520px) {
  .canvas-create-controls { display: grid; grid-template-columns: minmax(0, 1fr) minmax(112px, 132px); }
  .canvas-create-controls .btn { grid-column: 1 / -1; justify-content: center; }
  .canvas-layout-controls, .canvas-action-controls { flex-wrap: nowrap; padding-bottom: 3px; overflow-x: auto; overscroll-behavior-x: contain; scrollbar-width: thin; }
  .canvas-layout-controls .ctrl-select { flex: 0 0 166px; }
  .canvas-filter-controls { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .canvas-filter-controls .ctrl-select { width: 100%; min-width: 0; }
  .canvas-search { grid-column: 1 / -1; min-width: 0; }
  .canvas-action-controls { flex-wrap: wrap; overflow: visible; }
  .canvas-hint { display: none; }
}
</style>
