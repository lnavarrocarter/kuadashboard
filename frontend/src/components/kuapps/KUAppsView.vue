<template>
  <div class="kuapps-view">
    <div v-if="!compactNavigation" class="kuapps-tabs" role="tablist" aria-label="KUApps views">
      <button
        :class="['kuapps-tab', { active: activeView === 'architecture' }]"
        role="tab"
        :aria-selected="activeView === 'architecture'"
        @click="selectView('architecture')"
      >
        <i data-lucide="network"></i>
        <span><strong>Architecture</strong><small>Application resources and relationships</small></span>
      </button>
      <button
        :class="['kuapps-tab', { active: activeView === 'observability' }]"
        role="tab"
        :aria-selected="activeView === 'observability'"
        @click="selectView('observability')"
      >
        <i data-lucide="square-activity"></i>
        <span><strong>Observability</strong><small>Health, metrics and traces</small></span>
      </button>
    </div>

    <div class="kuapps-application-shell">
      <aside class="kuapps-applications">
        <div class="kuapps-list-heading">
          <span>Applications</span><strong>{{ applications.length }}</strong>
          <button class="btn btn-icon" title="Create application" @click="openObservabilitySetup"><i data-lucide="plus"></i></button>
          <button class="btn btn-icon" title="Refresh applications" :disabled="catalogLoading" @click="loadCatalog"><i data-lucide="refresh-cw"></i></button>
        </div>
        <div v-for="application in applications" :key="application.id" class="kuapps-application-item">
          <button
            :class="['kuapps-application-row', { active: selectedApplicationId === application.id }]"
            @click="selectApplication(application)"
          >
            <span class="application-mark">{{ application.name.slice(0, 2).toUpperCase() }}</span>
            <span><strong>{{ application.name }}</strong><small>{{ application.provider.toUpperCase() }}<template v-if="application.environment"> · {{ application.environment }}</template></small></span>
            <b>{{ application.architectureProjectIds?.length || (application.architectureProjectId ? 1 : 0) }}</b>
          </button>
          <div v-if="activeView === 'architecture' && selectedApplicationId === application.id" class="kuapps-project-sublist">
            <span class="kuapps-sublevel-heading">Projects</span>
            <button
              v-for="project in applicationProjects"
              :key="project.id"
              :class="['kuapps-project-row', { active: architectureStore.selectedProjectId === project.id }]"
              @click="selectProject(project)"
            >
              <span class="project-mark">{{ project.name.slice(0, 2).toUpperCase() }}</span>
              <span><strong>{{ project.name }}</strong><small>{{ project.description || 'Application architecture' }}</small></span>
            </button>
            <span v-if="!applicationProjects.length && !architectureStore.loading" class="kuapps-empty-projects">No architecture projects yet</span>
          </div>
        </div>
        <div v-if="catalogLoading" class="kuapps-empty-list">Loading applications…</div>
        <template v-else-if="!applications.length">
          <div class="kuapps-empty-list">No Applications configured.</div>
          <button class="btn sm kuapps-create-btn" @click="openObservabilitySetup"><i data-lucide="plus"></i> Create application</button>
        </template>
      </aside>

      <main class="kuapps-workspace">
        <div v-if="!selectedApplication && activeView !== 'observability'" class="kuapps-empty-state">
          <i data-lucide="boxes"></i>
          <strong>Select an Application</strong>
          <span>Architecture, observability, metrics and provider logs will open in this context.</span>
          <button class="btn sm primary" @click="openObservabilitySetup"><i data-lucide="plus"></i> Create application</button>
        </div>

        <template v-else>
          <div v-if="selectedApplication" class="kuapps-application-header">
            <div>
              <span class="kuapps-kicker">KUApps / Application</span>
              <h2>{{ selectedApplication.name }}</h2>
              <small>{{ selectedApplication.provider.toUpperCase() }}<template v-if="selectedApplication.environment"> · {{ selectedApplication.environment }}</template><template v-if="selectedApplication.team"> · {{ selectedApplication.team }}</template></small>
            </div>
            <div class="kuapps-associations">
              <span><strong>{{ architectureCount }}</strong><small>{{ architectureCount === 1 ? 'Architecture' : 'Architectures' }}</small></span>
              <span><strong>{{ selectedApplication.provider === 'aws' ? 'CloudWatch' : selectedApplication.provider === 'gcp' ? 'Cloud Monitoring / Logging' : selectedApplication.provider === 'kubernetes' ? 'metrics.k8s.io / Logs' : 'Provider metrics / Logs' }}</strong><small>Operational sources</small></span>
            </div>
          </div>

          <ArchitectureView
            v-if="activeView === 'architecture'"
            ref="architectureRef"
            :profile-id="profileId"
            :application-id="applicationId"
            :project-id="projectId"
            :hide-application-list="true"
            @open-observability="openObservability"
            @open-observability-setup="openObservabilitySetup"
            @application-context="forwardApplicationContext"
            @open-kubernetes-logs="$emit('open-kubernetes-logs', $event)"
            @open-kubernetes-detail="$emit('open-kubernetes-detail', $event)"
            @open-kubernetes-pods="$emit('open-kubernetes-pods', $event)"
            @open-aws-resource="$emit('open-aws-resource', $event)"
            @open-aws-logs="$emit('open-aws-logs', $event)"
          />

          <ApmObservabilityView
            v-else
            ref="observabilityRef"
            :provider="apmProvider"
            :profile-id="apmProfileId"
            :application-id="applicationId"
            :hide-application-list="true"
            :focus-resource="focusResource"
            @open-architecture="openArchitecture"
            @application-context="forwardApplicationContext"
            @open-kubernetes-logs="$emit('open-kubernetes-logs', $event)"
          />
        </template>
      </main>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { createIcons, icons } from 'lucide'
import ArchitectureView from '../architecture/ArchitectureView.vue'
import ApmObservabilityView from '../cloud/apm/ApmObservabilityView.vue'
import { useArchitectureStore } from '../../stores/useArchitectureStore'

const props = defineProps({
  activeView: { type: String, default: 'architecture' },
  profileId: { type: String, default: '' },
  projectId: { type: String, default: '' },
  applicationId: { type: String, default: '' },
  observabilityProvider: { type: String, default: 'generic' },
  observabilityProfileId: { type: String, default: 'local' },
  focusResource: { type: Object, default: null },
  compactNavigation: { type: Boolean, default: false },
})
const emit = defineEmits([
  'update-view', 'open-observability', 'open-architecture', 'application-context',
  'open-kubernetes-logs', 'open-kubernetes-detail', 'open-kubernetes-pods',
  'open-aws-resource', 'open-aws-logs',
])

const architectureRef = ref(null)
const observabilityRef = ref(null)
const architectureStore = useArchitectureStore()
const catalogLoading = ref(false)
const localApplicationId = ref(props.applicationId)
const activeView = computed(() => props.activeView === 'observability' ? 'observability' : 'architecture')
const applications = computed(() => architectureStore.applications || [])
const selectedApplicationId = computed(() => props.applicationId || localApplicationId.value)
const selectedApplication = computed(() => applications.value.find(application => application.id === selectedApplicationId.value) || null)
const applicationProjects = computed(() => architectureStore.projects || [])
const architectureCount = computed(() => selectedApplication.value?.architectureProjectIds?.length
  || (selectedApplication.value?.architectureProjectId ? 1 : 0))
const apmProvider = computed(() => ['aws', 'gcp', 'vercel', 'generic'].includes(props.observabilityProvider)
  ? props.observabilityProvider
  : 'generic')
const apmProfileId = computed(() => props.observabilityProfileId || (apmProvider.value === 'generic' ? 'local' : ''))

function selectView(view) {
  emit('update-view', view)
  nextTick(() => createIcons({ icons }))
}

async function loadCatalog() {
  catalogLoading.value = true
  try { await architectureStore.loadApplicationCatalog() } finally { catalogLoading.value = false }
  nextTick(() => createIcons({ icons }))
}

function selectApplication(application) {
  localApplicationId.value = application.id
  emit('application-context', application)
  nextTick(() => createIcons({ icons }))
}

function selectProject(project) {
  architectureStore.selectProject(project.id)
  nextTick(() => createIcons({ icons }))
}

function openObservability(application, focus = null) {
  emit('open-observability', application, focus)
  selectView('observability')
}

function openObservabilitySetup() {
  selectView('observability')
  nextTick(() => observabilityRef.value?.openSetup?.())
}

function openArchitecture(payload) {
  emit('open-architecture', payload)
  selectView('architecture')
}

function forwardApplicationContext(application) {
  emit('application-context', application)
  if (application?.id && !applications.value.some(a => a.id === application.id)) loadCatalog()
}

async function reloadActiveTab(options = {}) {
  if (activeView.value === 'observability') return observabilityRef.value?.refreshLocal?.(options)
  return architectureRef.value?.refreshWorkspace?.(options)
}

watch(() => props.applicationId, value => { localApplicationId.value = value || '' })
watch(() => [props.activeView, props.observabilityProvider], () => nextTick(() => createIcons({ icons })))
onMounted(async () => { await loadCatalog(); createIcons({ icons }) })

defineExpose({ reloadActiveTab, openObservabilitySetup })
</script>

<style scoped>
.kuapps-view { height: 100%; min-height: 0; display: flex; flex-direction: column; background: var(--bg); color: var(--text); }
.kuapps-tabs { display: flex; align-items: stretch; gap: 1px; padding: 8px 12px 0; border-bottom: 1px solid var(--border); background: var(--surface); }
.kuapps-tab { min-width: 190px; display: flex; align-items: center; gap: 9px; padding: 8px 12px 9px; border: 0; border-bottom: 2px solid transparent; background: transparent; color: var(--text-dim); text-align: left; cursor: pointer; }
.kuapps-tab:hover, .kuapps-tab.active { color: var(--text); background: var(--bg-hover); }
.kuapps-tab.active { border-bottom-color: var(--accent); }
.kuapps-tab > svg { width: 17px; color: var(--accent); }
.kuapps-tab span { display: flex; flex-direction: column; gap: 2px; }
.kuapps-tab small { color: var(--text-dim); font-size: 9px; }
.kuapps-application-shell { flex: 1; min-height: 0; display: grid; grid-template-columns: 225px minmax(0, 1fr); }
.kuapps-applications { min-height: 0; overflow: auto; padding: 9px; border-right: 1px solid var(--border); background: var(--surface); }
.kuapps-list-heading { display: flex; align-items: center; gap: 7px; padding: 5px 7px 10px; color: var(--text-dim); font-size: 11px; text-transform: uppercase; }
.kuapps-list-heading strong { color: var(--text); }
.kuapps-list-heading button { margin-left: auto; }
.kuapps-list-heading svg { width: 13px; }
.kuapps-application-row { width: 100%; display: grid; grid-template-columns: 29px minmax(0, 1fr) auto; align-items: center; gap: 8px; padding: 8px 7px; border: 0; border-radius: 6px; background: transparent; color: var(--text); text-align: left; cursor: pointer; }
.kuapps-application-row:hover, .kuapps-application-row.active { background: var(--bg-hover); }
.kuapps-application-row.active { box-shadow: inset 2px 0 var(--accent); }
.kuapps-application-row > span:nth-child(2) { display: flex; flex-direction: column; min-width: 0; gap: 2px; }
.kuapps-application-row strong, .kuapps-application-row small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.kuapps-application-row small, .kuapps-application-row b { color: var(--text-dim); font-size: 9px; }
.kuapps-application-item { display: flex; flex-direction: column; gap: 3px; }
.kuapps-project-sublist { margin: 0 0 7px 16px; padding: 6px 0 0 8px; display: flex; flex-direction: column; gap: 3px; border-left: 1px solid var(--border); }
.kuapps-sublevel-heading { padding: 0 6px 2px; color: var(--text-dim); font-size: 9px; font-weight: 700; text-transform: uppercase; }
.kuapps-project-row { width: 100%; min-height: 31px; padding: 5px 6px; display: grid; grid-template-columns: 22px minmax(0, 1fr); align-items: center; gap: 6px; border: 0; border-radius: 5px; background: transparent; color: var(--text); text-align: left; cursor: pointer; }
.kuapps-project-row:hover, .kuapps-project-row.active { background: var(--bg-hover); }
.kuapps-project-row.active { box-shadow: inset 2px 0 #2f81f7; }
.kuapps-project-row .project-mark { width: 22px; height: 22px; font-size: 8px; border-radius: 4px; }
.kuapps-project-row > span:last-child { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.kuapps-project-row strong, .kuapps-project-row small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.kuapps-project-row small, .kuapps-empty-projects { color: var(--text-dim); font-size: 9px; }
.kuapps-empty-projects { padding: 4px 6px 6px; }
.kuapps-empty-list { padding: 24px 8px 8px; color: var(--text-dim); font-size: 10px; text-align: center; }
.kuapps-create-btn { display: flex; margin: 0 auto 16px; }
.kuapps-workspace { min-width: 0; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
.kuapps-application-header { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 18px; border-bottom: 1px solid var(--border); background: var(--bg); }
.kuapps-application-header h2 { margin: 2px 0; font-size: 18px; }
.kuapps-application-header small { color: var(--text-dim); }
.kuapps-kicker { color: var(--accent); font-size: 9px; text-transform: uppercase; }
.kuapps-associations { display: flex; gap: 18px; }
.kuapps-associations span { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; }
.kuapps-associations small { font-size: 9px; }
.kuapps-empty-state { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; color: var(--text-dim); text-align: center; }
.kuapps-empty-state svg { width: 34px; color: var(--accent); }
.kuapps-empty-state strong { color: var(--text); }
.kuapps-workspace > :deep(.architecture-view), .kuapps-workspace > :deep(.apm-view) { flex: 1; min-height: 0; }
@media (max-width: 700px) { .kuapps-tabs { overflow-x: auto; }.kuapps-tab { min-width: 165px; } }
@media (max-width: 760px) { .kuapps-application-shell { grid-template-columns: 175px minmax(0, 1fr); }.kuapps-application-header { align-items: flex-start; flex-direction: column; }.kuapps-associations { width: 100%; justify-content: space-between; }.kuapps-associations span { align-items: flex-start; } }
</style>
