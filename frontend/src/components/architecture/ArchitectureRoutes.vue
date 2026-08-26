<template>
  <section class="architecture-routes">
    <header class="routes-header">
      <span class="routes-title">
        <span class="routes-title-icon"><i data-lucide="route"></i></span>
        <span><strong>Application routes</strong><small>Event, workflow and microservice execution paths</small></span>
      </span>
      <span class="routes-actions">
        <label class="route-order-control">
          <i data-lucide="arrow-up-narrow-wide"></i>
          <span>Order</span>
          <select v-model="sortMode" class="ctrl-select" title="Order application routes">
            <option value="sequence">Event sequence</option>
            <option value="name">Name A-Z</option>
            <option value="bus">Event bus</option>
            <option value="service">Service flow</option>
            <option value="depth">Longest route</option>
          </select>
        </label>
        <span class="route-count"><strong>{{ totalPaths }}</strong> route{{ totalPaths === 1 ? '' : 's' }} · {{ groups.length }} entr{{ groups.length === 1 ? 'y' : 'ies' }}</span>
      </span>
    </header>

    <div v-if="!groups.length" class="routes-empty">
      <i data-lucide="route-off"></i>
      <strong>No application routes in this diagram</strong>
      <span>Import EventBridge, Step Functions, Kubernetes Ingress or Services with relationship evidence.</span>
    </div>

    <article v-for="(group, groupIndex) in groups" :key="group.id" class="route-group">
      <header>
        <span :class="['event-order', group.category]">{{ categoryLabel(group.category) }} {{ groupSequence(groupIndex, group.category) }}</span>
        <span class="route-entry-icon"><i :data-lucide="iconFor(group.type)"></i></span>
        <span><strong>{{ group.name }}</strong><small>{{ labelFor(group.type) }}</small></span>
        <button v-if="group.type === 'stepfunctions'" class="btn sm" @click="$emit('inspect-workflow', group.paths[0].nodes[0])">
          <i data-lucide="workflow"></i> Workflow diagram
        </button>
      </header>

      <div v-if="group.config && group.category === 'event'" class="event-structure">
        <span><small>Event bus</small><strong>{{ group.config.eventBus }}</strong></span>
        <span v-if="group.config.scheduleExpression"><small>Schedule</small><code>{{ group.config.scheduleExpression }}</code></span>
        <span v-if="group.config.description"><small>Purpose</small><strong>{{ group.config.description }}</strong></span>
        <template v-if="group.config.eventPattern">
          <span v-for="field in eventFields(group.config.eventPattern)" :key="field.key">
            <small>{{ field.key }}</small><code>{{ patternValue(field.value) }}</code>
          </span>
        </template>
      </div>
      <div v-if="group.config && group.category === 'microservice'" class="microservice-structure">
        <span><small>Entry</small><strong>{{ group.config.entryType }}</strong></span>
        <span v-if="group.config.namespace"><small>Namespace</small><strong>{{ group.config.namespace }}</strong></span>
        <span v-if="group.config.context"><small>Context</small><code>{{ group.config.context }}</code></span>
        <span><small>Evidence</small><strong>Declared Kubernetes selectors and backends</strong></span>
      </div>

      <div class="route-paths">
        <div v-for="(path, pathIndex) in group.paths" :key="path.id" class="route-path" :data-route-id="path.id">
          <span class="path-order"><small>Route</small><strong>{{ sequence(pathIndex) }}</strong></span>
          <span v-for="(node, index) in path.nodes" :key="node.id" class="route-segment">
            <button
              :class="['route-node', node.resourceType, { actionable: node.resourceType === 'stepfunctions' }]"
              :disabled="node.resourceType !== 'stepfunctions'"
              @click="node.resourceType === 'stepfunctions' && $emit('inspect-workflow', node)"
            >
              <span class="stage-order">{{ sequence(index) }}</span>
              <i :data-lucide="iconFor(node.resourceType)"></i>
              <span><strong>{{ node.name }}</strong><small>{{ stageLabel(node.resourceType) }}</small></span>
            </button>
            <span v-if="path.relations[index]" class="route-relation">
              <small>{{ relationLabel(path.relations[index].relationType) }}</small>
              <i data-lucide="arrow-right"></i>
            </span>
          </span>
        </div>
      </div>
    </article>
  </section>
</template>

<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { createIcons, icons } from 'lucide'
import { architectureRouteGroups } from '../../lib/architectureRoutes'

const props = defineProps({ graph: { type: Object, required: true } })
defineEmits(['inspect-workflow'])

const sortMode = ref('sequence')
const filteredDocument = computed(() => {
  const document = props.graph?.document || { nodes: [], edges: [] }
  const view = document.view || {}
  const nodes = (document.nodes || []).filter(node =>
    (view.providerFilter === 'all' || !view.providerFilter || node.provider === view.providerFilter) &&
    (!view.kubeContextFilter || node.kubeContext === view.kubeContextFilter) &&
    (!view.namespaceFilter || node.namespace === view.namespaceFilter))
  const ids = new Set(nodes.map(node => node.id))
  return { ...document, nodes, edges: (document.edges || []).filter(edge => ids.has(edge.sourceNodeId) && ids.has(edge.targetNodeId)) }
})
const groups = computed(() => architectureRouteGroups(filteredDocument.value, { order: sortMode.value }))
const totalPaths = computed(() => groups.value.reduce((total, group) => total + group.paths.length, 0))

function sequence(index) {
  return String(index + 1).padStart(2, '0')
}

function groupSequence(index, category) {
  const position = groups.value.slice(0, index + 1).filter(group => group.category === category).length
  return String(position).padStart(2, '0')
}

function iconFor(type) {
  return {
    eventbridge: 'radio-tower', sqs: 'list-end', lambda: 'square-function', stepfunctions: 'workflow', ecs: 'container', s3: 'hard-drive',
    ingress: 'route', service: 'network', deployment: 'boxes', statefulset: 'database-zap', daemonset: 'rows-3', pod: 'container',
    configmap: 'file-cog', secret: 'key-round', pvc: 'hard-drive',
  }[type] || 'box'
}

function labelFor(type) {
  return {
    eventbridge: 'EventBridge event', sqs: 'SQS queue', lambda: 'Lambda', stepfunctions: 'Step Functions workflow', ecs: 'ECS', s3: 'S3',
    ingress: 'Kubernetes Ingress', service: 'Kubernetes Service', deployment: 'Kubernetes Deployment', statefulset: 'Kubernetes StatefulSet',
    daemonset: 'Kubernetes DaemonSet', pod: 'Kubernetes Pod', configmap: 'Kubernetes ConfigMap', secret: 'Kubernetes Secret', pvc: 'PersistentVolumeClaim',
  }[type] || type
}

function stageLabel(type) {
  return {
    eventbridge: 'Event source',
    sqs: 'Message buffer',
    lambda: 'Compute',
    stepfunctions: 'Workflow orchestration',
    ecs: 'Container workload',
    s3: 'Object storage',
    ingress: 'HTTP entrypoint', service: 'Service routing', deployment: 'Workload', statefulset: 'Stateful workload',
    daemonset: 'Node workload', pod: 'Runtime Pod', configmap: 'Configuration', secret: 'Secret reference', pvc: 'Persistent storage',
  }[type] || labelFor(type)
}

function relationLabel(type) {
  return { triggers: 'triggers', invokes: 'invokes', sends_to: 'sends to', starts_execution: 'starts', routes_to: 'routes to', owns: 'owns', uses: 'uses' }[type]
    || String(type || 'depends_on').replaceAll('_', ' ')
}

function patternValue(value) {
  if (Array.isArray(value)) return value.map(item => typeof item === 'object' ? JSON.stringify(item) : item).join(', ')
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}

function eventFields(pattern) {
  return Object.entries(pattern || {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => ({ key, value }))
}

function categoryLabel(category) {
  return { event: 'EVENT', workflow: 'WORKFLOW', microservice: 'MICROSERVICE' }[category] || 'ROUTE'
}

function refreshIcons() { nextTick(() => createIcons({ icons })) }
watch(groups, refreshIcons)
onMounted(refreshIcons)
</script>

<style scoped>
.architecture-routes { border: 1px solid var(--border); border-radius: 6px; overflow: hidden; background: var(--bg-panel); }
.routes-header, .route-group > header { min-height: 56px; padding: 10px 12px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--border); }
.routes-header { justify-content: space-between; }
.routes-title { display: flex; align-items: center; gap: 9px; }
.routes-title > span:last-child, .route-group > header > span:nth-child(3) { display: flex; flex-direction: column; }
.routes-title-icon { width: 32px; height: 32px; display: grid; place-items: center; color: #0d1117; background: #e3b341; border-radius: 5px; }
.routes-title-icon :deep(svg) { width: 17px; height: 17px; }
.routes-header small, .route-group header small, .route-count { color: var(--text-dim); }
.routes-actions, .route-order-control { display: flex; align-items: center; gap: 8px; }
.routes-actions { margin-left: auto; }
.route-order-control { color: var(--text-dim); font-size: 11px; }
.route-order-control :deep(svg) { width: 14px; height: 14px; }
.route-order-control .ctrl-select { width: 140px; }
.route-count { white-space: nowrap; }
.route-count strong { color: var(--text); font-size: 15px; }
.route-group { border-bottom: 1px solid var(--border); }
.route-group:last-child { border-bottom: 0; }
.route-group > header { background: var(--bg-hover); }
.route-group > header .btn { margin-left: auto; }
.event-order { width: 76px; color: #e3b341; font-size: 10px; font-weight: 700; text-transform: uppercase; }
.event-order.microservice { color: #326ce5; }
.route-entry-icon { width: 32px; height: 32px; display: grid; place-items: center; color: #0d1117; background: #e3b341; border-radius: 5px; }
.route-entry-icon :deep(svg) { width: 16px; height: 16px; }
.event-structure { padding: 8px 12px; display: flex; flex-wrap: wrap; gap: 7px; border-bottom: 1px solid var(--border); }
.event-structure > span { min-width: 130px; padding: 5px 7px; display: flex; flex-direction: column; gap: 2px; border-left: 2px solid #d29922; background: color-mix(in srgb, #d29922 7%, transparent); }
.microservice-structure { padding: 8px 12px; display: flex; flex-wrap: wrap; gap: 7px; border-bottom: 1px solid var(--border); }
.microservice-structure > span { min-width: 130px; padding: 5px 7px; display: flex; flex-direction: column; gap: 2px; border-left: 2px solid #326ce5; background: color-mix(in srgb, #326ce5 7%, transparent); }
.microservice-structure small { color: var(--text-dim); text-transform: uppercase; font-size: 9px; }
.microservice-structure code { color: var(--text); white-space: normal; overflow-wrap: anywhere; }
.event-structure small { color: var(--text-dim); text-transform: uppercase; font-size: 9px; }
.event-structure code { color: var(--text); white-space: normal; overflow-wrap: anywhere; }
.route-paths { display: flex; flex-direction: column; overflow-x: auto; }
.route-path { min-width: max-content; padding: 14px 12px; display: flex; align-items: center; border-top: 1px solid color-mix(in srgb, var(--border) 65%, transparent); }
.route-path:first-child { border-top: 0; }
.path-order { width: 54px; margin-right: 12px; display: flex; flex-direction: column; align-items: center; color: var(--text-dim); }
.path-order small { font-size: 9px; text-transform: uppercase; }
.path-order strong { color: var(--text); font-size: 15px; }
.route-segment { display: contents; }
.route-node { --node-accent: #8b949e; width: 210px; min-height: 62px; padding: 7px 9px; display: grid; grid-template-columns: 22px 18px minmax(0, 1fr); align-items: center; gap: 7px; color: var(--text); text-align: left; border: 1px solid var(--border); border-left: 3px solid var(--node-accent); border-radius: 5px; background: var(--bg); }
.route-node.eventbridge { --node-accent: #e3b341; }
.route-node.sqs { --node-accent: #db61a2; }
.route-node.lambda { --node-accent: #d29922; }
.route-node.stepfunctions { --node-accent: #f85149; }
.route-node.ecs { --node-accent: #39c5cf; }
.route-node.s3 { --node-accent: #3fb950; }
.route-node.ingress, .route-node.service { --node-accent: #326ce5; }
.route-node.deployment, .route-node.statefulset, .route-node.daemonset, .route-node.pod { --node-accent: #4b7bec; }
.route-node.configmap { --node-accent: #64748b; }
.route-node.secret { --node-accent: #b74856; }
.route-node.pvc { --node-accent: #3fb950; }
.stage-order { width: 22px; height: 22px; display: grid; place-items: center; color: var(--node-accent); border: 1px solid color-mix(in srgb, var(--node-accent) 65%, transparent); border-radius: 50%; font-size: 9px; font-weight: 700; }
.route-node > span { display: flex; flex-direction: column; min-width: 0; }
.route-node > .stage-order { display: grid; }
.route-node strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.route-node small { color: var(--text-dim); }
.route-node :deep(svg) { width: 17px; flex: none; color: var(--node-accent); }
.route-node.actionable { cursor: pointer; border-color: #f85149; }
.route-node:disabled { opacity: 1; }
.route-relation { width: 84px; display: flex; flex-direction: column; align-items: center; color: #58a6ff; }
.route-relation small { color: var(--text-dim); }
.route-relation :deep(svg) { width: 28px; }
.routes-empty { min-height: 260px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 7px; color: var(--text-dim); }
.routes-empty strong { color: var(--text); }
@media (max-width: 760px) {
  .routes-header { align-items: flex-start; flex-wrap: wrap; }
  .routes-actions { width: 100%; justify-content: space-between; }
  .route-count { white-space: normal; text-align: right; }
  .event-order { width: 62px; }
  .route-node { width: 184px; }
}
</style>
