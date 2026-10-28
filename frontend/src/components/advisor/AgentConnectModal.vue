<template>
  <BaseModal :show="show" wide @close="$emit('close')">
    <template #title>{{ t('agentConnect.title') }}</template>
    <div class="acm" data-test="agent-connect">
      <p class="acm-intro">{{ t('agentConnect.intro') }}</p>
      <PlanNote feature="agents" />
      <p v-if="loading" class="acm-dim">{{ t('common.loading') }}</p>
      <p v-else-if="error" class="acm-notice"><i data-lucide="alert-triangle"></i>{{ error }}</p>
      <template v-else-if="launch">
        <div class="acm-tabs" role="tablist">
          <button
            v-for="client in CLIENTS" :key="client.id" role="tab"
            :class="['acm-tab', { active: active === client.id }]" :aria-selected="active === client.id"
            :data-test="`agent-connect-${client.id}`" @click="active = client.id"
          >{{ t(`agentConnect.client.${client.id}`) }}</button>
        </div>
        <p class="acm-dim">{{ t(`agentConnect.hint.${active}`) }}</p>
        <div class="acm-snippet">
          <button class="btn sm" @click="copy(snippet)">{{ t('agentConnect.copy') }}</button>
          <pre><code data-test="agent-connect-snippet">{{ snippet }}</code></pre>
        </div>
        <div class="acm-actions">
          <button v-if="installable" class="btn sm primary" :disabled="!!busy" data-test="agent-connect-install" @click="install">
            {{ busy === 'install' ? t('agentConnect.installing') : t('agentConnect.install', { client: t(`agentConnect.client.${active}`) }) }}
          </button>
          <button v-if="fileClient?.added" class="btn sm" :disabled="!!busy" data-test="agent-connect-uninstall" @click="uninstall">
            {{ t('agentConnect.remove', { client: t(`agentConnect.client.${active}`) }) }}
          </button>
          <a v-if="active === 'claudeDesktop'" class="btn sm" href="/api/system/mcp/mcpb" download="kua.mcpb" data-test="agent-connect-mcpb">{{ t('agentConnect.downloadMcpb') }}</a>
          <button class="btn sm" :disabled="!!busy" data-test="agent-connect-verify" @click="verify">
            {{ busy === 'verify' ? t('agentConnect.verifying') : t('agentConnect.verify') }}
          </button>
        </div>
        <p v-if="fileClient" class="acm-dim" data-test="agent-connect-file">{{ t(fileClient.added ? 'agentConnect.fileAdded' : 'agentConnect.fileNotAdded', { file: fileClient.file }) }}</p>
        <p v-if="outcome" :class="['acm-outcome', outcome.ok ? 'ok' : 'warn']" data-test="agent-connect-outcome">{{ outcome.text }}</p>
        <!-- Agents on this computer: off refuses every MCP request (lib/agentPlanGuard.js). -->
        <label class="acm-writes" data-test="agent-enabled">
          <input type="checkbox" :checked="agentEnabled" :disabled="writesBusy" @change="setAgentAccess({ enabled: $event.target.checked })" />
          <span><strong>{{ t('agentConnect.enabled') }}</strong><small>{{ t(agentEnabled ? 'agentConnect.enabledOn' : 'agentConnect.enabledOff') }}</small></span>
        </label>
        <!-- KUApps changes from agents (#155): off until the user allows them on this computer. -->
        <label class="acm-writes" data-test="agent-writes">
          <input type="checkbox" :checked="agentWrites" :disabled="writesBusy || !agentEnabled" @change="setAgentAccess({ writes: $event.target.checked })" />
          <span><strong>{{ t('agentConnect.writes') }}</strong><small>{{ t(agentWrites ? 'agentConnect.writesOn' : 'agentConnect.writesOff') }}</small></span>
        </label>
        <ul class="acm-notes">
          <li>{{ t('agentConnect.noteOpen') }}</li>
          <li v-if="launch.packaged">{{ t('agentConnect.notePackaged') }}</li>
          <li>{{ t('agentConnect.noteReadOnly') }}</li>
          <li>{{ t('agentConnect.noteChatgpt') }}</li>
        </ul>
      </template>
    </div>
    <template #footer>
      <a class="btn sm" href="https://github.com/lnavarrocarter/kuadashboard/blob/main/docs/features/ai-agents.md" target="_blank" rel="noopener noreferrer">{{ t('agentConnect.docs') }} ↗</a>
      <button class="btn sm" @click="$emit('close')">{{ t('agentConnect.close') }}</button>
    </template>
  </BaseModal>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import BaseModal from '../BaseModal.vue'
import PlanNote from '../PlanNote.vue'
import { useApi } from '../../composables/useApi'
import { useI18n } from '../../composables/useI18n'
import { useToast } from '../../composables/useToast'
import { claudeCommand, codexCommand, codexToml, jsonConfig } from '../../lib/mcpSetup'

const props = defineProps({ show: { type: Boolean, default: false } })
defineEmits(['close'])

const CLIENTS = [
  { id: 'claude', build: claudeCommand },
  { id: 'claudeDesktop', build: jsonConfig },
  { id: 'codex', build: codexCommand },
  // Agents configured by a JSON file in the home folder (#307): KUA writes only its own entry.
  { id: 'cursor', build: jsonConfig },
  { id: 'windsurf', build: jsonConfig },
  { id: 'gemini', build: jsonConfig },
  { id: 'json', build: jsonConfig },
  { id: 'toml', build: codexToml },
]

const { t } = useI18n()
const { apiFetch } = useApi()
const { toast } = useToast()
const launch = ref(null)
const loading = ref(false)
const error = ref('')
const active = ref('claude')

const snippet = computed(() => (launch.value ? CLIENTS.find(client => client.id === active.value).build(launch.value) : ''))
// Claude Code and Codex have a CLI that KUA can run for the user; Claude Desktop gets kua.mcpb
// opened (POST /api/system/mcp/install, #306).
const FILE_CLIENTS = ['cursor', 'windsurf', 'gemini']
const installable = computed(() => ['claude', 'claudeDesktop', 'codex', ...FILE_CLIENTS].includes(active.value))
// For file agents: { file, present, added } from GET /api/system/mcp/clients.
const fileClients = ref({})
const fileClient = computed(() => (FILE_CLIENTS.includes(active.value) ? fileClients.value[active.value] || null : null))
async function loadFileClients() {
  try {
    const { clients = [] } = await apiFetch('/api/system/mcp/clients')
    fileClients.value = Object.fromEntries(clients.map(item => [item.client, item]))
  } catch { fileClients.value = {} }
}

async function uninstall() {
  const client = t(`agentConnect.client.${active.value}`)
  busy.value = 'uninstall'
  try {
    const result = await post('/api/system/mcp/uninstall', { client: active.value })
    outcome.value = { ok: true, text: t(result?.removed ? 'agentConnect.removed' : 'agentConnect.notAdded', { client }) }
  } catch (err) {
    outcome.value = { ok: false, text: t('agentConnect.installFailed', { error: err.message }) }
  } finally { busy.value = ''; loadFileClients() }
}
// 'install' | 'verify' while one runs; outcome: { ok, text } of the last one.
const busy = ref('')
const agentEnabled = ref(true)
const agentWrites = ref(false)
const writesBusy = ref(false)

function applyAccess(access) {
  agentEnabled.value = access?.enabled !== false
  agentWrites.value = access?.writes === true
}

// Only the switch that changed is sent: { enabled } or { writes }.
async function setAgentAccess(changes) {
  writesBusy.value = true
  try {
    applyAccess(await apiFetch('/api/kua-apps/agent-access', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(changes) }))
  } catch (err) {
    toast(err.message, 'error')
  } finally { writesBusy.value = false }
}
const outcome = ref(null)
watch(active, () => { outcome.value = null })

async function post(path, body) {
  return apiFetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) })
}

async function install() {
  const client = t(`agentConnect.client.${active.value}`)
  busy.value = 'install'
  try {
    const result = await post('/api/system/mcp/install', { client: active.value })
    // Claude Code gets the KUA plugin (server and skill) from this computer when its CLI can (#305).
    const done = { plugin: 'agentConnect.installedPlugin', mcpb: 'agentConnect.installedDesktop', config: 'agentConnect.installedConfig' }[result?.mode] || 'agentConnect.installed'
    outcome.value = { ok: true, text: t(done, { client, file: result?.file || '' }) }
  } catch (err) {
    const code = err.details?.code
    outcome.value = { ok: false, text: code === 'CLI_NOT_FOUND' ? t('agentConnect.installMissing', { client }) : code === 'MCPB_MISSING' ? t('agentConnect.mcpbMissing') : t('agentConnect.installFailed', { error: err.message }) }
  } finally { busy.value = ''; if (FILE_CLIENTS.includes(active.value)) loadFileClients() }
}

async function verify() {
  busy.value = 'verify'
  try {
    const result = await post('/api/system/mcp/verify')
    if (!result.ok) outcome.value = { ok: false, text: t('agentConnect.verifyFailed', { error: result.error }) }
    // Two KUAs open: the MCP server reads the newest one, which may not be this window.
    else if (result.kua?.url && result.thisKua && new URL(result.kua.url).port !== new URL(result.thisKua).port) outcome.value = { ok: false, text: t('agentConnect.verifyOtherKua', { url: result.kua.url, here: result.thisKua }) }
    else outcome.value = { ok: true, text: t('agentConnect.verifyOk', { tools: result.tools, kua: [`KUA${result.kua?.version ? ` ${result.kua.version}` : ''}`, result.kua?.url].filter(Boolean).join(' · '), profiles: result.profiles ?? 0 }) }
  } catch (err) {
    outcome.value = { ok: false, text: t('agentConnect.verifyFailed', { error: err.message }) }
  } finally { busy.value = '' }
}

async function load() {
  // The switches can change from the tray panel while this modal is closed.
  if (launch.value) {
    apiFetch('/api/kua-apps/agent-access').then(applyAccess).catch(() => {})
    return
  }
  if (loading.value) return
  loading.value = true
  error.value = ''
  try {
    const [nextLaunch, access] = await Promise.all([
      apiFetch('/api/system/mcp'),
      apiFetch('/api/kua-apps/agent-access').catch(() => ({ writes: false })),
    ])
    launch.value = nextLaunch
    applyAccess(access)
    loadFileClients()
  } catch (err) {
    error.value = err.message
  } finally {
    loading.value = false
  }
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text)
    toast(t('agentConnect.copied'), 'success')
  } catch {
    toast(t('agentBrief.copyFailed'), 'error')
  }
}

watch(() => props.show, show => { if (show) load() }, { immediate: true })
</script>

<style scoped>
.acm { display: flex; flex-direction: column; gap: 10px; font-size: 12px; min-width: 0; }
.acm-intro { margin: 0; line-height: 1.5; }
.acm-writes { display: flex; gap: 8px; align-items: flex-start; padding: 8px 10px; border: 1px solid var(--border); border-radius: 6px; cursor: pointer; }
.acm-writes span { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.acm-writes small { color: var(--text-dim); line-height: 1.4; }
.acm-dim { margin: 0; color: var(--text-dim); }
.acm-notice { margin: 0; color: var(--yellow); display: flex; gap: 6px; align-items: center; }
.acm-notice svg { width: 14px; height: 14px; }
.acm-tabs { display: flex; gap: 4px; flex-wrap: wrap; border-bottom: 1px solid var(--border); }
.acm-tab { padding: 6px 10px; border: 0; border-bottom: 2px solid transparent; background: transparent; color: var(--text-dim); font-size: 12px; cursor: pointer; }
.acm-tab:hover { color: var(--text); }
.acm-tab.active { color: var(--text); border-bottom-color: var(--accent); }
.acm-snippet { position: relative; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); min-width: 0; }
.acm-snippet .btn { position: absolute; top: 6px; right: 6px; }
.acm-snippet pre { margin: 0; padding: 10px 12px; padding-right: 80px; overflow-x: auto; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 11px; }
.acm-actions { display: flex; gap: 6px; flex-wrap: wrap; }
.acm-outcome { margin: 0; line-height: 1.5; overflow-wrap: anywhere; }
.acm-outcome.ok { color: var(--green); }
.acm-outcome.warn { color: var(--yellow); }
.acm-notes { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 4px; color: var(--text-dim); line-height: 1.5; }
</style>
