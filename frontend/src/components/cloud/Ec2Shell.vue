<template>
  <Teleport to="body">
    <div v-if="open" class="ec2sh-backdrop" @mousedown.self="$emit('close')">
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
            <label>Auth method</label>
            <div class="ec2sh-radio-group">
              <label class="ec2sh-radio-label">
                <input type="radio" v-model="form.authMethod" value="key" /> PEM key
              </label>
              <label class="ec2sh-radio-label">
                <input type="radio" v-model="form.authMethod" value="password" /> Password
              </label>
            </div>
          </div>

          <!-- Key-based auth -->
          <template v-if="form.authMethod === 'key'">
            <div class="ec2sh-form-row">
              <label>Key file (.pem)</label>
              <input v-model="form.keyPath" placeholder="/path/to/key.pem" class="ec2sh-input ec2sh-input-wide" />
              <button class="btn btn-browse" @click="browseKeyFile" title="Browse file">&#x1F4C2;</button>
            </div>
            <div class="ec2sh-form-row">
              <label>Passphrase</label>
              <input v-model="form.passphrase" type="password" placeholder="(optional)" class="ec2sh-input" style="width:180px" />
            </div>
          </template>

          <!-- Password auth -->
          <template v-else>
            <div class="ec2sh-form-row">
              <label>Password</label>
              <input v-model="form.password" type="password" placeholder="SSH password" class="ec2sh-input" style="width:240px" />
            </div>
          </template>

          <div class="ec2sh-form-actions">
            <button class="btn" @click="connect" :disabled="!form.host || (form.authMethod === 'key' ? !form.keyPath : !form.password)">Connect</button>
            <button class="btn btn-ghost" @click="$emit('close')">Cancel</button>
          </div>
        </div>

        <!-- Terminal area -->
        <div v-show="sessionStatus !== 'disconnected' && sessionStatus !== 'config'" class="ec2sh-term-wrap">

          <div class="ec2sh-toolbar">
            <span class="ec2sh-conn-info">{{ form.user }}@{{ form.host }}:{{ form.port }}</span>
            <div class="ec2sh-toolbar-btns">
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
              @keydown.c.exact="(e) => { if (e.ctrlKey) sendCtrlC() }"
            />
          </div>
        </div>

      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, computed, watch, nextTick, onUnmounted, markRaw } from 'vue'

const props = defineProps({
  open:     { type: Boolean, default: false },
  instance: { type: Object,  default: null  },
})
defineEmits(['close'])

// ── WS URL builder ────────────────────────────────────────────────────────────
function wsUrl(path) {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${location.host}${path}`
}

// ── State ─────────────────────────────────────────────────────────────────────
const outputRef  = ref(null)
const inputRef   = ref(null)

const sessionStatus = ref('disconnected')
const ws            = ref(null)
const outputLines   = ref([])
const outputHtml    = computed(() => outputLines.value.join(''))
const cmdInput      = ref('')
const cmdHistory    = ref([])
const historyIdx    = ref(-1)

const form = ref({
  host:       '',
  user:       'ec2-user',
  port:       22,
  authMethod: 'key',
  keyPath:    '',
  passphrase: '',
  password:   '',
})

// ── Watchers ──────────────────────────────────────────────────────────────────
watch(() => props.open, (val) => {
  if (val) {
    // Pre-fill host from instance
    if (props.instance) {
      form.value.host = props.instance.publicIp || props.instance.privateIp || ''
    }
    outputLines.value   = []
    sessionStatus.value = 'disconnected'
    nextTick(() => inputRef.value?.focus())
  } else {
    disconnectWs()
  }
})

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
function connect() {
  disconnectWs()
  sessionStatus.value = 'connecting'

  const sock = markRaw(new WebSocket(wsUrl('/ws/ec2-shell')))
  ws.value   = sock

  sock.addEventListener('open', () => {
    const payload = {
      action:     'connect',
      host:       form.value.host,
      user:       form.value.user || 'ec2-user',
      port:       form.value.port || 22,
      authMethod: form.value.authMethod,
    }
    if (form.value.authMethod === 'key') {
      payload.keyPath    = form.value.keyPath
      payload.passphrase = form.value.passphrase || undefined
    } else {
      payload.password = form.value.password
    }
    sock.send(JSON.stringify(payload))
  })

  sock.addEventListener('message', e => {
    let msg
    try { msg = JSON.parse(e.data) } catch (_) { return }

    if (msg.type === 'connected') {
      sessionStatus.value = 'connected'
      pushSys(`Connected to ${msg.user}@${msg.host}`)
      nextTick(() => inputRef.value?.focus())
    } else if (msg.type === 'out') {
      appendOutput(msg.data)
    } else if (msg.type === 'err') {
      appendOutput(msg.data, 'err')
    } else if (msg.type === 'error') {
      pushSys('Error: ' + msg.data, 'err')
      sessionStatus.value = 'ended'
    } else if (msg.type === 'done') {
      pushSys(`Session ended (exit ${msg.code})`, 'sys')
      sessionStatus.value = 'ended'
    }
  })

  sock.addEventListener('close', () => {
    if (sessionStatus.value === 'connected') {
      pushSys('Connection closed', 'sys')
      sessionStatus.value = 'ended'
    } else if (sessionStatus.value === 'connecting') {
      pushSys('Could not connect', 'err')
      sessionStatus.value = 'disconnected'
    }
  })

  sock.addEventListener('error', () => {
    pushSys('WebSocket error', 'err')
    sessionStatus.value = 'ended'
  })
}

function disconnectWs() {
  if (ws.value) {
    try {
      ws.value.send(JSON.stringify({ action: 'stop' }))
      ws.value.close()
    } catch (_) {}
    ws.value = null
  }
}

function disconnect() {
  disconnectWs()
  sessionStatus.value = 'ended'
  pushSys('Disconnected by user', 'sys')
}

// ── Output helpers ────────────────────────────────────────────────────────────
function escape(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function appendOutput(text, forceCls = '') {
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    if (!raw && i === lines.length - 1) break
    const cls = forceCls || ''
    const ts  = new Date().toTimeString().slice(0, 8)
    outputLines.value.push(
      `<div class="ec2sh-line${cls ? ' ' + cls : ''}"><span class="ts">${ts}</span>${escape(raw)}</div>`
    )
  }
  scrollToEnd()
}

function pushSys(text, cls = 'sys') {
  const ts = new Date().toTimeString().slice(0, 8)
  outputLines.value.push(
    `<div class="ec2sh-line ${cls}"><span class="ts">${ts}</span>${escape(text)}</div>`
  )
  scrollToEnd()
}

function clearOutput() {
  outputLines.value = []
  sendRaw('\x0C')
}

function scrollToEnd() {
  nextTick(() => {
    if (outputRef.value) outputRef.value.scrollTop = outputRef.value.scrollHeight
  })
}

// ── Command input ─────────────────────────────────────────────────────────────
function sendCmd() {
  if (sessionStatus.value !== 'connected') return
  const cmd = cmdInput.value
  const ts  = new Date().toTimeString().slice(0, 8)
  outputLines.value.push(
    `<div class="ec2sh-line cmd"><span class="ts">${ts}</span><span class="ec2sh-prompt-echo">&#x276F;</span> ${escape(cmd)}</div>`
  )
  if (cmd.trim()) {
    cmdHistory.value.unshift(cmd)
    if (cmdHistory.value.length > 200) cmdHistory.value.pop()
  }
  historyIdx.value = -1
  sendRaw(cmd + '\n')
  cmdInput.value = ''
  scrollToEnd()
}

function sendRaw(data) {
  if (ws.value?.readyState === WebSocket.OPEN)
    ws.value.send(JSON.stringify({ action: 'stdin', data }))
}

function sendCtrlC() { sendRaw('\x03') }
function sendCtrlD() { sendRaw('\x04') }

async function browseKeyFile() {
  // Electron environment: use native OS file dialog
  if (window.kuaElectron?.openFileDialog) {
    const filePath = await window.kuaElectron.openFileDialog({
      title:   'Select PEM key file',
      filters: [{ name: 'PEM key', extensions: ['pem', 'key'] }, { name: 'All files', extensions: ['*'] }],
    })
    if (filePath) form.value.keyPath = filePath
    return
  }
  // Browser/dev fallback: use hidden <input type="file">
  const input = document.createElement('input')
  input.type   = 'file'
  input.accept = '.pem,.key'
  input.style.display = 'none'
  input.addEventListener('change', () => {
    const file = input.files?.[0]
    if (file) {
      // In browser we only get the filename, not the full path.
      // Show the name so the user knows what was selected; they can edit the path manually.
      form.value.keyPath = file.name
    }
    input.remove()
  })
  document.body.appendChild(input)
  input.click()
}

function historyUp() {
  if (!cmdHistory.value.length) return
  historyIdx.value = Math.min(historyIdx.value + 1, cmdHistory.value.length - 1)
  cmdInput.value   = cmdHistory.value[historyIdx.value]
}

function historyDown() {
  if (historyIdx.value <= 0) { historyIdx.value = -1; cmdInput.value = ''; return }
  historyIdx.value--
  cmdInput.value = cmdHistory.value[historyIdx.value]
}

onUnmounted(() => { disconnectWs() })
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
:deep(.ec2sh-line)            { white-space: pre-wrap; word-break: break-all; padding: 0 2px; color: #e6edf3; }
:deep(.ec2sh-line .ts)        { color: #484f58; margin-right: 8px; font-size: 0.75rem; user-select: none; }
:deep(.ec2sh-line.sys)        { color: #8b949e; font-style: italic; }
:deep(.ec2sh-line.err)        { color: #f85149; }
:deep(.ec2sh-line.cmd)        { color: #79c0ff; }
:deep(.ec2sh-prompt-echo)     { color: #3fb950; margin-right: 6px; }

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
