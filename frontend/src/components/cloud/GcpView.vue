<template>
  <div class="cloud-view">

    <!-- Header -->
    <div class="cloud-view-header">
      <h2 class="cloud-view-title">Google Cloud Platform</h2>
      <div style="display:flex;gap:8px;align-items:center">
        <select v-model="selectedProfileId" class="ctrl-select" @change="onProfileChange">
          <option value="">--- Select GCP profile ---</option>
          <optgroup v-if="envStore.gcpProfiles.length" label="Stored profiles">
            <option v-for="p in envStore.gcpProfiles" :key="p.id" :value="p.id">{{ p.name }}</option>
          </optgroup>
          <optgroup v-if="localConfigs.length" label="gcloud configs">
            <option v-for="c in localConfigs" :key="`local:${c.name}`" :value="`local:${c.name}`">
              {{ c.name }}{{ c.project ? ` (${c.project})` : '' }}
            </option>
          </optgroup>
        </select>
        <button v-if="selectedProfileId" class="btn" @click="reloadActiveTab" :disabled="currentTab.loading">
          Refresh
        </button>
      </div>
    </div>

    <!-- No profile -->
    <div v-if="!selectedProfileId" class="empty-state">
      Select a GCP credential profile above to load resources.<br />
      <span class="text-dim">No profile? Go to <strong>Env Manager</strong> to create one.</span>
    </div>

    <template v-else>

      <!-- Tab bar -->
      <div class="aws-tab-bar">
        <button
          v-for="tab in TABS" :key="tab.id"
          :class="['aws-tab-btn', { active: activeTab === tab.id }]"
          @click="switchTab(tab.id)"
        >
          {{ tab.label }}
          <span v-if="tabCount(tab.id) > 0" class="tab-badge">{{ tabCount(tab.id) }}</span>
          <span v-else-if="tabHasError(tab.id)" class="tab-badge tab-badge-err">!</span>
        </button>
      </div>

      <!-- Toolbar -->
      <div class="aws-toolbar">
        <input v-model="search" class="ctrl-input aws-search" placeholder="Filter..." />
        <span class="text-dim" style="font-size:12px">
          <template v-if="currentTab.loading">Loading...</template>
          <template v-else>{{ filteredRows.length }} result{{ filteredRows.length !== 1 ? 's' : '' }}</template>
        </span>
      </div>

      <!-- Permission denied banner -->
      <div v-if="currentTab.error" class="api-disabled-banner">
        <span>{{ currentTab.error }}</span>
        <a v-if="currentTab.enableUrl" :href="currentTab.enableUrl" target="_blank"
           class="btn sm" style="margin-left:12px;white-space:nowrap;flex-shrink:0">
          Enable API
        </a>
      </div>

      <!-- Cloud Run -->
      <div v-show="activeTab === 'cloudrun'" class="tab-panel">
        <div v-if="gcpStore.tabs.cloudrun.loading" class="empty-row">Loading...</div>
        <div v-else-if="gcpStore.tabs.cloudrun.error && !filteredCloudRun.length" class="empty-row text-dim">API not available — see banner above.</div>
        <div v-else-if="!filteredCloudRun.length" class="empty-row">{{ search ? 'No matches.' : 'No Cloud Run services found.' }}</div>
        <table v-else class="cloud-table">
          <thead><tr><th>Name</th><th>Region</th><th>Status</th><th>Min</th><th>Max</th><th>Actions</th></tr></thead>
          <tbody>
            <tr v-for="svc in filteredCloudRun" :key="svc.name">
              <td><a :href="svc.uri" target="_blank" class="link">{{ svc.name }}</a></td>
              <td class="text-dim">{{ svc.region }}</td>
              <td><span :class="statusClass(svc.status)">{{ svc.status }}</span></td>
              <td>{{ svc.minInstances }}</td>
              <td>{{ svc.maxInstances ?? '--' }}</td>
              <td><div class="row-actions">
                <button class="btn sm" @click="startCloudRun(svc)">Start</button>
                <button class="btn sm danger" @click="stopCloudRun(svc)">Stop</button>
              </div></td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- GKE -->
      <div v-show="activeTab === 'gke'" class="tab-panel">
        <div v-if="gcpStore.tabs.gke.loading" class="empty-row">Loading...</div>
        <div v-else-if="gcpStore.tabs.gke.error && !filteredGke.length" class="empty-row text-dim">API not available — see banner above.</div>
        <div v-else-if="!filteredGke.length" class="empty-row">{{ search ? 'No matches.' : 'No GKE clusters found.' }}</div>
        <table v-else class="cloud-table">
          <thead><tr><th>Name</th><th>Location</th><th>Version</th><th>Nodes</th><th>Status</th></tr></thead>
          <tbody>
            <tr v-for="c in filteredGke" :key="c.name">
              <td>{{ c.name }}</td>
              <td class="text-dim">{{ c.location }}</td>
              <td class="text-dim">{{ c.version }}</td>
              <td>{{ c.nodeCount }}</td>
              <td><span :class="statusClass(c.status ? c.status.toLowerCase() : '')">{{ c.status }}</span></td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Compute VMs -->
      <div v-show="activeTab === 'vms'" class="tab-panel">
        <div v-if="gcpStore.tabs.vms.loading" class="empty-row">Loading...</div>
        <div v-else-if="gcpStore.tabs.vms.error && !filteredVms.length" class="empty-row text-dim">API not available — see banner above.</div>
        <div v-else-if="!filteredVms.length" class="empty-row">{{ search ? 'No matches.' : 'No Compute Engine VMs found.' }}</div>
        <table v-else class="cloud-table">
          <thead><tr><th>Name</th><th>Zone</th><th>Machine</th><th>Status</th><th>External IP</th><th>Actions</th></tr></thead>
          <tbody>
            <tr v-for="vm in filteredVms" :key="`${vm.zone}/${vm.name}`">
              <td>{{ vm.name }}</td>
              <td class="text-dim">{{ vm.zone }}</td>
              <td class="text-dim">{{ vm.machineType }}</td>
              <td><span :class="vmStatusClass(vm.status)">{{ vm.status }}</span></td>
              <td class="text-dim">{{ vm.externalIp || '--' }}</td>
              <td><div class="row-actions">
                <button class="btn sm" @click="startVM(vm)" :disabled="vm.status === 'RUNNING'">Start</button>
                <button class="btn sm danger" @click="stopVM(vm)" :disabled="vm.status === 'TERMINATED'">Stop</button>
              </div></td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Cloud SQL -->
      <div v-show="activeTab === 'sql'" class="tab-panel">
        <div v-if="gcpStore.tabs.sql.loading" class="empty-row">Loading...</div>
        <div v-else-if="gcpStore.tabs.sql.error && !filteredSql.length" class="empty-row text-dim">API not available — see banner above.</div>
        <div v-else-if="!filteredSql.length" class="empty-row">{{ search ? 'No matches.' : 'No Cloud SQL instances found.' }}</div>
        <table v-else class="cloud-table">
          <thead><tr><th>Name</th><th>Database</th><th>Region</th><th>Tier</th><th>IP</th><th>State</th><th>Actions</th></tr></thead>
          <tbody>
            <tr v-for="inst in filteredSql" :key="inst.name">
              <td>{{ inst.name }}</td>
              <td class="text-dim">{{ inst.database }}</td>
              <td class="text-dim">{{ inst.region }}</td>
              <td class="text-dim">{{ inst.tier }}</td>
              <td class="text-dim">{{ inst.ipAddress || '--' }}</td>
              <td><span :class="sqlStatusClass(inst.state)">{{ inst.state }}</span></td>
              <td><div class="row-actions">
                <button class="btn sm" @click="startSql(inst)" :disabled="inst.state === 'RUNNABLE'">Start</button>
                <button class="btn sm danger" @click="stopSql(inst)" :disabled="inst.state !== 'RUNNABLE'">Stop</button>
              </div></td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Cloud Storage -->
      <div v-show="activeTab === 'storage'" class="tab-panel">
        <div v-if="gcpStore.tabs.storage.loading" class="empty-row">Loading...</div>
        <div v-else-if="gcpStore.tabs.storage.error && !filteredStorage.length" class="empty-row text-dim">API not available — see banner above.</div>
        <div v-else-if="!filteredStorage.length" class="empty-row">{{ search ? 'No matches.' : 'No GCS buckets found.' }}</div>
        <table v-else class="cloud-table">
          <thead><tr><th>Name</th><th>Location</th><th>Storage Class</th><th>Public</th><th>Created</th></tr></thead>
          <tbody>
            <tr v-for="b in filteredStorage" :key="b.name">
              <td>{{ b.name }}</td>
              <td class="text-dim">{{ b.location }}</td>
              <td class="text-dim">{{ b.storageClass }}</td>
              <td><span :class="b.publicAccess ? 'status-warn' : 'status-ok'">{{ b.publicAccess ? 'Public' : 'Private' }}</span></td>
              <td class="text-dim">{{ b.created ? new Date(b.created).toLocaleDateString() : '--' }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Cloud Functions -->
      <div v-show="activeTab === 'functions'" class="tab-panel">
        <div v-if="gcpStore.tabs.functions.loading" class="empty-row">Loading...</div>
        <div v-else-if="gcpStore.tabs.functions.error && !filteredFunctions.length" class="empty-row text-dim">API not available — see banner above.</div>
        <div v-else-if="!filteredFunctions.length" class="empty-row">{{ search ? 'No matches.' : 'No Cloud Functions found.' }}</div>
        <table v-else class="cloud-table">
          <thead><tr><th>Name</th><th>Location</th><th>Runtime</th><th>Trigger</th><th>State</th><th>URL</th></tr></thead>
          <tbody>
            <tr v-for="fn in filteredFunctions" :key="fn.name">
              <td>{{ fn.name }}</td>
              <td class="text-dim">{{ fn.location }}</td>
              <td class="text-dim">{{ fn.runtime }}</td>
              <td class="text-dim">{{ fn.trigger }}</td>
              <td><span :class="fnStatusClass(fn.state)">{{ fn.state }}</span></td>
              <td>
                <a v-if="fn.url" :href="fn.url" target="_blank" class="link">Open</a>
                <span v-else class="text-dim">--</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Pub/Sub -->
      <div v-show="activeTab === 'pubsub'" class="tab-panel">
        <div v-if="gcpStore.tabs.pubsub.loading" class="empty-row">Loading...</div>
        <div v-else-if="gcpStore.tabs.pubsub.error && !filteredPubSub.length" class="empty-row text-dim">API not available — see banner above.</div>
        <div v-else-if="!filteredPubSub.length" class="empty-row">{{ search ? 'No matches.' : 'No Pub/Sub topics found.' }}</div>
        <table v-else class="cloud-table">
          <thead><tr><th>Topic Name</th><th>Labels</th></tr></thead>
          <tbody>
            <tr v-for="t in filteredPubSub" :key="t.name">
              <td>{{ t.name }}</td>
              <td class="text-dim">{{ t.labels || '--' }}</td>
            </tr>
          </tbody>
        </table>
      </div>

    </template>
  </div>
</template>

<script setup>
import { ref, computed, reactive, onMounted } from 'vue'
import { useEnvStore } from '../../stores/useEnvStore'
import { useGcpStore } from '../../stores/useGcpStore'
import { useToast }    from '../../composables/useToast'
import { useApi }      from '../../composables/useApi'

const envStore = useEnvStore()
const gcpStore = useGcpStore()
const { toast }    = useToast()
const { apiFetch } = useApi()

const selectedProfileId = ref(gcpStore.activeProfileId || '')
const localConfigs      = ref([])

onMounted(async () => {
  envStore.fetchProfiles()
  try { localConfigs.value = await apiFetch('/api/cloud/gcp/gcloud-configs') } catch { /* gcloud not installed */ }
  if (selectedProfileId.value) loadAllTabs()
})

function onProfileChange() {
  gcpStore.setActiveProfile(selectedProfileId.value || null)
  if (selectedProfileId.value) loadAllTabs()
}

const TABS = [
  { id: 'cloudrun',  label: 'Cloud Run' },
  { id: 'gke',       label: 'GKE' },
  { id: 'vms',       label: 'Compute VMs' },
  { id: 'sql',       label: 'Cloud SQL' },
  { id: 'storage',   label: 'Storage' },
  { id: 'functions', label: 'Functions' },
  { id: 'pubsub',    label: 'Pub/Sub' },
]

const activeTab = ref('cloudrun')
const loaded    = reactive({ cloudrun: false, gke: false, vms: false, sql: false, storage: false, functions: false, pubsub: false })
const search    = ref('')

const fetchMap = {
  cloudrun:  () => gcpStore.fetchCloudRunServices(),
  gke:       () => gcpStore.fetchGkeClusters(),
  vms:       () => gcpStore.fetchVMs(),
  sql:       () => gcpStore.fetchSqlInstances(),
  storage:   () => gcpStore.fetchBuckets(),
  functions: () => gcpStore.fetchFunctions(),
  pubsub:    () => gcpStore.fetchPubSubTopics(),
}

async function loadTab(id) {
  if (loaded[id]) return
  await fetchMap[id]?.()
  loaded[id] = true
}

async function reloadActiveTab() {
  loaded[activeTab.value] = false
  search.value = ''
  await loadTab(activeTab.value)
}

async function loadAllTabs() {
  gcpStore.setActiveProfile(selectedProfileId.value)
  Object.keys(loaded).forEach(k => { loaded[k] = false })
  await Promise.allSettled(TABS.map(t => loadTab(t.id)))
}

function switchTab(id) {
  activeTab.value = id
  search.value = ''
  loadTab(id)
}

const currentTab = computed(() => gcpStore.tabs[activeTab.value])
function tabCount(id)    { return gcpStore.tabs[id]?.data?.length ?? 0 }
function tabHasError(id) { return !!gcpStore.tabs[id]?.error }

function filterRows(rows) {
  if (!search.value) return rows
  const q = search.value.toLowerCase()
  return rows.filter(row => Object.values(row).some(v => String(v ?? '').toLowerCase().includes(q)))
}

const filteredCloudRun  = computed(() => filterRows(gcpStore.tabs.cloudrun.data))
const filteredGke       = computed(() => filterRows(gcpStore.tabs.gke.data))
const filteredVms       = computed(() => filterRows(gcpStore.tabs.vms.data))
const filteredSql       = computed(() => filterRows(gcpStore.tabs.sql.data))
const filteredStorage   = computed(() => filterRows(gcpStore.tabs.storage.data))
const filteredFunctions = computed(() => filterRows(gcpStore.tabs.functions.data))
const filteredPubSub    = computed(() => filterRows(gcpStore.tabs.pubsub.data))

const filteredRows = computed(() => {
  if (activeTab.value === 'cloudrun')  return filteredCloudRun.value
  if (activeTab.value === 'gke')       return filteredGke.value
  if (activeTab.value === 'vms')       return filteredVms.value
  if (activeTab.value === 'sql')       return filteredSql.value
  if (activeTab.value === 'storage')   return filteredStorage.value
  if (activeTab.value === 'functions') return filteredFunctions.value
  if (activeTab.value === 'pubsub')    return filteredPubSub.value
  return []
})

async function startCloudRun(svc) {
  const res = await gcpStore.startCloudRunService(svc.region, svc.name)
  if (res) { toast(`Started ${svc.name}`, 'success'); loaded.cloudrun = false; loadTab('cloudrun') }
  else      toast(gcpStore.tabs.cloudrun.error || 'Error', 'error')
}
async function stopCloudRun(svc) {
  const res = await gcpStore.stopCloudRunService(svc.region, svc.name)
  if (res) { toast(`Stopped ${svc.name}`, 'success'); loaded.cloudrun = false; loadTab('cloudrun') }
  else      toast(gcpStore.tabs.cloudrun.error || 'Error', 'error')
}
async function startVM(vm) {
  const res = await gcpStore.startVM(vm.zone, vm.name)
  if (res) { toast(`Starting ${vm.name}`, 'success'); setTimeout(() => { loaded.vms = false; loadTab('vms') }, 3000) }
  else      toast(gcpStore.tabs.vms.error || 'Error', 'error')
}
async function stopVM(vm) {
  const res = await gcpStore.stopVM(vm.zone, vm.name)
  if (res) { toast(`Stopping ${vm.name}`, 'success'); setTimeout(() => { loaded.vms = false; loadTab('vms') }, 3000) }
  else      toast(gcpStore.tabs.vms.error || 'Error', 'error')
}
async function startSql(inst) {
  const res = await gcpStore.startSqlInstance(inst.name)
  if (res) { toast(`Starting ${inst.name}`, 'success'); loaded.sql = false; loadTab('sql') }
  else      toast(gcpStore.tabs.sql.error || 'Error', 'error')
}
async function stopSql(inst) {
  const res = await gcpStore.stopSqlInstance(inst.name)
  if (res) { toast(`Stopping ${inst.name}`, 'success'); loaded.sql = false; loadTab('sql') }
  else      toast(gcpStore.tabs.sql.error || 'Error', 'error')
}

function statusClass(s) {
  if (!s) return ''
  const l = s.toLowerCase()
  if (l === 'ready' || l === 'running') return 'status-ok'
  if (l === 'reconciling')              return 'status-warn'
  return 'status-err'
}
function vmStatusClass(s) {
  if (!s) return ''
  return s === 'RUNNING' ? 'status-ok' : s === 'STAGING' ? 'status-warn' : 'status-err'
}
function sqlStatusClass(s) {
  if (!s) return ''
  return s === 'RUNNABLE' ? 'status-ok' : s === 'SUSPENDED' ? 'status-warn' : 'status-err'
}
function fnStatusClass(s) {
  if (!s) return ''
  return s === 'ACTIVE' ? 'status-ok' : s === 'DEPLOY_IN_PROGRESS' ? 'status-warn' : 'status-err'
}
</script>

<style scoped>
.api-disabled-banner {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 8px 0;
  padding: 10px 14px;
  background: rgba(239, 68, 68, 0.12);
  border: 1px solid rgba(239, 68, 68, 0.4);
  border-radius: 6px;
  font-size: 12px;
  color: #fca5a5;
  flex-wrap: wrap;
  word-break: break-word;
}
.tab-badge-err {
  background: rgba(239, 68, 68, 0.75) !important;
}
.tab-panel { margin-top: 8px; }
.row-actions { display: flex; gap: 4px; }
</style>
