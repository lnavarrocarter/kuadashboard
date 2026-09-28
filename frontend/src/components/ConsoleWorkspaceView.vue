<template>
  <div class="console-view">
    <div class="console-header">
      <h2 class="console-title">
        <i data-lucide="square-terminal"></i>
        {{ t('console.title') }}
      </h2>
      <span class="console-total">{{ store.tabs.length }} {{ t('console.sessions') }}</span>
      <button class="btn sm" @click="confirmClearHistory"><i data-lucide="history"></i> {{ t('console.clearAllHistory') }}</button>
    </div>

    <div class="console-body">
      <section class="console-sessions">
        <span class="console-section-title">{{ t('console.active') }}</span>
        <div class="console-table-wrap">
          <table class="console-table" v-if="store.tabs.length">
            <thead>
              <tr>
                <th>{{ t('console.colProvider') }}</th>
                <th>{{ t('console.colName') }}</th>
                <th>{{ t('console.colEnvironment') }}</th>
                <th>{{ t('console.colTarget') }}</th>
                <th>{{ t('console.colStatus') }}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="tab in store.tabs" :key="tab.id" :class="['console-row', { active: tab.id === store.activeId }]" @click="store.activateTab(tab.id)">
                <td>
                  <span class="console-provider-chip" :style="{ '--prov': providerMeta(tab.provider || 'kubernetes').color }">
                    <i :data-lucide="providerMeta(tab.provider || 'kubernetes').icon"></i>{{ providerMeta(tab.provider || 'kubernetes').label }}
                  </span>
                </td>
                <td class="console-name">
                  <input
                    v-if="renamingTab === tab.id" v-model="renameText" class="ctrl-input sm console-rename"
                    :aria-label="t('console.rename')"
                    @click.stop @keydown.enter="commitTabRename(tab)" @keydown.esc="renamingTab = null" @blur="commitTabRename(tab)"
                  />
                  <span v-else :title="tab.label || tab.pod" @dblclick.stop="startTabRename(tab)">
                    {{ middleTruncate(tab.label || tab.pod, 34) }}
                    <i v-if="store.isSaved(tab)" data-lucide="bookmark-check" class="console-saved-mark" :title="t('console.savedMark')"></i>
                  </span>
                </td>
                <td class="console-env">
                  {{ tab.environment || 'default' }}<span v-if="tab.region || tab.project" class="console-scope" :title="t('console.colScope')"> · {{ tab.region || tab.project }}</span>
                </td>
                <td class="console-target" :title="targetSummary(tab)">{{ middleTruncate(targetSummary(tab), 40) }}</td>
                <td><span :class="['console-status-badge', `state-${tab.connectionState || 'idle'}`]">{{ tab.connectionState || 'idle' }}</span></td>
                <td class="console-row-actions">
                  <div class="console-row-buttons">
                  <button class="btn sm btn-icon console-action-save" :title="t('console.saveConnection')" @click.stop="saveTab(tab)"><i data-lucide="bookmark-plus"></i></button>
                  <button class="btn sm btn-icon console-action-rename" :title="t('console.rename')" @click.stop="startTabRename(tab)"><i data-lucide="pencil"></i></button>
                  <button class="btn sm btn-icon console-action-reconnect" :title="t('console.reconnect')" @click.stop="reconnect(tab)"><i data-lucide="refresh-cw"></i></button>
                  <button class="btn sm btn-icon console-action-close" :title="t('console.close')" @click.stop="store.closeTab(tab.id)"><i data-lucide="x"></i></button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
          <div v-else class="console-empty">
            <i data-lucide="terminal"></i>
            <p>{{ t('console.empty') }}</p>
          </div>
        </div>
      </section>

      <section class="console-launcher">
        <span class="console-section-title">{{ t('console.savedTitle') }}</span>
        <div class="console-saved">
          <p v-if="!store.savedConnections.length" class="console-saved-empty">{{ t('console.savedEmpty') }}</p>
          <div v-for="conn in store.savedConnections" :key="conn.id" class="console-saved-item" :style="{ '--prov': providerMeta(connectionProvider(conn)).color }">
            <i :data-lucide="providerMeta(connectionProvider(conn)).icon" class="console-saved-icon"></i>
            <div class="console-saved-text">
              <input
                v-if="renamingConn === conn.id" v-model="renameText" class="ctrl-input sm console-rename"
                :aria-label="t('console.rename')"
                @keydown.enter="commitConnRename(conn)" @keydown.esc="renamingConn = null" @blur="commitConnRename(conn)"
              />
              <strong v-else :title="conn.name" @dblclick="startConnRename(conn)">{{ middleTruncate(conn.name, 30) }}</strong>
              <span class="console-saved-target" :title="connectionTarget(conn)">{{ middleTruncate(connectionTarget(conn), 42) }}</span>
            </div>
            <div class="console-saved-actions">
              <button class="btn sm primary console-saved-open" :title="t('console.openSaved')" @click="openSaved(conn)"><i data-lucide="play"></i></button>
              <button class="btn sm btn-icon" :title="t('console.rename')" @click="startConnRename(conn)"><i data-lucide="pencil"></i></button>
              <button class="btn sm btn-icon console-saved-delete" :title="t('console.deleteSaved')" @click="deleteSaved(conn)"><i data-lucide="trash-2"></i></button>
            </div>
          </div>
        </div>

        <span class="console-section-title">{{ t('console.newSession') }}</span>

        <div class="console-launcher-card">
          <div class="console-launcher-card-header">
            <i data-lucide="terminal"></i>
            <strong>Local Shell</strong>
          </div>
          <button class="btn sm primary" @click="connectLocal"><i data-lucide="plus"></i> {{ t('console.connect') }}</button>
        </div>

        <div class="console-launcher-card">
          <div class="console-launcher-card-header">
            <i data-lucide="boxes"></i>
            <strong>Kubernetes</strong>
          </div>
          <div class="console-launcher-form">
            <select v-model="kubeForm.context" class="ctrl-select sm">
              <option value="">{{ t('console.currentContext') }}</option>
              <option v-for="ctx in kubeStore.contexts" :key="ctx.name" :value="ctx.name">{{ ctx.name }}</option>
            </select>
            <select v-model="kubeForm.resourceType" class="ctrl-select sm">
              <option value="pods">Pod</option>
              <option value="deployments">Deployment</option>
              <option value="statefulsets">StatefulSet</option>
              <option value="daemonsets">DaemonSet</option>
            </select>
            <input v-model.trim="kubeForm.namespace" class="ctrl-input sm" :placeholder="t('console.namespace')" />
            <input v-model.trim="kubeForm.name" class="ctrl-input sm" :placeholder="t('console.resourceName')" />
          </div>
          <div class="console-launcher-actions">
            <button class="btn sm" :disabled="!requiredSatisfied(kubernetesLogsCapability, kubeForm.resourceType)" @click="connectKubernetes('logs')">
              <i data-lucide="scroll-text"></i> {{ t('console.viewLogs') }}
            </button>
            <button class="btn sm" :disabled="!requiredSatisfied(kubernetesExecCapability, 'pods')" @click="connectKubernetes('exec')">
              <i data-lucide="square-terminal"></i> Exec
            </button>
          </div>
        </div>

        <div class="console-launcher-card">
          <div class="console-launcher-card-header">
            <i data-lucide="cloud"></i>
            <strong>EC2 SSH</strong>
          </div>
          <div class="console-launcher-form">
            <input v-model.trim="ec2Form.host" class="ctrl-input sm" :placeholder="t('console.host')" />
            <input v-model.trim="ec2Form.user" class="ctrl-input sm" placeholder="ec2-user" />
            <input v-model.number="ec2Form.port" type="number" min="1" max="65535" class="ctrl-input sm" placeholder="22" />
            <input v-model.trim="ec2Form.profileId" class="ctrl-input sm" :placeholder="t('console.profileId')" />
          </div>
          <div class="console-launcher-actions">
            <button class="btn sm" :disabled="!ec2Form.host || !ec2Form.profileId" @click="connectEc2Ssh">
              <i data-lucide="plus"></i> {{ t('console.connect') }}
            </button>
          </div>
        </div>

        <div class="console-launcher-card">
          <div class="console-launcher-card-header">
            <i data-lucide="cloud"></i>
            <strong>AWS SSM</strong>
          </div>
          <div class="console-launcher-form">
            <input v-model.trim="ssmForm.instanceId" class="ctrl-input sm" placeholder="i-0123456789abcdef0" />
            <input v-model.trim="ssmForm.profileId" class="ctrl-input sm" :placeholder="t('console.profileId')" />
          </div>
          <p v-if="ssmPluginChecked && !ssmPluginInstalled" class="console-hint">
            {{ t('console.ssmPluginMissing') }}
            <a href="https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html" target="_blank" rel="noopener">{{ t('console.ssmPluginInstallLink') }}</a>
          </p>
          <div class="console-launcher-actions">
            <button class="btn sm" :disabled="!ssmPluginInstalled || !ssmForm.instanceId || !ssmForm.profileId" @click="connectSsm">
              <i data-lucide="plus"></i> {{ t('console.connect') }}
            </button>
          </div>
        </div>

        <div class="console-launcher-card">
          <div class="console-launcher-card-header">
            <i data-lucide="cloud"></i>
            <strong>GCP Logs</strong>
          </div>
          <div class="console-launcher-form">
            <input v-model.trim="gcpLogsForm.project" class="ctrl-input sm" placeholder="project-id (optional)" />
            <input v-model.trim="gcpLogsForm.region" class="ctrl-input sm" placeholder="us-central1" />
            <input v-model.trim="gcpLogsForm.service" class="ctrl-input sm" placeholder="Cloud Run service" />
            <input v-model.trim="gcpLogsForm.profileId" class="ctrl-input sm" :placeholder="t('console.profileId')" />
          </div>
          <div class="console-launcher-actions">
            <button class="btn sm" :disabled="!gcpLogsForm.region || !gcpLogsForm.service || !gcpLogsForm.profileId" @click="connectGcpLogs">
              <i data-lucide="scroll-text"></i> {{ t('console.viewLogs') }}
            </button>
          </div>
        </div>

        <div class="console-launcher-card">
          <div class="console-launcher-card-header">
            <i data-lucide="triangle"></i>
            <strong>Vercel</strong>
          </div>
          <div class="console-launcher-form">
            <input v-model.trim="vercelForm.deploymentId" class="ctrl-input sm" placeholder="dpl_..." />
            <input v-model.trim="vercelForm.profileId" class="ctrl-input sm" :placeholder="t('console.profileId')" />
          </div>
          <div class="console-launcher-actions">
            <button class="btn sm" :disabled="!vercelForm.deploymentId || !vercelForm.profileId" @click="connectVercel">
              <i data-lucide="scroll-text"></i> {{ t('console.viewLogs') }}
            </button>
          </div>
        </div>

        <div v-for="group in otherGroups" :key="group.provider" class="console-launcher-card">
          <div class="console-launcher-card-header">
            <i :data-lucide="providerIcon(group.provider)"></i>
            <strong>{{ group.provider.toUpperCase() }}</strong>
          </div>
          <div class="console-capability-row" v-for="capability in group.capabilities" :key="capability.id">
            <span>{{ capability.id }}</span>
            <span v-if="capability.status === 'available'" class="console-hint">{{ t('console.availableElsewhere', { provider: group.provider.toUpperCase() }) }}</span>
            <span v-else-if="capability.status === 'unavailable'" class="console-unavailable-badge" :title="capability.reason">{{ t('console.unavailable') }}</span>
            <span v-else class="console-planned-badge">{{ t('console.planned') }}</span>
          </div>
        </div>
      </section>
    </div>

    <ConfirmModal
      :show="showSsmConfirm"
      :title="t('console.ssmConfirmTitle')"
      :message="t('console.ssmConfirmMessage')"
      :confirm-label="t('console.connect')"
      icon="terminal-square"
      @confirm="confirmSsmConnect"
      @close="showSsmConfirm = false"
    />
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, reactive, ref } from 'vue'
import { createIcons, icons } from 'lucide'
import { useI18n } from '../composables/useI18n.js'
import { api } from '../composables/useApi.js'
import { useTerminalStore } from '../stores/useTerminalStore'
import { useTerminalStreams } from '../composables/useTerminalStreams'
import { useKubeStore } from '../stores/useKubeStore'
import ConfirmModal from './ConfirmModal.vue'
import { providerMeta, middleTruncate, connectionProvider, connectionTarget } from '../composables/consoleConnections'

const { t } = useI18n()
const store = useTerminalStore()
const kubeStore = useKubeStore()
const { startLogStream, startExecStream, startLocalStream, startSshStream, startSsmStream, startGcpLogsStream, startVercelLogsStream } = useTerminalStreams()

const kubeForm = reactive({ context: '', namespace: '', name: '', resourceType: 'pods' })
const ec2Form = reactive({ host: '', user: 'ec2-user', port: 22, profileId: '' })
const ssmForm = reactive({ instanceId: '', profileId: '' })
const gcpLogsForm = reactive({ project: '', region: '', service: '', profileId: '' })
const vercelForm = reactive({ deploymentId: '', profileId: '' })
const ssmPluginInstalled = ref(false)
const ssmPluginChecked = ref(false)
const showSsmConfirm = ref(false)
const renamingTab = ref(null)
const renamingConn = ref(null)
const renameText = ref('')
// Name given to the tab that the pending SSM confirmation will open (saved connections).
let pendingSsmName = null

const PROVIDER_ORDER = ['local', 'kubernetes', 'aws', 'gcp', 'vercel']
const PROVIDER_ICONS = { aws: 'cloud', gcp: 'cloud', vercel: 'triangle' }

const kubernetesLogsCapability = computed(() => store.capabilityRegistry.find(c => c.id === 'kubernetes-logs'))
const kubernetesExecCapability = computed(() => store.capabilityRegistry.find(c => c.id === 'kubernetes-exec'))

// ec2-ssh, aws-ssm, gcp-logs and vercel-logs get their own dedicated launcher cards
// (like Kubernetes) since they're now real, store-backed tabs; gcp-shell stays in this
// generic list since it's unavailable (no launchable transport), not planned/available.
const otherGroups = computed(() => {
  const groups = {}
  for (const capability of store.capabilityRegistry) {
    if (capability.provider === 'local' || capability.provider === 'kubernetes'
      || capability.id === 'ec2-ssh' || capability.id === 'aws-ssm'
      || capability.id === 'gcp-logs' || capability.id === 'vercel-logs') continue
    if (!groups[capability.provider]) groups[capability.provider] = []
    groups[capability.provider].push(capability)
  }
  return PROVIDER_ORDER.filter(provider => groups[provider]).map(provider => ({ provider, capabilities: groups[provider] }))
})

function providerIcon(provider) {
  return PROVIDER_ICONS[provider] || 'cloud'
}

function fieldValue(path, source) {
  return path.split('.').reduce((value, key) => value?.[key], source)
}

function requiredSatisfied(capability, resourceType) {
  if (!capability) return false
  const descriptor = { target: { namespace: kubeForm.namespace, name: kubeForm.name, resourceType } }
  return capability.required.every(field => Boolean(fieldValue(field, descriptor)))
}

function targetSummary(tab) {
  if (tab.provider === 'kubernetes') return `${tab.ns || tab.target?.namespace || ''}/${tab.pod || tab.target?.name || ''}`
  if (tab.provider === 'local') return 'local'
  return tab.target?.host || tab.pod || '—'
}

function reconnect(tab) {
  if (tab.type === 'exec') startExecStream(tab, { reconnect: true })
  else if (tab.type === 'local') startLocalStream(tab, { reconnect: true })
  else if (tab.type === 'ec2') startSshStream(tab, { reconnect: true })
  else if (tab.type === 'gcp-ssh') startSshStream(tab, { reconnect: true })
  else if (tab.type === 'ssm') startSsmStream(tab, { reconnect: true })
  else if (tab.type === 'gcp-logs') startGcpLogsStream(tab, { reconnect: true })
  else if (tab.type === 'vercel') startVercelLogsStream(tab, { reconnect: true })
  else startLogStream(tab, false, { reconnect: true })
}

/**
 * Opens a session of a given kind; used by the launcher forms and by saved
 * connections. SSM goes through its confirmation (openSsm) instead.
 */
function openConnection(kind, p) {
  const kubeContext = p.kubeContext ? { kubeContext: p.kubeContext } : {}
  let tab = null
  if (kind === 'local') { tab = store.openLocalTab(); startLocalStream(tab) }
  else if (kind === 'exec') { tab = store.openExecTab(p.namespace, p.name, [], kubeContext); startExecStream(tab) }
  else if (kind === 'log') { tab = store.openLogsTab(p.namespace, p.name, [], p.resourceType || 'pods', kubeContext); startLogStream(tab) }
  else if (kind === 'ec2') {
    tab = store.openCloudTab('ec2', `${p.user || 'ec2-user'}@${p.host}`, { profileId: p.profileId, target: { host: p.host, user: p.user || 'ec2-user', port: p.port || 22 } })
    startSshStream(tab)
  } else if (kind === 'gcp-logs') {
    tab = store.openCloudTab('gcp-logs', p.service, { profileId: p.profileId, project: p.project, region: p.region, target: { name: p.service } })
    startGcpLogsStream(tab)
  } else if (kind === 'gcp-ssh') {
    tab = store.openCloudTab('gcp-ssh', p.target?.name || 'gcp', { profileId: p.profileId, project: p.project, target: { ...(p.target || {}) } })
    startSshStream(tab)
  } else if (kind === 'vercel') {
    tab = store.openCloudTab('vercel', p.deploymentId, { profileId: p.profileId, target: { name: p.deploymentId } })
    startVercelLogsStream(tab)
  }
  return tab
}

function connectLocal() {
  openConnection('local', {})
}

function connectKubernetes(transport) {
  openConnection(transport === 'exec' ? 'exec' : 'log', { kubeContext: kubeForm.context, namespace: kubeForm.namespace, name: kubeForm.name, resourceType: kubeForm.resourceType })
}

function connectEc2Ssh() {
  openConnection('ec2', { ...ec2Form })
}

function connectGcpLogs() {
  openConnection('gcp-logs', { ...gcpLogsForm })
}

function connectVercel() {
  openConnection('vercel', { ...vercelForm })
}

// ── Saved connections and renaming (#63) ────────────────────────────────────
function openSaved(conn) {
  store.touchConnection(conn.id)
  if (conn.kind === 'ssm') {
    Object.assign(ssmForm, { instanceId: conn.params.instanceId, profileId: conn.params.profileId })
    pendingSsmName = conn.name
    connectSsm()
    return
  }
  const tab = openConnection(conn.kind, conn.params)
  if (tab) store.renameTab(tab.id, conn.name)
}

function saveTab(tab) {
  const saved = store.saveConnection(tab, tab.label || tab.pod)
  if (saved) {
    renamingConn.value = saved.id
    renameText.value = saved.name
    nextTick(() => createIcons({ icons }))
  }
}

function deleteSaved(conn) {
  if (window.confirm(t('console.deleteSavedConfirm', { name: conn.name }))) store.deleteConnection(conn.id)
}

function startTabRename(tab) {
  renamingConn.value = null
  renamingTab.value = tab.id
  renameText.value = tab.label || tab.pod || ''
  nextTick(() => document.querySelector('.console-rename')?.focus())
}

function commitTabRename(tab) {
  if (renamingTab.value !== tab.id) return
  store.renameTab(tab.id, renameText.value)
  renamingTab.value = null
}

function startConnRename(conn) {
  renamingTab.value = null
  renamingConn.value = conn.id
  renameText.value = conn.name
  nextTick(() => document.querySelector('.console-rename')?.focus())
}

function commitConnRename(conn) {
  if (renamingConn.value !== conn.id) return
  store.renameConnection(conn.id, renameText.value)
  renamingConn.value = null
}

function confirmClearHistory() {
  if (window.confirm(t('console.clearAllHistoryConfirm'))) store.clearAllHistory()
}

function connectSsm() {
  if (!ssmPluginInstalled.value || !ssmForm.instanceId || !ssmForm.profileId) return
  showSsmConfirm.value = true
}

function confirmSsmConnect() {
  showSsmConfirm.value = false
  const tab = store.openCloudTab('ssm', ssmForm.instanceId, {
    profileId: ssmForm.profileId,
    target: { instanceId: ssmForm.instanceId },
  })
  if (pendingSsmName) store.renameTab(tab.id, pendingSsmName)
  pendingSsmName = null
  startSsmStream(tab)
}

async function checkSsmPlugin() {
  try {
    const tools = await api('GET', '/api/system/tools')
    ssmPluginInstalled.value = Boolean(tools.find(tool => tool.id === 'session-manager-plugin')?.installed)
  } catch (_) {
    ssmPluginInstalled.value = false
  } finally {
    ssmPluginChecked.value = true
  }
}

onMounted(() => {
  if (!kubeStore.contexts.length) kubeStore.loadContexts()
  checkSsmPlugin()
  nextTick(() => createIcons({ icons }))
})
</script>

<style scoped>
.console-view { display: flex; flex-direction: column; height: 100%; padding: 16px 20px; gap: 12px; overflow: hidden; }
.console-header { display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; }
.console-title { display: flex; align-items: center; gap: 8px; font-size: 1.1rem; font-weight: 600; margin: 0; }
.console-title i { width: 18px; height: 18px; }
.console-total { font-size: 0.8rem; color: var(--text-dim); background: var(--bg-panel); padding: 2px 8px; border-radius: 10px; }

.console-body { flex: 1; display: grid; grid-template-columns: minmax(0, 2fr) minmax(240px, 1fr); gap: 14px; overflow: hidden; }
.console-sessions, .console-launcher { display: flex; flex-direction: column; gap: 8px; min-height: 0; overflow-y: auto; }
.console-section-title { color: var(--text-dim); font-size: 10px; font-weight: 700; text-transform: uppercase; }

.console-table-wrap { flex: 1; overflow: auto; border: 1px solid var(--border); border-radius: 6px; }
.console-table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
.console-table th { position: sticky; top: 0; background: var(--bg-panel); padding: 8px 10px; text-align: left; font-weight: 600; color: var(--text-dim); border-bottom: 1px solid var(--border); white-space: nowrap; }
.console-row { cursor: pointer; }
.console-row:hover { background: color-mix(in srgb, var(--text) 4%, transparent); }
.console-row.active { background: color-mix(in srgb, #2f81f7 10%, transparent); }
.console-row td { padding: 7px 10px; border-bottom: 1px solid var(--border); vertical-align: middle; }
.console-target { max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: monospace; font-size: 0.78rem; }
.console-row-actions { width: 1%; white-space: nowrap; }
.console-row-buttons { display: flex; gap: 4px; justify-content: flex-end; }
.console-provider-chip {
  display: inline-flex; align-items: center; gap: 5px; padding: 2px 8px; border-radius: 10px; font-size: 0.72rem; font-weight: 600; white-space: nowrap;
  color: var(--prov, var(--text-dim)); background: color-mix(in srgb, var(--prov, var(--text)) 14%, transparent);
}
.console-provider-chip i { width: 12px; height: 12px; }
.console-name { white-space: nowrap; }
.console-env { white-space: nowrap; }
.console-scope { color: var(--text-dim); font-size: 0.74rem; }
.console-name span { cursor: text; display: inline-block; max-width: 190px; overflow: hidden; text-overflow: ellipsis; vertical-align: middle; }
.console-saved-mark { width: 12px; height: 12px; margin-left: 4px; color: var(--accent); vertical-align: -2px; }
.console-rename { width: 100%; min-width: 140px; }

.console-saved { display: flex; flex-direction: column; gap: 6px; }
.console-saved-empty { margin: 0; color: var(--text-dim); font-size: 0.74rem; }
.console-saved-item {
  display: flex; align-items: center; gap: 8px; padding: 7px 8px; border: 1px solid var(--border); border-radius: 6px;
  border-left: 3px solid var(--prov, var(--border));
}
.console-saved-icon { width: 15px; height: 15px; flex: none; color: var(--prov, var(--text-dim)); }
.console-saved-text { display: flex; flex-direction: column; min-width: 0; flex: 1; gap: 1px; }
.console-saved-text strong { font-size: 0.82rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: text; }
.console-saved-target { font-size: 0.72rem; color: var(--text-dim); font-family: monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.console-saved-actions { display: flex; gap: 4px; flex: none; }
.console-saved-actions .btn i { width: 12px; height: 12px; }
.console-status-badge { padding: 2px 8px; border-radius: 10px; font-size: 0.72rem; font-weight: 600; text-transform: uppercase; }
.state-connected { background: rgba(63,185,80,0.18); color: #3fb950; }
.state-connecting, .state-validating { background: rgba(210,153,34,0.18); color: #d29922; }
.state-error { background: rgba(248,81,73,0.18); color: #f85149; }
.state-idle, .state-closed { background: color-mix(in srgb, var(--text) 8%, transparent); color: var(--text-dim); }

.console-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 48px; color: var(--text-dim); gap: 8px; }
.console-empty i { width: 32px; height: 32px; }

.console-launcher-card { display: flex; flex-direction: column; gap: 8px; padding: 10px; border: 1px solid var(--border); border-radius: 6px; }
.console-launcher-card-header { display: flex; align-items: center; gap: 6px; }
.console-launcher-card-header i { width: 15px; height: 15px; color: #58a6ff; }
.console-launcher-form { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.console-launcher-actions { display: flex; gap: 6px; flex-wrap: wrap; }
.console-capability-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 0.8rem; }
.console-hint { color: var(--text-dim); font-size: 0.74rem; }
.console-planned-badge { padding: 2px 8px; border-radius: 10px; font-size: 0.7rem; font-weight: 600; text-transform: uppercase; background: color-mix(in srgb, var(--text) 8%, transparent); color: var(--text-dim); }
.console-unavailable-badge { padding: 2px 8px; border-radius: 10px; font-size: 0.7rem; font-weight: 600; text-transform: uppercase; background: color-mix(in srgb, #f85149 14%, transparent); color: #f85149; cursor: help; }

@media (max-width: 860px) {
  .console-body { grid-template-columns: 1fr; overflow-y: auto; overflow-x: hidden; }
  .console-sessions, .console-launcher { overflow: visible; }
}
</style>
