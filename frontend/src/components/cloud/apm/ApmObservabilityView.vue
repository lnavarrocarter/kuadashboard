<template>
  <div class="apm-view">
    <header class="apm-toolbar">
      <div class="apm-title">
        <i data-lucide="square-activity"></i>
        <span><strong>{{ t('apm.applications') }}</strong><small>{{ t('apm.subtitle') }}</small></span>
      </div>
      <div class="apm-toolbar-controls">
        <select v-model="store.environment" class="ctrl-input" :title="t('apm.environmentFilter')">
          <option value="">{{ t('apm.allEnvironments') }}</option>
          <option v-for="value in store.environments" :key="value">{{ value }}</option>
        </select>
        <select v-model="store.team" class="ctrl-input" :title="t('apm.teamFilter')">
          <option value="">{{ t('apm.allTeams') }}</option>
          <option v-for="value in store.teams" :key="value">{{ value }}</option>
        </select>
        <div class="range-control" :aria-label="t('apm.metricRange')">
          <button v-for="value in ranges" :key="value" :class="{ active: store.range === value }" @click="setRange(value)">{{ value }}</button>
        </div>
        <button class="btn sm btn-icon" :title="t('apm.refreshLocal')" :disabled="store.loading" @click="refreshLocal">
          <i data-lucide="refresh-cw"></i>
        </button>
        <button class="btn sm primary" @click="setupOpen = true"><i data-lucide="plus"></i> {{ t('apm.addApplication') }}</button>
      </div>
    </header>

    <div v-if="store.error" class="alert-error apm-error">{{ store.error }}</div>

    <div class="apm-layout">
      <aside class="application-list">
        <div class="list-heading"><span>{{ t('apm.applications') }}</span><strong>{{ store.filteredApplications.length }}</strong></div>
        <button
          v-for="application in store.filteredApplications"
          :key="application.id"
          :class="['application-row', { active: store.selectedApplicationId === application.id }]"
          @click="chooseApplication(application.id)"
        >
          <span class="application-mark">{{ application.name.slice(0, 2).toUpperCase() }}</span>
          <span class="application-copy">
            <strong>{{ application.name }}</strong>
            <small>{{ [application.environment, application.team].filter(Boolean).join(' / ') || application.region }}</small>
          </span>
          <i v-if="application.pollingEnabled" data-lucide="radio" :title="t('apm.polling')"></i>
        </button>
        <button v-if="!store.filteredApplications.length" class="application-empty" @click="setupOpen = true">
          <i data-lucide="plus"></i><span>{{ t('apm.noApplications') }}</span>
        </button>
      </aside>

      <main ref="mainEl" class="apm-main">
        <div v-if="store.loading && !store.selectedApplication" class="apm-empty">{{ t('apm.loading') }}</div>
        <div v-else-if="!store.selectedApplication" class="apm-empty">
          <i data-lucide="square-activity"></i>
          <strong>{{ t('apm.emptyTitle') }}</strong>
          <span>{{ t('apm.emptyDescription') }}</span>
          <button class="btn primary" @click="setupOpen = true"><i data-lucide="plus"></i> {{ t('apm.configureApplication') }}</button>
        </div>

        <template v-else>
          <section class="application-header">
            <div>
              <div class="application-kicker">{{ store.selectedApplication.environment || t('apm.environmentUnset') }}</div>
              <h2>{{ store.selectedApplication.name }}</h2>
              <span>{{ store.selectedApplication.region }}<template v-if="store.selectedApplication.team"> / {{ store.selectedApplication.team }}</template></span>
            </div>
            <div class="application-actions">
              <span :class="['collection-state', runStatusClass]">{{ latestRunLabel }}</span>
              <button class="btn sm btn-icon" :title="t('apm.editApplication')" @click="openEditApplication">
                <i data-lucide="pencil"></i>
              </button>
              <button class="btn sm btn-icon danger" :title="t('apm.deleteApplication')" @click="deleteApplicationOpen = true">
                <i data-lucide="trash-2"></i>
              </button>
              <button class="btn sm btn-icon" :title="t('apm.configureThresholds')" @click="openThresholds">
                <i data-lucide="sliders-horizontal"></i>
              </button>
              <button class="btn sm" @click="openArchitectureLink">
                <i data-lucide="network"></i> {{ store.selectedApplication.architectureProjectId ? 'Open architecture' : 'Link architecture' }}
              </button>
              <button class="btn sm" :disabled="store.loadingKubernetesContexts" @click="openKubernetesPreview">
                <i :data-lucide="store.loadingKubernetesContexts ? 'loader-2' : 'boxes'"></i>
                {{ store.loadingKubernetesContexts ? 'Loading clusters…' : 'Kubernetes preview' }}
              </button>
              <button class="btn sm" :disabled="store.collecting || !store.topology.resources.length" @click="confirmCollect = true">
                <i :data-lucide="store.collecting ? 'loader-2' : 'cloud-download'"></i>
                {{ store.collecting ? t('apm.collecting') : t('apm.collectNow') }}
              </button>
            </div>
          </section>

          <section class="apm-status-strip">
            <span><i data-lucide="database"></i> {{ t('apm.localStorage', { range: store.range }) }}</span>
            <span><i data-lucide="layers-3"></i> {{ t('apm.resourcesCount', { count: store.topology.resources.length }) }}</span>
            <span><i data-lucide="gauge"></i> {{ usageLabel }}</span>
            <span :class="{ partial: store.overview?.health?.status === 'degraded' }"><i data-lucide="heart-pulse"></i> {{ healthLabel }}</span>
            <span v-if="store.kubernetesPreview?.applicationId === store.selectedApplicationId"><i data-lucide="boxes"></i> Kubernetes preview updated</span>
            <span v-if="store.selectedApplication.architectureProjectId"><i data-lucide="network"></i> Architecture linked</span>
            <span v-if="qualityPartial" class="partial"><i data-lucide="triangle-alert"></i> {{ t('apm.partialData') }}</span>
            <span v-if="kubernetesUsageUnavailable" class="partial"><i data-lucide="circle-alert"></i> {{ t('apm.kubernetesUsageUnavailable') }}</span>
            <span v-else-if="latestRunIssue" class="partial"><i data-lucide="circle-alert"></i> {{ latestRunIssue }}</span>
          </section>

          <div class="apm-view-tabs">
            <button :class="{ active: activeView === 'overview' }" @click="activeView = 'overview'">{{ t('apm.overview') }}</button>
            <button :class="{ active: activeView === 'topology' }" @click="activeView = 'topology'">{{ t('apm.topology') }}</button>
            <button v-if="hasTraceResources" :class="{ active: activeView === 'traces' }" @click="activeView = 'traces'">{{ t('apm.traces') }}</button>
            <button :class="{ active: activeView === 'resources' }" @click="activeView = 'resources'">{{ t('apm.resources') }}</button>
          </div>

          <template v-if="activeView === 'overview'">
            <section class="kpi-grid">
              <div v-for="item in kpis" :key="item.label" class="kpi-item">
                <span>{{ item.label }}</span><strong>{{ item.value }}</strong><small>{{ item.detail }}</small>
              </div>
            </section>
            <section v-if="hasMetrics" class="chart-grid">
              <CloudMetricChart v-for="chart in chartDefinitions" :key="chart.metric" :label="chart.label" :unit="chart.unit" :points="store.series[chart.metric] || []" :color="chart.color" :x-tick-limit="4" />
            </section>
            <div v-else class="apm-empty compact">
              <i data-lucide="chart-no-axes-combined"></i>
              <strong>{{ t('apm.noMetricsTitle') }}</strong>
              <span>{{ t('apm.noMetricsDescription') }}</span>
            </div>
          </template>

          <ApmTopologyGraph
            v-else-if="activeView === 'topology'"
            :topology="store.topology"
            :selected-resource-id="selectedResourceId"
            :can-analyze-cloud="canAnalyzeCloudTopology"
            :analyzing-cloud="store.analyzingTopology"
            @select="selectResource"
            @confirm-dependency="confirmDependency"
            @analyze-cloud="analyzeCloudTopology"
            @add-cloud-resource="addCloudResource"
          />

          <ApmProcessTrace
            v-else-if="activeView === 'traces'"
            :result="store.processTrace"
            :loading="store.tracingProcess"
            @trace="traceProcess"
          />

          <section v-else class="resource-table-wrap">
            <table class="cloud-table">
              <thead><tr><th>{{ t('apm.resource') }}</th><th>{{ t('apm.source') }}</th><th>{{ t('apm.location') }}</th><th>{{ t('apm.status') }}</th><th>{{ t('apm.actions') }}</th></tr></thead>
              <tbody>
                <tr v-for="resource in store.topology.resources" :key="resource.id">
                  <td><strong>{{ resource.name }}</strong><small>{{ apmResourceLabel(resource) }}</small></td>
                  <td>{{ resource.associationSource }}</td>
                  <td class="text-dim">{{ apmResourceLocation(resource) }}</td>
                  <td><span :class="resource.enabled ? 'status-ok' : 'text-dim'">{{ resource.enabled ? t('apm.enabled') : t('apm.paused') }}</span></td>
                  <td>
                    <button v-if="resource.type === 'lambda'" class="btn sm" @click="$emit('open-lambda-logs', resource.name)"><i data-lucide="file-search"></i> {{ t('apm.openLogs') }}</button>
                    <button v-else-if="kubernetesLogResource(resource)" class="btn sm" @click="$emit('open-kubernetes-logs', resource)"><i data-lucide="scroll-text"></i> {{ t('apm.openLogs') }}</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </section>
        </template>
      </main>
    </div>

    <ApmSetupModal
      :show="setupOpen"
      :provider="provider"
      :profile-id="profileId"
      :platform-resources="platformResources"
      :lambdas="lambdas"
      :ecs-services="ecsServices"
      :event-bridge-rules="eventBridgeRules"
      :step-functions="stepFunctions"
      :load-inventory="loadInventory"
      @close="setupOpen = false"
      @created="onCreated"
    />

    <BaseModal :show="editApplicationOpen" @close="editApplicationOpen = false">
      <template #title><i data-lucide="pencil"></i> {{ t('apm.editApplication') }}</template>
      <form class="application-editor" @submit.prevent="saveApplication">
        <label>{{ t('apm.name') }}<input v-model.trim="applicationForm.name" class="ctrl-input" required /></label>
        <label>{{ t('apm.environment') }}<input v-model.trim="applicationForm.environment" class="ctrl-input" /></label>
        <label>{{ t('apm.team') }}<input v-model.trim="applicationForm.team" class="ctrl-input" /></label>
        <label class="application-polling"><input v-model="applicationForm.pollingEnabled" type="checkbox" /> {{ t('apm.polling') }}</label>
        <div v-if="applicationError" class="alert-error">{{ applicationError }}</div>
      </form>
      <template #footer>
        <button class="btn" @click="editApplicationOpen = false">{{ t('action.cancel') }}</button>
        <button class="btn primary" :disabled="savingApplication || !applicationForm.name" @click="saveApplication">
          <i :data-lucide="savingApplication ? 'loader-2' : 'check'"></i>
          {{ savingApplication ? t('apm.savingApplication') : t('action.save') }}
        </button>
      </template>
    </BaseModal>

    <BaseModal :show="deleteApplicationOpen" @close="deleteApplicationOpen = false">
      <template #title><i data-lucide="trash-2"></i> {{ t('apm.deleteApplication') }}</template>
      <div class="delete-application-copy">
        <p>{{ t('apm.deleteApplicationDescription', { name: store.selectedApplication?.name || '' }) }}</p>
        <small>{{ t('apm.deleteApplicationWarning') }}</small>
      </div>
      <template #footer>
        <button class="btn" @click="deleteApplicationOpen = false">{{ t('action.cancel') }}</button>
        <button class="btn danger" :disabled="deletingApplication" @click="deleteApplication">
          <i :data-lucide="deletingApplication ? 'loader-2' : 'trash-2'"></i>
          {{ deletingApplication ? t('apm.deletingApplication') : t('action.delete') }}
        </button>
      </template>
    </BaseModal>

    <BaseModal :show="confirmCollect" @close="confirmCollect = false">
      <template #title><i data-lucide="cloud-download"></i> {{ t('apm.collectTitle') }}</template>
      <div class="collect-confirm">
        <p>{{ collectionDescription }}</p>
        <dl>
          <div><dt>{{ t('apm.lambdaFunctions') }}</dt><dd>{{ store.forecast?.lambdaCount || 0 }}</dd></div>
          <div><dt>{{ t('apm.maximumRequestsNow') }}</dt><dd>{{ (store.forecast?.lambdaCount || 0) * 2 }}</dd></div>
          <div><dt>{{ t('apm.monthlyUsage') }}</dt><dd>{{ usageLabel }}</dd></div>
        </dl>
        <p class="collect-warning">{{ t('apm.readWarning') }}</p>
      </div>
      <template #footer>
        <button class="btn" @click="confirmCollect = false">{{ t('action.cancel') }}</button>
        <button class="btn primary" @click="collectNow"><i data-lucide="cloud-download"></i> {{ t('apm.confirmCollection') }}</button>
      </template>
    </BaseModal>

    <BaseModal :show="thresholdsOpen" @close="thresholdsOpen = false">
      <template #title><i data-lucide="sliders-horizontal"></i> {{ t('apm.thresholdsTitle') }}</template>
      <form class="threshold-editor" @submit.prevent="saveThresholds">
        <p>{{ t('apm.thresholdsDescription') }}</p>
        <label v-for="threshold in thresholdDefinitions" :key="threshold.key" class="threshold-field">
          <span class="threshold-toggle">
            <input v-model="thresholdEnabled[threshold.key]" type="checkbox" />
            <strong>{{ threshold.label }}</strong>
          </span>
          <input
            v-model.number="thresholdValues[threshold.key]"
            class="ctrl-input"
            type="number"
            :name="threshold.key"
            :min="threshold.min"
            :max="threshold.max"
            :step="threshold.step"
            :disabled="!thresholdEnabled[threshold.key]"
          />
          <small>{{ threshold.description }}</small>
        </label>
        <div v-if="thresholdError" class="alert-error">{{ thresholdError }}</div>
      </form>
      <template #footer>
        <button class="btn" @click="thresholdsOpen = false">{{ t('action.cancel') }}</button>
        <button class="btn primary" :disabled="savingThresholds" @click="saveThresholds">
          <i :data-lucide="savingThresholds ? 'loader-2' : 'check'"></i>
          {{ savingThresholds ? t('apm.savingThresholds') : t('apm.saveThresholds') }}
        </button>
      </template>
    </BaseModal>

    <BaseModal :show="architectureLinkOpen" @close="architectureLinkOpen = false">
      <template #title><i data-lucide="network"></i> Architecture</template>
      <div class="architecture-link-editor">
        <template v-if="store.architectureLink?.linked">
          <strong>{{ store.architectureLink.project.name }}</strong>
          <small>{{ store.architectureLink.resources.matched.length }} matched resources · {{ store.architectureLink.resources.unmatched.length }} unmatched</small>
          <small v-if="store.architectureLink.resources.duplicateIdentityWarnings.length" class="architecture-link-warning">
            {{ store.architectureLink.resources.duplicateIdentityWarnings.length }} duplicate identity warnings
          </small>
          <button class="btn sm" :disabled="store.reconcilingRegistry" @click="reconcileSharedRegistry">
            <i :data-lucide="store.reconcilingRegistry ? 'loader-2' : 'git-merge'"></i>
            {{ store.reconcilingRegistry ? 'Reconciling registry' : 'Reconcile shared registry' }}
          </button>
          <small v-if="store.registry">
            {{ store.registry.resources.length }} shared resources · {{ store.registry.relationships.length }} shared relationships
          </small>
        </template>
        <template v-else>
          <button class="btn sm primary" :disabled="store.linkingArchitecture" @click="createArchitectureProjectLink">
            <i data-lucide="plus"></i> Create architecture view
          </button>
          <label>Existing project
            <select v-model="architectureProjectId" class="ctrl-input">
              <option value="">Select a project</option>
              <option v-for="project in store.architectureProjects" :key="project.id" :value="project.id">{{ project.name }}</option>
            </select>
          </label>
        </template>
      </div>
      <template #footer>
        <button class="btn" @click="architectureLinkOpen = false">{{ t('action.cancel') }}</button>
        <button v-if="store.architectureLink?.linked" class="btn danger" :disabled="store.linkingArchitecture" @click="unlinkArchitectureProject">
          <i data-lucide="unlink"></i> Unlink
        </button>
        <button v-else class="btn primary" :disabled="store.linkingArchitecture || !architectureProjectId" @click="linkArchitectureProject">
          <i data-lucide="link"></i> Link project
        </button>
      </template>
    </BaseModal>

    <BaseModal :show="kubernetesPreviewOpen" @close="kubernetesPreviewOpen = false">
      <template #title><i data-lucide="boxes"></i> Kubernetes topology preview</template>
      <div class="kubernetes-preview">
        <template v-if="!store.kubernetesPreview">
          <label>Cluster
            <select v-model="kubernetesContextId" class="ctrl-input" :disabled="store.loadingKubernetesContexts || store.previewingKubernetes">
              <option value="">Select an EKS cluster</option>
              <option v-for="context in store.kubernetesContexts" :key="context.id" :value="context.id">{{ context.name }}</option>
            </select>
          </label>
          <small v-if="store.loadingKubernetesContexts">Loading available clusters…</small>
          <small v-else-if="!store.kubernetesContexts.length">No compatible Kubernetes clusters were found.</small>
          <small v-else>Select one cluster before loading workloads, Services, Ingress and events.</small>
        </template>
        <template v-else>
        <div class="kubernetes-preview-stats">
          <span><strong>{{ store.kubernetesPreview?.nodes.length || 0 }}</strong> resources</span>
          <span><strong>{{ store.kubernetesPreview?.relationships.length || 0 }}</strong> relationships</span>
          <span><strong>{{ store.kubernetesPreview?.health.filter(item => item.status === 'degraded').length || 0 }}</strong> degraded contexts</span>
        </div>
        <div v-for="capability in store.kubernetesPreview?.capabilities || []" :key="capability.context" class="kubernetes-preview-context">
          <strong>{{ capability.context }}</strong>
          <small>{{ capability.stableIdentity ? 'UID identity' : 'No stable identity' }} · {{ capability.relationshipEvidence ? 'relationship evidence' : 'limited relationships' }} · {{ capability.events ? 'events' : 'events unavailable' }}</small>
        </div>
        <div v-if="store.kubernetesPreview?.failures.length" class="architecture-link-warning">
          {{ store.kubernetesPreview.failures.map(item => item.context).join(', ') }} could not be reached.
        </div>
        </template>
      </div>
      <template #footer>
        <button class="btn" @click="kubernetesPreviewOpen = false">{{ t('action.cancel') }}</button>
        <button v-if="!store.kubernetesPreview" class="btn primary" :disabled="!kubernetesContextId || store.previewingKubernetes" @click="previewKubernetesTopology">
          <i :data-lucide="store.previewingKubernetes ? 'loader-2' : 'scan-search'"></i>
          {{ store.previewingKubernetes ? 'Loading workloads…' : 'Load preview' }}
        </button>
      </template>
    </BaseModal>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { createIcons, icons } from 'lucide'
import BaseModal from '../../BaseModal.vue'
import CloudMetricChart from '../CloudMetricChart.vue'
import { useApmStore } from '../../../stores/useApmStore'
import { useI18n } from '../../../composables/useI18n'
import ApmSetupModal from './ApmSetupModal.vue'
import ApmTopologyGraph from './ApmTopologyGraph.vue'
import ApmProcessTrace from './ApmProcessTrace.vue'
import { apmResourceLabel, apmResourceLocation } from './resourcePresentation'

const props = defineProps({
  provider: { type: String, default: 'aws' },
  profileId: { type: String, default: '' },
  applicationId: { type: String, default: '' },
  platformResources: { type: Array, default: () => [] },
  lambdas: { type: Array, default: () => [] },
  ecsServices: { type: Array, default: () => [] },
  eventBridgeRules: { type: Array, default: () => [] },
  stepFunctions: { type: Array, default: () => [] },
  loadInventory: { type: Function, default: null },
})
const emit = defineEmits(['open-lambda-logs', 'open-kubernetes-logs', 'open-architecture'])
const store = useApmStore()
const { t } = useI18n()
const ranges = ['6h', '24h', '7d', '30d', '90d']
const setupOpen = ref(false)
const editApplicationOpen = ref(false)
const deleteApplicationOpen = ref(false)
const savingApplication = ref(false)
const deletingApplication = ref(false)
const applicationError = ref('')
const applicationForm = reactive({ name: '', environment: '', team: '', pollingEnabled: false })
const confirmCollect = ref(false)
const thresholdsOpen = ref(false)
const architectureLinkOpen = ref(false)
const architectureProjectId = ref('')
const kubernetesPreviewOpen = ref(false)
const kubernetesContextId = ref('')
const savingThresholds = ref(false)
const thresholdError = ref('')
const thresholdValues = reactive({ errorRatePercent: 5, durationMs: 1000, readyPodsPercent: 100, restartDelta: 1 })
const thresholdEnabled = reactive({ errorRatePercent: true, durationMs: true, readyPodsPercent: true, restartDelta: true })
const activeView = ref('overview')
const selectedResourceId = ref('')
const mainEl = ref(null)
const thresholdDefinitions = computed(() => [
  { key: 'errorRatePercent', label: t('apm.threshold.errorRate'), description: t('apm.threshold.errorRateHint'), min: 0, max: 100, step: 0.1 },
  { key: 'durationMs', label: t('apm.threshold.duration'), description: t('apm.threshold.durationHint'), min: 0, step: 1 },
  { key: 'readyPodsPercent', label: t('apm.threshold.readyPods'), description: t('apm.threshold.readyPodsHint'), min: 0, max: 100, step: 0.1 },
  { key: 'restartDelta', label: t('apm.threshold.restarts'), description: t('apm.threshold.restartsHint'), min: 0, step: 1 },
])

const metrics = computed(() => Object.fromEntries((store.overview?.metrics || []).map(metric => [metric.metricName, metric])))
const applicationResources = computed(() => store.topology.resources || [])
const hasLambdaResources = computed(() => applicationResources.value.some(resource => resource.type === 'lambda'))
const hasKubernetesResources = computed(() => applicationResources.value.some(resource => resource.type === 'kubernetes'))
const hasTraceResources = computed(() => props.provider === 'aws' && applicationResources.value.some(resource => resource.type === 'stepfunctions'))
const canAnalyzeCloudTopology = computed(() => props.provider === 'aws' && applicationResources.value.some(resource =>
  ['lambda', 'stepfunctions', 'sqs', 'eventbridge', 'ecs'].includes(resource.type)))
const chartDefinitions = computed(() => [
  ...(hasLambdaResources.value ? [
    { metric: 'invocations_observed', label: t('apm.observedInvocations'), unit: '', color: '#58a6ff' },
    { metric: 'errors_observed', label: t('apm.observedErrors'), unit: '', color: '#f85149' },
    { metric: 'duration_ms', label: t('apm.lambdaDuration'), unit: 'ms', color: '#d29922' },
  ] : []),
  ...(hasKubernetesResources.value ? [
    { metric: 'cpu_cores', label: t('apm.kubernetesCpu'), unit: '', color: '#3fb950' },
    { metric: 'memory_bytes', label: t('apm.kubernetesMemory'), unit: 'bytes', color: '#a371f7' },
    { metric: 'pods_ready', label: t('apm.readyPods'), unit: '', color: '#39c5cf' },
  ] : []),
])
const hasMetrics = computed(() => chartDefinitions.value.some(chart => metrics.value[chart.metric]))
const collectionDescription = computed(() => hasKubernetesResources.value && !hasLambdaResources.value
  ? 'This reads metrics.k8s.io for enabled Kubernetes workloads.'
  : t('apm.collectDescription'))
const qualityPartial = computed(() => (store.overview?.metrics || []).some(metric => metric.quality === 'partial'))
const latestRunLabel = computed(() => {
  const run = store.overview?.latestRun
  if (!run) return t('apm.notCollected')
  const timestamp = run.finishedAt || run.startedAt
  return `${t(`apm.status.${run.status}`)} / ${new Date(timestamp).toLocaleString()}`
})
const runStatusClass = computed(() => {
  const status = store.overview?.latestRun?.status
  return status === 'completed' ? 'ok' : status === 'failed' || status === 'budget_exhausted' ? 'error' : status ? 'warn' : ''
})
const latestRunIssue = computed(() => {
  const run = store.overview?.latestRun
  if (run?.status === 'budget_exhausted') return t('apm.error.budget_exhausted')
  if (run?.errorCode === 'metrics_api_unavailable') return t('apm.error.metrics_api_unavailable')
  if (run?.errorCode === 'credentials_expired') return t('apm.error.credentials_expired')
  if (run?.errorCode) return t('apm.error.collection_failed')
  return ''
})
const kubernetesUsageUnavailable = computed(() => hasKubernetesResources.value && !hasLambdaResources.value &&
  store.overview?.latestRun?.errorCode === 'metrics_api_unavailable')
const usageLabel = computed(() => {
  const total = store.usage?.total || 0
  const limit = store.usage?.limit || 100000
  return t('apm.awsReads', { total: total.toLocaleString(), limit: limit.toLocaleString() })
})
const healthLabel = computed(() => {
  const health = store.overview?.health
  if (health?.status === 'degraded') return t('apm.healthDegraded', { count: health.signals.length })
  if (health?.status === 'healthy') return t('apm.healthHealthy')
  return t('apm.healthUnknown')
})

function metricSum(name) { return Number(metrics.value[name]?.sum || 0) }
function metricAverage(name) { return Number(metrics.value[name]?.average || 0) }
function formatNumber(value, digits = 0) { return Number(value).toLocaleString(undefined, { maximumFractionDigits: digits }) }
function formatBytes(value) {
  if (!value) return '-'
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(2)} GiB`
  return `${(value / 1024 ** 2).toFixed(1)} MiB`
}

const kpis = computed(() => {
  const invocations = metricSum('invocations_observed')
  const errors = metricSum('errors_observed')
  const ready = metricSum('pods_ready')
  const total = metricSum('pods_total')
  return [
    ...(hasLambdaResources.value ? [
      { label: t('apm.observedInvocations'), value: formatNumber(invocations), detail: t('apm.reportLines') },
      { label: t('apm.observedErrorRate'), value: invocations ? `${((errors / invocations) * 100).toFixed(1)}%` : '-', detail: t('apm.signals', { count: formatNumber(errors) }) },
      { label: t('apm.averageDuration'), value: metrics.value.duration_ms ? `${formatNumber(metricAverage('duration_ms'), 1)} ms` : '-', detail: t('apm.lambdaExecution') },
    ] : []),
    ...(hasKubernetesResources.value ? [
      { label: t('apm.readyPods'), value: total ? `${formatNumber(ready)} / ${formatNumber(total)}` : '-', detail: t('apm.restarts', { count: formatNumber(metricSum('restarts_delta')) }) },
      { label: t('apm.averageCpu'), value: metrics.value.cpu_cores ? `${formatNumber(metricAverage('cpu_cores'), 3)} cores` : '-', detail: t('apm.metricsApi') },
      { label: t('apm.averageMemory'), value: formatBytes(metricAverage('memory_bytes')), detail: t('apm.metricsApi') },
    ] : []),
  ]
})

async function loadCharts() {
  if (!store.selectedApplicationId) return
  await Promise.all(chartDefinitions.value.map(chart => store.loadSeries(chart.metric)))
}

function kubernetesLogResource(resource) {
  return resource.type === 'kubernetes' && ['Deployment', 'StatefulSet', 'DaemonSet', 'Pod'].includes(resource.kind)
}

async function refreshLocal() {
  await store.refreshLocal()
  await loadCharts()
  renderIcons()
}

async function chooseApplication(applicationId) {
  await store.selectApplication(applicationId)
  await loadCharts()
  selectedResourceId.value = ''
  mainEl.value?.scrollTo({ top: 0 })
  renderIcons()
}

async function setRange(value) {
  if (store.range === value) return
  store.range = value
  await store.loadSelectedApplication()
  await loadCharts()
}

async function collectNow() {
  confirmCollect.value = false
  await store.collectNow()
  await loadCharts()
}

function openEditApplication() {
  const application = store.selectedApplication
  if (!application) return
  Object.assign(applicationForm, {
    name: application.name,
    environment: application.environment || '',
    team: application.team || '',
    pollingEnabled: !!application.pollingEnabled,
  })
  applicationError.value = ''
  editApplicationOpen.value = true
}

async function saveApplication() {
  if (!store.selectedApplicationId || !applicationForm.name || savingApplication.value) return
  savingApplication.value = true
  applicationError.value = ''
  try {
    await store.updateApplication(store.selectedApplicationId, { ...applicationForm })
    await store.loadSelectedApplication()
    editApplicationOpen.value = false
  } catch (requestError) {
    applicationError.value = requestError.message
  } finally {
    savingApplication.value = false
  }
}

async function deleteApplication() {
  const applicationId = store.selectedApplicationId
  if (!applicationId || deletingApplication.value) return
  deletingApplication.value = true
  try {
    await store.deleteApplication(applicationId)
    deleteApplicationOpen.value = false
    await loadCharts()
  } finally {
    deletingApplication.value = false
  }
}

function openThresholds() {
  const current = store.selectedApplication?.thresholds || {}
  for (const threshold of thresholdDefinitions.value) {
    const value = current[threshold.key]
    thresholdEnabled[threshold.key] = value !== null
    if (value !== null && value !== undefined) thresholdValues[threshold.key] = value
  }
  thresholdError.value = ''
  thresholdsOpen.value = true
}

async function openArchitectureLink() {
  if (store.selectedApplication?.architectureProjectId) {
    emit('open-architecture', {
      applicationId: store.selectedApplication.id,
      projectId: store.selectedApplication.architectureProjectId,
      provider: props.provider,
      profileId: props.profileId,
      application: store.selectedApplication,
    })
    return
  }
  architectureProjectId.value = ''
  await Promise.all([store.loadArchitectureLink(), store.loadArchitectureProjects()])
  architectureLinkOpen.value = true
  renderIcons()
}

async function linkArchitectureProject() {
  const link = await store.linkArchitectureProject(architectureProjectId.value)
  if (link) architectureProjectId.value = ''
  renderIcons()
}

async function createArchitectureProjectLink() {
  await store.createArchitectureProjectLink()
  renderIcons()
}

async function unlinkArchitectureProject() {
  const application = await store.unlinkArchitectureProject()
  if (application) architectureProjectId.value = ''
  renderIcons()
}

async function reconcileSharedRegistry() {
  await store.reconcileSharedRegistry()
  renderIcons()
}

async function openKubernetesPreview() {
  if (store.kubernetesPreview?.applicationId === store.selectedApplicationId) {
    kubernetesContextId.value = store.kubernetesPreview.sources[0]?.context || ''
    kubernetesPreviewOpen.value = true
    renderIcons()
    return
  }
  kubernetesContextId.value = ''
  store.kubernetesPreview = null
  kubernetesPreviewOpen.value = true
  await store.loadApplicationKubernetesContexts()
  renderIcons()
}

async function previewKubernetesTopology() {
  const preview = await store.previewKubernetesDiscovery({ contexts: [kubernetesContextId.value] })
  if (preview) kubernetesContextId.value = preview.sources[0]?.context || kubernetesContextId.value
  renderIcons()
}

async function saveThresholds() {
  if (!store.selectedApplicationId || savingThresholds.value) return
  const payload = {}
  for (const threshold of thresholdDefinitions.value) {
    if (!thresholdEnabled[threshold.key]) {
      payload[threshold.key] = null
      continue
    }
    const value = Number(thresholdValues[threshold.key])
    if (!Number.isFinite(value) || value < threshold.min || (threshold.max !== undefined && value > threshold.max)) {
      thresholdError.value = t('apm.thresholdInvalid', { threshold: threshold.label })
      return
    }
    payload[threshold.key] = value
  }
  savingThresholds.value = true
  thresholdError.value = ''
  try {
    await store.updateThresholds(store.selectedApplicationId, payload)
    await store.loadSelectedApplication()
    thresholdsOpen.value = false
  } catch (requestError) {
    thresholdError.value = requestError.message
  } finally {
    savingThresholds.value = false
  }
}

async function onCreated() {
  await store.refreshLocal()
  await loadCharts()
}

function selectResource(resource) {
  selectedResourceId.value = resource?.id || ''
}

async function confirmDependency(dependency) {
  if (!store.selectedApplicationId) return
  await store.confirmDependency(store.selectedApplicationId, dependency)
  if (props.provider === 'aws') await store.analyzeCloudTopology(store.selectedApplicationId)
  renderIcons()
}

async function analyzeCloudTopology() {
  if (!store.selectedApplicationId) return
  await store.analyzeCloudTopology(store.selectedApplicationId)
  renderIcons()
}

async function addCloudResource(reference) {
  if (!store.selectedApplicationId || !reference?.candidate) return
  await store.addResource(store.selectedApplicationId, reference.candidate)
  await store.analyzeCloudTopology(store.selectedApplicationId)
  renderIcons()
}

async function traceProcess(query, includeData) {
  if (!store.selectedApplicationId) return
  await store.traceProcess(store.selectedApplicationId, query, { includeData })
  renderIcons()
}

function renderIcons() {
  nextTick(() => createIcons({ icons }))
}

watch(() => props.profileId, async profileId => {
  store.setActiveProfile(profileId, props.provider)
  if (profileId) {
    await refreshLocal()
    if (props.applicationId && store.applications.some(application => application.id === props.applicationId)) {
      await chooseApplication(props.applicationId)
    }
  }
}, { immediate: true })
watch(() => props.provider, async provider => {
  store.setActiveProfile(props.profileId, provider)
  if (props.profileId) await refreshLocal()
})
watch(activeView, () => mainEl.value?.scrollTo?.({ top: 0 }))
watch([activeView, setupOpen, editApplicationOpen, deleteApplicationOpen, confirmCollect, thresholdsOpen, architectureLinkOpen, kubernetesPreviewOpen], renderIcons)
onMounted(renderIcons)
defineExpose({ refreshLocal })
</script>

<style scoped>
.apm-view { height: 100%; min-height: 0; display: flex; flex-direction: column; background: var(--bg); color: var(--text); }
.apm-toolbar { min-height: 52px; display: flex; align-items: center; justify-content: space-between; gap: 14px; border-bottom: 1px solid var(--border); padding: 8px 12px; }
.apm-title, .apm-title span { min-width: 0; display: flex; align-items: center; gap: 9px; }
.apm-title > svg { width: 21px; height: 21px; color: #3fb950; }
.apm-title span { align-items: flex-start; flex-direction: column; gap: 1px; }
.apm-title strong { font-size: 13px; }
.apm-title small { color: var(--text-dim); font-size: 9px; }
.apm-toolbar-controls { display: flex; align-items: center; gap: 7px; }
.apm-toolbar-controls select { width: 130px; }
.range-control, .apm-view-tabs { display: flex; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
.range-control button, .apm-view-tabs button { border: 0; border-right: 1px solid var(--border); background: var(--surface); color: var(--text-dim); cursor: pointer; }
.range-control button { height: 27px; min-width: 35px; font-size: 9px; }
.range-control button:last-child, .apm-view-tabs button:last-child { border-right: 0; }
.range-control button.active, .apm-view-tabs button.active { background: var(--accent); color: white; }
.apm-error { margin: 8px 12px 0; }
.apm-layout { min-height: 0; flex: 1; display: grid; grid-template-columns: 214px minmax(0, 1fr); }
.application-list { min-height: 0; overflow: auto; border-right: 1px solid var(--border); background: var(--surface); padding: 8px; }
.list-heading { display: flex; justify-content: space-between; padding: 5px 4px 9px; color: var(--text-dim); font-size: 9px; text-transform: uppercase; }
.application-row, .application-empty { width: 100%; min-width: 0; border: 0; border-radius: 6px; background: transparent; color: var(--text); cursor: pointer; }
.application-row { display: grid; grid-template-columns: 30px minmax(0, 1fr) 14px; align-items: center; gap: 8px; padding: 8px 7px; text-align: left; }
.application-row:hover, .application-row.active { background: var(--bg-hover); }
.application-row.active { box-shadow: inset 2px 0 var(--accent); }
.application-mark { width: 28px; height: 28px; display: grid; place-items: center; border-radius: 6px; background: rgba(63,185,80,.13); color: #3fb950; font-size: 9px; font-weight: 700; }
.application-copy { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.application-copy strong, .application-copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.application-copy strong { font-size: 11px; }
.application-editor { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.application-editor label { display: flex; flex-direction: column; gap: 5px; color: var(--text-dim); font-size: 10px; }
.application-editor .application-polling { grid-column: 1 / -1; flex-direction: row; align-items: center; }
.application-editor .alert-error { grid-column: 1 / -1; }
.delete-application-copy p { margin: 0 0 8px; }
.delete-application-copy small { color: var(--text-dim); }
.application-copy small { color: var(--text-dim); font-size: 9px; }
.application-row > svg { width: 13px; color: #3fb950; }
.application-empty { display: flex; flex-direction: column; align-items: center; gap: 7px; color: var(--text-dim); font-size: 10px; padding: 28px 8px; }
.application-empty svg { width: 17px; }
.apm-main { min-width: 0; min-height: 0; overflow: auto; padding: 14px; }
.application-header { display: flex; align-items: center; justify-content: space-between; gap: 14px; }
.application-header h2 { margin: 2px 0; font-size: 20px; letter-spacing: 0; }
.application-header > div > span { color: var(--text-dim); font-size: 10px; }
.application-kicker { color: #3fb950; font-size: 9px; text-transform: uppercase; }
.application-actions { display: flex; align-items: center; gap: 8px; }
.collection-state { max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-dim); font-size: 9px; }
.collection-state.ok { color: #3fb950; }.collection-state.warn { color: #d29922; }.collection-state.error { color: #f85149; }
.apm-status-strip { margin: 12px 0; display: flex; align-items: center; gap: 16px; min-height: 30px; border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); color: var(--text-dim); font-size: 9px; }
.apm-status-strip span { display: flex; align-items: center; gap: 5px; }
.apm-status-strip svg { width: 12px; height: 12px; }
.apm-status-strip .partial { color: #d29922; }
.apm-view-tabs { width: fit-content; margin-bottom: 12px; }
.apm-view-tabs button { min-width: 82px; height: 28px; font-size: 10px; }
.kpi-grid { display: grid; grid-template-columns: repeat(6, minmax(105px, 1fr)); border: 1px solid var(--border); border-radius: 7px; overflow: hidden; margin-bottom: 12px; }
.kpi-item { min-width: 0; min-height: 74px; display: flex; flex-direction: column; justify-content: center; gap: 3px; border-right: 1px solid var(--border); padding: 9px 11px; background: var(--surface); }
.kpi-item:last-child { border-right: 0; }
.kpi-item span, .kpi-item small { color: var(--text-dim); font-size: 9px; }
.kpi-item strong { font-size: 16px; font-weight: 650; }
.chart-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.apm-empty { min-height: 320px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 9px; color: var(--text-dim); text-align: center; }
.apm-empty svg { width: 30px; height: 30px; color: #3fb950; }
.apm-empty strong { color: var(--text); font-size: 13px; }
.apm-empty span { max-width: 430px; font-size: 10px; line-height: 1.5; }
.apm-empty.compact { min-height: 230px; border: 1px dashed var(--border); border-radius: 7px; }
.resource-table-wrap { overflow: auto; border: 1px solid var(--border); border-radius: 7px; }
.resource-table-wrap td > small { display: block; margin-top: 2px; color: var(--text-dim); font-size: 9px; }
.collect-confirm { display: flex; flex-direction: column; gap: 10px; font-size: 11px; line-height: 1.5; }
.collect-confirm dl { margin: 0; border: 1px solid var(--border); border-radius: 6px; }
.collect-confirm dl div { display: flex; justify-content: space-between; padding: 7px 9px; border-bottom: 1px solid var(--border); }
.collect-confirm dl div:last-child { border-bottom: 0; }
.collect-confirm dd { margin: 0; font-weight: 700; }
.collect-warning { color: #d29922; }
.threshold-editor { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.threshold-editor > p, .threshold-editor > .alert-error { grid-column: 1 / -1; margin: 0; color: var(--text-dim); font-size: 10px; line-height: 1.5; }
.threshold-field { min-width: 0; display: grid; grid-template-columns: minmax(0, 1fr) 92px; align-items: center; gap: 5px 10px; border-bottom: 1px solid var(--border); padding: 8px 0; }
.threshold-toggle { min-width: 0; display: flex; align-items: center; gap: 7px; }
.threshold-toggle strong { font-size: 10px; }
.threshold-field small { grid-column: 1 / -1; color: var(--text-dim); font-size: 9px; line-height: 1.4; }
.threshold-field .ctrl-input { width: 92px; }
.architecture-link-editor { display: flex; flex-direction: column; gap: 10px; }
.architecture-link-editor label { display: flex; flex-direction: column; gap: 5px; color: var(--text-dim); font-size: 10px; }
.architecture-link-editor small { color: var(--text-dim); }
.architecture-link-warning { color: #d29922 !important; }
.kubernetes-preview { display: flex; flex-direction: column; gap: 10px; }
.kubernetes-preview label { display: flex; flex-direction: column; gap: 5px; color: var(--text-dim); font-size: 10px; }
.kubernetes-preview-stats { display: flex; gap: 8px; }
.kubernetes-preview-stats span, .kubernetes-preview-context { border: 1px solid var(--border); border-radius: 5px; padding: 8px; color: var(--text-dim); font-size: 10px; }
.kubernetes-preview-stats strong, .kubernetes-preview-context strong { color: var(--text); }
.kubernetes-preview-context { display: flex; flex-direction: column; gap: 3px; }
@media (max-width: 1100px) { .kpi-grid { grid-template-columns: repeat(3, 1fr); }.kpi-item:nth-child(3) { border-right: 0; }.chart-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 820px) { .apm-toolbar { align-items: flex-start; flex-direction: column; }.apm-toolbar-controls { width: 100%; flex-wrap: wrap; }.apm-layout { grid-template-columns: 170px minmax(0, 1fr); }.application-actions { align-items: flex-end; flex-direction: column; }.collection-state { max-width: 160px; }.chart-grid { grid-template-columns: 1fr; } }
@media (max-width: 620px) {
  .apm-view { position: fixed; inset: 102px 0 78px; z-index: 12; height: auto; }
  .apm-toolbar-controls select { width: calc(50% - 4px); }
  .range-control { order: 3; }
  .apm-layout { display: flex; flex-direction: column; }
  .application-list { max-height: 128px; border-right: 0; border-bottom: 1px solid var(--border); }
  .kpi-grid { grid-template-columns: repeat(2, 1fr); }
  .kpi-item:nth-child(3) { border-right: 1px solid var(--border); }
  .kpi-item:nth-child(even) { border-right: 0; }
  .application-header { align-items: flex-start; }
  .apm-status-strip { align-items: flex-start; flex-direction: column; gap: 6px; padding: 8px 0; }
  .threshold-editor { grid-template-columns: 1fr; }
}
</style>
