<template>
  <div id="app">
    <!-- ── Header ─────────────────────────────────────────────────────────── -->
    <header class="header">
      <div class="header-left">
        <span class="app-logo"><i data-lucide="layers"></i> KuaDashboard</span>
        <div class="provider-tabs">
          <button :class="['provider-tab', { active: activeProvider === 'kubernetes' }]" @click="setProvider('kubernetes')">
            <i data-lucide="box"></i> Kubernetes
          </button>
          <button :class="['provider-tab', { active: activeProvider === 'aws' }]" @click="setProvider('aws')">
            <i data-lucide="cloud"></i> AWS
          </button>
          <button :class="['provider-tab', { active: activeProvider === 'gcp' }]" @click="setProvider('gcp')">
            <i data-lucide="cloud-cog"></i> GCP
          </button>
        </div>
        <template v-if="activeProvider === 'kubernetes'">
          <select class="ctrl-select" v-model="selectedContext" @change="switchContext">
            <option v-for="c in store.contexts" :key="c.name" :value="c.name">{{ c.name }}</option>
          </select>
          <select class="ctrl-select" v-model="store.namespace" @change="store.loadResources()">
            <option value="all">All namespaces</option>
            <option v-for="n in store.namespaces" :key="n" :value="n">{{ n }}</option>
          </select>
        </template>
        <template v-else-if="activeProvider === 'aws'">
          <select class="ctrl-select" v-model="awsProfileId" @change="onAwsProfileChange">
            <option value="">— AWS profile —</option>
            <optgroup v-if="envStore.awsProfiles.length" label="Stored profiles">
              <option v-for="p in envStore.awsProfiles" :key="p.id" :value="p.id">{{ p.name }}</option>
            </optgroup>
            <optgroup v-if="awsLocalProfiles.length" label="~/.aws/credentials">
              <option v-for="p in awsLocalProfiles" :key="`local:${p.name}`" :value="`local:${p.name}`">
                {{ p.name }}{{ p.region ? ` (${p.region})` : '' }}
              </option>
            </optgroup>
          </select>
        </template>
        <template v-else-if="activeProvider === 'gcp'">
          <select class="ctrl-select" v-model="gcpProfileId" @change="onGcpProfileChange">
            <option value="">— GCP profile —</option>
            <optgroup v-if="envStore.gcpProfiles.length" label="Stored profiles">
              <option v-for="p in envStore.gcpProfiles" :key="p.id" :value="p.id">{{ p.name }}</option>
            </optgroup>
            <optgroup v-if="gcpLocalConfigs.length" label="gcloud configs">
              <option v-for="c in gcpLocalConfigs" :key="`local:${c.name}`" :value="`local:${c.name}`">
                {{ c.name }}{{ c.project ? ` (${c.project})` : '' }}
              </option>
            </optgroup>
          </select>
        </template>
      </div>
      <div class="header-right">
        <template v-if="activeProvider === 'kubernetes'">
          <button class="btn sm" :class="{ primary: pfPanelVisible }" @click="pfPanelVisible = !pfPanelVisible" title="Port Forwards">
            <i data-lucide="cable"></i>
            <span v-if="pfStore.list.length" class="badge-count">{{ pfStore.list.length }}</span>
          </button>
          <button class="btn btn-icon" title="Import kubeconfig" @click="modals.kubeconfig = true"><i data-lucide="plus-circle"></i></button>
          <button class="btn btn-icon" title="Delete context" @click="deleteContextConfirm"><i data-lucide="trash-2"></i></button>
        </template>
        <button class="btn btn-icon" :class="{ primary: cloudView === 'envs' }" title="Env Manager" @click="toggleEnvManager"><i data-lucide="key-round"></i></button>
        <button class="btn btn-icon" title="Local Shell" @click="openLocalShell()"><i data-lucide="terminal"></i></button>
        <button class="btn btn-icon" @click="modals.help = true" title="Help"><i data-lucide="help-circle"></i></button>
        <button class="btn btn-icon btn-donate" @click="openSponsor" title="Apoyar el proyecto">
          <i data-lucide="heart"></i>
        </button>
      </div>
    </header>

    <!-- ── CLI tools notice ──────────────────────────────────────────────── -->
    <CliToolsNotice />

    <!-- ── Body ──────────────────────────────────────────────────────────── -->
    <div class="page-body">
      <div class="layout">
        <!-- Kubernetes sidebar -->
        <nav class="sidebar" v-if="activeProvider === 'kubernetes'">
          <div class="sidebar-section">
            <div class="sidebar-section-title">Workloads</div>
            <a v-for="r in ['pods','deployments','statefulsets','daemonsets']" :key="r"
               :class="['sidebar-item', { active: cloudView === null && store.resource === r }]"
               @click.prevent="setResource(r)">{{ LABELS[r] }}</a>
          </div>
          <div class="sidebar-section">
            <div class="sidebar-section-title">Network</div>
            <a v-for="r in ['services','ingresses']" :key="r"
               :class="['sidebar-item', { active: cloudView === null && store.resource === r }]"
               @click.prevent="setResource(r)">{{ LABELS[r] }}</a>
          </div>
          <div class="sidebar-section">
            <div class="sidebar-section-title">Config</div>
            <a v-for="r in ['configmaps','secrets']" :key="r"
               :class="['sidebar-item', { active: cloudView === null && store.resource === r }]"
               @click.prevent="setResource(r)">{{ LABELS[r] }}</a>
          </div>
          <div class="sidebar-section">
            <div class="sidebar-section-title">Storage</div>
            <a :class="['sidebar-item', { active: cloudView === null && store.resource === 'pvcs' }]"
               @click.prevent="setResource('pvcs')">PVC</a>
          </div>
          <div class="sidebar-section">
            <div class="sidebar-section-title">Cluster</div>
            <a v-for="r in ['nodes','events']" :key="r"
               :class="['sidebar-item', { active: cloudView === null && store.resource === r }]"
               @click.prevent="setResource(r)">{{ LABELS[r] }}</a>
          </div>
          <div class="sidebar-section">
            <div class="sidebar-section-title">Tools</div>
            <a :class="['sidebar-item', { active: cloudView === 'envs' }]"
               @click.prevent="setCloudView('envs')">Env Manager</a>
            <a class="sidebar-item"
               @click.prevent="openLocalShell()">Local Shell</a>
          </div>
        </nav>

        <!-- AWS sidebar -->
        <nav class="sidebar" v-if="activeProvider === 'aws'">
          <div class="sidebar-section">
            <div class="sidebar-section-title">Compute</div>
            <a v-for="r in AWS_SIDEBAR.compute" :key="r.id"
               :class="['sidebar-item', { active: awsTab === r.id }]"
               @click.prevent="awsTab = r.id">{{ r.label }}</a>
          </div>
          <div class="sidebar-section">
            <div class="sidebar-section-title">Containers</div>
            <a v-for="r in AWS_SIDEBAR.containers" :key="r.id"
               :class="['sidebar-item', { active: awsTab === r.id }]"
               @click.prevent="awsTab = r.id">{{ r.label }}</a>
          </div>
          <div class="sidebar-section">
            <div class="sidebar-section-title">Networking</div>
            <a v-for="r in AWS_SIDEBAR.networking" :key="r.id"
               :class="['sidebar-item', { active: awsTab === r.id }]"
               @click.prevent="awsTab = r.id">{{ r.label }}</a>
          </div>
          <div class="sidebar-section">
            <div class="sidebar-section-title">Storage</div>
            <a v-for="r in AWS_SIDEBAR.storage" :key="r.id"
               :class="['sidebar-item', { active: awsTab === r.id }]"
               @click.prevent="awsTab = r.id">{{ r.label }}</a>
          </div>
          <div class="sidebar-section">
            <div class="sidebar-section-title">Integration</div>
            <a v-for="r in AWS_SIDEBAR.integration" :key="r.id"
               :class="['sidebar-item', { active: awsTab === r.id }]"
               @click.prevent="awsTab = r.id">{{ r.label }}</a>
          </div>
        </nav>

        <!-- GCP sidebar -->
        <nav class="sidebar" v-if="activeProvider === 'gcp'">
          <div class="sidebar-section">
            <div class="sidebar-section-title">Compute</div>
            <a v-for="r in GCP_SIDEBAR.compute" :key="r.id"
               :class="['sidebar-item', { active: gcpTab === r.id }]"
               @click.prevent="gcpTab = r.id">{{ r.label }}</a>
          </div>
          <div class="sidebar-section">
            <div class="sidebar-section-title">Database</div>
            <a v-for="r in GCP_SIDEBAR.database" :key="r.id"
               :class="['sidebar-item', { active: gcpTab === r.id }]"
               @click.prevent="gcpTab = r.id">{{ r.label }}</a>
          </div>
          <div class="sidebar-section">
            <div class="sidebar-section-title">Storage</div>
            <a v-for="r in GCP_SIDEBAR.storage" :key="r.id"
               :class="['sidebar-item', { active: gcpTab === r.id }]"
               @click.prevent="gcpTab = r.id">{{ r.label }}</a>
          </div>
          <div class="sidebar-section">
            <div class="sidebar-section-title">Serverless</div>
            <a v-for="r in GCP_SIDEBAR.serverless" :key="r.id"
               :class="['sidebar-item', { active: gcpTab === r.id }]"
               @click.prevent="gcpTab = r.id">{{ r.label }}</a>
          </div>
          <div class="sidebar-section">
            <div class="sidebar-section-title">Messaging</div>
            <a v-for="r in GCP_SIDEBAR.messaging" :key="r.id"
               :class="['sidebar-item', { active: gcpTab === r.id }]"
               @click.prevent="gcpTab = r.id">{{ r.label }}</a>
          </div>
        </nav>

        <main class="main">
          <EnvManagerView v-if="cloudView === 'envs'" />
          <template v-else-if="activeProvider === 'kubernetes'">
            <ResourceTable @action="handleAction" />
          </template>
          <AwsView  v-else-if="activeProvider === 'aws'"  :active-service="awsTab" />
          <GcpView  v-else-if="activeProvider === 'gcp'"  :active-service="gcpTab" />
        </main>
      </div>

      <TerminalPanel @restartStream="restartStream" />
    </div>

    <PortForwardPanel :visible="pfPanelVisible" @close="pfPanelVisible = false" @add="openPfManual" />

    <div class="statusbar">
      <template v-if="activeProvider === 'kubernetes'">
        <span class="sb-item">{{ store.currentContext }}</span>
        <span class="sb-sep">|</span>
        <span class="sb-item">{{ store.namespace }}</span>
        <span class="sb-spacer"></span>
        <span class="sb-item">{{ store.rows.length }} items</span>
      </template>
      <template v-else>
        <span class="sb-item">{{ activeProvider === 'aws' ? 'Amazon Web Services' : 'Google Cloud Platform' }}</span>
        <span class="sb-spacer"></span>
      </template>
      <span class="sb-sep">|</span>
      <span class="sb-item">{{ clock }}</span>
    </div>

    <!-- Modals -->
    <DeleteModal      :show="modals.delete"        :message="modalData.deleteMsg"          @confirm="confirmDelete"        @close="modals.delete = false" />
    <DeleteModal      :show="modals.deleteContext"  :message="modalData.deleteContextMsg"   @confirm="confirmDeleteContext"  @close="modals.deleteContext = false" />
    <DeleteModal      :show="modals.drain"          :message="modalData.drainMsg"            @confirm="confirmDrain"          @close="modals.drain = false" />
    <ScaleModal       :show="modals.scale"          :name="modalData.scaleName"              :current="modalData.scaleCurrent" @confirm="confirmScale" @close="modals.scale = false" />
    <YamlModal        :show="modals.yaml"           :title="modalData.yamlTitle"             :resource-type="modalData.yamlType" :namespace="modalData.yamlNs" :name="modalData.yamlName" @close="modals.yaml = false" />
    <PortForwardModal :show="modals.portForward"    :namespace="modalData.pfNamespace"       :service="modalData.pfService" :ports="modalData.pfPorts" :label="modalData.pfLabel" :manual-mode="modalData.pfManual" @close="modals.portForward = false" @started="pfPanelVisible = true" />
    <KubeconfigModal  :show="modals.kubeconfig"                                              @close="modals.kubeconfig = false" />
    <HelpModal        :show="modals.help"                                                    @close="modals.help = false" />

    <DonationModal />
    <WelcomeModal />
    <UpdateNotice />
    <ToastContainer />
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, onUnmounted, nextTick } from 'vue'
import { createIcons, icons } from 'lucide'

import { useKubeStore }        from './stores/useKubeStore'
import { usePortForwardStore } from './stores/usePortForwardStore'
import { useTerminalStore }    from './stores/useTerminalStore'
import { useAwsStore }         from './stores/useAwsStore'
import { useGcpStore }         from './stores/useGcpStore'
import { useEnvStore }         from './stores/useEnvStore'
import { useTerminalStreams }   from './composables/useTerminalStreams'
import { useToast }            from './composables/useToast'
import { api }                 from './composables/useApi'

import ResourceTable    from './components/ResourceTable.vue'
import EnvManagerView  from './components/cloud/EnvManagerView.vue'
import GcpView         from './components/cloud/GcpView.vue'
import AwsView         from './components/cloud/AwsView.vue'
import CliToolsNotice  from './components/CliToolsNotice.vue'
import TerminalPanel    from './components/TerminalPanel.vue'
import PortForwardPanel from './components/PortForwardPanel.vue'
import DeleteModal      from './components/modals/DeleteModal.vue'
import ScaleModal       from './components/modals/ScaleModal.vue'
import YamlModal        from './components/modals/YamlModal.vue'
import PortForwardModal from './components/modals/PortForwardModal.vue'
import KubeconfigModal  from './components/modals/KubeconfigModal.vue'
import HelpModal        from './components/modals/HelpModal.vue'
import DonationModal    from './components/modals/DonationModal.vue'
import WelcomeModal     from './components/modals/WelcomeModal.vue'
import UpdateNotice     from './components/UpdateNotice.vue'
import ToastContainer   from './components/ToastContainer.vue'

const store     = useKubeStore()
const pfStore   = usePortForwardStore()
const termStore = useTerminalStore()
const awsStore  = useAwsStore()
const gcpStore  = useGcpStore()
const envStore  = useEnvStore()
const { startLogStream, startExecStream, startLocalStream } = useTerminalStreams()
const { toast } = useToast()

const LABELS = {
  pods: 'Pods', deployments: 'Deployments', statefulsets: 'StatefulSets',
  daemonsets: 'DaemonSets', services: 'Services', ingresses: 'Ingresses',
  configmaps: 'ConfigMaps', secrets: 'Secrets', pvcs: 'PVC',
  nodes: 'Nodes', events: 'Events',
}

const AWS_SIDEBAR = {
  compute:     [{ id: 'ec2', label: 'EC2' }, { id: 'lambda', label: 'Lambda' }],
  containers:  [{ id: 'ecs', label: 'ECS' }, { id: 'eks', label: 'EKS' }, { id: 'ecr', label: 'ECR' }],
  networking:  [{ id: 'vpc', label: 'VPC' }, { id: 'apigw', label: 'API Gateway' }],
  storage:     [{ id: 's3', label: 'S3' }],
  integration: [{ id: 'eventbridge', label: 'EventBridge' }, { id: 'stepfn', label: 'Step Functions' }],
}

const GCP_SIDEBAR = {
  compute:    [{ id: 'cloudrun', label: 'Cloud Run' }, { id: 'gke', label: 'GKE' }, { id: 'vms', label: 'Compute VMs' }],
  database:   [{ id: 'sql', label: 'Cloud SQL' }],
  storage:    [{ id: 'storage', label: 'Storage' }],
  serverless: [{ id: 'functions', label: 'Functions' }],
  messaging:  [{ id: 'pubsub', label: 'Pub/Sub' }],
}

const pfPanelVisible  = ref(false)
const activeProvider  = ref('kubernetes')  // 'kubernetes' | 'aws' | 'gcp'
const cloudView       = ref(null)   // null = Kubernetes view, 'envs' = Env Manager
const selectedContext = ref('')
const awsTab          = ref('ec2')
const gcpTab          = ref('cloudrun')
const clock           = ref('')
let clockTimer

const awsLocalProfiles = ref([])
const gcpLocalConfigs  = ref([])
const awsProfileId     = ref(awsStore.activeProfileId || '')
const gcpProfileId     = ref(gcpStore.activeProfileId || '')

const modals    = reactive({ delete: false, deleteContext: false, scale: false, yaml: false, portForward: false, kubeconfig: false, help: false, drain: false })
const modalData = reactive({
  deleteMsg: '', deletePending: null,
  deleteContextMsg: '', deleteContextName: '',
  scaleName: '', scaleCurrent: 0, scalePending: null,
  yamlTitle: '', yamlType: '', yamlNs: null, yamlName: '',
  pfNamespace: '', pfService: '', pfPorts: [], pfLabel: '', pfManual: false,
  drainMsg: '', drainPending: null,
})

async function setProvider(p) {
  activeProvider.value = p
  if (p === 'kubernetes' && cloudView.value !== 'envs') cloudView.value = null
  if (p === 'aws') { if (!awsLocalProfiles.value.length) loadAwsLocalProfiles() }
  if (p === 'gcp') { if (!gcpLocalConfigs.value.length) loadGcpLocalConfigs() }
  nextTick(() => createIcons({ icons }))
}

async function loadAwsLocalProfiles() {
  try { awsLocalProfiles.value = await api('GET', '/api/cloud/aws/local-profiles') } catch { /* ignore */ }
}
async function loadGcpLocalConfigs() {
  try { gcpLocalConfigs.value = await api('GET', '/api/cloud/gcp/gcloud-configs') } catch { /* ignore */ }
}
function onAwsProfileChange() {
  awsStore.setActiveProfile(awsProfileId.value || null)
}
function onGcpProfileChange() {
  gcpStore.setActiveProfile(gcpProfileId.value || null)
}
function toggleEnvManager() {
  cloudView.value = cloudView.value === 'envs' ? null : 'envs'
  nextTick(() => createIcons({ icons }))
}
function setResource(r)       { cloudView.value = null; store.resource = r; store.loadResources() }
function setCloudView(view)   { cloudView.value = view }

function openLocalShell() {
  const tab = termStore.openLocalTab()
  startLocalStream(tab)
}

async function switchContext() {
  try { await store.switchContext(selectedContext.value); toast('Context switched to ' + selectedContext.value, 'success') }
  catch (e) { toast(e.message, 'error') }
}

function deleteContextConfirm() {
  const name = selectedContext.value; if (!name) return
  modalData.deleteContextName = name
  modalData.deleteContextMsg  = `Eliminar contexto "${name}"? Esta accion no puede deshacerse.`
  modals.deleteContext = true
}
async function confirmDeleteContext() {
  modals.deleteContext = false
  try { await store.deleteContext(modalData.deleteContextName); toast(`Contexto eliminado`, 'success'); selectedContext.value = store.currentContext }
  catch (e) { toast(e.message, 'error') }
}

function handleAction(fn, args) {
  const h = {
    viewLogs:        ([ns, pod, c])         => openLogs(ns, pod, c),
    openExec:        ([ns, pod, c])         => openExec(ns, pod, c),
    viewYaml:        ([type, ns, name])     => openYaml(type, ns, name),
    confirmDelete:   ([type, ns, name])     => openDelete(type, ns, name),
    openScale:       ([type, ns, name, cur])=> openScale(type, ns, name, cur),
    openPortForward: ([ns, name, ports])    => openPf(ns, name, ports),
    restart:         ([type, ns, name])     => doRestart(type, ns, name),
    cordonNode:      ([name, cordon])       => doCordon(name, cordon),
    confirmDrain:    ([name])               => openDrain(name),
  }
  h[fn]?.(args)
}

function openLogs(ns, pod, containers) { const tab = termStore.openLogsTab(ns, pod, containers); startLogStream(tab, false) }
function openExec(ns, pod, containers) { const tab = termStore.openExecTab(ns, pod, containers); startExecStream(tab) }
function restartStream(tab, previous = false) { if (tab.type === 'exec') startExecStream(tab); else startLogStream(tab, previous) }

function openYaml(type, ns, name)    { Object.assign(modalData, { yamlTitle: `${type}/${name}`, yamlType: type, yamlNs: ns, yamlName: name }); modals.yaml = true }
function openDelete(type, ns, name)  { modalData.deletePending = { type, ns, name }; modalData.deleteMsg = `Delete ${type.slice(0,-1)} "${name}" in ns "${ns}"? Cannot be undone.`; modals.delete = true }
function openScale(type, ns, name, cur) { modalData.scalePending = { type, ns, name }; modalData.scaleName = name; modalData.scaleCurrent = cur; modals.scale = true }
function openPf(ns, name, ports)     { Object.assign(modalData, { pfNamespace: ns, pfService: name, pfPorts: ports||[], pfLabel: `${ns}/${name}`, pfManual: false }); modals.portForward = true }
function openPfManual()              { Object.assign(modalData, { pfNamespace: store.namespace||'default', pfService: '', pfPorts: [], pfLabel: 'Manual', pfManual: true }); modals.portForward = true }
function openDrain(name)             { modalData.drainPending = name; modalData.drainMsg = `Drain node "${name}"? It will be cordoned and pods evicted.`; modals.drain = true }

async function confirmDelete() {
  const { type, ns, name } = modalData.deletePending; modals.delete = false
  try {
    if (type === 'nodes') await api('DELETE', `/api/nodes/${name}`)
    else await api('DELETE', `/api/${ns}/${type}/${name}`)
    toast(`Deleted ${name}`, 'success'); setTimeout(() => store.loadResources(), 600)
  } catch (e) { toast(e.message, 'error') }
}
async function confirmScale(replicas) {
  const { type, ns, name } = modalData.scalePending; modals.scale = false
  try { await api('POST', `/api/${ns}/${type}/${name}/scale`, { replicas }); toast(`Scaled ${name} to ${replicas}`, 'success'); setTimeout(() => store.loadResources(), 800) }
  catch (e) { toast(e.message, 'error') }
}
async function doRestart(type, ns, name) {
  try { await api('POST', `/api/${ns}/${type}/${name}/restart`); toast(`Restarted ${name}`, 'success'); setTimeout(() => store.loadResources(), 1000) }
  catch (e) { toast(e.message, 'error') }
}
async function doCordon(name, cordon) {
  try { await api('POST', `/api/nodes/${name}/cordon`, { cordon }); toast(`Node ${name} ${cordon ? 'cordoned' : 'uncordoned'}`, 'success'); setTimeout(() => store.loadResources(), 800) }
  catch (e) { toast(e.message, 'error') }
}
async function confirmDrain() {
  const name = modalData.drainPending; modals.drain = false
  try { const r = await api('POST', `/api/nodes/${name}/drain`); toast(`Node ${name} drained. Evicted: ${r.evicted}`, r.failed ? 'warn' : 'success'); setTimeout(() => store.loadResources(), 800) }
  catch (e) { toast(e.message, 'error') }
}

function openSponsor() {
  const url = 'https://github.com/sponsors/lnavarrocarter/'
  if (window.kuaElectron?.openExternal) window.kuaElectron.openExternal(url)
  else window.open(url, '_blank')
}

function onKey(e) { if (e.key === 'Escape') Object.keys(modals).forEach(k => modals[k] = false) }

onMounted(async () => {
  clockTimer = setInterval(() => { clock.value = new Date().toLocaleTimeString() }, 1000)
  clock.value = new Date().toLocaleTimeString()
  await store.loadContexts()
  selectedContext.value = store.currentContext
  await store.loadNamespaces()
  await store.loadResources()
  await pfStore.autoRestore()
  envStore.fetchProfiles()
  loadAwsLocalProfiles()
  loadGcpLocalConfigs()
  document.addEventListener('keydown', onKey)
  nextTick(() => createIcons({ icons }))
})
onUnmounted(() => { clearInterval(clockTimer); document.removeEventListener('keydown', onKey) })
</script>
