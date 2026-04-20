<template>
  <div class="lsh-view">

    <!-- ── Header ──────────────────────────────────────────────────────────── -->
    <div class="lsh-header">
      <div class="lsh-header-left">
        <span class="lsh-title">Local Shell</span>
        <span :class="['lsh-status-dot', sessionStatus]" :title="statusLabel"></span>
        <span class="lsh-status-text text-dim">{{ statusLabel }}</span>
      </div>
      <div class="lsh-header-actions">
        <button class="btn sm" @click="toggleBrowser" :title="showBrowser ? 'Hide explorer' : 'Show explorer'">
          {{ showBrowser ? '◀ Explorer' : '▶ Explorer' }}
        </button>
        <button class="btn sm" @click="reconnect" title="Reconnect shell" :disabled="sessionStatus === 'connected'">⟳ Reconnect</button>
        <button class="btn sm" :class="{ primary: showHelp }" @click="showHelp = !showHelp" title="Keyboard shortcuts & help">? Help</button>
      </div>
    </div>

    <!-- ── Breadcrumb ──────────────────────────────────────────────────────── -->
    <div class="lsh-breadcrumb" v-if="showBrowser">
      <template v-for="(seg, i) in breadcrumbs" :key="seg.path">
        <span class="lsh-bc-sep" v-if="i > 0">{{ pathSep }}</span>
        <span class="lsh-bc-seg" @click="navigateTo(seg.path)" :title="seg.path">{{ seg.label }}</span>
      </template>
      <span class="lsh-bc-refresh btn-icon" @click="refreshBrowser" title="Refresh">↻</span>
    </div>

    <!-- ── Help overlay ────────────────────────────────────────────────────── -->
    <div v-if="showHelp" class="lsh-help">
      <div class="lsh-help-title">Shortcuts & commands</div>
      <table class="lsh-help-table">
        <tr><td><kbd>↑</kbd> / <kbd>↓</kbd></td><td>Navigate command history</td></tr>
        <tr><td><kbd>Tab</kbd></td><td>Autocomplete path from file explorer</td></tr>
        <tr><td><kbd>Ctrl+C</kbd></td><td>Send interrupt signal</td></tr>
        <tr><td><kbd>Ctrl+L</kbd></td><td>Clear terminal output</td></tr>
        <tr><td><kbd>Ctrl+D</kbd></td><td>Send EOF / close session</td></tr>
        <tr><td><kbd>Enter</kbd></td><td>Send command</td></tr>
      </table>
      <div class="lsh-help-title" style="margin-top:10px">File explorer</div>
      <table class="lsh-help-table">
        <tr><td>Click folder</td><td>Navigate + send <code>cd &lt;path&gt;</code> to shell</td></tr>
        <tr><td>Click file</td><td>Preview file content (text files only, max 512 KB)</td></tr>
        <tr><td>Double-click file</td><td>Insert path into command input</td></tr>
      </table>
    </div>

    <!-- ── Main body: Explorer + Terminal ─────────────────────────────────── -->
    <div class="lsh-body">

      <!-- ── File browser ─────────────────────────────────────────────────── -->
      <div v-show="showBrowser" class="lsh-filebrowser">

        <!-- Drive picker (Windows) -->
        <div v-if="drives.length > 1" class="lsh-drives">
          <button
            v-for="d in drives"
            :key="d.path"
            :class="['btn', 'xs', currentPath.toUpperCase().startsWith(d.path.toUpperCase().slice(0,2)) ? 'primary' : '']"
            @click="navigateTo(d.path)"
          >{{ d.label }}</button>
        </div>

        <!-- Entries list -->
        <div class="lsh-entries" ref="entriesRef">
          <div v-if="browserLoading" class="lsh-fb-msg text-dim">Loading…</div>
          <div v-else-if="browserError" class="lsh-fb-msg alert-error">{{ browserError }}</div>
          <template v-else>
            <!-- Parent dir -->
            <div
              v-if="parentPath"
              class="lsh-entry lsh-entry-dir"
              @click="navigateTo(parentPath)"
              title="Go up"
            >
              <span class="lsh-entry-icon">↑</span>
              <span class="lsh-entry-name">..</span>
            </div>
            <!-- Entries -->
            <div
              v-for="entry in browserEntries"
              :key="entry.name"
              :class="['lsh-entry', entry.isDir ? 'lsh-entry-dir' : 'lsh-entry-file', entry.name === selectedEntry ? 'selected' : '']"
              @click="handleEntryClick(entry)"
              @dblclick="handleEntryDblClick(entry)"
              :title="entry.name + (entry.sizeHuman ? ' · ' + entry.sizeHuman : '')"
            >
              <span class="lsh-entry-icon">{{ entryIcon(entry) }}</span>
              <span class="lsh-entry-name">{{ entry.name }}</span>
              <span class="lsh-entry-meta text-dim">{{ entry.isDir ? '' : entry.sizeHuman }}</span>
            </div>
            <div v-if="!browserEntries.length" class="lsh-fb-msg text-dim">Empty directory</div>
          </template>
        </div>

      </div>

      <!-- ── Terminal pane ─────────────────────────────────────────────────── -->
      <div class="lsh-terminal">

        <!-- Output area -->
        <div
          class="lsh-term-output"
          ref="outputRef"
          v-html="outputHtml"
        ></div>

        <!-- File preview panel -->
        <div v-if="filePreview" class="lsh-preview">
          <div class="lsh-preview-header">
            <span class="lsh-preview-path text-dim">{{ filePreview.path }}</span>
            <span class="lsh-preview-meta text-dim">{{ filePreview.lines }} lines · {{ filePreview.sizeHuman }}</span>
            <button class="btn-close" @click="filePreview = null">✕</button>
          </div>
          <pre class="lsh-preview-body">{{ filePreview.content }}</pre>
        </div>

        <!-- Input bar -->
        <div class="lsh-term-input-bar">
          <span class="lsh-prompt" :class="sessionStatus">❯</span>
          <input
            ref="inputRef"
            v-model="cmdInput"
            class="lsh-term-input"
            autocomplete="off"
            spellcheck="false"
            :placeholder="inputPlaceholder"
            :disabled="sessionStatus !== 'connected'"
            @keydown.enter.prevent="sendCmd"
            @keydown.up.prevent="historyUp"
            @keydown.down.prevent="historyDown"
            @keydown.tab.prevent="tabComplete"
            @keydown.ctrl.c.prevent="sendCtrlC"
            @keydown.ctrl.l.prevent="clearOutput"
            @keydown.ctrl.d.prevent="sendCtrlD"
          />
          <button class="btn btn-icon" title="Send Ctrl+C" @click="sendCtrlC">✕</button>
          <button class="btn btn-icon" title="Clear output" @click="clearOutput">⌫</button>
        </div>

      </div>
    </div>

  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted, onUnmounted, markRaw } from 'vue'

// ── WS URL builder ────────────────────────────────────────────────────────────
function wsUrl(path) {
  if (import.meta.env.DEV) return `ws://localhost:3000${path}`
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${location.host}${path}`
}

// ── State ─────────────────────────────────────────────────────────────────────
const outputRef   = ref(null)
const inputRef    = ref(null)
const entriesRef  = ref(null)

// session
const sessionStatus = ref('disconnected')  // 'disconnected' | 'connecting' | 'connected' | 'ended'
const shellName     = ref('')
const ws            = ref(null)

// terminal output
const outputLines = ref([])  // raw HTML strings
const outputHtml  = computed(() => outputLines.value.join(''))

// command input
const cmdInput    = ref('')
const cmdHistory  = ref([])
const historyIdx  = ref(-1)

// file browser
const showBrowser    = ref(true)
const currentPath    = ref('')
const parentPath     = ref(null)
const pathSep        = ref('/')
const browserEntries = ref([])
const browserLoading = ref(false)
const browserError   = ref('')
const drives         = ref([])
const selectedEntry  = ref('')

// breadcrumbs derived from currentPath
const breadcrumbs = computed(() => {
  if (!currentPath.value) return []
  const sep  = pathSep.value
  const p    = currentPath.value
  const segs = []

  if (sep === '\\') {
    // Windows: C:\Users\foo → ["C:", "Users", "foo"]
    const parts = p.replace(/\\/g, '/').split('/').filter(Boolean)
    let built = ''
    for (const part of parts) {
      built = built ? built + '\\' + part : part
      // Ensure drive root ends with backslash
      const fullPath = part.includes(':') ? part + '\\' : built
      segs.push({ label: part, path: part.includes(':') ? part + '\\' : built })
    }
  } else {
    // Unix: /home/user/foo → ["/", "home", "user", "foo"]
    segs.push({ label: '/', path: '/' })
    const parts = p.split('/').filter(Boolean)
    let built = ''
    for (const part of parts) {
      built += '/' + part
      segs.push({ label: part, path: built })
    }
  }
  return segs
})

// file preview
const filePreview = ref(null)

// help
const showHelp = ref(false)

// ── Computed ──────────────────────────────────────────────────────────────────
const statusLabel = computed(() => {
  const map = { disconnected: 'Disconnected', connecting: 'Connecting…', connected: shellName.value || 'Connected', ended: 'Session ended' }
  return map[sessionStatus.value] || sessionStatus.value
})

const inputPlaceholder = computed(() => {
  if (sessionStatus.value === 'connected') return 'Type command and press Enter…'
  if (sessionStatus.value === 'connecting') return 'Connecting…'
  return 'Session ended — click Reconnect'
})

// ── WebSocket ─────────────────────────────────────────────────────────────────
function wsConnect() {
  if (ws.value) {
    try { ws.value.close() } catch (_) {}
  }
  sessionStatus.value = 'connecting'
  const sock = markRaw(new WebSocket(wsUrl('/ws/shell')))
  ws.value   = sock

  sock.addEventListener('open', () => {
    // Connected event comes from server after process is ready
  })

  sock.addEventListener('message', e => {
    let msg
    try { msg = JSON.parse(e.data) } catch (_) { return }

    if (msg.type === 'connected') {
      sessionStatus.value = 'connected'
      shellName.value     = msg.shell
      pushSys(`▶ Shell: ${msg.shell}   CWD: ${msg.cwd}`)
      // Seed file browser with initial CWD
      if (!currentPath.value) fetchBrowser(msg.cwd)
      nextTick(() => inputRef.value?.focus())
    } else if (msg.type === 'out') {
      appendOutput(msg.data, '')
    } else if (msg.type === 'err') {
      appendOutput(msg.data, 'err')
    } else if (msg.type === 'error') {
      pushSys('✖ ' + msg.data, 'err')
      sessionStatus.value = 'ended'
    } else if (msg.type === 'done') {
      pushSys(`■ Session ended (exit ${msg.code})`, 'sys')
      sessionStatus.value = 'ended'
    }
  })

  sock.addEventListener('close', () => {
    if (sessionStatus.value === 'connected') {
      sessionStatus.value = 'ended'
      pushSys('■ Connection closed', 'sys')
    } else if (sessionStatus.value === 'connecting') {
      sessionStatus.value = 'disconnected'
      pushSys('✖ Could not connect to local shell', 'err')
    }
  })

  sock.addEventListener('error', () => {
    pushSys('✖ WebSocket error', 'err')
    sessionStatus.value = 'ended'
  })
}

function reconnect() {
  wsConnect()
}

// ── Output helpers ────────────────────────────────────────────────────────────
function escape(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** Colorise output lines by content patterns */
function classify(text) {
  const t = text.toLowerCase()
  if (/error|exception|failed|fatal|✖/.test(t))  return 'err'
  if (/warning|warn/.test(t))                     return 'warn'
  if (/success|ok|done|✓|passed/.test(t))         return 'ok'
  return ''
}

function appendOutput(text, forceCls) {
  // Split on newlines, render each as a separate div
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    if (!raw && i === lines.length - 1) break  // skip trailing empty
    const cls = forceCls || classify(raw)
    const ts  = new Date().toTimeString().slice(0, 8)
    outputLines.value.push(
      `<div class="lsh-line${cls ? ' ' + cls : ''}"><span class="ts">${ts}</span>${escape(raw)}</div>`
    )
  }
  scrollToEnd()
}

function pushSys(text, cls = 'sys') {
  const ts = new Date().toTimeString().slice(0, 8)
  outputLines.value.push(
    `<div class="lsh-line ${cls}"><span class="ts">${ts}</span>${escape(text)}</div>`
  )
  scrollToEnd()
}

function clearOutput() {
  outputLines.value = []
  // Also send ctrl+l to shell
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
  // Show what user typed
  const ts = new Date().toTimeString().slice(0, 8)
  outputLines.value.push(
    `<div class="lsh-line cmd"><span class="ts">${ts}</span><span class="lsh-prompt-echo">❯</span> ${escape(cmd)}</div>`
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

// ── Tab completion ────────────────────────────────────────────────────────────
async function tabComplete() {
  const input = cmdInput.value
  // Find last space-delimited token (the one being completed)
  const lastSpace = Math.max(input.lastIndexOf(' '), input.lastIndexOf('\t'))
  const token = lastSpace >= 0 ? input.slice(lastSpace + 1) : input
  if (!token) return

  // Determine if token looks like a path
  const sep = pathSep.value
  const hasPath = token.includes('/') || token.includes('\\') || token.startsWith('~')
  if (!hasPath) {
    // Complete from current directory entries
    const matches = browserEntries.value
      .filter(e => e.name.toLowerCase().startsWith(token.toLowerCase()))
      .map(e => e.isDir ? e.name + sep : e.name)
    if (matches.length === 1) {
      const prefix = lastSpace >= 0 ? input.slice(0, lastSpace + 1) : ''
      cmdInput.value = prefix + matches[0]
    } else if (matches.length > 1) {
      pushSys('  ' + matches.join('  '), 'sys')
    }
    return
  }

  // Path completion via API
  try {
    const dir  = token.endsWith(sep) || token.endsWith('/') ? token : (token.slice(0, token.lastIndexOf(sep) + 1) || token.slice(0, token.lastIndexOf('/') + 1))
    const stub = token.slice(dir.length)
    const res  = await fetch(`/api/local/ls?path=${encodeURIComponent(dir || currentPath.value)}`)
    if (!res.ok) return
    const data = await res.json()
    const matches = data.entries
      .filter(e => e.name.toLowerCase().startsWith(stub.toLowerCase()))
      .map(e => dir + e.name + (e.isDir ? sep : ''))
    if (matches.length === 1) {
      const prefix = lastSpace >= 0 ? input.slice(0, lastSpace + 1) : ''
      cmdInput.value = prefix + matches[0]
    } else if (matches.length > 1) {
      pushSys('  ' + matches.map(m => m.split(sep).pop()).join('  '), 'sys')
    }
  } catch (_) {}
}

// ── File browser ──────────────────────────────────────────────────────────────
async function fetchBrowser(dirPath) {
  browserLoading.value = true
  browserError.value   = ''
  selectedEntry.value  = ''
  try {
    const res  = await fetch(`/api/local/ls?path=${encodeURIComponent(dirPath)}`)
    const data = await res.json()
    if (!res.ok) throw new Error(data.error)
    currentPath.value    = data.path
    parentPath.value     = data.parent
    pathSep.value        = data.sep
    browserEntries.value = data.entries
  } catch (err) {
    browserError.value = err.message
  } finally {
    browserLoading.value = false
  }
}

async function refreshBrowser() {
  if (currentPath.value) await fetchBrowser(currentPath.value)
}

async function navigateTo(dirPath) {
  await fetchBrowser(dirPath)
  // Also cd the shell there
  if (sessionStatus.value === 'connected') {
    const cmd = pathSep.value === '\\' ? `cd "${dirPath}"` : `cd '${dirPath}'`
    sendRaw(cmd + '\n')
  }
  nextTick(() => inputRef.value?.focus())
}

function handleEntryClick(entry) {
  selectedEntry.value = entry.name
  if (entry.isDir) {
    navigateTo(currentPath.value.replace(/[\\/]$/, '') + pathSep.value + entry.name)
  } else {
    previewFile(currentPath.value.replace(/[\\/]$/, '') + pathSep.value + entry.name)
  }
}

function handleEntryDblClick(entry) {
  if (!entry.isDir) {
    const fullPath = currentPath.value.replace(/[\\/]$/, '') + pathSep.value + entry.name
    const sep = cmdInput.value.endsWith(' ') || !cmdInput.value ? '' : ' '
    cmdInput.value += sep + (pathSep.value === '\\' ? `"${fullPath}"` : `'${fullPath}'`)
    nextTick(() => inputRef.value?.focus())
  }
}

async function previewFile(filePath) {
  filePreview.value = null
  try {
    const res  = await fetch(`/api/local/read?path=${encodeURIComponent(filePath)}`)
    const data = await res.json()
    if (!res.ok) {
      pushSys('✖ ' + data.error, 'err')
      return
    }
    filePreview.value = data
  } catch (err) {
    pushSys('✖ ' + err.message, 'err')
  }
}

// ── Icons ─────────────────────────────────────────────────────────────────────
const ICONS = {
  dir: '📁', code: '📝', json: '📋', config: '⚙️', doc: '📄',
  web: '🌐', script: '📜', img: '🖼️', archive: '📦', pdf: '📑',
  lock: '🔒', git: '🔀', file: '📄',
}
function entryIcon(entry) {
  return ICONS[entry.icon] || ICONS.file
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────
onMounted(async () => {
  // Fetch drives list
  try {
    const r = await fetch('/api/local/drives')
    if (r.ok) drives.value = await r.json()
  } catch (_) {}

  wsConnect()
})

onUnmounted(() => {
  if (ws.value) try { ws.value.close() } catch (_) {}
})
</script>
