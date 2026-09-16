<template>
  <div class="console-view">
    <div class="console-header">
      <h2 class="console-title">
        <i data-lucide="square-terminal"></i>
        {{ t('console.title') }}
      </h2>
      <span class="console-total">{{ store.tabs.length }} {{ t('console.sessions') }}</span>
    </div>

    <div class="console-body">
      <section class="console-sessions">
        <span class="console-section-title">{{ t('console.active') }}</span>
        <div class="console-table-wrap">
          <table class="console-table" v-if="store.tabs.length">
            <thead>
              <tr>
                <th>{{ t('console.colProvider') }}</th>
                <th>{{ t('console.colEnvironment') }}</th>
                <th>{{ t('console.colScope') }}</th>
                <th>{{ t('console.colTarget') }}</th>
                <th>{{ t('console.colStatus') }}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="tab in store.tabs" :key="tab.id" :class="['console-row', { active: tab.id === store.activeId }]" @click="store.activateTab(tab.id)">
                <td><span class="console-provider-chip">{{ tab.provider || 'kubernetes' }}</span></td>
                <td>{{ tab.environment || 'default' }}</td>
                <td>{{ tab.region || tab.project || '—' }}</td>
                <td class="console-target" :title="targetSummary(tab)">{{ targetSummary(tab) }}</td>
                <td><span :class="['console-status-badge', `state-${tab.connectionState || 'idle'}`]">{{ tab.connectionState || 'idle' }}</span></td>
                <td class="console-row-actions">
                  <button class="btn sm btn-icon console-action-reconnect" :title="t('console.reconnect')" @click.stop="reconnect(tab)"><i data-lucide="refresh-cw"></i></button>
                  <button class="btn sm btn-icon console-action-close" :title="t('console.close')" @click.stop="store.closeTab(tab.id)"><i data-lucide="x"></i></button>
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

        <div v-for="group in otherGroups" :key="group.provider" class="console-launcher-card">
          <div class="console-launcher-card-header">
            <i :data-lucide="providerIcon(group.provider)"></i>
            <strong>{{ group.provider.toUpperCase() }}</strong>
          </div>
          <div class="console-capability-row" v-for="capability in group.capabilities" :key="capability.id">
            <span>{{ capability.id }}</span>
            <span v-if="capability.status === 'available'" class="console-hint">{{ t('console.availableElsewhere') }}</span>
            <span v-else class="console-planned-badge">{{ t('console.planned') }}</span>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, reactive } from 'vue'
import { createIcons, icons } from 'lucide'
import { useI18n } from '../composables/useI18n.js'
import { useTerminalStore } from '../stores/useTerminalStore'
import { useTerminalStreams } from '../composables/useTerminalStreams'
import { useKubeStore } from '../stores/useKubeStore'

const { t } = useI18n()
const store = useTerminalStore()
const kubeStore = useKubeStore()
const { startLogStream, startExecStream, startLocalStream, startSshStream } = useTerminalStreams()

const kubeForm = reactive({ context: '', namespace: '', name: '', resourceType: 'pods' })
const ec2Form = reactive({ host: '', user: 'ec2-user', port: 22, profileId: '' })

const PROVIDER_ORDER = ['local', 'kubernetes', 'aws', 'gcp', 'vercel']
const PROVIDER_ICONS = { aws: 'cloud', gcp: 'cloud', vercel: 'triangle' }

const kubernetesLogsCapability = computed(() => store.capabilityRegistry.find(c => c.id === 'kubernetes-logs'))
const kubernetesExecCapability = computed(() => store.capabilityRegistry.find(c => c.id === 'kubernetes-exec'))

// ec2-ssh gets its own dedicated launcher card (like Kubernetes) since it's now a real,
// store-backed tab; the remaining AWS/GCP/Vercel capabilities stay hint/planned-only.
const otherGroups = computed(() => {
  const groups = {}
  for (const capability of store.capabilityRegistry) {
    if (capability.provider === 'local' || capability.provider === 'kubernetes' || capability.id === 'ec2-ssh') continue
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
  else startLogStream(tab, false, { reconnect: true })
}

function connectLocal() {
  const tab = store.openLocalTab()
  startLocalStream(tab)
}

function connectKubernetes(transport) {
  const context = kubeForm.context ? { kubeContext: kubeForm.context } : {}
  if (transport === 'exec') {
    const tab = store.openExecTab(kubeForm.namespace, kubeForm.name, [], context)
    startExecStream(tab)
  } else {
    const tab = store.openLogsTab(kubeForm.namespace, kubeForm.name, [], kubeForm.resourceType, context)
    startLogStream(tab)
  }
}

function connectEc2Ssh() {
  const tab = store.openCloudTab('ec2', `${ec2Form.user}@${ec2Form.host}`, {
    profileId: ec2Form.profileId,
    target: { host: ec2Form.host, user: ec2Form.user || 'ec2-user', port: ec2Form.port || 22 },
  })
  startSshStream(tab)
}

onMounted(() => {
  if (!kubeStore.contexts.length) kubeStore.loadContexts()
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
.console-table th { position: sticky; top: 0; background: var(--bg-panel); padding: 8px 12px; text-align: left; font-weight: 600; color: var(--text-dim); border-bottom: 1px solid var(--border); white-space: nowrap; }
.console-row { cursor: pointer; }
.console-row:hover { background: color-mix(in srgb, var(--text) 4%, transparent); }
.console-row.active { background: color-mix(in srgb, #2f81f7 10%, transparent); }
.console-row td { padding: 7px 12px; border-bottom: 1px solid var(--border); vertical-align: middle; }
.console-target { max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: monospace; font-size: 0.78rem; }
.console-row-actions { display: flex; gap: 4px; justify-content: flex-end; }
.console-provider-chip { padding: 2px 8px; border-radius: 10px; font-size: 0.72rem; background: color-mix(in srgb, var(--text) 8%, transparent); color: var(--text-dim); }
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

@media (max-width: 860px) {
  .console-body { grid-template-columns: 1fr; overflow-y: auto; overflow-x: hidden; }
  .console-sessions, .console-launcher { overflow: visible; }
}
</style>
