<template>
  <Teleport to="body">
    <div v-show="open" class="ec2sh-backdrop" @mousedown.self="$emit('close')">
      <div class="ec2sh-modal">

        <!-- Header -->
        <div class="ec2sh-header">
          <div class="ec2sh-title">
            <span class="ec2sh-icon">&#x1F5A5;</span>
            <span>SSH &mdash; {{ instance?.name || instance?.id }}</span>
            <span v-if="instance?.publicIp" class="ec2sh-host-badge">{{ instance.publicIp }}</span>
          </div>
          <div class="ec2sh-hdr-right">
            <span :class="['ec2sh-status', sessionStatus]">{{ statusLabel }}</span>
            <button class="ec2sh-close" @click="$emit('close')">&#x2715;</button>
          </div>
        </div>

        <!-- Connect form (shown when not connected) -->
        <div v-if="sessionStatus === 'disconnected' || sessionStatus === 'config'" class="ec2sh-form">
          <p v-if="contextError" role="alert">{{ contextError }}</p>
          <div class="ec2sh-form-row">
            <label>Host / IP</label>
            <input v-model="form.host" placeholder="e.g. 1.2.3.4" class="ec2sh-input" />
          </div>
          <div class="ec2sh-form-row">
            <label>User</label>
            <input v-model="form.user" placeholder="ec2-user" class="ec2sh-input" style="width:130px" />
          </div>
          <div class="ec2sh-form-row">
            <label>Port</label>
            <input v-model.number="form.port" type="number" min="1" max="65535" placeholder="22" class="ec2sh-input" style="width:80px" />
          </div>
          <div class="ec2sh-form-row">
            <label>Credential profile ID</label>
            <input v-model="form.profileId" placeholder="Env Manager profile: SSH_PRIVATE_KEY or SSH_PASSWORD" class="ec2sh-input ec2sh-input-wide" />
          </div>

          <div class="ec2sh-form-actions">
            <button class="btn" @click="connect" :disabled="!form.host || !form.profileId">Connect</button>
            <button class="btn btn-ghost" @click="$emit('close')">Cancel</button>
          </div>
        </div>

        <!-- Terminal area -->
        <div v-show="sessionStatus !== 'disconnected' && sessionStatus !== 'config'" class="ec2sh-term-wrap">

          <div class="ec2sh-toolbar">
            <span class="ec2sh-conn-info">{{ form.user }}@{{ form.host }}:{{ form.port }}</span>
            <div class="ec2sh-toolbar-btns">
              <span v-if="clipboardMsg" class="ec2sh-clip-msg">{{ clipboardMsg }}</span>
              <button class="ec2sh-tbtn" title="Copy selected terminal text" @click="copySelectedOutput">Copy selected</button>
              <button class="ec2sh-tbtn" title="Copy all terminal output" @click="copyAllOutput">Copy output</button>
              <button class="ec2sh-tbtn" title="Paste clipboard into command input" @click="pasteIntoInput">Paste</button>
              <button class="ec2sh-tbtn" title="Ctrl+C" @click="sendCtrlC">&#x23F9; INT</button>
              <button class="ec2sh-tbtn" title="Ctrl+D" @click="sendCtrlD">EOF</button>
              <button class="ec2sh-tbtn" @click="clearOutput">Clear</button>
              <button v-if="sessionStatus === 'ended'" class="ec2sh-tbtn accent" @click="connect">Reconnect</button>
              <button v-else class="ec2sh-tbtn" @click="disconnect">Disconnect</button>
            </div>
          </div>

          <div class="ec2sh-output" ref="outputRef" v-html="outputHtml"></div>

          <div class="ec2sh-input-bar">
            <span class="ec2sh-prompt">&#x276F;</span>
            <input
              ref="inputRef"
              v-model="cmdInput"
              class="ec2sh-cmd-input"
              :placeholder="inputPlaceholder"
              :disabled="sessionStatus !== 'connected'"
              @keydown.enter.prevent="sendCmd"
              @keydown.up.prevent="historyUp"
              @keydown.down.prevent="historyDown"
              @keydown.ctrl.c.prevent="sendCtrlC"
            />
          </div>
        </div>

      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, computed, watch, nextTick, onUnmounted } from 'vue'
import { useTerminalStore } from '../../stores/useTerminalStore'
import { useTerminalStreams } from '../../composables/useTerminalStreams'

const props = defineProps({
  open:          { type: Boolean, default: false },
  instance:      { type: Object,  default: null  },
  environment:   { type: String,  default: ''    },
  applicationId: { type: String,  default: ''    },
})
defineEmits(['close'])

// ── State ─────────────────────────────────────────────────────────────────────
// The session itself lives in useTerminalStore (shared with the quick panel and the
// Console workspace) — this component only owns the connect form and its own UI chrome.
const store = useTerminalStore()
const { startSshStream } = useTerminalStreams()

const outputRef  = ref(null)
const inputRef   = ref(null)

const tab = ref(null)
const contextError = ref('')
const outputHtml    = computed(() => (tab.value?.lines || []).join(''))
const cmdInput      = ref('')
const historyIdx    = ref(-1)
const clipboardMsg  = ref('')
let clipboardTimer = null

const form = ref({
  host:       '',
  user:       'ec2-user',
  port:       22,
  profileId:  '',
})

const sessionStatus = computed(() => {
  if (contextError.value) return 'config'
  if (!tab.value) return 'disconnected'
  const state = tab.value.connectionState
  if (['validating', 'connecting', 'reconnecting'].includes(state)) return 'connecting'
  if (state === 'connected') return 'connected'
  if (['error', 'done', 'stopped'].includes(state)) return 'ended'
  return 'disconnected'
})

// ── Watchers ──────────────────────────────────────────────────────────────────
watch(() => props.open, (val) => {
  if (!val) return
  if (props.instance && !form.value.host) {
    form.value.host = props.instance.publicIp || props.instance.privateIp || ''
  }
  nextTick(() => inputRef.value?.focus())
}, { immediate: true })

watch(sessionStatus, status => { if (status === 'connected') nextTick(() => inputRef.value?.focus()) })

// ── Computed ──────────────────────────────────────────────────────────────────
const statusLabel = computed(() => {
  const map = {
    disconnected: 'Disconnected',
    config:       'Configure',
    connecting:   'Connecting...',
    connected:    `Connected`,
    ended:        'Session ended',
  }
  return map[sessionStatus.value] || sessionStatus.value
})

const inputPlaceholder = computed(() => {
  if (sessionStatus.value === 'connected')  return 'Type command and press Enter...'
  if (sessionStatus.value === 'connecting') return 'Connecting...'
  return 'Session ended - click Reconnect'
})

// ── WebSocket ─────────────────────────────────────────────────────────────────
// The session lives in useTerminalStore: connecting attaches to (or creates) a shared
// tab, so the same host/user/profile reused from the Console workspace's launcher
// converges on one session instead of opening a second parallel connection.
async function connect() {
  contextError.value = ''
  const nextTab = store.openCloudTab('ec2', `${form.value.user}@${form.value.host}`, {
    profileId: form.value.profileId,
    environment: props.environment,
    applicationId: props.applicationId,
    target: { host: form.value.host, user: form.value.user || 'ec2-user', port: form.value.port || 22, instanceId: props.instance?.id },
  })
  const isReconnect = Boolean(nextTab.entries?.length)
  tab.value = nextTab
  await startSshStream(tab.value, { reconnect: isReconnect })
  if (!tab.value.ws) contextError.value = 'Invalid console context or credential profile'
}

function disconnect() {
  if (!tab.value) return
  store.stopStream(tab.value)
  store.pushLine(tab.value, 'Disconnected by user', 'sys')
}

// ── Output helpers ────────────────────────────────────────────────────────────
function clearOutput() {
  if (tab.value) { tab.value.lines = []; tab.value.entries = []; tab.value.lineCount = 0 }
  sendRaw('\x0C')
}

function htmlToText(html) {
  const div = document.createElement('div')
  div.innerHTML = String(html)
  div.querySelectorAll('.ts').forEach(node => node.remove())
  return div.textContent || div.innerText || ''
}

function getSelectedOutputText() {
  const selection = window.getSelection?.()
  if (!selection || selection.isCollapsed || !outputRef.value) return ''
  const anchorNode = selection.anchorNode
  const focusNode = selection.focusNode
  if (!outputRef.value.contains(anchorNode) && !outputRef.value.contains(focusNode)) return ''
  return selection.toString()
}

async function writeClipboardText(text, successMsg = 'Copied') {
  if (!text) {
    showClipboardMsg('No text selected')
    return false
  }
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
    } else {
      const textarea = document.createElement('textarea')
      textarea.value = text
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      textarea.remove()
    }
    showClipboardMsg(successMsg)
    return true
  } catch (_) {
    showClipboardMsg('Copy failed')
    return false
  }
}

function copySelectedOutput() {
  writeClipboardText(getSelectedOutputText(), 'Selection copied')
}

function copyAllOutput() {
  writeClipboardText((tab.value?.lines || []).map(htmlToText).join('\n'), 'Output copied')
}

async function pasteIntoInput() {
  try {
    const text = await navigator.clipboard?.readText?.()
    if (!text) {
      showClipboardMsg('Clipboard empty')
      return
    }
    if (text.includes('\n') && !confirm('Clipboard has multiple lines. Paste into input without running it?')) return
    cmdInput.value += text
    showClipboardMsg('Pasted')
    nextTick(() => inputRef.value?.focus())
  } catch (_) {
    showClipboardMsg('Paste failed')
  }
}

function showClipboardMsg(message) {
  clipboardMsg.value = message
  clearTimeout(clipboardTimer)
  clipboardTimer = setTimeout(() => { clipboardMsg.value = '' }, 1800)
}

function scrollToEnd() {
  nextTick(() => {
    if (outputRef.value) outputRef.value.scrollTop = outputRef.value.scrollHeight
  })
}
watch(() => tab.value?.entries?.length, () => scrollToEnd())

// ── Command input ─────────────────────────────────────────────────────────────
function sendCmd() {
  if (sessionStatus.value !== 'connected') return
  const cmd = cmdInput.value
  store.pushLine(tab.value, '❯ ' + cmd, 'cmd')
  store.pushHistory(tab.value, cmd)
  historyIdx.value = -1
  sendRaw(cmd + '\n')
  cmdInput.value = ''
}

function sendRaw(data) {
  if (tab.value?.ws?.readyState === WebSocket.OPEN)
    tab.value.ws.send(JSON.stringify({ action: 'stdin', data }))
}

function sendCtrlC() { sendRaw('\x03') }
function sendCtrlD() { sendRaw('\x04') }

function historyUp() {
  const history = store.historyFor(tab.value)
  if (!history.length) return
  historyIdx.value = Math.min(historyIdx.value + 1, history.length - 1)
  cmdInput.value   = history[historyIdx.value]
}

function historyDown() {
  const history = store.historyFor(tab.value)
  if (historyIdx.value <= 0) { historyIdx.value = -1; cmdInput.value = ''; return }
  historyIdx.value--
  cmdInput.value = history[historyIdx.value]
}

onUnmounted(() => { if (tab.value) store.stopStream(tab.value) })
</script>

<style scoped>
.ec2sh-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,.65);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 900;
}
.ec2sh-modal {
  background: #0d1117;
  border: 1px solid #30363d;
  border-radius: 10px;
  width: min(92vw, 920px);
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 24px 60px rgba(0,0,0,.7);
}

/* Header */
.ec2sh-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  background: #161b22;
  border-bottom: 1px solid #21262d;
  gap: 8px;
}
.ec2sh-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  color: #e6edf3;
  font-size: 0.95rem;
}
.ec2sh-icon { font-size: 1.1rem; }
.ec2sh-host-badge {
  background: rgba(88,166,255,.15);
  color: #58a6ff;
  border: 1px solid rgba(88,166,255,.3);
  border-radius: 4px;
  padding: 1px 7px;
  font-size: 0.78rem;
  font-family: monospace;
}
.ec2sh-hdr-right { display: flex; align-items: center; gap: 10px; }
.ec2sh-status {
  font-size: 0.78rem;
  padding: 2px 8px;
  border-radius: 12px;
  font-weight: 500;
}
.ec2sh-status.disconnected { background: rgba(139,148,158,.2); color: #8b949e; }
.ec2sh-status.connecting   { background: rgba(210,153,34,.2);  color: #d29922; }
.ec2sh-status.connected    { background: rgba(63,185,80,.2);   color: #3fb950; }
.ec2sh-status.ended        { background: rgba(248,81,73,.2);   color: #f85149; }
.ec2sh-close {
  background: none; border: none; color: #8b949e; cursor: pointer;
  font-size: 1rem; padding: 2px 4px; border-radius: 4px;
}
.ec2sh-close:hover { color: #e6edf3; background: rgba(255,255,255,.1); }

/* Form */
.ec2sh-form {
  padding: 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.ec2sh-form-row {
  display: flex;
  align-items: center;
  gap: 12px;
}
.ec2sh-form-row label {
  color: #8b949e;
  font-size: 0.85rem;
  min-width: 110px;
  text-align: right;
}
.ec2sh-input {
  background: #161b22;
  border: 1px solid #30363d;
  color: #e6edf3;
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 0.87rem;
  font-family: monospace;
  width: 240px;
  outline: none;
  transition: border-color .15s;
}
.ec2sh-input:focus { border-color: #388bfd; }
.ec2sh-input-wide { width: 340px; }
.ec2sh-form-actions {
  display: flex;
  gap: 10px;
  padding-top: 6px;
  margin-left: 122px;
}
.ec2sh-radio-group {
  display: flex;
  gap: 16px;
  align-items: center;
}
.ec2sh-radio-label {
  display: flex;
  align-items: center;
  gap: 5px;
  color: #e6edf3;
  font-size: 0.85rem;
  cursor: pointer;
}
.btn-browse {
  padding: 5px 9px;
  font-size: 0.9rem;
  margin-left: 4px;
  background: rgba(139,148,158,.12);
  border-color: #30363d;
  color: #8b949e;
}
.btn-browse:hover { background: rgba(255,255,255,.08); color: #e6edf3; }

/* Terminal */
.ec2sh-term-wrap {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
.ec2sh-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  background: #161b22;
  border-bottom: 1px solid #21262d;
  font-size: 0.78rem;
  gap: 8px;
}
.ec2sh-conn-info {
  color: #58a6ff;
  font-family: monospace;
  font-size: 0.8rem;
}
.ec2sh-toolbar-btns { display: flex; gap: 6px; align-items: center; }
.ec2sh-clip-msg { color: #8b949e; font-size: 0.74rem; white-space: nowrap; }
.ec2sh-tbtn {
  background: rgba(139,148,158,.12);
  border: 1px solid #30363d;
  color: #8b949e;
  border-radius: 4px;
  padding: 2px 9px;
  font-size: 0.75rem;
  cursor: pointer;
  transition: all .15s;
}
.ec2sh-tbtn:hover { background: rgba(255,255,255,.08); color: #e6edf3; }
.ec2sh-tbtn.accent { background: rgba(63,185,80,.15); border-color: #3fb950; color: #3fb950; }
.ec2sh-tbtn.accent:hover { background: rgba(63,185,80,.25); }

.ec2sh-output {
  flex: 1;
  overflow-y: auto;
  padding: 10px 14px;
  font-family: 'Consolas', 'Menlo', monospace;
  font-size: 0.82rem;
  line-height: 1.5;
  background: #0d1117;
  min-height: 320px;
  max-height: 52vh;
  user-select: text;
}

.ec2sh-input-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: #161b22;
  border-top: 1px solid #21262d;
}
.ec2sh-prompt { color: #3fb950; font-size: 1rem; }
.ec2sh-cmd-input {
  flex: 1;
  background: transparent;
  border: none;
  color: #e6edf3;
  font-family: 'Consolas', 'Menlo', monospace;
  font-size: 0.87rem;
  outline: none;
}
.ec2sh-cmd-input:disabled { color: #8b949e; }

/* Output line styles */
/* Line markup here matches useTerminalStore's pushLine() output (shared with the
   quick panel/Console workspace), not a bespoke format. */
:deep(.term-line)            { white-space: pre-wrap; word-break: break-all; padding: 0 2px; color: #e6edf3; }
:deep(.term-line .ts)        { color: #484f58; margin-right: 8px; font-size: 0.75rem; user-select: none; }
:deep(.term-line.sys)        { color: #8b949e; font-style: italic; }
:deep(.term-line.err)        { color: #f85149; }
:deep(.term-line.cmd)        { color: #79c0ff; }

/* btn reuse */
.btn {
  background: rgba(88,166,255,.15);
  border: 1px solid rgba(88,166,255,.4);
  color: #58a6ff;
  border-radius: 6px;
  padding: 6px 16px;
  font-size: 0.87rem;
  cursor: pointer;
  transition: all .15s;
}
.btn:hover { background: rgba(88,166,255,.25); }
.btn:disabled { opacity: .4; cursor: not-allowed; }
.btn-ghost {
  background: transparent;
  border-color: #30363d;
  color: #8b949e;
}
.btn-ghost:hover { color: #e6edf3; background: rgba(255,255,255,.05); }
</style>
