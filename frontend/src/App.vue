<template>
  <div id="app">
    <!-- ── Header ─────────────────────────────────────────────────────────── -->
    <header class="header">
      <div class="header-left">
        <span class="app-logo"><i data-lucide="layers"></i> KuaDashboard</span>
        <select class="ctrl-select" v-model="selectedContext" @change="switchContext">
          <option v-for="c in store.contexts" :key="c.name" :value="c.name">{{ c.name }}</option>
        </select>
        <select class="ctrl-select" v-model="store.namespace" @change="store.loadResources()">
          <option value="all">All namespaces</option>
          <option v-for="n in store.namespaces" :key="n" :value="n">{{ n }}</option>
        </select>
      </div>
      <div class="header-right">
        <button class="btn sm" :class="{ primary: pfPanelVisible }" @click="pfPanelVisible = !pfPanelVisible" title="Port Forwards">
          <i data-lucide="cable"></i> Ports
          <span v-if="pfStore.list.length" class="badge-count">{{ pfStore.list.length }}</span>
        </button>
        <button class="btn btn-icon" title="Import kubeconfig" @click="modals.kubeconfig = true"><i data-lucide="plus-circle"></i></button>
        <button class="btn btn-icon" title="Delete context" @click="deleteContextConfirm"><i data-lucide="trash-2"></i></button>
        <button class="btn btn-icon" @click="modals.help = true" title="Help"><i data-lucide="help-circle"></i></button>
      </div>
    </header>

    <!-- ── Body ──────────────────────────────────────────────────────────── -->
    <div class="page-body">
      <div class="layout">
        <nav class="sidebar">
          <div class="sidebar-section">
            <div class="sidebar-section-title">Workloads</div>
            <a v-for="r in ['pods','deployments','statefulsets','daemonsets']" :key="r"
               :class="['sidebar-item', { active: store.resource === r }]"
               @click.prevent="setResource(r)">{{ LABELS[r] }}</a>
          </div>
          <div class="sidebar-section">
            <div class="sidebar-section-title">Network</div>
            <a v-for="r in ['services','ingresses']" :key="r"
               :class="['sidebar-item', { active: store.resource === r }]"
               @click.prevent="setResource(r)">{{ LABELS[r] }}</a>
          </div>
          <div class="sidebar-section">
            <div class="sidebar-section-title">Config</div>
            <a v-for="r in ['configmaps','secrets']" :key="r"
               :class="['sidebar-item', { active: store.resource === r }]"
               @click.prevent="setResource(r)">{{ LABELS[r] }}</a>
          </div>
          <div class="sidebar-section">
            <div class="sidebar-section-title">Storage</div>
            <a :class="['sidebar-item', { active: store.resource === 'pvcs' }]"
               @click.prevent="setResource('pvcs')">PVC</a>
          </div>
          <div class="sidebar-section">
            <div class="sidebar-section-title">Cluster</div>
            <a v-for="r in ['nodes','events']" :key="r"
               :class="['sidebar-item', { active: store.resource === r }]"
               @click.prevent="setResource(r)">{{ LABELS[r] }}</a>
          </div>
        </nav>

        <main class="main">
          <ResourceTable @action="handleAction" />
        </main>
      </div>

      <TerminalPanel @restartStream="restartStream" />
    </div>

    <PortForwardPanel :visible="pfPanelVisible" @close="pfPanelVisible = false" @add="openPfManual" />

    <div class="statusbar">
      <span class="sb-item">{{ store.currentContext }}</span>
      <span class="sb-sep">|</span>
      <span class="sb-item">{{ store.namespace }}</span>
      <span class="sb-spacer"></span>
      <span class="sb-item">{{ store.rows.length }} items</span>
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

    <ToastContainer />
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, onUnmounted, nextTick } from 'vue'
import { createIcons, icons } from 'lucide'

import { useKubeStore }        from './stores/useKubeStore'
import { usePortForwardStore } from './stores/usePortForwardStore'
import { useTerminalStore }    from './stores/useTerminalStore'
import { useTerminalStreams }   from './composables/useTerminalStreams'
import { useToast }            from './composables/useToast'
import { api }                 from './composables/useApi'

import ResourceTable    from './components/ResourceTable.vue'
import TerminalPanel    from './components/TerminalPanel.vue'
import PortForwardPanel from './components/PortForwardPanel.vue'
import DeleteModal      from './components/modals/DeleteModal.vue'
import ScaleModal       from './components/modals/ScaleModal.vue'
import YamlModal        from './components/modals/YamlModal.vue'
import PortForwardModal from './components/modals/PortForwardModal.vue'
import KubeconfigModal  from './components/modals/KubeconfigModal.vue'
import ToastContainer   from './components/ToastContainer.vue'

const store     = useKubeStore()
const pfStore   = usePortForwardStore()
const termStore = useTerminalStore()
const { startLogStream, startExecStream } = useTerminalStreams()
const { toast } = useToast()

const LABELS = {
  pods: 'Pods', deployments: 'Deployments', statefulsets: 'StatefulSets',
  daemonsets: 'DaemonSets', services: 'Services', ingresses: 'Ingresses',
  configmaps: 'ConfigMaps', secrets: 'Secrets', pvcs: 'PVC',
  nodes: 'Nodes', events: 'Events',
}

const pfPanelVisible  = ref(false)
const selectedContext = ref('')
const clock           = ref('')
let clockTimer

const modals    = reactive({ delete: false, deleteContext: false, scale: false, yaml: false, portForward: false, kubeconfig: false, help: false, drain: false })
const modalData = reactive({
  deleteMsg: '', deletePending: null,
  deleteContextMsg: '', deleteContextName: '',
  scaleName: '', scaleCurrent: 0, scalePending: null,
  yamlTitle: '', yamlType: '', yamlNs: null, yamlName: '',
  pfNamespace: '', pfService: '', pfPorts: [], pfLabel: '', pfManual: false,
  drainMsg: '', drainPending: null,
})

function setResource(r) { store.resource = r; store.loadResources() }

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

function onKey(e) { if (e.key === 'Escape') Object.keys(modals).forEach(k => modals[k] = false) }

onMounted(async () => {
  clockTimer = setInterval(() => { clock.value = new Date().toLocaleTimeString() }, 1000)
  clock.value = new Date().toLocaleTimeString()
  await store.loadContexts()
  selectedContext.value = store.currentContext
  await store.loadNamespaces()
  await store.loadResources()
  await pfStore.autoRestore()
  document.addEventListener('keydown', onKey)
  nextTick(() => createIcons({ icons }))
})
onUnmounted(() => { clearInterval(clockTimer); document.removeEventListener('keydown', onKey) })
</script>
