<template>
  <div id="app">
    <!-- ── Header ─────────────────────────────────────────────────────────── -->
    <header class="header">
      <div class="header-left">
        <span class="app-logo" title="Know Unified Administration">
          <svg width="28" height="28" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" style="border-radius:5px;flex-shrink:0">
            <rect width="32" height="32" rx="6" fill="#252526"/>
            <path fill="#0e9de8" d="M7,5 L12,5 L12,13.5 L25,5 L28.5,5 L15.5,16.5 L28.5,27 L25,27 L12,18.5 L12,27 L7,27 Z"/>
          </svg>
          <span>KUA</span><span class="app-logo-sub">Know Unified Administration</span>
        </span>
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
            <option value="all">{{ t('nav.allNamespaces') }}</option>
            <option v-for="n in store.namespaces" :key="n" :value="n">{{ n }}</option>
          </select>
        </template>
        <template v-else-if="activeProvider === 'aws'">
          <select class="ctrl-select" v-model="awsProfileId" @change="onAwsProfileChange">
            <option value="">{{ t('aws.noProfile') }}</option>
            <optgroup v-if="envStore.awsProfiles.length" :label="t('nav.storedProfiles')">
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
            <option value="">{{ t('gcp.noProfile') }}</option>
            <optgroup v-if="envStore.gcpProfiles.length" :label="t('nav.storedProfiles')">
              <option v-for="p in envStore.gcpProfiles" :key="p.id" :value="p.id">{{ p.name }}</option>
            </optgroup>
            <optgroup v-if="gcpLocalConfigs.length" :label="t('nav.gcpConfigs')">
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
          <button class="btn btn-icon" :title="t('nav.importKubeconfig')" @click="modals.kubeconfig = true"><i data-lucide="plus-circle"></i></button>
          <button class="btn btn-icon" :title="t('nav.deleteContext')" @click="deleteContextConfirm"><i data-lucide="trash-2"></i></button>
        </template>
        <template v-else-if="activeProvider === 'aws'">
          <button class="btn btn-icon" :title="t('nav.addAws')" @click="openAddConnection('aws')"><i data-lucide="plus-circle"></i></button>
          <button class="btn btn-icon" :title="t('nav.deleteAws')" :disabled="!awsProfileId || awsProfileId.startsWith('local:')" @click="deleteConnectionConfirm('aws')"><i data-lucide="trash-2"></i></button>
        </template>
        <template v-else-if="activeProvider === 'gcp'">
          <button class="btn btn-icon" :title="t('nav.addGcp')" @click="openAddConnection('gcp')"><i data-lucide="plus-circle"></i></button>
          <button class="btn btn-icon" :title="t('nav.deleteGcp')" :disabled="!gcpProfileId || gcpProfileId.startsWith('local:')" @click="deleteConnectionConfirm('gcp')"><i data-lucide="trash-2"></i></button>
        </template>
        <button class="btn btn-icon" :class="{ primary: cloudView === 'envs' }" :title="t('nav.envManager')" @click="toggleEnvManager"><i data-lucide="key-round"></i></button>
        <button class="btn btn-icon" :title="t('nav.localShell')" @click="openLocalShell()"><i data-lucide="terminal"></i></button>
        <button class="btn btn-icon btn-lang" @click="toggleLang" :title="settings.lang === 'es' ? 'Switch to English' : 'Cambiar a Español'">
          <span class="lang-flag">{{ settings.lang === 'es' ? '🇪🇸' : '🇺🇸' }}</span>
        </button>
        <button class="btn btn-icon" @click="toggleTheme" :title="settings.theme === 'dark' ? t('nav.lightMode') : t('nav.darkMode')">
          <i :data-lucide="settings.theme === 'dark' ? 'sun' : 'moon'"></i>
        </button>
        <button class="btn btn-icon" @click="modals.help = true" :title="t('nav.help')"><i data-lucide="help-circle"></i></button>
        <button class="btn btn-icon btn-donate" @click="openSponsor" :title="t('nav.supportProject')">
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
            <div class="sidebar-section-title">{{ t('sidebar.workloads') }}</div>
            <a v-for="r in ['pods','deployments','statefulsets','daemonsets']" :key="r"
               :class="['sidebar-item', { active: cloudView === null && store.resource === r }]"
               @click.prevent="setResource(r)">{{ LABELS[r] }}</a>
          </div>
          <div class="sidebar-section">
            <div class="sidebar-section-title">{{ t('sidebar.network') }}</div>
            <a v-for="r in ['services','ingresses']" :key="r"
               :class="['sidebar-item', { active: cloudView === null && store.resource === r }]"
               @click.prevent="setResource(r)">{{ LABELS[r] }}</a>
          </div>
          <div class="sidebar-section">
            <div class="sidebar-section-title">{{ t('sidebar.config') }}</div>
            <a v-for="r in ['configmaps','secrets']" :key="r"
               :class="['sidebar-item', { active: cloudView === null && store.resource === r }]"
               @click.prevent="setResource(r)">{{ LABELS[r] }}</a>
          </div>
          <div class="sidebar-section">
            <div class="sidebar-section-title">{{ t('sidebar.storage') }}</div>
            <a :class="['sidebar-item', { active: cloudView === null && store.resource === 'pvcs' }]"
               @click.prevent="setResource('pvcs')">PVC</a>
          </div>
          <div class="sidebar-section">
            <div class="sidebar-section-title">{{ t('sidebar.cluster') }}</div>
            <a v-for="r in ['nodes','events']" :key="r"
               :class="['sidebar-item', { active: cloudView === null && store.resource === r }]"
               @click.prevent="setResource(r)">{{ LABELS[r] }}</a>
          </div>
          <div class="sidebar-section">
            <div class="sidebar-section-title">{{ t('sidebar.helm') }}</div>
            <a :class="['sidebar-item', { active: cloudView === 'helm' }]"
               @click.prevent="setCloudView('helm')">{{ t('sidebar.releases') }}</a>
            <a :class="['sidebar-item', { active: cloudView === 'helm-repos' }]"
               @click.prevent="setCloudView('helm-repos')">{{ t('sidebar.repositories') }}</a>
          </div>
        </nav>

        <!-- AWS sidebar -->
        <nav class="sidebar" v-if="activeProvider === 'aws'">
          <div class="sidebar-section">
            <div class="sidebar-section-title">{{ t('sidebar.compute') }}</div>
            <a v-for="r in AWS_SIDEBAR.compute" :key="r.id"
               :class="['sidebar-item', { active: awsTab === r.id }]"
               @click.prevent="awsTab = r.id">{{ r.label }}</a>
          </div>
          <div class="sidebar-section">
            <div class="sidebar-section-title">{{ t('sidebar.containers') }}</div>
            <a v-for="r in AWS_SIDEBAR.containers" :key="r.id"
               :class="['sidebar-item', { active: awsTab === r.id }]"
               @click.prevent="awsTab = r.id">{{ r.label }}</a>
          </div>
          <div class="sidebar-section">
            <div class="sidebar-section-title">{{ t('sidebar.networking') }}</div>
            <a v-for="r in AWS_SIDEBAR.networking" :key="r.id"
               :class="['sidebar-item', { active: awsTab === r.id }]"
               @click.prevent="awsTab = r.id">{{ r.label }}</a>
          </div>
          <div class="sidebar-section">
            <div class="sidebar-section-title">{{ t('sidebar.storage') }}</div>
            <a v-for="r in AWS_SIDEBAR.storage" :key="r.id"
               :class="['sidebar-item', { active: awsTab === r.id }]"
               @click.prevent="awsTab = r.id">{{ r.label }}</a>
          </div>
          <div class="sidebar-section">
            <div class="sidebar-section-title">{{ t('sidebar.database') }}</div>
            <a v-for="r in AWS_SIDEBAR.database" :key="r.id"
               :class="['sidebar-item', { active: awsTab === r.id }]"
               @click.prevent="awsTab = r.id">{{ r.label }}</a>
          </div>
          <div class="sidebar-section">
            <div class="sidebar-section-title">{{ t('sidebar.analytics') }}</div>
            <a v-for="r in AWS_SIDEBAR.analytics" :key="r.id"
               :class="['sidebar-item', { active: awsTab === r.id }]"
               @click.prevent="awsTab = r.id">{{ r.label }}</a>
          </div>
          <div class="sidebar-section">
            <div class="sidebar-section-title">{{ t('sidebar.integration') }}</div>
            <a v-for="r in AWS_SIDEBAR.integration" :key="r.id"
               :class="['sidebar-item', { active: awsTab === r.id }]"
               @click.prevent="awsTab = r.id">{{ r.label }}</a>
          </div>
          <div class="sidebar-section">
            <div class="sidebar-section-title">{{ t('sidebar.security') }}</div>
            <a v-for="r in AWS_SIDEBAR.security" :key="r.id"
               :class="['sidebar-item', { active: awsTab === r.id }]"
               @click.prevent="awsTab = r.id">{{ r.label }}</a>
          </div>
        </nav>

        <!-- GCP sidebar -->
        <nav class="sidebar" v-if="activeProvider === 'gcp'">
          <div class="sidebar-section">
            <div class="sidebar-section-title">{{ t('sidebar.compute') }}</div>
            <a v-for="r in GCP_SIDEBAR.compute" :key="r.id"
               :class="['sidebar-item', { active: gcpTab === r.id }]"
               @click.prevent="gcpTab = r.id">{{ r.label }}</a>
          </div>
          <div class="sidebar-section">
            <div class="sidebar-section-title">{{ t('sidebar.database') }}</div>
            <a v-for="r in GCP_SIDEBAR.database" :key="r.id"
               :class="['sidebar-item', { active: gcpTab === r.id }]"
               @click.prevent="gcpTab = r.id">{{ r.label }}</a>
          </div>
          <div class="sidebar-section">
            <div class="sidebar-section-title">{{ t('sidebar.storage') }}</div>
            <a v-for="r in GCP_SIDEBAR.storage" :key="r.id"
               :class="['sidebar-item', { active: gcpTab === r.id }]"
               @click.prevent="gcpTab = r.id">{{ r.label }}</a>
          </div>
          <div class="sidebar-section">
            <div class="sidebar-section-title">{{ t('sidebar.serverless') }}</div>
            <a v-for="r in GCP_SIDEBAR.serverless" :key="r.id"
               :class="['sidebar-item', { active: gcpTab === r.id }]"
               @click.prevent="gcpTab = r.id">{{ r.label }}</a>
          </div>
          <div class="sidebar-section">
            <div class="sidebar-section-title">{{ t('sidebar.messaging') }}</div>
            <a v-for="r in GCP_SIDEBAR.messaging" :key="r.id"
               :class="['sidebar-item', { active: gcpTab === r.id }]"
               @click.prevent="gcpTab = r.id">{{ r.label }}</a>
          </div>
        </nav>

        <main class="main">
          <EnvManagerView v-if="cloudView === 'envs'" />
          <HelmView v-else-if="cloudView === 'helm' || cloudView === 'helm-repos'" :initial-tab="cloudView === 'helm-repos' ? 'repos' : 'releases'" />
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
        <span class="sb-item">{{ t('status.items', { n: store.rows.length }) }}</span>
      </template>
      <template v-else>
        <span class="sb-item">{{ activeProvider === 'aws' ? 'Amazon Web Services' : 'Google Cloud Platform' }}</span>
        <span class="sb-spacer"></span>
      </template>
      <span class="sb-sep">|</span>
      <span v-if="settings.showClock" class="sb-item">{{ clock }}</span>
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
    <ProfileModal
      :show="modals.addConnection"
      :profile="null"
      :default-provider="modalData.connectionProvider"
      @close="modals.addConnection = false"
      @save="handleConnectionSave"
    />

    <DonationModal />
    <WelcomeModal />
    <UpdateNotice />
    <ToastContainer />
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, onUnmounted, nextTick, watch } from 'vue'
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
import { settings, applySettings } from './composables/useSettings'
import { useI18n } from './composables/useI18n'

import ResourceTable    from './components/ResourceTable.vue'
import HelmView         from './components/HelmView.vue'
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
import ProfileModal     from './components/modals/ProfileModal.vue'
import DonationModal    from './components/modals/DonationModal.vue'
import WelcomeModal     from './components/modals/WelcomeModal.vue'
import UpdateNotice     from './components/UpdateNotice.vue'
import ToastContainer   from './components/ToastContainer.vue'
import { useUpdateStore } from './stores/useUpdateStore'

const { t } = useI18n()
const updateStore = useUpdateStore()
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
  networking:  [{ id: 'vpc', label: 'VPC' }, { id: 'apigw', label: 'API Gateway' }, { id: 'cloudfront', label: 'CloudFront' }, { id: 'route53', label: 'Route 53' }],
  storage:     [{ id: 's3', label: 'S3' }],
  database:    [{ id: 'dynamodb', label: 'DynamoDB' }, { id: 'docdb', label: 'DocumentDB' }],
  analytics:   [{ id: 'glue', label: 'Glue' }, { id: 'athena', label: 'Athena' }, { id: 'datapipeline', label: 'Data Pipeline' }],
  integration: [{ id: 'eventbridge', label: 'EventBridge' }, { id: 'stepfn', label: 'Step Functions' }],
  security:    [{ id: 'cognito', label: 'Cognito' }, { id: 'secrets', label: 'Secrets Manager' }],
}

const GCP_SIDEBAR = {
  compute:    [{ id: 'cloudrun', label: 'Cloud Run' }, { id: 'gke', label: 'GKE' }, { id: 'vms', label: 'Compute VMs' }],
  database:   [{ id: 'sql', label: 'Cloud SQL' }],
  storage:    [{ id: 'storage', label: 'Storage' }],
  serverless: [{ id: 'functions', label: 'Functions' }],
  messaging:  [{ id: 'pubsub', label: 'Pub/Sub' }],
}

// ─── localStorage helpers ────────────────────────────────────────────────────
const LS = {
  get:    (k, def = '') => { try { return localStorage.getItem(`kua:${k}`) ?? def } catch { return def } },
  set:    (k, v)        => { try { if (v) localStorage.setItem(`kua:${k}`, v); else localStorage.removeItem(`kua:${k}`) } catch {} },
}

const pfPanelVisible  = ref(false)
const activeProvider  = ref(LS.get('provider', 'kubernetes'))  // 'kubernetes' | 'aws' | 'gcp'
const cloudView       = ref(null)   // null = Kubernetes view, 'envs' = Env Manager
const selectedContext = ref('')
const awsTab          = ref('ec2')
const gcpTab          = ref('cloudrun')
const clock           = ref('')
let clockTimer
let autoRefreshTimer

watch(() => settings.autoRefresh, (secs) => {
  clearInterval(autoRefreshTimer)
  if (secs > 0) autoRefreshTimer = setInterval(() => reloadActiveProvider(), secs * 1000)
})

function reloadActiveProvider() {
  if (activeProvider.value === 'kubernetes') store.loadResources()
}

const awsLocalProfiles = ref([])
const gcpLocalConfigs  = ref([])
const awsProfileId     = ref(LS.get('awsProfile', ''))
const gcpProfileId     = ref(LS.get('gcpProfile', ''))

// Persistir cambios en localStorage automáticamente
watch(activeProvider, v  => LS.set('provider',    v))
watch(awsProfileId,   v  => LS.set('awsProfile',  v))
watch(gcpProfileId,   v  => LS.set('gcpProfile',  v))
watch(() => store.namespace, v => LS.set('kubeNs', v))

const modals    = reactive({ delete: false, deleteContext: false, scale: false, yaml: false, portForward: false, kubeconfig: false, help: false, drain: false, addConnection: false })
const modalData = reactive({
  deleteMsg: '', deletePending: null,
  deleteContextMsg: '', deleteContextName: '',
  scaleName: '', scaleCurrent: 0, scalePending: null,
  yamlTitle: '', yamlType: '', yamlNs: null, yamlName: '',
  pfNamespace: '', pfService: '', pfPorts: [], pfLabel: '', pfManual: false,
  drainMsg: '', drainPending: null,
  connectionProvider: 'aws', deleteConnectionId: null, deleteConnectionMode: false,
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
function selectProfile(provider, id) {
  if (provider === 'aws') { awsProfileId.value = id; awsStore.setActiveProfile(id) }
  else                    { gcpProfileId.value = id; gcpStore.setActiveProfile(id) }
}
function openAddConnection(provider) {
  modalData.connectionProvider = provider
  modals.addConnection = true
}
async function handleConnectionSave(payload) {
  // gcloud CLI auto-auth mode: no profile stored, just activate the local config
  if (payload.gcpAuthMode === 'gcloud') {
    modals.addConnection = false
    gcpProfileId.value   = payload.profileId
    gcpStore.setActiveProfile(payload.profileId)
    toast(`GCP gcloud config "${payload.profileId.slice(6)}" activated`, 'success')
    nextTick(() => createIcons({ icons }))
    return
  }

  const { name, category, provider, keys, meta } = payload
  const created = await envStore.createProfile({ name, category, provider, keys, meta })
  modals.addConnection = false
  if (created) {
    if (provider === 'aws') { awsProfileId.value = created.id; awsStore.setActiveProfile(created.id) }
    if (provider === 'gcp') { gcpProfileId.value = created.id; gcpStore.setActiveProfile(created.id) }
    toast(`Connection "${name}" added`, 'success')
    nextTick(() => createIcons({ icons }))
  }
}
function deleteConnectionConfirm(provider) {
  const id = provider === 'aws' ? awsProfileId.value : gcpProfileId.value
  if (!id || id.startsWith('local:')) return
  const profile = envStore.profiles.find(p => p.id === id)
  if (!profile) return
  modalData.deleteConnectionId   = id
  modalData.deleteConnectionMode = true
  modalData.deletePending        = null
  modalData.deleteMsg            = `Delete profile "${profile.name}"? All stored keys will be permanently removed.`
  modals.delete                  = true
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
  try { await store.switchContext(selectedContext.value); toast(t('msg.contextSwitched', { name: selectedContext.value }), 'success') }
  catch (e) { toast(e.message, 'error') }
}

function deleteContextConfirm() {
  const name = selectedContext.value; if (!name) return
  modalData.deleteContextName = name
  modalData.deleteContextMsg  = t('msg.deleteContext', { name })
  modals.deleteContext = true
}
async function confirmDeleteContext() {
  modals.deleteContext = false
  try { await store.deleteContext(modalData.deleteContextName); toast(t('msg.contextDeleted'), 'success'); selectedContext.value = store.currentContext }
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
  if (modalData.deleteConnectionMode) {
    modalData.deleteConnectionMode = false
    const id = modalData.deleteConnectionId
    modals.delete = false
    const ok = await envStore.deleteProfile(id)
    if (ok) {
      if (awsProfileId.value === id) { awsProfileId.value = ''; awsStore.setActiveProfile(null) }
      if (gcpProfileId.value === id) { gcpProfileId.value = ''; gcpStore.setActiveProfile(null) }
      toast('Profile deleted', 'success')
    }
    return
  }
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

function toggleLang() {
  settings.lang = settings.lang === 'es' ? 'en' : 'es'
  applySettings()
}

function toggleTheme() {
  settings.theme = settings.theme === 'dark' ? 'light' : 'dark'
  applySettings()
}

function onKey(e) { if (e.key === 'Escape') Object.keys(modals).forEach(k => modals[k] = false) }

onMounted(async () => {
  applySettings()
  clockTimer = setInterval(() => { clock.value = new Date().toLocaleTimeString() }, 1000)
  clock.value = new Date().toLocaleTimeString()
  await store.loadContexts()
  selectedContext.value = store.currentContext
  await store.loadNamespaces()
  // Restaurar namespace guardado
  const savedNs = LS.get('kubeNs', '')
  if (savedNs && store.namespaces.includes(savedNs)) store.namespace = savedNs
  await store.loadResources()
  await pfStore.autoRestore()
  await envStore.fetchProfiles()
  // Restaurar perfil AWS guardado
  if (awsProfileId.value) {
    awsStore.setActiveProfile(awsProfileId.value)
    if (activeProvider.value === 'aws') loadAwsLocalProfiles()
  }
  // Restaurar perfil GCP guardado
  if (gcpProfileId.value) {
    gcpStore.setActiveProfile(gcpProfileId.value)
    if (activeProvider.value === 'gcp') loadGcpLocalConfigs()
  }
  // Cargar profiles locales si el proveedor activo lo necesita
  if (activeProvider.value === 'aws' && !awsLocalProfiles.value.length) loadAwsLocalProfiles()
  if (activeProvider.value === 'gcp' && !gcpLocalConfigs.value.length)  loadGcpLocalConfigs()
  document.addEventListener('keydown', onKey)
  updateStore.initListeners()
  nextTick(() => createIcons({ icons }))
})
onUnmounted(() => { clearInterval(clockTimer); clearInterval(autoRefreshTimer); document.removeEventListener('keydown', onKey) })
</script>
