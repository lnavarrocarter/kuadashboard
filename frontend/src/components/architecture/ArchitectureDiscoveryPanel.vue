<template>
  <section class="discovery-panel">
    <header class="discovery-header">
      <span><i data-lucide="scan-search"></i><strong>{{ t('archDisc.title') }}</strong><small>{{ t('archDisc.subtitle') }}</small></span>
      <button class="btn sm btn-icon" :title="t('archDisc.close')" @click="$emit('close')"><i data-lucide="x"></i></button>
    </header>

    <nav class="discovery-steps" :aria-label="t('archDisc.progressLabel')">
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
      <label>{{ t('archDisc.region') }}<input v-model.trim="region" class="ctrl-input" placeholder="us-east-1" /></label>
      <button class="btn sm primary" :disabled="store.discovering || !region" @click="loadDeployments">
        <i :data-lucide="store.discovering ? 'loader-2' : 'cloud-download'"></i>
        {{ store.discoveryCatalog ? t('archDisc.refreshStacks') : t('archDisc.findStacks') }}
      </button>
      <form class="arn-resource-lookup" @submit.prevent="findAwsResourceByArn">
        <label>{{ t('archDisc.arnLookup') }}<input v-model.trim="resourceArn" class="ctrl-input" :placeholder="t('archDisc.arnPlaceholder')" data-test="aws-arn-input" /></label>
        <button class="btn sm" :disabled="store.discovering || !resourceArn" data-test="aws-arn-search" type="submit"><i data-lucide="search"></i>{{ t('archDisc.findArn') }}</button>
      </form>
      <p v-if="arnLookupMessage" class="arn-lookup-message" role="status">{{ arnLookupMessage }}</p>
      <button v-if="unmappedArn" class="btn sm arn-reference-action" :disabled="store.saving" data-test="aws-arn-add-manual" @click="addUnmappedArn">
        <i data-lucide="plus"></i>{{ t('archDisc.addArnReference') }}
      </button>
      <span v-if="store.discoveryCatalog" class="discovery-scope">
        {{ t('archDisc.accountScope', { account: store.discoveryCatalog.scope.accountId, n: store.discoveryCatalog.estimate.awsRequests }) }}
      </span>
    </div>

    <template v-if="store.discoveryCatalog && !store.discoveryPreview">
      <div class="discovery-section-heading">
        <span><strong>{{ t('archDisc.chooseCfn') }}</strong><small>{{ t('archDisc.chooseCfnHint') }}</small></span>
        <strong class="selection-count">{{ t('archDisc.selected', { n: selectedStacks.length }) }}</strong>
      </div>
      <label v-if="store.discoveryCatalog.deployments.length" class="deployment-search">
        <i data-lucide="search"></i>
        <input v-model="stackSearch" type="search" :placeholder="t('archDisc.searchStacks')" :aria-label="t('archDisc.searchStacks')" />
      </label>
      <div v-if="filteredDeployments.length" class="deployment-list">
        <label v-for="deployment in filteredDeployments" :key="deployment.id" class="discovery-row">
          <input v-model="selectedStacks" type="checkbox" :value="deployment.name" :disabled="!selectedStacks.includes(deployment.name) && selectedStacks.length >= 10" />
          <span><strong>{{ deployment.name }}</strong><small>{{ deployment.status }}</small></span>
          <time>{{ deployment.updatedAt ? new Date(deployment.updatedAt).toLocaleString() : t('archDisc.noUpdateTime') }}</time>
        </label>
      </div>
      <div v-else-if="store.discoveryCatalog.deployments.length" class="discovery-empty">{{ t('archDisc.noStackMatches') }}</div>
      <div v-else class="discovery-empty">{{ t('archDisc.noStacks') }}</div>
      <div class="discovery-next-actions">
        <button v-if="store.discoveryCatalog.deployments.length" class="btn sm" :disabled="store.discovering" @click="previewRegionalInventory">
          <i data-lucide="radar"></i> {{ t('archDisc.useRegional') }}
        </button>
        <button class="btn sm primary" :disabled="store.discovering || (store.discoveryCatalog.deployments.length > 0 && !selectedStacks.length)" @click="previewSelectedStacks">
          {{ t('archDisc.continue') }} <i data-lucide="arrow-right"></i>
        </button>
      </div>
    </template>

    <template v-if="store.discoveryPreview">
      <div class="discovery-section-heading resource-step-heading">
        <span><strong>{{ t('archDisc.addResources') }}</strong><small>{{ selectedStackSummary }}</small></span>
        <button class="btn sm" @click="backToStacks"><i data-lucide="arrow-left"></i> {{ t('archDisc.backToStacks') }}</button>
      </div>
        <button v-if="unmappedArn" class="btn sm arn-reference-action" :disabled="store.saving" data-test="aws-arn-add-manual" @click="addUnmappedArn">
          <i data-lucide="plus"></i>{{ t('archDisc.addArnReference') }}
        </button>
      <div v-if="selectedStacks.length" class="stack-resource-summary">
        <span class="resource-icon"><i data-lucide="layers-3"></i></span>
        <span>
          <strong>{{ t('archDisc.cfnCoverage') }}</strong>
          <small>{{ t('archDisc.coverageDetail', { resources: stackNodes.length, relationships: stackRelationshipCount, n: selectedStacks.length }) }}</small>
        </span>
        <button class="btn sm primary" :disabled="store.saving || !stackNodes.length || stackNodes.length > 500" @click="drawStackResources">
          <i data-lucide="layout-dashboard"></i> {{ t('archDisc.drawAllStack') }}
        </button>
      </div>
      <div v-if="store.discoveryPreview.applicationCandidates?.length" class="application-candidates">
        <div class="discovery-section-heading">
          <span><strong>{{ t('archDisc.identifiedApps') }}</strong><small>{{ t('archDisc.identifiedAppsHint') }}</small></span>
        </div>
        <div v-for="candidate in store.discoveryPreview.applicationCandidates" :key="candidate.id" class="application-row">
          <span>
            <strong>{{ candidate.name }}</strong>
            <small>{{ t('archDisc.candidateDetail', { resources: candidate.resourceCount, relationships: candidate.relationshipCount, pct: Math.round(candidate.confidence * 100) }) }}<template v-if="candidateAlreadyAddedCount(candidate)"> · {{ t('archDisc.alreadyInProjectCount', { n: candidateAlreadyAddedCount(candidate) }) }}</template></small>
            <span class="application-types">
              <span v-for="item in candidate.resourceTypes" :key="item.type">
                <i :data-lucide="resourceIcon(item.type)"></i>{{ item.count }} {{ resourceLabel(item.type) }}
              </span>
            </span>
          </span>
          <button class="btn sm primary" :disabled="store.saving" @click="drawApplication(candidate)">
            <i :data-lucide="store.saving ? 'loader-2' : 'workflow'"></i>
            {{ store.saving ? t('archDisc.drawing') : t('archDisc.drawApplication') }}
          </button>
        </div>
      </div>
      <div v-if="store.discoveryPreview.estimate.truncated" class="inventory-warning">
        <i data-lucide="triangle-alert"></i>
        {{ t('archDisc.truncated') }}
      </div>
      <div v-if="crossStackReferences.length" class="inventory-warning">
        <i data-lucide="link-2"></i>
        <span>
          {{ t('archDisc.crossStack', { n: crossStackReferences.length, names: crossStackReferenceNames }) }}
        </span>
      </div>
      <div v-if="!confirmingRelationships" class="discovery-section-heading">
        <span><strong>{{ t('archDisc.confirmResources') }}</strong><small>{{ resourceSelectionHint }}</small></span>
        <button v-if="selectedStacks.length > 1" class="btn sm primary" :disabled="store.saving || !stackNodes.length || stackNodes.length > 500" @click="drawStackResources">
          <i :data-lucide="store.saving ? 'loader-2' : 'layout-dashboard'"></i>
          {{ store.saving ? t('archDisc.drawing') : t('archDisc.drawComplete') }}
        </button>
        <button v-else class="btn sm primary" :disabled="!reviewNodeIds.length || store.saving" @click="continueToRelationships">
          {{ t('archDisc.reviewRelationships') }} <i data-lucide="arrow-right"></i>
        </button>
      </div>
      <div v-if="!confirmingRelationships && selectedStacks.length <= 1" class="resource-list">
        <label v-if="selectableNodes.length" class="resource-search">
          <i data-lucide="search"></i>
          <input v-model.trim="resourceSearch" type="search" :placeholder="t('archDisc.searchResources')" :aria-label="t('archDisc.searchResources')" data-test="aws-resource-search" />
        </label>
        <section v-for="group in filteredResourceGroups" :key="group.type" class="resource-group">
          <header class="resource-group-heading">
            <span class="resource-icon"><i :data-lucide="resourceIcon(group.type)"></i></span>
            <span><strong>{{ group.label }}</strong><small>{{ t(group.nodes.length === 1 ? 'archDisc.resource' : 'archDisc.resources', { n: group.nodes.length }) }}</small></span>
          </header>
          <label v-for="node in group.nodes" :key="node.id" class="discovery-row resource-row" :class="{ 'already-in-project': node.alreadyInGraph }">
            <input v-model="selectedNodes" type="checkbox" :value="node.id" :disabled="node.alreadyInGraph" />
            <span><strong>{{ node.name }}</strong><small>{{ resourceOrigin(node) }}</small><small v-if="nativeIdentity(node)" class="native-identity" :title="nativeIdentity(node)">{{ nativeIdentity(node) }}</small></span>
            <span v-if="node.alreadyInGraph" class="evidence-badge already-badge"><i data-lucide="check-circle-2"></i> {{ alreadyAddedLabel(t, store.linkedApplication) }}</span>
            <span v-else class="evidence-badge"><i data-lucide="shield-check"></i> {{ evidenceLabel(node) }}</span>
          </label>
        </section>
        <div v-if="!resourceGroups.length" class="discovery-empty">{{ t('archDisc.allCovered') }}</div>
        <div v-else-if="!filteredResourceGroups.length" class="discovery-empty">{{ t('archDisc.noResourceMatches') }}</div>
      </div>
      <div v-if="!confirmingRelationships" class="relationship-readiness">
        <i data-lucide="git-branch"></i>
        <span>
          <strong>{{ t('archDisc.suggestionCount', { n: store.discoveryPreview.relationshipSuggestions.length }) }}</strong>
          <small>{{ t('archDisc.relatedIncluded', { n: relatedNodeIds.length }) }}</small>
        </span>
      </div>
      <template v-if="confirmingRelationships">
        <div class="discovery-section-heading">
          <span><strong>{{ t('archDisc.reviewRelationships') }}</strong><small>{{ t('archDisc.reviewDetail', { resources: reviewNodeIds.length, relationships: reviewRelationships.length }) }}</small></span>
          <span class="review-actions">
            <button class="btn sm" :disabled="store.saving" @click="confirmingRelationships = false"><i data-lucide="arrow-left"></i> {{ t('archDisc.back') }}</button>
            <button class="btn sm primary" :disabled="!reviewNodeIds.length || store.saving" @click="importResources(reviewNodeIds)">
              <i :data-lucide="store.saving ? 'loader-2' : 'download'"></i>
              {{ store.saving ? t('archDisc.drawing') : t('archDisc.drawDiagram') }}
            </button>
          </span>
        </div>
        <div v-if="reviewRelationships.length" class="suggestion-list">
          <div v-for="suggestion in reviewRelationships" :key="suggestion.id" class="suggestion-row">
            <span><strong>{{ nodeName(suggestion.sourceNodeId) }}</strong><small>{{ relationshipLabel(suggestion.relationType) }}</small><strong>{{ nodeName(suggestion.targetNodeId) }}</strong></span>
            <span class="confidence">{{ Math.round(suggestion.confidence * 100) }}%</span>
            <span :class="['outcome-badge', suggestion.confidence >= threshold ? 'automatic' : 'suggested']">
              {{ suggestion.confidence >= threshold ? t('archDisc.automatic') : t('archDisc.review') }}
            </span>
            <span class="evidence-badge"><i data-lucide="shield-check"></i> {{ suggestion.evidence[0]?.intrinsic }}</span>
          </div>
        </div>
        <div v-else class="discovery-empty">{{ t('archDisc.noRelationships') }}</div>
      </template>
    </template>
  </section>
</template>

<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { createIcons, icons } from 'lucide'
import { useArchitectureStore } from '../../stores/useArchitectureStore'
import { useI18n } from '../../composables/useI18n'
import { alreadyAddedLabel, nativeIdentity } from '../../lib/discoveryMembership'

const emit = defineEmits(['close', 'imported'])
const store = useArchitectureStore()
const { t } = useI18n()
const region = ref('us-east-1')
const resourceArn = ref('')
const arnLookupMessage = ref('')
const unmappedArn = ref('')
const resourceSearch = ref('')
const stackSearch = ref('')
const selectedStacks = ref([])
const selectedNodes = ref([])
const confirmingRelationships = ref(false)
const steps = computed(() => [
  { label: 'CloudFormation', detail: t('archDisc.step.cfnDetail') },
  { label: t('archDisc.step.resources'), detail: t('archDisc.step.resourcesDetail') },
  { label: t('archDisc.step.diagram'), detail: t('archDisc.step.diagramDetail') },
])
const threshold = computed(() => store.selectedProject?.automaticEdgeThreshold ?? 0.85)
const thresholdPercent = computed(() => Math.round(threshold.value * 100))
const currentStep = computed(() => (store.discoveryPreview ? (confirmingRelationships.value ? 2 : 1) : 0))
const discoveryProgress = computed(() => store.discoveryPhase === 'stacks'
  ? { title: t('archDisc.loadingStacks'), detail: t('archDisc.loadingStacksDetail') }
  : { title: t('archDisc.analyzing'), detail: t('archDisc.analyzingDetail') })
const filteredDeployments = computed(() => {
  const query = stackSearch.value.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase()
  if (!query) return store.discoveryCatalog?.deployments || []
  return (store.discoveryCatalog?.deployments || []).filter(deployment =>
    `${deployment.name} ${deployment.status}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().includes(query))
})
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
const filteredResourceGroups = computed(() => {
  const query = resourceSearch.value.trim().toLocaleLowerCase()
  if (!query) return resourceGroups.value
  return resourceGroups.value
    .map(group => ({
      ...group,
      nodes: group.nodes.filter(node => [node.name, node.arn, node.nativeId, node.discoveryKey, node.id]
        .some(value => String(value || '').toLocaleLowerCase().includes(query))),
    }))
    .filter(group => group.nodes.length)
})
const reviewNodeIds = computed(() => [...new Set([...relatedNodeIds.value, ...selectedNodes.value])])
const reviewNodeSet = computed(() => new Set(reviewNodeIds.value))
const reviewRelationships = computed(() => (store.discoveryPreview?.relationshipSuggestions || [])
  .filter(edge => reviewNodeSet.value.has(edge.sourceNodeId) && reviewNodeSet.value.has(edge.targetNodeId)))
const alreadyAddedCount = computed(() => selectableNodes.value.filter(node => node.alreadyInGraph).length)
const resourceSelectionHint = computed(() => {
  if (selectedStacks.value.length > 1) return t('archDisc.hint.multipleStacks')
  if (!selectableNodes.value.length) return t('archDisc.hint.allCovered')
  const pendingCount = selectableNodes.value.length - alreadyAddedCount.value
  const suffix = alreadyAddedCount.value ? t('archDisc.hint.alreadySuffix', { n: alreadyAddedCount.value }) : ''
  return t('archDisc.hint.unlinked', { n: pendingCount }) + suffix
})
const selectedStackSummary = computed(() => selectedStacks.value.length
  ? t(selectedStacks.value.length === 1 ? 'archDisc.deploymentSelected' : 'archDisc.deploymentsSelected', { n: selectedStacks.value.length })
  : t('archDisc.regionalNoCfn'))
const crossStackReferences = computed(() => store.discoveryPreview?.relationshipAnalysis?.crossStackReferences || [])
const crossStackReferenceNames = computed(() => [...new Set(crossStackReferences.value.map(reference => reference.exportName))].join(', '))

async function loadDeployments() {
  stackSearch.value = ''
  selectedStacks.value = []
  selectedNodes.value = []
  confirmingRelationships.value = false
  await store.loadAwsDeployments(region.value)
  refreshIcons()
}

async function findAwsResourceByArn() {
  const arn = resourceArn.value.trim()
  const parts = arn.split(':')
  const service = parts[2]
  const globalService = ['iam', 's3'].includes(service)
  if (parts[0] !== 'arn' || !service || (!globalService && (!parts[3] || !parts[4])) || !parts.slice(5).join(':')) {
    arnLookupMessage.value = t('archDisc.invalidArn')
    unmappedArn.value = ''
    return
  }
  selectedNodes.value = []
  confirmingRelationships.value = false
  arnLookupMessage.value = ''
  unmappedArn.value = ''
  if (globalService) {
    unmappedArn.value = arn
    arnLookupMessage.value = t('archDisc.arnNotMapped')
    refreshIcons()
    return
  }
  region.value = parts[3]
  const preview = await store.previewAwsResources({ region: parts[3], accountId: parts[4], stackNames: [] })
  if (!preview) return
  const match = preview.nodes.find(node => String(node.arn || '').toLowerCase() === arn.toLowerCase())
  if (!match) {
    unmappedArn.value = arn
    arnLookupMessage.value = t('archDisc.arnNotMapped')
    refreshIcons()
    return
  }
  if (match.alreadyInGraph) {
    arnLookupMessage.value = t('archDisc.arnAlreadyAdded')
    refreshIcons()
    return
  }
  selectedNodes.value = [match.id]
  resourceSearch.value = arn
  confirmingRelationships.value = true
  refreshIcons()
}

function awsTypeFromArn(service, resource) {
  const prefix = resource.split(/[/:]/, 1)[0]
  if (service === 'elasticloadbalancing') return prefix === 'targetgroup' ? 'targetgroup' : 'loadbalancer'
  if (service === 'ec2' && prefix === 'instance') return 'ec2'
  if (service === 'lambda' && prefix === 'function') return 'lambda'
  if (service === 'sqs') return 'sqs'
  if (service === 'sns') return 'sns'
  if (service === 'states') return 'stepfunctions'
  if (service === 'events' && prefix === 'rule') return 'eventbridge'
  if (service === 'ecs' && prefix === 'service') return 'ecs'
  if (service === 'rds' && prefix === 'db') return 'rds'
  if (service === 'dynamodb' && prefix === 'table') return 'dynamodb'
  if (service === 's3') return 's3'
  if (service === 'iam') return 'iam'
  return 'aws-resource'
}

async function addUnmappedArn() {
  const arn = unmappedArn.value
  if (!arn || store.graph?.document?.nodes?.some(node => String(node.arn || '').toLowerCase() === arn.toLowerCase())) {
    arnLookupMessage.value = t('archDisc.arnAlreadyAdded')
    unmappedArn.value = ''
    return
  }
  const parts = arn.split(':')
  const resource = parts.slice(5).join(':')
  const resourceType = awsTypeFromArn(parts[2], resource)
  const name = resource.split(/[/:]/).filter(Boolean).at(-1) || arn
  const node = {
    id: `manual:aws:${globalThis.crypto?.randomUUID?.() || Date.now()}`,
    provider: 'aws', resourceType, kind: resourceType, name, arn, nativeId: arn, discoveryKey: arn,
    accountId: parts[4] || '', region: parts[3] || '', manual: true,
    evidence: [{ type: 'manual_resource', values: [arn], unverified: true }],
  }
  const graph = await store.applyOperation({ type: 'node.upsert', value: node }, {
    reason: t('archDisc.reasonAddArn', { name }),
  })
  if (!graph) return
  store.discoveryPreview = null
  unmappedArn.value = ''
  emit('imported', graph)
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
    lambda: 'Lambda', sqs: t('archCanvas.type.sqs'), eventbridge: t('archCanvas.type.eventbridge'), stepfunctions: 'Step Functions',
    ecs: 'ECS', s3: t('archCanvas.type.s3'), iam: t('archCanvas.type.iam'), 'iam-policy': t('archCanvas.type.iamPolicy'), policy: t('archCanvas.type.policy'),
    sns: 'SNS', dynamodb: 'DynamoDB', api: 'API Gateway', logs: 'CloudWatch Logs', secret: t('archCanvas.type.secret'),
  }[type] || (type ? String(type).replaceAll('-', ' ') : t('archCanvas.type.awsResource'))
}

function nodeName(nodeId) {
  return store.discoveryPreview.nodes.find(node => node.id === nodeId)?.name || nodeId
}

function resourceOrigin(node) {
  return node.stackName ? `${node.stackName} / ${node.logicalId}` : t('archDisc.regionalInventory')
}

function evidenceLabel(node) {
  return node.evidence?.[0]?.type === 'cloudformation_resource' ? 'CloudFormation' : t('archDisc.awsInventory')
}

function candidateAlreadyAddedCount(candidate) {
  const nodesById = new Map((store.discoveryPreview?.nodes || []).map(node => [node.id, node]))
  return candidate.nodeIds.filter(id => nodesById.get(id)?.alreadyInGraph).length
}

async function drawApplication(candidate) {
  selectedNodes.value = [...candidate.nodeIds]
  await importResources(candidate.nodeIds)
}

async function drawStackResources() {
  selectedNodes.value = stackNodes.value.map(node => node.id)
  await importResources(selectedNodes.value)
}

const RELATION_TYPES = ['depends_on', 'triggers', 'invokes', 'runs_on', 'routes_to', 'references', 'accesses']

function relationshipLabel(relationType) {
  const type = relationType || 'depends_on'
  return RELATION_TYPES.includes(type) ? t(`archCanvas.rel.${type}`) : String(type).replaceAll('_', ' ')
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
.arn-resource-lookup { min-width: 280px; display: flex; align-items: center; gap: 8px; }
.arn-resource-lookup label { flex: 1; min-width: 0; }
.arn-resource-lookup .ctrl-input { width: 100%; min-width: 0; }
.arn-lookup-message { flex-basis: 100%; margin: 0; color: var(--text-dim); font-size: 11px; }
.arn-reference-action { margin: 8px 12px; }
.discovery-scope { margin-left: auto; color: var(--text-dim); font-size: 11px; }
.discovery-section-heading { justify-content: space-between; background: var(--bg-hover); }
.discovery-section-heading > span { flex-direction: column; align-items: flex-start; gap: 2px; }
.deployment-search { min-height: 38px; margin: 8px 12px; padding: 0 9px; display: flex; align-items: center; gap: 8px; border: 1px solid var(--border); border-radius: 4px; background: var(--bg); color: var(--text-dim); }
.deployment-search:focus-within { border-color: #2f81f7; }
.deployment-search :deep(svg) { width: 15px; height: 15px; flex: none; }
.deployment-search input { width: 100%; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--text); font: inherit; }
.deployment-search input::placeholder { color: var(--text-dim); }
.resource-search { min-height: 38px; margin: 8px 12px; padding: 0 9px; display: flex; align-items: center; gap: 8px; border: 1px solid var(--border); border-radius: 4px; background: var(--bg); color: var(--text-dim); }
.resource-search:focus-within { border-color: #2f81f7; }
.resource-search :deep(svg) { width: 15px; height: 15px; flex: none; }
.resource-search input { width: 100%; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--text); font: inherit; }
.resource-search input::placeholder { color: var(--text-dim); }
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
.discovery-row.already-in-project { cursor: default; opacity: 0.65; }
.evidence-badge.already-badge { color: var(--text-dim); }
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
  .arn-resource-lookup { width: 100%; min-width: 0; }
  .deployment-search { margin: 8px; }
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
.native-identity { display: block; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: monospace; font-size: 10px; color: var(--text-dim); }
</style>