<template>
  <section class="discovery-panel">
    <header class="discovery-header">
      <span><i data-lucide="scan-search"></i><strong>Configure AWS application</strong><small>Build the diagram from deployment evidence</small></span>
      <button class="btn sm btn-icon" title="Close discovery" @click="$emit('close')"><i data-lucide="x"></i></button>
    </header>

    <nav class="discovery-steps" aria-label="Application setup progress">
      <span v-for="(step, index) in steps" :key="step.label" :class="{ active: currentStep === index, complete: currentStep > index }">
        <span>{{ currentStep > index ? '✓' : index + 1 }}</span>
        <strong>{{ step.label }}</strong>
        <small>{{ step.detail }}</small>
      </span>
    </nav>

    <div v-if="store.discovering" class="discovery-progress" role="status" aria-live="polite">
      <i data-lucide="loader-2"></i>
      <span>
        <strong>{{ discoveryProgress.title }}</strong>
        <small>{{ discoveryProgress.detail }}</small>
      </span>
    </div>

    <div v-if="!store.discoveryPreview" class="discovery-controls">
      <label>Region<input v-model.trim="region" class="ctrl-input" placeholder="us-east-1" /></label>
      <button class="btn sm primary" :disabled="store.discovering || !region" @click="loadDeployments">
        <i :data-lucide="store.discovering ? 'loader-2' : 'cloud-download'"></i>
        {{ store.discoveryCatalog ? 'Refresh stacks' : 'Find CloudFormation stacks' }}
      </button>
      <span v-if="store.discoveryCatalog" class="discovery-scope">
        Account {{ store.discoveryCatalog.scope.accountId }} · {{ store.discoveryCatalog.estimate.awsRequests }} read request{{ store.discoveryCatalog.estimate.awsRequests === 1 ? '' : 's' }}
      </span>
    </div>

    <template v-if="store.discoveryCatalog && !store.discoveryPreview">
      <div class="discovery-section-heading">
        <span><strong>1. Choose CloudFormation</strong><small>Select up to 10 deployments that belong to this application</small></span>
        <strong class="selection-count">{{ selectedStacks.length }} selected</strong>
      </div>
      <div v-if="store.discoveryCatalog.deployments.length" class="deployment-list">
        <label v-for="deployment in store.discoveryCatalog.deployments" :key="deployment.id" class="discovery-row">
          <input v-model="selectedStacks" type="checkbox" :value="deployment.name" :disabled="!selectedStacks.includes(deployment.name) && selectedStacks.length >= 10" />
          <span><strong>{{ deployment.name }}</strong><small>{{ deployment.status }}</small></span>
          <time>{{ deployment.updatedAt ? new Date(deployment.updatedAt).toLocaleString() : 'No update time' }}</time>
        </label>
      </div>
      <div v-else class="discovery-empty">No active CloudFormation stacks found in this region.</div>
      <div class="discovery-next-actions">
        <button v-if="store.discoveryCatalog.deployments.length" class="btn sm" :disabled="store.discovering" @click="previewRegionalInventory">
          <i data-lucide="radar"></i> Use regional inventory
        </button>
        <button class="btn sm primary" :disabled="store.discovering || (store.discoveryCatalog.deployments.length > 0 && !selectedStacks.length)" @click="previewSelectedStacks">
          Continue to resources <i data-lucide="arrow-right"></i>
        </button>
      </div>
    </template>

    <template v-if="store.discoveryPreview">
      <div class="discovery-section-heading resource-step-heading">
        <span><strong>2. Add application resources</strong><small>{{ selectedStackSummary }}</small></span>
        <button class="btn sm" @click="backToStacks"><i data-lucide="arrow-left"></i> Back to stacks</button>
      </div>
      <div v-if="selectedStacks.length" class="stack-resource-summary">
        <span class="resource-icon"><i data-lucide="layers-3"></i></span>
        <span>
          <strong>CloudFormation coverage</strong>
          <small>{{ stackNodes.length }} resources · {{ stackRelationshipCount }} relationships from {{ selectedStacks.length }} deployment{{ selectedStacks.length === 1 ? '' : 's' }}</small>
        </span>
        <button class="btn sm primary" :disabled="store.saving || !stackNodes.length || stackNodes.length > 500" @click="drawStackResources">
          <i data-lucide="layout-dashboard"></i> Draw all stack resources
        </button>
      </div>
      <div v-if="store.discoveryPreview.applicationCandidates?.length" class="application-candidates">
        <div class="discovery-section-heading">
          <span><strong>Identified applications</strong><small>Connected components inferred from AWS evidence</small></span>
        </div>
        <div v-for="candidate in store.discoveryPreview.applicationCandidates" :key="candidate.id" class="application-row">
          <span>
            <strong>{{ candidate.name }}</strong>
            <small>{{ candidate.resourceCount }} resources · {{ candidate.relationshipCount }} relationships · {{ Math.round(candidate.confidence * 100) }}% confidence</small>
            <span class="application-types">
              <span v-for="item in candidate.resourceTypes" :key="item.type">
                <i :data-lucide="resourceIcon(item.type)"></i>{{ item.count }} {{ resourceLabel(item.type) }}
              </span>
            </span>
          </span>
          <button class="btn sm primary" :disabled="store.saving" @click="drawApplication(candidate)">
            <i :data-lucide="store.saving ? 'loader-2' : 'workflow'"></i>
            {{ store.saving ? 'Drawing…' : 'Draw application' }}
          </button>
        </div>
      </div>
      <div v-if="store.discoveryPreview.estimate.truncated" class="inventory-warning">
        <i data-lucide="triangle-alert"></i>
        Inventory reached the 500-resource preview limit. Identified applications may be partial.
      </div>
      <div v-if="!confirmingRelationships" class="discovery-section-heading">
        <span><strong>Confirm resources</strong><small>{{ resourceSelectionHint }}</small></span>
        <button v-if="selectedStacks.length > 1" class="btn sm primary" :disabled="store.saving || !stackNodes.length || stackNodes.length > 500" @click="drawStackResources">
          <i :data-lucide="store.saving ? 'loader-2' : 'layout-dashboard'"></i>
          {{ store.saving ? 'Drawing…' : 'Draw complete diagram' }}
        </button>
        <button v-else class="btn sm primary" :disabled="!reviewNodeIds.length || store.saving" @click="continueToRelationships">
          Review relationships <i data-lucide="arrow-right"></i>
        </button>
      </div>
      <div v-if="!confirmingRelationships && selectedStacks.length <= 1" class="resource-list">
        <section v-for="group in resourceGroups" :key="group.type" class="resource-group">
          <header class="resource-group-heading">
            <span class="resource-icon"><i :data-lucide="resourceIcon(group.type)"></i></span>
            <span><strong>{{ group.label }}</strong><small>{{ group.nodes.length }} resource{{ group.nodes.length === 1 ? '' : 's' }}</small></span>
          </header>
          <label v-for="node in group.nodes" :key="node.id" class="discovery-row resource-row">
            <input v-model="selectedNodes" type="checkbox" :value="node.id" />
            <span><strong>{{ node.name }}</strong><small>{{ resourceOrigin(node) }}</small></span>
            <span class="evidence-badge"><i data-lucide="shield-check"></i> {{ evidenceLabel(node) }}</span>
          </label>
        </section>
        <div v-if="!resourceGroups.length" class="discovery-empty">All preview resources already participate in suggested relationships.</div>
      </div>
      <div v-if="!confirmingRelationships" class="relationship-readiness">
        <i data-lucide="git-branch"></i>
        <span>
          <strong>{{ store.discoveryPreview.relationshipSuggestions.length }} relationship suggestion{{ store.discoveryPreview.relationshipSuggestions.length === 1 ? '' : 's' }}</strong>
          <small>{{ relatedNodeIds.length }} related resource{{ relatedNodeIds.length === 1 ? '' : 's' }} will be included automatically; lower confidence remains suggested.</small>
        </span>
      </div>
      <template v-if="confirmingRelationships">
        <div class="discovery-section-heading">
          <span><strong>Review relationships</strong><small>{{ reviewNodeIds.length }} resources · {{ reviewRelationships.length }} relationships ready to draw</small></span>
          <span class="review-actions">
            <button class="btn sm" :disabled="store.saving" @click="confirmingRelationships = false"><i data-lucide="arrow-left"></i> Back</button>
            <button class="btn sm primary" :disabled="!reviewNodeIds.length || store.saving" @click="importResources(reviewNodeIds)">
              <i :data-lucide="store.saving ? 'loader-2' : 'download'"></i>
              {{ store.saving ? 'Drawing…' : 'Draw diagram' }}
            </button>
          </span>
        </div>
        <div v-if="reviewRelationships.length" class="suggestion-list">
          <div v-for="suggestion in reviewRelationships" :key="suggestion.id" class="suggestion-row">
            <span><strong>{{ nodeName(suggestion.sourceNodeId) }}</strong><small>{{ relationshipLabel(suggestion.relationType) }}</small><strong>{{ nodeName(suggestion.targetNodeId) }}</strong></span>
            <span class="confidence">{{ Math.round(suggestion.confidence * 100) }}%</span>
            <span :class="['outcome-badge', suggestion.confidence >= threshold ? 'automatic' : 'suggested']">
              {{ suggestion.confidence >= threshold ? 'Automatic' : 'Review' }}
            </span>
            <span class="evidence-badge"><i data-lucide="shield-check"></i> {{ suggestion.evidence[0]?.intrinsic }}</span>
          </div>
        </div>
        <div v-else class="discovery-empty">No relationships found between the selected resources.</div>
      </template>
    </template>
  </section>
</template>

<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { createIcons, icons } from 'lucide'
import { useArchitectureStore } from '../../stores/useArchitectureStore'

const emit = defineEmits(['close', 'imported'])
const store = useArchitectureStore()
const region = ref('us-east-1')
const selectedStacks = ref([])
const selectedNodes = ref([])
const confirmingRelationships = ref(false)
const steps = [
  { label: 'CloudFormation', detail: 'Choose deployments' },
  { label: 'Resources', detail: 'Confirm components' },
  { label: 'Diagram', detail: 'Review application flow' },
]
const threshold = computed(() => store.selectedProject?.automaticEdgeThreshold ?? 0.85)
const thresholdPercent = computed(() => Math.round(threshold.value * 100))
const currentStep = computed(() => (store.discoveryPreview ? (confirmingRelationships.value ? 2 : 1) : 0))
const discoveryProgress = computed(() => store.discoveryPhase === 'stacks'
  ? { title: 'Loading CloudFormation stacks', detail: 'AWS is listing deployments in the selected region.' }
  : { title: 'Analyzing AWS resources', detail: 'Reading selected stacks, regional inventory and relationship evidence. This can take a moment.' })
const stackNodes = computed(() => store.discoveryPreview?.nodes?.filter(node => selectedStacks.value.includes(node.stackName)) || [])
const stackRelationshipCount = computed(() => {
  const nodeIds = new Set(stackNodes.value.map(node => node.id))
  return store.discoveryPreview?.relationshipSuggestions?.filter(edge =>
    nodeIds.has(edge.sourceNodeId) && nodeIds.has(edge.targetNodeId)).length || 0
})
const relatedNodeIds = computed(() => [...new Set((store.discoveryPreview?.relationshipSuggestions || [])
  .flatMap(edge => [edge.sourceNodeId, edge.targetNodeId]))])
const relatedNodeSet = computed(() => new Set(relatedNodeIds.value))
const selectableNodes = computed(() => (store.discoveryPreview?.nodes || [])
  .filter(node => !relatedNodeSet.value.has(node.id)))
const resourceGroups = computed(() => {
  const groups = new Map()
  for (const node of selectableNodes.value) {
    const type = node.resourceType || 'resource'
    const group = groups.get(type) || { type, label: resourceLabel(type), nodes: [] }
    group.nodes.push(node)
    groups.set(type, group)
  }
  return [...groups.values()]
    .map(group => ({ ...group, nodes: group.nodes.slice().sort((left, right) => left.name.localeCompare(right.name)) }))
    .sort((left, right) => left.label.localeCompare(right.label) || left.type.localeCompare(right.type))
})
const reviewNodeIds = computed(() => [...new Set([...relatedNodeIds.value, ...selectedNodes.value])])
const reviewNodeSet = computed(() => new Set(reviewNodeIds.value))
const reviewRelationships = computed(() => (store.discoveryPreview?.relationshipSuggestions || [])
  .filter(edge => reviewNodeSet.value.has(edge.sourceNodeId) && reviewNodeSet.value.has(edge.targetNodeId)))
const resourceSelectionHint = computed(() => {
  if (selectedStacks.value.length > 1) return 'Multiple stacks draw the complete stack diagram'
  if (!selectableNodes.value.length) return 'Suggested relationships already cover every preview resource'
  return `${selectableNodes.value.length} unlinked resource${selectableNodes.value.length === 1 ? '' : 's'} available for manual selection`
})
const selectedStackSummary = computed(() => selectedStacks.value.length
  ? `${selectedStacks.value.length} CloudFormation deployment${selectedStacks.value.length === 1 ? '' : 's'} selected`
  : 'Regional inventory without a CloudFormation deployment')

async function loadDeployments() {
  selectedStacks.value = []
  selectedNodes.value = []
  confirmingRelationships.value = false
  await store.loadAwsDeployments(region.value)
  refreshIcons()
}

async function previewResources(stackNames) {
  selectedNodes.value = []
  confirmingRelationships.value = false
  await store.previewAwsResources({
    region: region.value,
    accountId: store.discoveryCatalog?.scope.accountId || '',
    stackNames,
  })
  refreshIcons()
}

function previewSelectedStacks() {
  return previewResources(selectedStacks.value)
}

function previewRegionalInventory() {
  selectedStacks.value = []
  return previewResources([])
}

function backToStacks() {
  selectedNodes.value = []
  confirmingRelationships.value = false
  store.discoveryPreview = null
  refreshIcons()
}

function continueToRelationships() {
  confirmingRelationships.value = true
  refreshIcons()
}

async function importResources(nodeIds = selectedNodes.value) {
  const graph = await store.importAwsResources({
    region: region.value,
    accountId: store.discoveryPreview.scope.accountId,
    stackNames: selectedStacks.value,
    selectedNodeIds: nodeIds,
  })
  if (graph) {
    selectedNodes.value = []
    confirmingRelationships.value = false
    emit('imported', graph)
    refreshIcons()
  }
}

function resourceIcon(type) {
  return {
    lambda: 'square-function', sqs: 'list-end', eventbridge: 'radio-tower', stepfunctions: 'workflow',
    ecs: 'container', s3: 'hard-drive', iam: 'shield', 'iam-policy': 'shield-check', policy: 'scroll-text',
    sns: 'radio', dynamodb: 'database', api: 'braces', logs: 'logs', secret: 'key-round',
  }[type] || 'box'
}

function resourceLabel(type) {
  return {
    lambda: 'Lambda', sqs: 'SQS queue', eventbridge: 'EventBridge rule', stepfunctions: 'Step Functions',
    ecs: 'ECS', s3: 'S3 bucket', iam: 'IAM role', 'iam-policy': 'IAM policy', policy: 'Resource policy',
    sns: 'SNS', dynamodb: 'DynamoDB', api: 'API Gateway', logs: 'CloudWatch Logs', secret: 'Secret',
  }[type] || String(type || 'AWS resource').replaceAll('-', ' ')
}

function nodeName(nodeId) {
  return store.discoveryPreview.nodes.find(node => node.id === nodeId)?.name || nodeId
}

function resourceOrigin(node) {
  return node.stackName ? `${node.stackName} / ${node.logicalId}` : 'Regional inventory'
}

function evidenceLabel(node) {
  return node.evidence?.[0]?.type === 'cloudformation_resource' ? 'CloudFormation' : 'AWS inventory'
}

async function drawApplication(candidate) {
  selectedNodes.value = [...candidate.nodeIds]
  await importResources(candidate.nodeIds)
}

async function drawStackResources() {
  selectedNodes.value = stackNodes.value.map(node => node.id)
  await importResources(selectedNodes.value)
}

function relationshipLabel(relationType) {
  return { depends_on: 'depends on', triggers: 'triggers', invokes: 'invokes', runs_on: 'runs on' }[relationType]
    || String(relationType || 'depends_on').replaceAll('_', ' ')
}

function refreshIcons() {
  nextTick(() => createIcons({ icons }))
}

watch(() => store.discoveryPreview, refreshIcons)
onMounted(refreshIcons)
</script>

<style scoped>
.discovery-panel { margin-bottom: 12px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-panel); overflow: hidden; }
.discovery-header, .discovery-controls, .discovery-section-heading { padding: 10px 12px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--border); }
.discovery-header { justify-content: space-between; }
.discovery-progress { min-height: 54px; padding: 8px 12px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid color-mix(in srgb, #2f81f7 55%, var(--border)); background: color-mix(in srgb, #2f81f7 9%, transparent); color: var(--text); }
.discovery-progress > i { width: 19px; height: 19px; color: #2f81f7; animation: discovery-spin 0.9s linear infinite; }
.discovery-progress span { display: flex; flex-direction: column; gap: 2px; }
.discovery-progress small { color: var(--text-dim); }
.discovery-header > span, .discovery-section-heading > span { display: flex; align-items: center; gap: 8px; }
.discovery-header small, .discovery-section-heading small { color: var(--text-dim); }
.discovery-steps { min-height: 68px; padding: 9px 12px; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); border-bottom: 1px solid var(--border); background: var(--bg); }
.discovery-steps > span { position: relative; display: grid; grid-template-columns: 28px minmax(0, 1fr); grid-template-rows: auto auto; column-gap: 8px; align-content: center; color: var(--text-dim); }
.discovery-steps > span:not(:last-child)::after { content: ''; position: absolute; top: 14px; right: 12px; width: calc(100% - 150px); min-width: 24px; height: 1px; background: var(--border); }
.discovery-steps > span > span { grid-row: 1 / 3; width: 28px; height: 28px; display: grid; place-items: center; border: 1px solid var(--border); border-radius: 50%; font-size: 11px; font-weight: 700; }
.discovery-steps strong { color: inherit; font-size: 11px; }
@keyframes discovery-spin { to { transform: rotate(360deg); } }
.discovery-steps small { color: var(--text-dim); font-size: 10px; }
.discovery-steps > span.active { color: #e3b341; }
.discovery-steps > span.active > span { color: #0d1117; border-color: #e3b341; background: #e3b341; }
.discovery-steps > span.complete { color: #3fb950; }
.discovery-steps > span.complete > span { border-color: #3fb950; }
.discovery-controls label { display: flex; align-items: center; gap: 7px; color: var(--text-dim); font-size: 11px; }
.discovery-controls .ctrl-input { width: 130px; }
.discovery-scope { margin-left: auto; color: var(--text-dim); font-size: 11px; }
.discovery-section-heading { justify-content: space-between; background: var(--bg-hover); }
.discovery-section-heading > span { flex-direction: column; align-items: flex-start; gap: 2px; }
.deployment-list, .resource-list { max-height: 250px; overflow: auto; }
.selection-count { color: #e3b341; font-size: 11px; }
.discovery-next-actions { padding: 10px 12px; display: flex; justify-content: flex-end; gap: 8px; border-bottom: 1px solid var(--border); }
.resource-step-heading { border-top: 0; }
.stack-resource-summary { min-height: 62px; padding: 9px 12px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--border); background: color-mix(in srgb, #3fb950 5%, transparent); }
.stack-resource-summary > span:nth-child(2) { display: flex; flex-direction: column; min-width: 0; }
.stack-resource-summary small { color: var(--text-dim); }
.stack-resource-summary .btn { margin-left: auto; }
.resource-group { border-bottom: 1px solid var(--border); }
.resource-group:last-child { border-bottom: 0; }
.resource-group-heading { position: sticky; top: 0; z-index: 1; min-height: 42px; padding: 7px 12px; display: flex; align-items: center; gap: 9px; border-bottom: 1px solid var(--border); background: color-mix(in srgb, var(--bg-hover) 78%, var(--bg-panel)); }
.resource-group-heading > span:last-child { display: flex; flex-direction: column; min-width: 0; }
.resource-group-heading small { color: var(--text-dim); }
.discovery-row { min-height: 48px; padding: 8px 12px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--border); cursor: pointer; }
.resource-row { padding-left: 20px; }
.discovery-row:hover { background: var(--bg-hover); }
.discovery-row > span:not(.resource-icon, .evidence-badge) { display: flex; flex-direction: column; min-width: 0; }
.discovery-row small { color: var(--text-dim); }
.discovery-row time { margin-left: auto; color: var(--text-dim); font-size: 11px; }
.resource-icon { width: 30px; height: 30px; display: grid; place-items: center; border-radius: 5px; background: #1f6feb; color: white; }
.resource-icon :deep(svg) { width: 16px; height: 16px; }
.evidence-badge { margin-left: auto; display: flex; align-items: center; gap: 5px; color: #3fb950; font-size: 11px; white-space: nowrap; }
.evidence-badge :deep(svg) { width: 14px; height: 14px; }
.relationship-readiness { margin: 10px 12px; padding: 9px 10px; display: flex; align-items: center; gap: 9px; border-left: 3px solid #2f81f7; background: var(--bg-hover); }
.relationship-readiness > span { display: flex; flex-direction: column; }
.relationship-readiness small, .discovery-empty { color: var(--text-dim); }
.suggestion-list { border-top: 1px solid var(--border); }
.suggestion-row { min-height: 44px; padding: 7px 12px; display: flex; align-items: center; gap: 12px; border-bottom: 1px solid var(--border); }
.suggestion-row > span:first-child { display: flex; align-items: center; gap: 7px; min-width: 0; }
.suggestion-row small { color: var(--text-dim); }
.confidence { margin-left: auto; color: #d29922; font-weight: 700; }
.outcome-badge { padding: 2px 5px; border-radius: 4px; font-size: 10px; font-weight: 700; }
.outcome-badge.automatic { color: #58a6ff; background: color-mix(in srgb, #2f81f7 14%, transparent); }
.outcome-badge.suggested { color: #d29922; background: color-mix(in srgb, #d29922 14%, transparent); }
.discovery-empty { padding: 18px; text-align: center; }
.application-row { min-height: 52px; padding: 8px 12px; display: flex; align-items: center; justify-content: space-between; gap: 12px; border-bottom: 1px solid var(--border); }
.application-row > span { display: flex; flex-direction: column; min-width: 0; }
.application-row small { color: var(--text-dim); }
.application-types { margin-top: 5px; display: flex; flex-wrap: wrap; gap: 5px; }
.application-types span { padding: 2px 5px; display: inline-flex; align-items: center; gap: 4px; color: var(--text-dim); border: 1px solid var(--border); border-radius: 4px; font-size: 10px; }
.application-types :deep(svg) { width: 11px; height: 11px; }
.inventory-warning { margin: 10px 12px; padding: 9px 10px; display: flex; align-items: center; gap: 8px; color: #d29922; border-left: 3px solid #d29922; background: var(--bg-hover); }
.inventory-warning :deep(svg) { width: 15px; height: 15px; flex: none; }
@media (max-width: 760px) {
  .discovery-controls { align-items: flex-start; flex-wrap: wrap; }
  .discovery-scope { width: 100%; margin-left: 0; }
  .discovery-header small { display: none; }
  .discovery-row time, .evidence-badge { display: none; }
  .discovery-steps { grid-template-columns: 1fr; gap: 8px; }
  .discovery-steps > span:not(.active, .complete) { display: none; }
  .discovery-steps > span::after { display: none; }
  .discovery-next-actions { align-items: stretch; flex-direction: column-reverse; }
  .stack-resource-summary { align-items: flex-start; flex-wrap: wrap; }
  .stack-resource-summary .btn { width: 100%; margin-left: 0; }
}
</style>