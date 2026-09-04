<template>
  <div class="architecture-view">
    <header class="architecture-toolbar">
      <div class="architecture-title">
        <i data-lucide="network"></i>
        <span><strong>Architecture</strong><small>Evidence-backed application diagrams</small></span>
      </div>
      <div class="architecture-actions">
        <input ref="bundleInput" class="bundle-file-input" type="file" accept=".kuaapp.json,application/json" @change="handleBundleFile" />
        <button class="btn sm" :disabled="!profileId || store.saving" title="Import a local KUA Application backup" @click="openBundlePicker">
          <i data-lucide="upload"></i> Import backup
        </button>
        <button v-if="activeApplication" class="btn sm" :disabled="store.saving" title="Download a sanitized local KUA Application backup" @click="exportKuaApp">
          <i data-lucide="download"></i> Export backup
        </button>
        <button class="btn sm btn-icon" title="Refresh application" :disabled="store.loading || !profileId" @click="refreshWorkspace">
          <i data-lucide="refresh-cw"></i>
        </button>
        <div v-if="store.selectedProject" class="resource-add-menu">
          <button class="btn sm" :disabled="store.loading" @click="resourceProvider = resourceProvider ? '' : 'aws'">
            <i data-lucide="plus"></i> Add resources
          </button>
          <div v-if="resourceProvider" class="resource-provider-options">
            <button :class="{ active: resourceProvider === 'aws' }" @click="resourceProvider = 'aws'"><i data-lucide="cloud"></i> AWS</button>
            <button :class="{ active: resourceProvider === 'kubernetes' }" @click="resourceProvider = 'kubernetes'"><i data-lucide="boxes"></i> Kubernetes</button>
            <button :class="{ active: resourceProvider === 'manual' }" @click="resourceProvider = 'manual'"><i data-lucide="square-plus"></i> Manual resource</button>
            <button :class="{ active: resourceProvider === 'gcp' }" @click="resourceProvider = 'gcp'"><i data-lucide="cloud-cog"></i> GCP</button>
            <button :class="{ active: resourceProvider === 'vercel' }" @click="resourceProvider = 'vercel'"><i data-lucide="triangle"></i> Vercel</button>
          </div>
        </div>
        <button class="btn sm primary" :disabled="!profileId" @click="creatingProject = true">
          <i data-lucide="plus"></i> New project
        </button>
      </div>
    </header>

    <div v-if="!profileId" class="architecture-empty architecture-application-picker">
      <i data-lucide="boxes"></i>
      <strong>Select a KUA application</strong>
      <span>Choose an application to open its Architecture workspace.</span>
      <div v-if="store.loading" class="architecture-empty compact">Loading applications...</div>
      <div v-else-if="store.applications.length" class="architecture-first-access-list">
        <button
          v-for="application in store.applications"
          :key="application.id"
          class="architecture-first-access-row"
          @click="selectApplication(application.id)"
        >
          <span class="application-mark">{{ application.name.slice(0, 2).toUpperCase() }}</span>
          <span><strong>{{ application.name }}</strong><small>{{ application.provider.toUpperCase() }}<template v-if="application.environment"> · {{ application.environment }}</template><template v-if="application.team"> · {{ application.team }}</template></small></span>
          <i data-lucide="arrow-right"></i>
        </button>
      </div>
      <template v-else-if="!store.error">
        <span>No KUA applications are configured yet.</span>
        <button class="btn sm" @click="refreshApplicationCatalog"><i data-lucide="refresh-cw"></i> Refresh</button>
      </template>
      <button v-if="store.error" class="btn sm" @click="refreshApplicationCatalog"><i data-lucide="refresh-cw"></i> Retry</button>
      <div v-if="store.error" class="alert-error architecture-error">{{ store.error }}</div>
    </div>

    <template v-else>
      <div v-if="store.error" class="alert-error architecture-error">{{ store.error }}</div>
      <form v-if="creatingProject" class="architecture-create" @submit.prevent="submitProject">
        <input v-model.trim="projectDraft.name" class="ctrl-input" required maxlength="120" placeholder="Project name" />
        <input v-model.trim="projectDraft.description" class="ctrl-input" maxlength="500" placeholder="Description" />
        <button class="btn sm primary" :disabled="store.saving"><i data-lucide="arrow-right"></i> Create and configure</button>
        <button type="button" class="btn sm" @click="creatingProject = false">Cancel</button>
      </form>

      <div class="architecture-layout">
        <aside class="architecture-projects">
          <template v-if="store.applications.length">
            <div class="architecture-list-heading"><span>KUA Applications</span><strong>{{ store.applications.length }}</strong></div>
            <button
              v-for="application in store.applications"
              :key="application.id"
              :class="['architecture-application-row', { active: store.selectedApplicationId === application.id }]"
              @click="selectApplication(application.id)"
            >
              <span class="application-mark">{{ application.name.slice(0, 2).toUpperCase() }}</span>
              <span><strong>{{ application.name }}</strong><small>{{ [application.environment, application.team].filter(Boolean).join(' / ') || application.provider.toUpperCase() }}</small></span>
            </button>
          </template>
          <div class="architecture-list-heading"><span>Projects</span><strong>{{ store.projects.length }}</strong></div>
          <button
            v-for="project in store.projects"
            :key="project.id"
            :class="['architecture-project-row', { active: store.selectedProjectId === project.id }]"
            @click="store.selectProject(project.id)"
          >
            <span class="project-mark">{{ project.name.slice(0, 2).toUpperCase() }}</span>
            <span><strong>{{ project.name }}</strong><small>{{ project.description || 'Application architecture' }}</small></span>
          </button>
          <button v-if="!store.projects.length && !store.loading" class="architecture-project-empty" @click="creatingProject = true">
            <i data-lucide="plus"></i> Create the first project
          </button>
        </aside>

        <main class="architecture-workspace">
          <div v-if="store.loading" class="architecture-empty compact">Loading architecture...</div>
          <div v-else-if="!store.selectedProject" class="architecture-empty">
            <i data-lucide="waypoints"></i>
            <strong>{{ store.selectedApplication ? `No architecture view for ${store.selectedApplication.name}` : 'No architecture selected' }}</strong>
            <span>{{ store.selectedApplication ? 'Create the application view to start collecting scopes, sources and evidence.' : 'Create a project to start collecting scopes, sources and evidence.' }}</span>
            <button v-if="store.selectedApplication" class="btn sm primary" @click="creatingProject = true"><i data-lucide="plus"></i> Create application view</button>
          </div>
          <template v-else>
            <section class="architecture-project-header">
              <div>
                <span class="architecture-kicker">{{ applicationContextLabel }} / revision {{ store.graph?.revision ?? 0 }}</span>
                <h2>{{ store.selectedProject.name }}</h2>
                <p>{{ store.selectedProject.description || 'Application architecture workspace' }}</p>
              </div>
              <form class="snapshot-form" @submit.prevent="submitSnapshot">
                <button v-if="store.linkedApplication" class="btn sm" type="button" @click="emit('open-observability', store.linkedApplication)">
                  <i data-lucide="square-activity"></i> Open observability
                </button>
                <button class="btn sm" type="button" :disabled="!syncSource || store.syncPreviewing" @click="previewSync">
                  <i :data-lucide="store.syncPreviewing ? 'loader-2' : 'refresh-cw'"></i>
                  {{ store.syncPreviewing ? 'Checking…' : 'Sync preview' }}
                </button>
                <input v-model.trim="snapshotName" class="ctrl-input" required maxlength="120" placeholder="Snapshot name" />
                <button class="btn sm" :disabled="store.saving"><i data-lucide="camera"></i> Snapshot</button>
                <button class="btn sm btn-icon danger" type="button" :disabled="store.saving" title="Delete project" @click="deleteProject">
                  <i data-lucide="trash-2"></i>
                </button>
              </form>
            </section>

            <section v-if="store.selectedApplication" class="architecture-application-context">
              <span><small>Application</small><strong>{{ store.selectedApplication.name }}</strong></span>
              <span><small>Provider</small><strong>{{ store.selectedApplication.provider.toUpperCase() }}</strong></span>
              <span><small>Environment</small><strong>{{ store.selectedApplication.environment || '—' }}</strong></span>
              <span><small>Team</small><strong>{{ store.selectedApplication.team || '—' }}</strong></span>
              <span><small>Scopes</small><strong>{{ store.graph?.document?.scopes?.length || 0 }}</strong></span>
              <span :class="store.selectedApplication.architectureProjectId ? 'linked' : 'unlinked'"><small>Architecture</small><strong>{{ store.selectedApplication.architectureProjectId ? 'Linked' : 'Not linked' }}</strong></span>
            </section>

            <section class="architecture-stats">
              <div><span>Nodes</span><strong>{{ store.graph?.document.nodes.length || 0 }}</strong></div>
              <div><span>Relations</span><strong>{{ store.graph?.document.edges.length || 0 }}</strong></div>
              <div><span>Sources</span><strong>{{ store.graph?.document.sources.length || 0 }}</strong></div>
              <div><span>Snapshots</span><strong>{{ store.snapshots.length }}</strong></div>
            </section>

            <section v-if="store.syncPreview" class="sync-preview-panel">
              <header>
                <span><i data-lucide="refresh-cw"></i><strong>CloudFormation sync preview</strong><small>{{ syncSourceLabel }}</small></span>
                <strong>{{ store.syncPreview.summary.changeCount }} change{{ store.syncPreview.summary.changeCount === 1 ? '' : 's' }}</strong>
                <button class="btn sm btn-icon" title="Close sync preview" @click="store.syncPreview = null"><i data-lucide="x"></i></button>
              </header>
              <div class="sync-preview-grid">
                <div v-for="item in resourceSyncCounts" :key="`resource:${item.key}`">
                  <span>{{ item.label }}</span><strong>{{ item.count }}</strong>
                </div>
              </div>
              <div class="sync-preview-grid relationship-grid">
                <div v-for="item in relationshipSyncCounts" :key="`relationship:${item.key}`">
                  <span>{{ item.label }}</span><strong>{{ item.count }}</strong>
                </div>
              </div>
              <div class="sync-review-lists">
                <details v-for="section in syncResourceSections" :key="section.key" v-show="section.items.length">
                  <summary>{{ section.label }} <strong>{{ section.items.length }}</strong></summary>
                  <span v-for="item in section.items" :key="syncItemId(item)" class="sync-review-item">
                    {{ syncItemName(item) }}
                  </span>
                </details>
                <details v-for="section in syncRelationshipSections" :key="section.key" v-show="section.items.length">
                  <summary>{{ section.label }} <strong>{{ section.items.length }}</strong></summary>
                  <span v-for="item in section.items" :key="syncItemId(item)" class="sync-review-item">
                    {{ syncRelationshipName(item) }}
                  </span>
                </details>
              </div>
              <footer>
                <span>{{ store.syncPreview.summary.resources.missing }} resource{{ store.syncPreview.summary.resources.missing === 1 ? '' : 's' }} will become stale</span>
                <button class="btn sm primary" :disabled="store.saving" @click="applySync">
                  <i data-lucide="check"></i> Apply sync
                </button>
              </footer>
            </section>

            <section v-if="staleResources.length" class="stale-resource-list">
              <header><span>Stale resources</span><small>{{ staleResources.length }} need a decision</small></header>
              <div v-for="node in staleResources" :key="node.id" class="stale-resource-row">
                <span><strong>{{ node.name }}</strong><small>{{ node.kind || node.resourceType }}</small></span>
                <button class="btn sm" :disabled="store.saving" @click="restoreStaleResource(node)"><i data-lucide="undo-2"></i> Restore</button>
                <button class="btn sm danger" :disabled="store.saving" @click="removeStaleResource(node)"><i data-lucide="trash-2"></i> Remove</button>
              </div>
            </section>

            <ArchitectureDiscoveryPanel
              v-if="resourceProvider === 'aws'"
              @close="resourceProvider = ''"
              @imported="resourceProvider = ''"
            />
            <ArchitectureKubernetesDiscoveryPanel
              v-if="resourceProvider === 'kubernetes'"
              @close="resourceProvider = ''"
              @imported="resourceProvider = ''"
            />
            <ArchitectureManualResourcePanel
              v-if="resourceProvider === 'manual'"
              @close="resourceProvider = ''"
              @imported="resourceProvider = ''"
            />
            <ArchitectureCloudDiscoveryPanel
              v-if="resourceProvider === 'gcp'"
              provider="gcp"
              @close="resourceProvider = ''"
              @imported="resourceProvider = ''"
            />
            <ArchitectureCloudDiscoveryPanel
              v-if="resourceProvider === 'vercel'"
              provider="vercel"
              @close="resourceProvider = ''"
              @imported="resourceProvider = ''"
            />

            <div class="architecture-view-tabs">
              <button :class="['btn', 'sm', { primary: activeView === 'routes' }]" @click="activeView = 'routes'">
                <i data-lucide="route"></i> Routes
              </button>
              <button :class="['btn', 'sm', { primary: activeView === 'canvas' }]" @click="activeView = 'canvas'">
                <i data-lucide="network"></i> Canvas
              </button>
              <button :class="['btn', 'sm', { primary: activeView === 'resources' }]" :disabled="!store.linkedApplication" @click="selectResourcesView">
                <i data-lucide="database"></i> Resources
              </button>
            </div>

            <ArchitectureRoutes
              v-if="store.graph && activeView === 'routes'"
              :graph="store.graph"
              @inspect-workflow="openWorkflow"
              @operation="applyCanvasOperation"
            />

            <ArchitectureCanvas
              v-if="store.graph && activeView === 'canvas'"
              :graph="store.graph"
              :saving="store.saving"
              :observability-enabled="Boolean(store.linkedApplication)"
              :metrics="metricsByNode"
              :metrics-loading="metricsLoading"
              :collection="collectionByNode"
              :collection-loading="metricsLoading"
              @operation="applyCanvasOperation"
              @inspect-workflow="openWorkflow"
              @node-action="handleNodeAction"
              @request-metrics="loadOperationalMetrics"
            />

            <ArchitectureResources
              v-if="activeView === 'resources'"
              :graph="store.graph"
              :registry="store.registry"
              :loading="store.registryLoading"
              @refresh="store.loadRegistry"
            />

            <StepFnDetail
              :open="Boolean(selectedWorkflow)"
              :sm="selectedWorkflow"
              :profile-id="profileId"
              initial-tab="diagram"
              @close="selectedWorkflow = null"
            />

            <section v-if="store.snapshots.length" class="snapshot-list">
              <header><span>Snapshots</span><small>Immutable local history</small></header>
              <div v-for="snapshot in store.snapshots" :key="snapshot.id" class="snapshot-row">
                <span class="snapshot-version">v{{ snapshot.version }}</span>
                <span><strong>{{ snapshot.name }}</strong><small>Revision {{ snapshot.sourceRevision }}</small></span>
                <time>{{ new Date(snapshot.createdAt).toLocaleString() }}</time>
                <button class="btn sm btn-icon" title="Compare with current graph" @click="compareSnapshot(snapshot.id)">
                  <i data-lucide="git-compare-arrows"></i>
                </button>
                <button class="btn sm btn-icon" title="Restore this snapshot" :disabled="store.saving" @click="restoreSnapshot(snapshot)">
                  <i data-lucide="history"></i>
                </button>
              </div>
            </section>

            <section v-if="store.snapshotDiff" class="architecture-diff">
              <span><i data-lucide="git-compare-arrows"></i> Compared with v{{ store.snapshotDiff.snapshot.version }}</span>
              <strong>{{ store.snapshotDiff.diff.changeCount }} change{{ store.snapshotDiff.diff.changeCount === 1 ? '' : 's' }}</strong>
              <button class="btn sm btn-icon" title="Close comparison" @click="store.snapshotDiff = null"><i data-lucide="x"></i></button>
            </section>

            <section v-if="store.changes.length" class="change-list">
              <header><span>Change history</span><small>Latest {{ store.changes.length }} revisions</small></header>
              <div v-for="change in store.changes" :key="change.id" class="change-row">
                <span class="change-revision">r{{ change.revision }}</span>
                <span><strong>{{ changeLabel(change.type) }}</strong><small>{{ change.reason || change.subjectId || change.subjectType }}</small></span>
                <time>{{ new Date(change.createdAt).toLocaleString() }}</time>
              </div>
            </section>
          </template>
        </main>
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { createIcons, icons } from 'lucide'
import { useArchitectureStore } from '../../stores/useArchitectureStore'
import { useApmStore } from '../../stores/useApmStore'
import { useAwsStore } from '../../stores/useAwsStore'
import { useTerminalStore } from '../../stores/useTerminalStore'
import { useToast } from '../../composables/useToast'
import { suggestGraphRelationships } from '../../lib/logRelationshipEvidence'
import StepFnDetail from '../StepFnDetail.vue'
import ArchitectureCanvas from './ArchitectureCanvas.vue'
import ArchitectureDiscoveryPanel from './ArchitectureDiscoveryPanel.vue'
import ArchitectureKubernetesDiscoveryPanel from './ArchitectureKubernetesDiscoveryPanel.vue'
import ArchitectureCloudDiscoveryPanel from './ArchitectureCloudDiscoveryPanel.vue'
import ArchitectureManualResourcePanel from './ArchitectureManualResourcePanel.vue'
import ArchitectureResources from './ArchitectureResources.vue'
import ArchitectureRoutes from './ArchitectureRoutes.vue'
import { catalogFor } from '../cloud/apm/metricCatalog'

const props = defineProps({
  profileId: { type: String, default: '' },
  projectId: { type: String, default: '' },
  applicationId: { type: String, default: '' },
})
const emit = defineEmits([
  'open-observability', 'application-context',
  'open-kubernetes-logs', 'open-kubernetes-detail', 'open-kubernetes-pods',
  'open-aws-resource', 'open-aws-logs',
])
const store = useArchitectureStore()
const apmStore = useApmStore()
const awsStore = useAwsStore()
const terminalStore = useTerminalStore()
const { toast } = useToast()
const creatingProject = ref(false)
const projectDraft = reactive({ name: '', description: '' })
const snapshotName = ref('')
const resourceProvider = ref('')
const activeView = ref('routes')
const selectedWorkflow = ref(null)
const bundleInput = ref(null)
const activeApplication = computed(() => store.linkedApplication || store.selectedApplication)
const applicationContextLabel = computed(() => store.linkedApplication
  ? `${store.linkedApplication.name} · ${String(store.linkedApplication.provider || 'application').toUpperCase()}`
  : 'Architecture')
const syncSource = computed(() => {
  const sources = store.graph?.document?.sources?.filter(source => source.type === 'cloudformation') || []
  if (!sources.length) return null
  const first = sources[0]
  return {
    accountId: first.accountId || '',
    region: first.region || 'us-east-1',
    stackNames: sources
      .filter(source => source.accountId === first.accountId && source.region === first.region)
      .map(source => source.name),
  }
})
const syncSourceLabel = computed(() => syncSource.value
  ? `${syncSource.value.stackNames.length} stack${syncSource.value.stackNames.length === 1 ? '' : 's'} · ${syncSource.value.region}`
  : 'No CloudFormation source')
const resourceSyncCounts = computed(() => syncCountItems(store.syncPreview?.summary?.resources, {
  new: 'New', changed: 'Changed', unchanged: 'Unchanged', missing: 'Missing', stale: 'Stale', manual: 'Manual',
}))
const relationshipSyncCounts = computed(() => syncCountItems(store.syncPreview?.summary?.relationships, {
  new: 'New relationships', reinforced: 'Reinforced', unchanged: 'Unchanged', missingEvidence: 'Missing evidence', rejected: 'Rejected', manual: 'Manual',
}))
const syncResourceSections = computed(() => [
  ['new', 'New resources'], ['changed', 'Changed resources'], ['missing', 'Missing resources'], ['stale', 'Already stale'], ['manual', 'Manual resources'],
].map(([key, label]) => ({ key, label, items: store.syncPreview?.resources?.[key] || [] })))
const syncRelationshipSections = computed(() => [
  ['new', 'New relationships'], ['reinforced', 'Reinforced relationships'], ['missingEvidence', 'Relationships missing evidence'], ['rejected', 'Rejected relationships'], ['manual', 'Manual relationships'],
].map(([key, label]) => ({ key: `relationship:${key}`, label, items: store.syncPreview?.relationships?.[key] || [] })))
const staleResources = computed(() => store.graph?.document?.nodes?.filter(node => node.syncState === 'stale') || [])
const metricsByNode = ref({})
const metricsLoading = ref(false)
const collectionByNode = ref({})

const METRIC_LABELS = {
  invocations_observed: 'Invocations',
  errors_observed: 'Errors',
  duration_ms: 'Duration',
  cpu_cores: 'CPU',
  memory_bytes: 'Memory',
  log_bytes: 'Logs',
  pods_ready: 'Ready pods',
}

function syncCountItems(counts = {}, labels) {
  return Object.entries(labels).map(([key, label]) => ({ key, label, count: counts?.[key] || 0 }))
}

async function loadProfile(profileId) {
  resourceProvider.value = ''
  selectedWorkflow.value = null
  store.setActiveProfile(profileId || null)
  awsStore.setActiveProfile(profileId || null)
  if (!profileId) {
    await store.loadApplicationCatalog()
    return nextTick(() => createIcons({ icons }))
  }
  const applications = await store.loadApplications()
  if (props.applicationId && applications.some(application => application.id === props.applicationId)) {
    await store.selectApplication(props.applicationId)
  } else if (props.projectId) {
    await store.loadProjects({ applicationId: '' })
  } else if (store.selectedApplicationId && applications.some(application => application.id === store.selectedApplicationId)) {
    await store.selectApplication(store.selectedApplicationId)
  } else if (applications.length) {
    await store.selectApplication(applications[0].id)
  } else {
    await store.loadProjects({ applicationId: '' })
  }
  if (props.projectId && store.projects.some(project => project.id === props.projectId)) {
    await store.selectProject(props.projectId)
  }
  nextTick(() => createIcons({ icons }))
}

async function refreshWorkspace() {
  const currentApplicationId = props.applicationId || store.selectedApplicationId || ''
  if (currentApplicationId) {
    await store.loadApplications()
    await store.selectApplication(currentApplicationId)
  } else {
    await store.loadProjects({ applicationId: '' })
  }
  nextTick(() => createIcons({ icons }))
}

function sameApmResource(resource, node) {
  const typeMatches = node.provider === 'kubernetes'
    ? resource.type === 'kubernetes' && (!node.kind || resource.kind === node.kind)
    : resource.type === node.resourceType
  if (!typeMatches) return false
  const identities = [node.arn, node.nativeId, node.discoveryKey].filter(Boolean)
  if (identities.some(identity => [resource.id, resource.arn, resource.key].includes(identity))) return true
  return resource.name === node.name
}

function formatMetricValue(value, unit) {
  if (value == null) return null
  if (unit === 'bytes') {
    if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)} GiB`
    if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)} MiB`
    if (value >= 1024) return `${(value / 1024).toFixed(1)} KiB`
    return `${Math.round(value)} B`
  }
  return `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}${unit ? ` ${unit}` : ''}`
}

function collectionOverlay(run) {
  if (!run) return { status: 'unknown', label: 'Not collected', icon: 'circle-help', detail: 'No collection has completed for this application' }
  const status = run.status || 'unknown'
  const label = status === 'budget_exhausted' ? 'Budget' : status.charAt(0).toUpperCase() + status.slice(1)
  const timestamp = run.finishedAt || run.startedAt
  return {
    status,
    label,
    icon: status === 'completed' ? 'check-circle-2' : status === 'partial' ? 'triangle-alert' : 'circle-alert',
    detail: timestamp ? `${label} · ${new Date(timestamp).toLocaleString()}` : label,
  }
}

async function loadOperationalMetrics() {
  const application = store.linkedApplication
  if (!application?.id || !application.profileId) return
  metricsLoading.value = true
  metricsByNode.value = {}
  collectionByNode.value = {}
  try {
    apmStore.setActiveProfile(application.profileId, application.provider || 'aws')
    await apmStore.selectApplication(application.id)
    const resources = apmStore.topology.resources || []
    const collectionStatus = collectionOverlay(apmStore.overview?.latestRun)
    const nextMetrics = {}
    const nextCollection = {}
    for (const node of store.graph?.document?.nodes || []) {
      const resource = resources.find(candidate => sameApmResource(candidate, node))
      if (!resource) continue
      nextCollection[node.id] = collectionStatus
      const charts = catalogFor(resource.type, resource.kind).charts || []
      const items = []
      for (const chart of charts) {
        const points = await apmStore.loadSeries(chart.metric, { resourceId: resource.id })
        const value = formatMetricValue(points.at(-1)?.v, chart.unit)
        if (value != null) items.push({ key: chart.metric, label: METRIC_LABELS[chart.metric] || chart.metric, value })
      }
      nextMetrics[node.id] = { loading: false, items }
    }
    metricsByNode.value = nextMetrics
    collectionByNode.value = nextCollection
  } finally {
    metricsLoading.value = false
  }
}

async function selectApplication(applicationId) {
  if (!profileId) {
    const application = store.applications.find(item => item.id === applicationId)
    if (application) emit('application-context', application)
    return
  }
  await store.selectApplication(applicationId)
  nextTick(() => createIcons({ icons }))
}

async function refreshApplicationCatalog() {
  await store.loadApplicationCatalog()
  nextTick(() => createIcons({ icons }))
}

async function submitProject() {
  const project = await store.createProject({ ...projectDraft, applicationId: props.applicationId || store.selectedApplicationId || '' })
  if (!project) return
  projectDraft.name = ''
  projectDraft.description = ''
  creatingProject.value = false
  resourceProvider.value = 'aws'
  activeView.value = 'routes'
  nextTick(() => createIcons({ icons }))
}

async function submitSnapshot() {
  const snapshot = await store.createSnapshot({ name: snapshotName.value })
  if (snapshot) snapshotName.value = ''
  nextTick(() => createIcons({ icons }))
}

async function deleteProject() {
  const project = store.selectedProject
  if (!project || !window.confirm(`Delete project "${project.name}" and all of its graph history? This cannot be undone.`)) return
  resourceProvider.value = ''
  selectedWorkflow.value = null
  await store.deleteProject(project.id)
  nextTick(() => createIcons({ icons }))
}

function openBundlePicker() {
  bundleInput.value?.click()
}

async function handleBundleFile(event) {
  const [file] = event.target.files || []
  event.target.value = ''
  if (!file) return
  const result = await store.importKuaApp(file)
  if (result) toast(`Imported ${result.application.name}`, 'success')
  nextTick(() => createIcons({ icons }))
}

async function exportKuaApp() {
  if (!activeApplication.value) return
  const downloaded = await store.downloadKuaApp(activeApplication.value.id)
  if (downloaded) toast(`Exported ${activeApplication.value.name}`, 'success')
}

async function previewSync() {
  if (!syncSource.value) return
  await store.previewAwsSync(syncSource.value)
  nextTick(() => createIcons({ icons }))
}

async function applySync() {
  if (!syncSource.value) return
  await store.applyAwsSync(syncSource.value)
  nextTick(() => createIcons({ icons }))
}

async function restoreStaleResource(node) {
  const { staleAt, ...restoredNode } = node
  await store.applyOperation({
    type: 'node.upsert',
    value: { ...restoredNode, manual: true, syncState: 'restored' },
  }, { reason: `Restore stale resource ${node.name}` })
  nextTick(() => createIcons({ icons }))
}

async function removeStaleResource(node) {
  if (!window.confirm(`Remove stale resource "${node.name}" and its relationships?`)) return
  await store.applyOperation({ type: 'node.remove', subjectId: node.id }, { reason: `Remove stale resource ${node.name}` })
  nextTick(() => createIcons({ icons }))
}

function syncItemName(item) {
  const node = item.preview || item.node
  return node?.name || item.edge?.relationType || 'Unknown resource'
}

function syncItemId(item) {
  const node = item.preview || item.node || item.edge
  return node?.id || JSON.stringify(item)
}

function syncRelationshipName(item) {
  const edge = item.preview || item.edge
  return edge ? `${edge.relationType}: ${edge.sourceNodeId} to ${edge.targetNodeId}` : 'Unknown relationship'
}

async function compareSnapshot(snapshotId) {
  await store.compareSnapshot(snapshotId)
  nextTick(() => createIcons({ icons }))
}

async function restoreSnapshot(snapshot) {
  if (!window.confirm(`Restore snapshot v${snapshot.version} "${snapshot.name}"? A new snapshot will preserve the restored state.`)) return
  await store.revertSnapshot(snapshot.id, { reason: `Restore snapshot v${snapshot.version}` })
  nextTick(() => createIcons({ icons }))
}

async function applyCanvasOperation(operation, reason) {
  await store.applyOperation(operation, { reason })
  nextTick(() => createIcons({ icons }))
}

function openWorkflow(node) {
  selectedWorkflow.value = node?.arn ? { name: node.name, arn: node.arn } : null
}

const NODE_ACTION_EVENTS = {
  'kubernetes-logs': 'open-kubernetes-logs',
  'kubernetes-detail': 'open-kubernetes-detail',
  'kubernetes-pods': 'open-kubernetes-pods',
  'aws-logs': 'open-aws-logs',
  'aws-detail': 'open-aws-resource',
}

// Kind -> the resourceType used by open Kubernetes log terminal tabs (see useTerminalStore.openLogsTab).
const KUBE_LOG_TAB_RESOURCE_TYPE = {
  Deployment: 'deployments', StatefulSet: 'statefulsets', DaemonSet: 'daemonsets', Pod: 'pods',
}

function handleNodeAction({ action, node } = {}) {
  if (action === 'kubernetes-log-suggestions') return suggestRelationshipsFromLogs(node)
  if (['observability-metrics', 'observability-traces'].includes(action)) {
    if (!store.linkedApplication || !node) return
    emit('open-observability', store.linkedApplication, {
      view: action === 'observability-traces' ? 'traces' : 'metrics',
      node,
    })
    return
  }
  const eventName = NODE_ACTION_EVENTS[action]
  if (eventName && node) emit(eventName, node)
}

// Deterministic, sanitized extraction over an already-open log stream; every candidate is added as a
// 'suggested' edge that still requires the existing accept/reject review before it counts as confirmed.
async function suggestRelationshipsFromLogs(node) {
  const resourceType = KUBE_LOG_TAB_RESOURCE_TYPE[node?.kind]
  if (!resourceType || !node?.namespace || !node?.name) return
  const tab = terminalStore.tabs.find(item =>
    item.type === 'log' && item.resourceType === resourceType && item.ns === node.namespace && item.pod === node.name)
  if (!tab?.entries?.length) {
    toast('Open logs for this resource first, then try again', 'error')
    return
  }
  const suggestions = suggestGraphRelationships({
    lines: tab.entries.map(entry => entry.text),
    sourceNode: node,
    nodes: store.graph?.document?.nodes || [],
  })
  if (!suggestions.length) {
    toast('No relationship evidence found in the current logs', 'info')
    return
  }
  for (const suggestion of suggestions) {
    await store.applyOperation({
      type: 'edge.upsert',
      value: {
        id: `log-suggestion:${node.id}:${suggestion.targetNodeId}`,
        sourceNodeId: node.id,
        targetNodeId: suggestion.targetNodeId,
        relationType: 'calls',
        status: 'suggested',
        confidence: suggestion.confidence,
        evidence: [{ type: 'log_reference', values: [suggestion.sample], occurrences: suggestion.occurrences }],
      },
    }, `Suggest relationship from logs: ${node.name} -> ${suggestion.targetName}`)
  }
  toast(`${suggestions.length} suggested relationship${suggestions.length === 1 ? '' : 's'} added for review`, 'success')
  nextTick(() => createIcons({ icons }))
}

function changeLabel(type) {
  return String(type || '').split('.').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
}

function selectResourcesView() {
  activeView.value = 'resources'
  if (store.linkedApplication) store.loadRegistry()
}

watch(() => props.profileId, loadProfile)
watch(() => props.applicationId, async () => loadProfile(props.profileId))
watch(() => props.projectId, async projectId => {
  if (projectId && store.projects.some(project => project.id === projectId)) {
    await store.selectProject(projectId)
    nextTick(() => createIcons({ icons }))
  }
})
watch(() => store.linkedApplication, application => {
  if (application) emit('application-context', application)
  if (application && activeView.value === 'resources') store.loadRegistry()
})
onMounted(() => loadProfile(props.profileId))
</script>

<style scoped>
.architecture-view { min-height: 100%; display: flex; flex-direction: column; color: var(--text); }
.architecture-application-picker { flex: 1; min-height: 260px; }
.architecture-first-access-list { width: min(520px, 100%); display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
.architecture-first-access-row { width: 100%; display: flex; align-items: center; gap: 10px; padding: 9px 11px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-panel); color: inherit; text-align: left; cursor: pointer; }
.architecture-first-access-row:hover { border-color: #3fb950; background: var(--bg-hover); }
.architecture-first-access-row > span:nth-child(2) { display: flex; flex: 1; flex-direction: column; min-width: 0; }
.architecture-first-access-row small { color: var(--text-dim); }
.architecture-first-access-row > svg { color: var(--text-dim); width: 15px; }
.bundle-file-input { display: none; }
.architecture-toolbar { min-height: 58px; padding: 10px 18px; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.architecture-title, .architecture-actions, .architecture-project-header, .snapshot-form { display: flex; align-items: center; gap: 10px; }
.resource-add-menu { position: relative; }
.resource-provider-options { position: absolute; top: calc(100% + 5px); right: 0; z-index: 12; min-width: 170px; padding: 4px; display: flex; flex-direction: column; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-panel); box-shadow: 0 8px 20px rgba(0, 0, 0, .22); }
.resource-provider-options button { min-height: 31px; display: flex; align-items: center; gap: 7px; border: 0; border-radius: 4px; background: transparent; color: var(--text); padding: 5px 7px; cursor: pointer; text-align: left; }
.resource-provider-options button:hover, .resource-provider-options button.active { background: var(--bg-hover); }
.resource-provider-options button:disabled { color: var(--text-dim); cursor: not-allowed; }
.resource-provider-options svg { width: 14px; height: 14px; }
.architecture-title > i { width: 22px; color: #2f81f7; }
.architecture-title span, .architecture-project-row > span:last-child, .snapshot-row > span:nth-child(2) { display: flex; flex-direction: column; min-width: 0; }
.architecture-title small, .architecture-project-row small, .snapshot-row small { color: var(--text-dim); }
.architecture-create { padding: 10px 18px; border-bottom: 1px solid var(--border); display: grid; grid-template-columns: minmax(180px, 0.8fr) minmax(240px, 1.5fr) auto auto; gap: 8px; }
.architecture-layout { flex: 1; min-height: 0; display: grid; grid-template-columns: 250px minmax(0, 1fr); }
.architecture-projects { border-right: 1px solid var(--border); padding: 10px; overflow: auto; }
.architecture-list-heading { padding: 5px 7px 10px; display: flex; justify-content: space-between; color: var(--text-dim); font-size: 12px; text-transform: uppercase; }
.architecture-project-row, .architecture-project-empty { width: 100%; border: 0; background: transparent; color: inherit; padding: 9px 8px; display: flex; align-items: center; gap: 9px; text-align: left; cursor: pointer; border-radius: 5px; }
.architecture-project-row:hover, .architecture-project-row.active { background: var(--bg-hover); }
.architecture-project-row.active { box-shadow: inset 2px 0 #2f81f7; }
.architecture-application-row { width: 100%; border: 0; background: transparent; color: inherit; padding: 8px; display: flex; align-items: center; gap: 9px; text-align: left; cursor: pointer; border-radius: 5px; }
.architecture-application-row:hover, .architecture-application-row.active { background: var(--bg-hover); }
.architecture-application-row.active { box-shadow: inset 2px 0 #3fb950; }
.architecture-application-row > span:last-child { display: flex; flex-direction: column; min-width: 0; }
.architecture-application-row small { color: var(--text-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 170px; }
.application-mark { width: 28px; height: 28px; flex: 0 0 28px; display: grid; place-items: center; background: #238636; color: white; border-radius: 5px; font-size: 10px; font-weight: 700; }
.project-mark { width: 32px; height: 32px; flex: 0 0 32px; display: grid; place-items: center; background: #1f6feb; color: white; border-radius: 5px; font-size: 11px; font-weight: 700; }
.architecture-project-row small { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 170px; }
.architecture-project-empty { color: var(--text-dim); justify-content: center; border: 1px dashed var(--border); }
.architecture-workspace { min-width: 0; padding: 18px; overflow: auto; }
.architecture-project-header { justify-content: space-between; align-items: flex-end; }
.architecture-project-header h2 { margin: 3px 0; font-size: 22px; letter-spacing: 0; }
.architecture-project-header p { margin: 0; color: var(--text-dim); }
.architecture-kicker { color: #2f81f7; font-size: 11px; text-transform: uppercase; font-weight: 700; }
.architecture-application-context { margin: 12px 0; padding: 9px 12px; display: flex; flex-wrap: wrap; gap: 18px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-panel); }
.architecture-application-context span { display: flex; flex-direction: column; gap: 2px; min-width: 70px; }
.architecture-application-context small { color: var(--text-dim); font-size: 10px; text-transform: uppercase; }
.architecture-application-context strong { font-size: 12px; }
.architecture-application-context .linked strong { color: #3fb950; }
.architecture-application-context .unlinked strong { color: #d29922; }
.snapshot-form .ctrl-input { width: 180px; }
.architecture-stats { margin: 18px 0 12px; display: grid; grid-template-columns: repeat(4, minmax(100px, 1fr)); border: 1px solid var(--border); border-radius: 6px; }
.architecture-stats div { padding: 12px 14px; display: flex; justify-content: space-between; align-items: baseline; border-right: 1px solid var(--border); }
.architecture-stats div:last-child { border-right: 0; }
.architecture-stats span { color: var(--text-dim); font-size: 12px; }
.architecture-stats strong { font-size: 20px; }
.sync-preview-panel { margin: 12px 0; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-panel); overflow: hidden; }
.sync-preview-panel header { min-height: 48px; padding: 9px 12px; display: flex; align-items: center; gap: 12px; border-bottom: 1px solid var(--border); background: var(--bg-hover); }
.sync-preview-panel header > span { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.sync-preview-panel header > span > i { display: none; }
.sync-preview-panel header small { color: var(--text-dim); }
.sync-preview-panel header > strong { margin-left: auto; color: #e3b341; }
.sync-preview-grid { display: grid; grid-template-columns: repeat(6, minmax(80px, 1fr)); border-bottom: 1px solid var(--border); }
.sync-preview-grid:last-child { border-bottom: 0; }
.sync-preview-grid div { min-height: 54px; padding: 9px 10px; display: flex; flex-direction: column; gap: 3px; border-right: 1px solid var(--border); }
.sync-preview-grid div:last-child { border-right: 0; }
.sync-preview-grid span { color: var(--text-dim); font-size: 11px; }
.sync-preview-grid strong { font-size: 18px; }
.relationship-grid { background: color-mix(in srgb, #2f81f7 4%, transparent); }
.sync-review-lists { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); border-bottom: 1px solid var(--border); }
.sync-review-lists details { padding: 8px 10px; border-right: 1px solid var(--border); }
.sync-review-lists summary { cursor: pointer; color: var(--text-dim); font-size: 12px; }
.sync-review-lists summary strong { color: var(--text); margin-left: 4px; }
.sync-review-item { display: block; padding: 5px 0 0 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.sync-preview-panel footer { min-height: 48px; padding: 8px 12px; display: flex; align-items: center; justify-content: space-between; gap: 10px; color: var(--text-dim); font-size: 12px; }
.stale-resource-list { margin: 12px 0; border: 1px solid #d29922; border-radius: 6px; }
.stale-resource-list > header, .stale-resource-row { min-height: 42px; padding: 8px 10px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--border); }
.stale-resource-list > header { justify-content: space-between; color: var(--text-dim); }
.stale-resource-row:last-child { border-bottom: 0; }
.stale-resource-row > span { display: flex; flex: 1; min-width: 0; flex-direction: column; }
.stale-resource-row small { color: var(--text-dim); }
.architecture-view-tabs { margin-bottom: 8px; display: flex; gap: 6px; }
.canvas-message, .architecture-empty { position: relative; min-height: 280px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; text-align: center; color: var(--text-dim); }
.canvas-message i, .architecture-empty i { width: 32px; height: 32px; color: #2f81f7; }
.canvas-message strong, .architecture-empty strong { color: var(--text); }
.architecture-empty.compact { min-height: 160px; }
.architecture-error { margin: 10px 18px 0; }
.snapshot-list, .change-list { margin-top: 14px; border-top: 1px solid var(--border); }
.snapshot-list > header, .snapshot-row, .change-list > header, .change-row { display: flex; align-items: center; gap: 12px; padding: 10px 4px; border-bottom: 1px solid var(--border); }
.snapshot-list > header, .change-list > header { justify-content: space-between; color: var(--text-dim); }
.snapshot-version { width: 38px; color: #2f81f7; font-weight: 700; }
.snapshot-row time, .change-row time { margin-left: auto; color: var(--text-dim); font-size: 12px; }
.architecture-diff { margin-top: 12px; min-height: 42px; padding: 8px 10px; display: flex; align-items: center; gap: 10px; border: 1px solid #2f81f7; border-radius: 5px; background: color-mix(in srgb, #2f81f7 10%, transparent); }
.architecture-diff span { display: flex; align-items: center; gap: 7px; }
.architecture-diff strong { margin-left: auto; }
.change-revision { width: 38px; color: var(--text-dim); font-family: monospace; }
.change-row > span:nth-child(2) { display: flex; flex-direction: column; }
.change-row small { color: var(--text-dim); }
@media (max-width: 850px) {
  .architecture-toolbar { flex-wrap: wrap; }
  .architecture-title small { display: none; }
  .architecture-actions { margin-left: auto; }
  .architecture-create { grid-template-columns: 1fr; }
  .architecture-layout { grid-template-columns: 1fr; }
  .architecture-projects { border-right: 0; border-bottom: 1px solid var(--border); max-height: 180px; }
  .architecture-project-header { align-items: flex-start; flex-direction: column; }
  .architecture-stats { grid-template-columns: repeat(2, 1fr); }
  .sync-preview-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .sync-preview-panel footer { align-items: flex-start; flex-direction: column; }
  .architecture-stats div:nth-child(2) { border-right: 0; }
  .architecture-stats div:nth-child(-n+2) { border-bottom: 1px solid var(--border); }
}
</style>
