<template>
  <section class="discovery-panel">
    <header class="discovery-header">
      <span><i data-lucide="scan-search"></i><strong>AWS discovery</strong><small>Read-only CloudFormation and ECS inventory</small></span>
      <button class="btn sm btn-icon" title="Close discovery" @click="$emit('close')"><i data-lucide="x"></i></button>
    </header>

    <div class="discovery-controls">
      <label>Region<input v-model.trim="region" class="ctrl-input" placeholder="us-east-1" /></label>
      <button class="btn sm" :disabled="store.discovering || !region" @click="loadDeployments">
        <i :data-lucide="store.discovering ? 'loader-2' : 'cloud-download'"></i>
        {{ store.discoveryCatalog ? 'Refresh stacks' : 'Load stacks' }}
      </button>
      <span v-if="store.discoveryCatalog" class="discovery-scope">
        Account {{ store.discoveryCatalog.scope.accountId }} · {{ store.discoveryCatalog.estimate.awsRequests }} read request{{ store.discoveryCatalog.estimate.awsRequests === 1 ? '' : 's' }}
      </span>
    </div>

    <template v-if="store.discoveryCatalog">
      <div class="discovery-section-heading">
        <span><strong>1. Select deployments</strong><small>Up to 10 active CloudFormation stacks</small></span>
        <button class="btn sm" :disabled="!selectedStacks.length || store.discovering" @click="previewResources">
          Preview resources
        </button>
      </div>
      <div v-if="store.discoveryCatalog.deployments.length" class="deployment-list">
        <label v-for="deployment in store.discoveryCatalog.deployments" :key="deployment.id" class="discovery-row">
          <input v-model="selectedStacks" type="checkbox" :value="deployment.name" :disabled="!selectedStacks.includes(deployment.name) && selectedStacks.length >= 10" />
          <span><strong>{{ deployment.name }}</strong><small>{{ deployment.status }}</small></span>
          <time>{{ deployment.updatedAt ? new Date(deployment.updatedAt).toLocaleString() : 'No update time' }}</time>
        </label>
      </div>
      <div v-else class="discovery-empty">No active CloudFormation stacks found in this region.</div>
    </template>

    <template v-if="store.discoveryPreview">
      <div class="discovery-section-heading">
        <span><strong>2. Confirm resources</strong><small>No resource is selected automatically</small></span>
        <button class="btn sm primary" :disabled="!selectedNodes.length || store.saving" @click="importResources">
          <i data-lucide="download"></i> Import {{ selectedNodes.length || '' }}
        </button>
      </div>
      <div class="resource-list">
        <label v-for="node in store.discoveryPreview.nodes" :key="node.id" class="discovery-row resource-row">
          <input v-model="selectedNodes" type="checkbox" :value="node.id" />
          <span class="resource-icon"><i :data-lucide="resourceIcon(node.resourceType)"></i></span>
          <span><strong>{{ node.name }}</strong><small>{{ resourceLabel(node.resourceType) }} · {{ node.stackName }} / {{ node.logicalId }}</small></span>
          <span class="evidence-badge"><i data-lucide="shield-check"></i> CloudFormation</span>
        </label>
      </div>
      <div class="relationship-readiness">
        <i data-lucide="git-branch"></i>
        <span>
          <strong>{{ store.discoveryPreview.relationshipSuggestions.length }} relationship suggestion{{ store.discoveryPreview.relationshipSuggestions.length === 1 ? '' : 's' }}</strong>
          <small>CloudFormation references are preview-only. Import creates nodes without confirming these relationships.</small>
        </span>
      </div>
      <div v-if="store.discoveryPreview.relationshipSuggestions.length" class="suggestion-list">
        <div v-for="suggestion in store.discoveryPreview.relationshipSuggestions" :key="suggestion.id" class="suggestion-row">
          <span><strong>{{ nodeName(suggestion.sourceNodeId) }}</strong><small>depends on</small><strong>{{ nodeName(suggestion.targetNodeId) }}</strong></span>
          <span class="confidence">{{ Math.round(suggestion.confidence * 100) }}%</span>
          <span class="evidence-badge"><i data-lucide="shield-check"></i> {{ suggestion.evidence[0]?.intrinsic }}</span>
        </div>
      </div>
    </template>
  </section>
</template>

<script setup>
import { nextTick, onMounted, ref, watch } from 'vue'
import { createIcons, icons } from 'lucide'
import { useArchitectureStore } from '../../stores/useArchitectureStore'

defineEmits(['close', 'imported'])
const store = useArchitectureStore()
const region = ref('us-east-1')
const selectedStacks = ref([])
const selectedNodes = ref([])

async function loadDeployments() {
  selectedStacks.value = []
  selectedNodes.value = []
  await store.loadAwsDeployments(region.value)
  refreshIcons()
}

async function previewResources() {
  selectedNodes.value = []
  await store.previewAwsResources({
    region: region.value,
    accountId: store.discoveryCatalog.scope.accountId,
    stackNames: selectedStacks.value,
  })
  refreshIcons()
}

async function importResources() {
  const graph = await store.importAwsResources({
    region: region.value,
    accountId: store.discoveryCatalog.scope.accountId,
    stackNames: selectedStacks.value,
    selectedNodeIds: selectedNodes.value,
  })
  if (graph) {
    selectedNodes.value = []
    refreshIcons()
  }
}

function resourceIcon(type) {
  return { lambda: 'square-function', sqs: 'list-end', eventbridge: 'radio-tower', stepfunctions: 'workflow', ecs: 'container' }[type] || 'box'
}

function resourceLabel(type) {
  return { lambda: 'Lambda', sqs: 'SQS queue', eventbridge: 'EventBridge rule', stepfunctions: 'Step Functions', ecs: 'ECS' }[type] || type
}

function nodeName(nodeId) {
  return store.discoveryPreview.nodes.find(node => node.id === nodeId)?.name || nodeId
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
.discovery-header > span, .discovery-section-heading > span { display: flex; align-items: center; gap: 8px; }
.discovery-header small, .discovery-section-heading small { color: var(--text-dim); }
.discovery-controls label { display: flex; align-items: center; gap: 7px; color: var(--text-dim); font-size: 11px; }
.discovery-controls .ctrl-input { width: 130px; }
.discovery-scope { margin-left: auto; color: var(--text-dim); font-size: 11px; }
.discovery-section-heading { justify-content: space-between; background: var(--bg-hover); }
.discovery-section-heading > span { flex-direction: column; align-items: flex-start; gap: 2px; }
.deployment-list, .resource-list { max-height: 250px; overflow: auto; }
.discovery-row { min-height: 48px; padding: 8px 12px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--border); cursor: pointer; }
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
.discovery-empty { padding: 18px; text-align: center; }
@media (max-width: 760px) {
  .discovery-controls { align-items: flex-start; flex-wrap: wrap; }
  .discovery-scope { width: 100%; margin-left: 0; }
  .discovery-header small { display: none; }
  .discovery-row time, .evidence-badge { display: none; }
}
</style>