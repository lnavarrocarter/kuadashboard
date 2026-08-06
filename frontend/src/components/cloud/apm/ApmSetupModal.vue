<template>
  <BaseModal :show="show" :wide="true" @close="$emit('close')">
    <template #title><i data-lucide="square-activity"></i> {{ t('apm.setupTitle') }}</template>

    <form class="apm-setup" @submit.prevent="submit">
      <section class="setup-section">
        <div class="setup-section-title">{{ t('apm.identity') }}</div>
        <div class="scope-banner">
          <i data-lucide="cloud-cog"></i>
          <span><small>{{ t('apm.awsScope') }}</small><strong>{{ profileName }} · {{ deploymentCatalog?.scope?.accountId || t('apm.accountPending') }} · {{ form.region }}</strong></span>
        </div>
        <div class="setup-grid">
          <label>{{ t('apm.name') }}<input v-model.trim="form.name" class="ctrl-input" required placeholder="orders" /></label>
          <label>{{ t('apm.region') }}<input v-model.trim="form.region" class="ctrl-input" required placeholder="us-east-1" /></label>
          <label>{{ t('apm.environment') }}<input v-model.trim="form.environment" class="ctrl-input" placeholder="dev" /></label>
          <label>{{ t('apm.team') }}<input v-model.trim="form.team" class="ctrl-input" placeholder="platform" /></label>
        </div>
      </section>

      <section class="setup-section">
        <div class="setup-section-head">
          <div>
            <div class="setup-section-title">{{ t('apm.awsInventory') }}</div>
            <div class="setup-hint">{{ t('apm.awsInventoryHint') }}</div>
          </div>
          <button class="btn sm" type="button" :disabled="!profileId || !loadInventory || loadingInventory" @click="refreshInventory">
            <i :data-lucide="loadingInventory ? 'loader-2' : 'list-restart'"></i>
            {{ loadingInventory ? t('apm.loadingInventory') : t('apm.loadInventory') }}
          </button>
        </div>
        <template v-if="inventoryResources.length">
          <input v-model.trim="inventorySearch" class="ctrl-input" :placeholder="t('apm.filterInventoryResources')" />
          <div class="resource-picker inventory-resources">
            <label v-for="resource in filteredInventoryResources" :key="resource.key" class="resource-option">
              <input v-model="selectedInventoryKeys" type="checkbox" :value="resource.key" />
              <i :data-lucide="resourceIcon(resource.type)"></i>
              <span>
                <strong>{{ resource.name }}</strong>
                <small>{{ resourceLabel(resource) }}</small>
                <small>{{ resourceLocation(resource) }}</small>
              </span>
            </label>
          </div>
          <div class="setup-hint">{{ t('apm.manualInventorySelection', { count: selectedInventoryKeys.length }) }}</div>
        </template>
        <div v-else-if="inventoryLoaded" class="setup-empty">{{ t('apm.noInventoryResources') }}</div>
      </section>

      <section class="setup-section">
        <div class="setup-section-head">
          <div>
            <div class="setup-section-title">{{ t('apm.deploymentImport') }}</div>
            <div class="setup-hint">{{ t('apm.deploymentImportHint') }}</div>
          </div>
          <button class="btn sm" type="button" :disabled="!profileId || loadingDeployments" @click="loadDeployments">
            <i :data-lucide="loadingDeployments ? 'loader-2' : 'cloud-download'"></i>
            {{ loadingDeployments ? t('apm.loadingDeployments') : t('apm.loadDeployments') }}
          </button>
        </div>
        <template v-if="deploymentCatalog">
          <div class="setup-tools deployment-tools">
            <input v-model.trim="deploymentSearch" class="ctrl-input setup-search" :placeholder="t('apm.filterDeployments')" />
            <span class="setup-hint">{{ t('apm.selectedDeployments', { count: selectedStackNames.length }) }}</span>
            <button class="btn sm" type="button" :disabled="!selectedStackNames.length || previewingDeployments" @click="previewDeployments">
              <i :data-lucide="previewingDeployments ? 'loader-2' : 'scan-search'"></i>
              {{ previewingDeployments ? t('apm.previewingResources') : t('apm.previewResources') }}
            </button>
          </div>
          <div v-if="filteredDeployments.length" class="deployment-picker">
            <label v-for="deployment in filteredDeployments" :key="deployment.id" class="deployment-option">
              <input v-model="selectedStackNames" type="checkbox" :value="deployment.name" />
              <span><strong>{{ deployment.name }}</strong><small>{{ deployment.status }}</small></span>
            </label>
          </div>
          <div v-else class="setup-empty">{{ t('apm.noDeployments') }}</div>
        </template>
        <template v-if="deploymentResources.length">
          <div class="resource-summary">
            <span v-for="(count, type) in deploymentResourceCounts" :key="type">{{ type }} {{ count }}</span>
            <small>{{ t('apm.deploymentReadEstimate', { count: deploymentEstimate?.awsRequests || 0 }) }}</small>
          </div>
          <input v-model.trim="deploymentResourceSearch" class="ctrl-input" :placeholder="t('apm.filterDeploymentResources')" />
          <div class="resource-picker deployment-resources">
            <label v-for="resource in filteredDeploymentResources" :key="resource.key" class="resource-option">
              <input v-model="selectedDeploymentKeys" type="checkbox" :value="resource.key" />
              <i :data-lucide="resourceIcon(resource.type)"></i>
              <span>
                <strong>{{ resource.name }}</strong>
                <small>{{ resourceLabel(resource) }}</small>
                <small>{{ resource.stackName }}</small>
              </span>
            </label>
          </div>
          <div class="setup-hint">{{ t('apm.manualDeploymentSelection', { count: selectedDeploymentKeys.length }) }}</div>
        </template>
      </section>

      <section class="setup-section">
        <div class="setup-section-head">
          <div>
            <div class="setup-section-title">{{ t('apm.lambdaFunctions') }}</div>
            <div class="setup-hint">{{ t('apm.lambdaPickerHint') }}</div>
          </div>
          <div class="setup-tools">
            <button class="btn sm" type="button" :disabled="!form.name || !lambdas.length || discovering" @click="analyzeCandidates">
              <i :data-lucide="discovering ? 'loader-2' : 'scan-search'"></i>
              {{ discovering ? t('apm.analyzingCandidates') : t('apm.analyzeCandidates') }}
            </button>
            <input v-model.trim="lambdaSearch" class="ctrl-input setup-search" :placeholder="t('apm.filterFunctions')" />
          </div>
        </div>
        <div v-if="discoveryEstimate" class="setup-hint discovery-estimate">
          {{ t('apm.discoveryEstimate', { aws: discoveryEstimate.awsRequests, kubernetes: discoveryEstimate.kubernetesRequests }) }}
        </div>
        <div v-if="filteredLambdas.length" class="resource-picker">
          <label v-for="fn in filteredLambdas" :key="fn.arn || fn.name" class="resource-option">
            <input v-model="form.lambdaNames" type="checkbox" :value="fn.name" />
            <i data-lucide="function-square"></i>
            <span>
              <strong>{{ fn.name }}</strong>
              <small>{{ fn.runtime || 'Lambda' }}</small>
              <small v-if="candidateFor(fn)" :class="['candidate-status', candidateFor(fn).status]">{{ candidateLabel(candidateFor(fn)) }}</small>
            </span>
          </label>
        </div>
        <div v-else class="setup-empty">{{ t('apm.lambdaPickerEmpty') }}</div>
      </section>

      <section class="setup-section">
        <label class="resource-toggle">
          <input v-model="form.includeKubernetes" type="checkbox" />
          <span><strong>{{ t('apm.addKubernetes') }}</strong><small>{{ t('apm.kubernetesHint') }}</small></span>
        </label>
        <div v-if="form.includeKubernetes" class="setup-grid kube-grid">
          <label>{{ t('apm.context') }}<input v-model.trim="form.kubeContext" class="ctrl-input" required placeholder="aws-eks-dev" /></label>
          <label>{{ t('apm.namespace') }}<input v-model.trim="form.namespace" class="ctrl-input" required placeholder="default" /></label>
          <label>{{ t('apm.kind') }}
            <select v-model="form.kind" class="ctrl-input">
              <option>Deployment</option><option>StatefulSet</option><option>DaemonSet</option><option>Service</option>
            </select>
          </label>
          <label>{{ t('apm.workload') }}<input v-model.trim="form.workloadName" class="ctrl-input" required placeholder="orders-api" /></label>
        </div>
      </section>

      <section class="cost-notice">
        <i data-lucide="shield-check"></i>
        <div>
          <strong>{{ t('apm.costGuard') }}</strong>
          <p>{{ t('apm.costForecast', { count: selectedLambdaCount, maximum: maximumForecast.toLocaleString() }) }}</p>
          <p>{{ t('apm.costDisclaimer') }}</p>
        </div>
        <label class="poll-toggle"><input v-model="form.pollingEnabled" type="checkbox" /> {{ t('apm.polling') }}</label>
      </section>

      <label v-if="form.pollingEnabled && selectedLambdaCount" class="cost-ack">
        <input v-model="form.costAcknowledged" type="checkbox" />
        {{ t('apm.costConsent') }}
      </label>

      <div v-if="error" class="alert-error">{{ error }}</div>
    </form>

    <template #footer>
      <button class="btn" type="button" @click="$emit('close')">{{ t('action.cancel') }}</button>
      <button class="btn primary" type="button" :disabled="!canSubmit || saving" @click="submit">
        <i :data-lucide="saving ? 'loader-2' : 'check'"></i> {{ saving ? t('apm.creating') : t('apm.createApplication') }}
      </button>
    </template>
  </BaseModal>
</template>

<script setup>
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { createIcons, icons } from 'lucide'
import BaseModal from '../../BaseModal.vue'
import { useApmStore } from '../../../stores/useApmStore'
import { useI18n } from '../../../composables/useI18n'
import { apmResourceIcon, apmResourceLabel, apmResourceLocation } from './resourcePresentation'

const props = defineProps({
  show: Boolean,
  profileId: { type: String, default: '' },
  lambdas: { type: Array, default: () => [] },
  ecsServices: { type: Array, default: () => [] },
  eventBridgeRules: { type: Array, default: () => [] },
  stepFunctions: { type: Array, default: () => [] },
  loadInventory: { type: Function, default: null },
})
const emit = defineEmits(['close', 'created'])
const store = useApmStore()
const { t } = useI18n()
const saving = ref(false)
const discovering = ref(false)
const loadingDeployments = ref(false)
const previewingDeployments = ref(false)
const loadingInventory = ref(false)
const inventoryLoaded = ref(false)
const error = ref('')
const lambdaSearch = ref('')
const inventorySearch = ref('')
const deploymentSearch = ref('')
const deploymentResourceSearch = ref('')
const discovery = ref([])
const discoveryEstimate = ref(null)
const discoveryName = ref('')
const deploymentCatalog = ref(null)
const deploymentResources = ref([])
const deploymentEstimate = ref(null)
const selectedStackNames = ref([])
const selectedDeploymentKeys = ref([])
const selectedInventoryKeys = ref([])
const form = reactive({
  name: '', region: 'us-east-1', environment: '', team: '', pollingEnabled: false,
  costAcknowledged: false, lambdaNames: [], includeKubernetes: false,
  kubeContext: '', namespace: 'default', kind: 'Deployment', workloadName: '',
})

const filteredLambdas = computed(() => {
  const query = lambdaSearch.value.toLowerCase()
  return props.lambdas.filter(fn => !query || fn.name.toLowerCase().includes(query))
})
const profileName = computed(() => props.profileId.replace(/^local:/, '') || t('apm.noProfile'))
const filteredDeployments = computed(() => {
  const query = deploymentSearch.value.toLowerCase()
  return (deploymentCatalog.value?.deployments || []).filter(deployment =>
    !query || deployment.name.toLowerCase().includes(query))
})
const filteredDeploymentResources = computed(() => {
  const query = deploymentResourceSearch.value.toLowerCase()
  return deploymentResources.value.filter(resource =>
    !query || `${resource.name} ${resource.type} ${resource.stackName} ${resource.service}`.toLowerCase().includes(query))
})
const selectedDeploymentResources = computed(() => {
  const selected = new Set(selectedDeploymentKeys.value)
  return deploymentResources.value.filter(resource => selected.has(resource.key))
})
const inventoryResources = computed(() => [
  ...props.ecsServices.map(resource => ({
    type: 'ecs',
    key: resource.arn || `AWS::ECS::Service:${resource.cluster}/${resource.name}`,
    arn: resource.arn || null,
    name: resource.name,
    service: resource.cluster || '',
    kind: 'AWS::ECS::Service',
    associationSource: 'manual',
  })),
  ...props.eventBridgeRules.map(resource => ({
    type: 'eventbridge',
    key: resource.arn || `AWS::Events::Rule:${resource.busName || 'default'}|${resource.name}`,
    arn: resource.arn || null,
    name: resource.name,
    service: resource.busName || 'default',
    kind: 'AWS::Events::Rule',
    associationSource: 'manual',
  })),
  ...props.stepFunctions.map(resource => ({
    type: 'stepfunctions',
    key: resource.arn,
    arn: resource.arn,
    name: resource.name,
    service: '',
    kind: 'AWS::StepFunctions::StateMachine',
    associationSource: 'manual',
  })),
].filter(resource => resource.key && resource.name))
const filteredInventoryResources = computed(() => {
  const query = inventorySearch.value.toLowerCase()
  return inventoryResources.value.filter(resource =>
    !query || `${resource.name} ${resource.type} ${resource.service}`.toLowerCase().includes(query))
})
const selectedInventoryResources = computed(() => {
  const selected = new Set(selectedInventoryKeys.value)
  return inventoryResources.value.filter(resource => selected.has(resource.key))
})
const selectedAssociatedResources = computed(() => [...new Map([
  ...selectedDeploymentResources.value,
  ...selectedInventoryResources.value,
].map(resource => [resource.key, resource])).values()])
const deploymentResourceCounts = computed(() => deploymentResources.value.reduce((counts, resource) => {
  counts[resource.type] = (counts[resource.type] || 0) + 1
  return counts
}, {}))
const selectedLambdaCount = computed(() => new Set([
  ...form.lambdaNames,
  ...selectedAssociatedResources.value.filter(resource => resource.type === 'lambda').map(resource => resource.name),
]).size)
const selectedResourceCount = computed(() => form.lambdaNames.length + selectedAssociatedResources.value.length)
const maximumForecast = computed(() => selectedLambdaCount.value * 48 * 30 * 2)
const canSubmit = computed(() =>
  !!props.profileId && !!form.name && !!form.region &&
  (selectedResourceCount.value > 0 || form.includeKubernetes) &&
  (!form.includeKubernetes || (!!form.kubeContext && !!form.namespace && !!form.workloadName)) &&
  (!form.pollingEnabled || !selectedLambdaCount.value || form.costAcknowledged))

const resourceIcon = apmResourceIcon
const resourceLabel = apmResourceLabel
const resourceLocation = apmResourceLocation

function candidateFor(fn) {
  if (discoveryName.value !== form.name) return null
  const key = fn.arn || fn.name
  return discovery.value.find(candidate => candidate.key === key) || null
}

function candidateLabel(candidate) {
  if (candidate.status === 'pending') {
    return t('apm.candidatePending', { candidates: candidate.identity.candidates.join(', ') })
  }
  const suggestion = candidate.suggestions[0]
  if (!suggestion) return t('apm.candidateUnmatched')
  if (suggestion.source === 'name') {
    return t('apm.candidateSuggested', { application: suggestion.application.name })
  }
  return t('apm.candidateMatched', {
    source: t(`apm.candidateSource.${suggestion.source}`),
    application: suggestion.application.name,
  })
}

async function analyzeCandidates() {
  if (!props.profileId || !form.name || !props.lambdas.length || discovering.value) return
  discovering.value = true
  error.value = ''
  try {
    store.setActiveProfile(props.profileId)
    const result = await store.discoverCandidates({
      name: form.name,
      environment: form.environment,
      team: form.team,
    }, props.lambdas.map(fn => ({
      type: 'lambda',
      key: fn.arn || fn.name,
      name: fn.name,
      tags: fn.tags || [],
    })))
    discovery.value = result.candidates
    discoveryEstimate.value = result.estimate
    discoveryName.value = form.name
  } catch (requestError) {
    error.value = requestError.message
  } finally {
    discovering.value = false
  }
}

async function loadDeployments() {
  if (!props.profileId || loadingDeployments.value) return
  loadingDeployments.value = true
  error.value = ''
  try {
    store.setActiveProfile(props.profileId)
    deploymentCatalog.value = await store.loadDeployments(form.region)
    selectedStackNames.value = []
    deploymentResources.value = []
    selectedDeploymentKeys.value = []
  } catch (requestError) {
    error.value = requestError.message
  } finally {
    loadingDeployments.value = false
  }
}

async function previewDeployments() {
  if (!selectedStackNames.value.length || previewingDeployments.value) return
  previewingDeployments.value = true
  error.value = ''
  try {
    const result = await store.previewDeploymentResources(form.region, selectedStackNames.value)
    deploymentResources.value = result.resources.map(resource => ({
      ...resource,
      associationSource: 'deployment',
    }))
    deploymentEstimate.value = result.estimate
    selectedDeploymentKeys.value = []
  } catch (requestError) {
    error.value = requestError.message
  } finally {
    previewingDeployments.value = false
  }
}

async function refreshInventory() {
  if (!props.loadInventory || loadingInventory.value) return
  loadingInventory.value = true
  error.value = ''
  try {
    await props.loadInventory()
    selectedInventoryKeys.value = []
    inventoryLoaded.value = true
  } catch (requestError) {
    error.value = requestError.message
  } finally {
    loadingInventory.value = false
  }
}

function reset() {
  Object.assign(form, {
    name: '', region: 'us-east-1', environment: '', team: '', pollingEnabled: false,
    costAcknowledged: false, lambdaNames: [], includeKubernetes: false,
    kubeContext: '', namespace: 'default', kind: 'Deployment', workloadName: '',
  })
  lambdaSearch.value = ''
  inventorySearch.value = ''
  deploymentSearch.value = ''
  deploymentResourceSearch.value = ''
  discovery.value = []
  discoveryEstimate.value = null
  discoveryName.value = ''
  deploymentCatalog.value = null
  deploymentResources.value = []
  deploymentEstimate.value = null
  selectedStackNames.value = []
  selectedDeploymentKeys.value = []
  selectedInventoryKeys.value = []
  inventoryLoaded.value = false
  error.value = ''
}

async function submit() {
  if (!canSubmit.value || saving.value) return
  saving.value = true
  error.value = ''
  let application = null
  try {
    store.setActiveProfile(props.profileId)
    application = await store.createApplication({
      name: form.name,
      region: form.region,
      environment: form.environment,
      team: form.team,
      pollingEnabled: form.pollingEnabled,
    })
    for (const name of form.lambdaNames) {
      if (selectedAssociatedResources.value.some(resource => resource.type === 'lambda' && resource.name === name)) continue
      const fn = props.lambdas.find(item => item.name === name)
      await store.addResource(application.id, {
        type: 'lambda',
        key: fn?.arn || `${form.region}:${name}`,
        arn: fn?.arn || null,
        name,
        logGroup: fn?.logGroup || `/aws/lambda/${name}`,
        associationSource: 'manual',
      })
    }
    for (const resource of selectedAssociatedResources.value) {
      await store.addResource(application.id, {
        type: resource.type,
        key: resource.key,
        arn: resource.arn,
        name: resource.name,
        service: resource.service,
        kind: resource.kind,
        logGroup: resource.type === 'lambda' ? `/aws/lambda/${resource.name}` : null,
        associationSource: resource.associationSource,
      })
    }
    if (form.includeKubernetes) {
      await store.addResource(application.id, {
        type: 'kubernetes',
        key: `${form.kubeContext}/${form.namespace}/${form.kind}/${form.workloadName}`,
        kubeContext: form.kubeContext,
        namespace: form.namespace,
        kind: form.kind,
        name: form.workloadName,
        associationSource: 'manual',
      })
    }
    await store.selectApplication(application.id)
    emit('created', application)
    emit('close')
    reset()
  } catch (requestError) {
    if (application) {
      try {
        await store.deleteApplication(application.id)
      } catch (_) {
        error.value = t('apm.setupRollbackFailed', { error: requestError.message })
        return
      }
    }
    error.value = requestError.message
  } finally {
    saving.value = false
  }
}

watch(() => props.show, visible => {
  if (visible) nextTick(() => createIcons({ icons }))
})
</script>

<style scoped>
.apm-setup { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.setup-section { display: flex; flex-direction: column; gap: 10px; }
.setup-section-title { color: var(--text); font-size: 11px; font-weight: 700; text-transform: uppercase; }
.setup-section-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; }
.setup-hint, .setup-empty { color: var(--text-dim); font-size: 10px; line-height: 1.4; }
.scope-banner { display: flex; align-items: center; gap: 9px; padding: 9px 0; border-block: 1px solid var(--border); }
.scope-banner > svg { width: 18px; height: 18px; color: #58a6ff; }
.scope-banner span { display: flex; flex-direction: column; gap: 2px; }
.scope-banner small { color: var(--text-dim); font-size: 9px; text-transform: uppercase; }
.scope-banner strong { font-size: 11px; }
.setup-tools { display: flex; align-items: center; gap: 8px; }
.setup-tools .btn { white-space: nowrap; }
.setup-tools .btn > svg { width: 14px; height: 14px; }
.discovery-estimate { color: #3fb950; }
.setup-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
.setup-grid label { min-width: 0; display: flex; flex-direction: column; gap: 5px; color: var(--text-dim); font-size: 10px; }
.setup-search { width: 190px; }
.deployment-tools { justify-content: flex-end; }
.deployment-tools .setup-hint { margin-right: auto; }
.deployment-picker { max-height: 150px; overflow: auto; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); border-block: 1px solid var(--border); }
.deployment-option { min-width: 0; display: flex; align-items: center; gap: 8px; padding: 8px 4px; cursor: pointer; }
.deployment-option span { min-width: 0; display: flex; flex-direction: column; }
.deployment-option strong, .deployment-option small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.deployment-option strong { font-size: 10px; }
.deployment-option small { color: var(--text-dim); font-size: 9px; }
.resource-summary { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
.resource-summary span { padding: 3px 6px; border: 1px solid var(--border); border-radius: 5px; font-size: 9px; text-transform: uppercase; }
.resource-summary small { margin-left: auto; color: var(--text-dim); }
.deployment-resources { max-height: 240px; }
.inventory-resources { max-height: 210px; }
.resource-picker { max-height: 174px; overflow: auto; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); border: 1px solid var(--border); border-radius: 7px; }
.resource-option { min-width: 0; display: flex; align-items: center; gap: 9px; padding: 9px 10px; border-bottom: 1px solid var(--border); cursor: pointer; }
.resource-option:nth-child(odd) { border-right: 1px solid var(--border); }
.resource-option > svg { width: 16px; height: 16px; color: #d29922; }
.resource-option span, .resource-toggle span { min-width: 0; display: flex; flex-direction: column; }
.resource-option strong, .resource-option small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.resource-option strong { font-size: 11px; }
.resource-option small, .resource-toggle small { color: var(--text-dim); font-size: 9px; }
.resource-option .candidate-status { color: #58a6ff; }
.resource-option .candidate-status.matched { color: #3fb950; }
.resource-option .candidate-status.pending { color: #d29922; }
.resource-toggle { display: flex; align-items: center; gap: 9px; cursor: pointer; }
.resource-toggle strong { font-size: 11px; }
.cost-notice { display: grid; grid-template-columns: 24px minmax(0, 1fr) auto; align-items: start; gap: 10px; border: 1px solid rgba(210,153,34,.45); background: rgba(210,153,34,.07); border-radius: 7px; padding: 11px; }
.cost-notice > svg { width: 20px; height: 20px; color: #d29922; }
.cost-notice strong { font-size: 11px; }
.cost-notice p { margin: 3px 0 0; color: var(--text-dim); font-size: 9px; line-height: 1.35; }
.poll-toggle { display: flex; align-items: center; gap: 6px; font-size: 10px; white-space: nowrap; }
.cost-ack { display: flex; align-items: flex-start; gap: 8px; color: #d29922; font-size: 10px; }
@media (max-width: 760px) {
  .setup-grid, .resource-picker { grid-template-columns: 1fr 1fr; }
  .cost-notice { grid-template-columns: 24px minmax(0, 1fr); }
  .poll-toggle { grid-column: 2; }
}
@media (max-width: 520px) {
  .setup-grid, .resource-picker { grid-template-columns: 1fr; }
  .resource-option:nth-child(odd) { border-right: 0; }
  .setup-section-head { align-items: stretch; flex-direction: column; }
  .setup-tools { align-items: stretch; flex-direction: column; }
  .setup-search { width: 100%; }
}
</style>