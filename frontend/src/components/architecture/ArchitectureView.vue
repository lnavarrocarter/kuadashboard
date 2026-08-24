<template>
  <div class="architecture-view">
    <header class="architecture-toolbar">
      <div class="architecture-title">
        <i data-lucide="network"></i>
        <span><strong>Architecture</strong><small>Evidence-backed application diagrams</small></span>
      </div>
      <div class="architecture-actions">
        <button class="btn sm btn-icon" title="Refresh projects" :disabled="store.loading || !profileId" @click="store.loadProjects()">
          <i data-lucide="refresh-cw"></i>
        </button>
        <button v-if="store.selectedProject" class="btn sm" :disabled="store.loading" @click="showDiscovery = !showDiscovery">
          <i data-lucide="scan-search"></i> Discover AWS
        </button>
        <button class="btn sm primary" :disabled="!profileId" @click="creatingProject = true">
          <i data-lucide="plus"></i> New project
        </button>
      </div>
    </header>

    <div v-if="!profileId" class="architecture-empty">
      <i data-lucide="cloud-cog"></i>
      <strong>Select an AWS profile</strong>
      <span>Architecture projects are isolated by cloud profile.</span>
    </div>

    <template v-else>
      <div v-if="store.error" class="alert-error architecture-error">{{ store.error }}</div>
      <form v-if="creatingProject" class="architecture-create" @submit.prevent="submitProject">
        <input v-model.trim="projectDraft.name" class="ctrl-input" required maxlength="120" placeholder="Project name" />
        <input v-model.trim="projectDraft.description" class="ctrl-input" maxlength="500" placeholder="Description" />
        <button class="btn sm primary" :disabled="store.saving"><i data-lucide="check"></i> Create</button>
        <button type="button" class="btn sm" @click="creatingProject = false">Cancel</button>
      </form>

      <div class="architecture-layout">
        <aside class="architecture-projects">
          <div class="architecture-list-heading"><span>Projects</span><strong>{{ store.projects.length }}</strong></div>
          <button
            v-for="project in store.projects"
            :key="project.id"
            :class="['architecture-project-row', { active: store.selectedProjectId === project.id }]"
            @click="store.selectProject(project.id)"
          >
            <span class="project-mark">{{ project.name.slice(0, 2).toUpperCase() }}</span>
            <span><strong>{{ project.name }}</strong><small>{{ project.description || 'AWS architecture' }}</small></span>
          </button>
          <button v-if="!store.projects.length && !store.loading" class="architecture-project-empty" @click="creatingProject = true">
            <i data-lucide="plus"></i> Create the first project
          </button>
        </aside>

        <main class="architecture-workspace">
          <div v-if="store.loading" class="architecture-empty compact">Loading architecture...</div>
          <div v-else-if="!store.selectedProject" class="architecture-empty">
            <i data-lucide="waypoints"></i>
            <strong>No architecture selected</strong>
            <span>Create a project to start collecting scopes, sources and evidence.</span>
          </div>
          <template v-else>
            <section class="architecture-project-header">
              <div>
                <span class="architecture-kicker">AWS / revision {{ store.graph?.revision ?? 0 }}</span>
                <h2>{{ store.selectedProject.name }}</h2>
                <p>{{ store.selectedProject.description || 'Application architecture workspace' }}</p>
              </div>
              <form class="snapshot-form" @submit.prevent="submitSnapshot">
                <input v-model.trim="snapshotName" class="ctrl-input" required maxlength="120" placeholder="Snapshot name" />
                <button class="btn sm" :disabled="store.saving"><i data-lucide="camera"></i> Snapshot</button>
              </form>
            </section>

            <section class="architecture-stats">
              <div><span>Nodes</span><strong>{{ store.graph?.document.nodes.length || 0 }}</strong></div>
              <div><span>Relations</span><strong>{{ store.graph?.document.edges.length || 0 }}</strong></div>
              <div><span>Sources</span><strong>{{ store.graph?.document.sources.length || 0 }}</strong></div>
              <div><span>Snapshots</span><strong>{{ store.snapshots.length }}</strong></div>
            </section>

            <ArchitectureDiscoveryPanel
              v-if="showDiscovery"
              @close="showDiscovery = false"
              @imported="showDiscovery = false"
            />

            <div class="architecture-view-tabs">
              <button :class="['btn', 'sm', { primary: activeView === 'routes' }]" @click="activeView = 'routes'">
                <i data-lucide="route"></i> Routes
              </button>
              <button :class="['btn', 'sm', { primary: activeView === 'canvas' }]" @click="activeView = 'canvas'">
                <i data-lucide="network"></i> Canvas
              </button>
            </div>

            <ArchitectureRoutes
              v-if="store.graph && activeView === 'routes'"
              :graph="store.graph"
              @inspect-workflow="openWorkflow"
            />

            <ArchitectureCanvas
              v-if="store.graph && activeView === 'canvas'"
              :graph="store.graph"
              :saving="store.saving"
              @operation="applyCanvasOperation"
              @inspect-workflow="openWorkflow"
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
import { nextTick, onMounted, reactive, ref, watch } from 'vue'
import { createIcons, icons } from 'lucide'
import { useArchitectureStore } from '../../stores/useArchitectureStore'
import { useAwsStore } from '../../stores/useAwsStore'
import StepFnDetail from '../StepFnDetail.vue'
import ArchitectureCanvas from './ArchitectureCanvas.vue'
import ArchitectureDiscoveryPanel from './ArchitectureDiscoveryPanel.vue'
import ArchitectureRoutes from './ArchitectureRoutes.vue'

const props = defineProps({ profileId: { type: String, default: '' } })
const store = useArchitectureStore()
const awsStore = useAwsStore()
const creatingProject = ref(false)
const projectDraft = reactive({ name: '', description: '' })
const snapshotName = ref('')
const showDiscovery = ref(false)
const activeView = ref('routes')
const selectedWorkflow = ref(null)

async function loadProfile(profileId) {
  showDiscovery.value = false
  selectedWorkflow.value = null
  store.setActiveProfile(profileId || null)
  awsStore.setActiveProfile(profileId || null)
  if (profileId) await store.loadProjects()
  nextTick(() => createIcons({ icons }))
}

async function submitProject() {
  const project = await store.createProject(projectDraft)
  if (!project) return
  projectDraft.name = ''
  projectDraft.description = ''
  creatingProject.value = false
  nextTick(() => createIcons({ icons }))
}

async function submitSnapshot() {
  const snapshot = await store.createSnapshot({ name: snapshotName.value })
  if (snapshot) snapshotName.value = ''
  nextTick(() => createIcons({ icons }))
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

function changeLabel(type) {
  return String(type || '').split('.').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
}

watch(() => props.profileId, loadProfile)
onMounted(() => loadProfile(props.profileId))
</script>

<style scoped>
.architecture-view { min-height: 100%; display: flex; flex-direction: column; color: var(--text); }
.architecture-toolbar { min-height: 58px; padding: 10px 18px; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.architecture-title, .architecture-actions, .architecture-project-header, .snapshot-form { display: flex; align-items: center; gap: 10px; }
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
.project-mark { width: 32px; height: 32px; flex: 0 0 32px; display: grid; place-items: center; background: #1f6feb; color: white; border-radius: 5px; font-size: 11px; font-weight: 700; }
.architecture-project-row small { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 170px; }
.architecture-project-empty { color: var(--text-dim); justify-content: center; border: 1px dashed var(--border); }
.architecture-workspace { min-width: 0; padding: 18px; overflow: auto; }
.architecture-project-header { justify-content: space-between; align-items: flex-end; }
.architecture-project-header h2 { margin: 3px 0; font-size: 22px; letter-spacing: 0; }
.architecture-project-header p { margin: 0; color: var(--text-dim); }
.architecture-kicker { color: #2f81f7; font-size: 11px; text-transform: uppercase; font-weight: 700; }
.snapshot-form .ctrl-input { width: 180px; }
.architecture-stats { margin: 18px 0 12px; display: grid; grid-template-columns: repeat(4, minmax(100px, 1fr)); border: 1px solid var(--border); border-radius: 6px; }
.architecture-stats div { padding: 12px 14px; display: flex; justify-content: space-between; align-items: baseline; border-right: 1px solid var(--border); }
.architecture-stats div:last-child { border-right: 0; }
.architecture-stats span { color: var(--text-dim); font-size: 12px; }
.architecture-stats strong { font-size: 20px; }
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
  .architecture-stats div:nth-child(2) { border-right: 0; }
  .architecture-stats div:nth-child(-n+2) { border-bottom: 1px solid var(--border); }
}
</style>