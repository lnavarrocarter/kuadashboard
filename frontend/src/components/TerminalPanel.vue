<template>
  <div>
  <Transition name="term-slide">
  <div
    v-show="store.visible"
    class="term-panel"
    :class="{ minimised }"
    :style="minimised ? {} : { height: store.height + 'px' }"
    ref="panelRef"
  >
    <!-- Resize handle -->
    <div class="term-resize-handle" @mousedown="startResize"></div>

    <!-- ── Header ──────────────────────────────────────────────────────── -->
    <div class="term-header">
      <div class="term-tabs">
        <div
          v-for="tab in store.tabs"
          :key="tab.id"
          :class="['term-tab', { active: tab.id === store.activeId }, `tab-ctx-${tab.context || 'pod'}`]"
          @click.self="store.activateTab(tab.id)"
        >
          <span :class="['tab-dot', { streaming: tab.streaming, stopped: !tab.streaming }]"></span>
          <!-- Context chip -->
          <span :class="['tab-ctx-chip', `ctx-${tab.context || 'pod'}`]">{{ CTX_LABELS[tab.context || 'pod'] }}</span>
          <span class="tab-label" :title="tab.label || tab.pod" @click="store.activateTab(tab.id)">{{ tab.label || tab.pod }}</span>
          <button class="tab-close" :title="t('term.closeTab')" @click.stop="closeTab(tab.id)">✕</button>
        </div>
      </div>

      <div class="term-header-actions">
        <!-- Container selector (pod exec only) -->
        <select
          v-if="activeTab?.context === 'pod' || !activeTab?.context"
          class="ctrl-select sm"
          v-model="activeContainer"
          @change="changeContainer"
        >
          <option v-for="c in activeTabContainers" :key="c" :value="c">{{ c }}</option>
        </select>
        <!-- Previous logs toggle (log tabs only) -->
        <label v-if="activeTab && !isShellTab" class="chk-label"><input type="checkbox" v-model="showPrevious" /> Prev</label>
        <div class="term-btn-sep"></div>
        <button class="btn btn-icon" :title="t('term.clear')" @click="clearLogs"><i data-lucide="eraser"></i></button>
        <button class="btn btn-icon" :class="{ primary: store.wrap }" title="Wrap text" @click="store.wrap = !store.wrap"><i data-lucide="wrap-text"></i></button>
        <button class="btn btn-icon" title="Scroll to end" @click="scrollEnd"><i data-lucide="arrow-down-to-line"></i></button>
        <div class="term-btn-sep"></div>
        <!-- File browser toggle (local shell only) -->
        <button
          v-if="activeTab?.context === 'local'"
          :class="['btn btn-icon', { primary: showBrowser }]"
          :title="t('term.fileBrowser')"
          @click="toggleBrowser"
        ><i data-lucide="folder-open"></i></button>
        <!-- Help toggle -->
        <button
          :class="['btn btn-icon', { primary: showHelp }]"
          title="Keyboard shortcuts"
          @click="showHelp = !showHelp"
        ><i data-lucide="circle-help"></i></button>
        <div class="term-btn-sep"></div>
        <button class="btn btn-icon stop" :title="t('term.stop')" @click="stopActive"><i data-lucide="square"></i></button>
        <button class="btn btn-icon" title="Pop out" @click="popOut"><i data-lucide="external-link"></i></button>
        <button class="btn btn-icon" title="Minimise" @click="minimised = !minimised"><i data-lucide="minus"></i></button>
        <button class="btn btn-icon" title="Close all tabs" @click="closeAll"><i data-lucide="x"></i></button>
      </div>
    </div>

    <!-- ── Help overlay ─────────────────────────────────────────────────── -->
    <Transition name="help-slide">
    <div v-if="showHelp && !minimised" class="term-help">
      <div class="term-help-cols">
        <div>
          <div class="term-help-section">Shell input</div>
          <table class="term-help-table"><tbody>
            <tr><td><kbd>↑</kbd><kbd>↓</kbd></td><td>Command history</td></tr>
            <tr><td><kbd>Tab</kbd></td><td>Path autocomplete</td></tr>
            <tr><td><kbd>Enter</kbd></td><td>Send command</td></tr>
            <tr><td><kbd>Ctrl+C</kbd></td><td>Interrupt (SIGINT)</td></tr>
            <tr><td><kbd>Ctrl+D</kbd></td><td>EOF / close session</td></tr>
            <tr><td><kbd>Ctrl+L</kbd></td><td>Clear output</td></tr>
          </tbody></table>
        </div>
        <div>
          <div class="term-help-section">File browser</div>
          <table class="term-help-table"><tbody>
            <tr><td>Click 📁</td><td>Navigate + <code>cd</code></td></tr>
            <tr><td>Click 📄</td><td>Preview file</td></tr>
            <tr><td>Double click</td><td>Insert path into input</td></tr>
            <tr><td>↑ (top)</td><td>Go to parent directory</td></tr>
          </tbody></table>
          <div class="term-help-section" style="margin-top:8px">Line colours</div>
          <table class="term-help-table"><tbody>
            <tr><td><span class="th-dot err"></span></td><td>Error / exception</td></tr>
            <tr><td><span class="th-dot warn"></span></td><td>Warning</td></tr>
            <tr><td><span class="th-dot ok"></span></td><td>Success / OK</td></tr>
            <tr><td><span class="th-dot sys"></span></td><td>System / meta</td></tr>
          </tbody></table>
        </div>
        <div>
          <div class="term-help-section">Common commands</div>
          <table class="term-help-table"><tbody>
            <tr><td><code>ls -la</code></td><td>List files</td></tr>
            <tr><td><code>pwd</code></td><td>Current directory</td></tr>
            <tr><td><code>env</code></td><td>Environment vars</td></tr>
            <tr><td><code>ps aux</code></td><td>Running processes</td></tr>
            <tr><td><code>cat /etc/os-release</code></td><td>OS info</td></tr>
            <tr><td><code>df -h</code></td><td>Disk usage</td></tr>
            <tr><td><code>top</code> / <code>htop</code></td><td>CPU / memory</td></tr>
            <tr><td><code>curl -I &lt;url&gt;</code></td><td>HTTP check</td></tr>
          </tbody></table>
        </div>
      </div>
    </div>
    </Transition>

    <!-- ── Body: optional file browser + output ─────────────────────────── -->
    <div v-show="!minimised" class="term-main-body">

      <!-- File browser (local shell only) -->
      <div v-show="activeTab?.context === 'local' && showBrowser" class="term-filebrowser">
        <!-- Breadcrumb -->
        <div class="term-fb-crumb">
        <span
            v-for="(seg, i) in browserCrumbs"
            :key="seg.path"
            class="fb-crumb-item"
          >
            <span v-if="i > 0" class="fb-sep">{{ browserSep }}</span>
            <span class="fb-seg" @click="browseNavigate(seg.path)" :title="seg.path">{{ seg.label }}</span>
          </span>
          <span class="fb-refresh" @click="refreshBrowser" title="Refresh">↻</span>
        </div>
        <!-- Entries -->
        <div class="term-fb-entries" ref="fbEntriesRef">
          <div v-if="browserLoading" class="fb-msg">Loading…</div>
          <div v-else-if="browserErr" class="fb-msg err">{{ browserErr }}</div>
          <template v-else>
            <div v-if="browserParent" class="fb-entry fb-dir" @click="browseNavigate(browserParent)" title="Parent directory">
              <span class="fb-icon">↑</span><span>..</span>
            </div>
            <div
              v-for="e in browserEntries"
              :key="e.name"
              :class="['fb-entry', e.isDir ? 'fb-dir' : 'fb-file']"
              @click="fbClick(e)"
              @dblclick="fbDblClick(e)"
              :title="e.name + (e.sizeHuman ? ' · ' + e.sizeHuman : '')"
            >
              <span class="fb-icon">{{ e.isDir ? '📁' : fileIcon(e.icon) }}</span>
              <span class="fb-name">{{ e.name }}</span>
              <span v-if="!e.isDir" class="fb-size">{{ e.sizeHuman }}</span>
            </div>
            <div v-if="!browserEntries.length" class="fb-msg">Empty</div>
          </template>
        </div>
      </div>

      <!-- Terminal output -->
      <div
        class="term-body"
        :class="{ wrap: store.wrap }"
        ref="bodyRef"
        v-html="bodyHtml"
      ></div>
    </div>

    <!-- ── Exec / Shell input bar ────────────────────────────────────────── -->
    <div v-if="isShellTab && !minimised" class="term-input-bar">
      <span :class="['term-prompt', activeTab?.streaming ? 'active' : 'inactive']">❯</span>
      <input
        ref="inputRef"
        v-model="cmdInput"
        class="term-input-field"
        autocomplete="off"
        spellcheck="false"
        :placeholder="shellPlaceholder"
        :disabled="!activeTab?.streaming"
        @keydown.enter.prevent="sendInput"
        @keydown.up.prevent="historyUp"
        @keydown.down.prevent="historyDown"
        @keydown.tab.prevent="tabComplete"
        @keydown.exact.ctrl.c.prevent="sendCtrlC"
        @keydown.exact.ctrl.l.prevent="clearLogs"
        @keydown.exact.ctrl.d.prevent="sendCtrlD"
      />
      <!-- Suggestion chip -->
      <span v-if="suggestion" class="term-suggestion" @click="applySuggestion">{{ suggestion }}</span>
      <button class="btn btn-icon" title="Ctrl+C — interrupt" @click="sendCtrlC"><i data-lucide="x-circle"></i></button>
    </div>

    <!-- ── Footer ────────────────────────────────────────────────────────── -->
    <div v-show="!minimised" class="term-footer" ref="footerRef">
      <span>{{ statusText }}</span>
      <span v-if="activeTab?.context === 'local'" class="term-footer-cwd text-dim">{{ browserCwd }}</span>
      <span id="termLineCount" style="margin-left:auto">{{ lineCount }} lines</span>
    </div>
  </div>
  </Transition>

  <!-- File viewer / editor modal -->
  <FileViewerModal
    v-if="fileViewerPath"
    :filePath="fileViewerPath"
    :initialMode="fileViewerMode"
    @close="onViewerClose"
    @saved="onViewerSaved"
  />
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { useI18n } from '../composables/useI18n.js'

const { t } = useI18n()
import { useTerminalStore } from '../stores/useTerminalStore'
import { createIcons, icons } from 'lucide'
import FileViewerModal from './FileViewerModal.vue'

const store = useTerminalStore()
const bodyRef      = ref(null)
const panelRef     = ref(null)
const inputRef     = ref(null)
const fbEntriesRef = ref(null)
const minimised    = ref(false)
const showPrevious = ref(false)
const showHelp     = ref(false)
const showBrowser  = ref(true)
const cmdInput     = ref('')
let resizing = false, startY = 0, startH = 0

// File viewer modal
const fileViewerPath = ref(null)
const fileViewerMode = ref('auto')

// ── Context labels ─────────────────────────────────────────────────────────
const CTX_LABELS = { pod: 'k8s', local: 'local', aws: 'AWS', gcp: 'GCP' }

// ── Current tab state ──────────────────────────────────────────────────────
const activeTab           = computed(() => store.tabs.find(t => t.id === store.activeId) || null)
const isShellTab          = computed(() => ['exec', 'local', 'aws', 'gcp'].includes(activeTab.value?.type))
const activeTabContainers = computed(() => activeTab.value?.containers || [])
const activeContainer     = ref('')
const bodyHtml            = computed(() => activeTab.value?.lines.join('') || '')
const lineCount           = computed(() => activeTab.value?.lineCount ?? 0)

const statusText = computed(() => {
  const tab = activeTab.value
  if (!tab) return 'Idle'
  const label = tab.label || tab.pod || 'Shell'
  return tab.streaming ? `● ${label}` : `○ ${label} (ended)`
})

const shellPlaceholder = computed(() => {
  if (!activeTab.value?.streaming) return 'Session ended — reconnect or close tab'
  return suggestion.value
    ? `${cmdInput.value}${suggestion.value}  (Tab to complete)`
    : 'Type command and press Enter…   Tab=autocomplete  ↑↓=history'
})

watch(activeTab, tab => {
  if (tab) activeContainer.value = tab.container || ''
  showHelp.value = false
  nextTick(() => createIcons({ icons }))
  // Seed browser when switching to a local tab
  if (tab?.context === 'local' && !browserCwd.value) {
    fetchBrowser(null)
  }
})

// React to CWD changes pushed by the shell (via {type:'cwd'} WS message)
watch(
  () => activeTab.value?.cwd,
  (newCwd) => {
    if (!newCwd || activeTab.value?.context !== 'local') return
    if (newCwd !== browserCwd.value) {
      fetchBrowser(newCwd)
    }
  }
)

watch(bodyHtml, () => nextTick(() => {
  if (bodyRef.value) bodyRef.value.scrollTop = bodyRef.value.scrollHeight
}), { flush: 'post' })

watch(isShellTab, v => { if (v) nextTick(() => inputRef.value?.focus()) })
watch(activeTab,  () => { showPrevious.value = false })

watch(showPrevious, val => {
  const tab = activeTab.value
  if (!tab || isShellTab.value) return
  store.stopStream(tab)
  clearLogs()
  emit('restartStream', tab, val)
})

// ── Tab actions ────────────────────────────────────────────────────────────
function closeTab(id) { store.closeTab(id) }
function closeAll()   { [...store.tabs].forEach(t => store.closeTab(t.id)) }
function clearLogs()  {
  if (!activeTab.value) return
  activeTab.value.lines     = []
  activeTab.value.lineCount = 0
}
function stopActive() { if (activeTab.value) store.stopStream(activeTab.value) }
function scrollEnd()  { if (bodyRef.value) bodyRef.value.scrollTop = bodyRef.value.scrollHeight }

function changeContainer() {
  if (!activeTab.value) return
  activeTab.value.container = activeContainer.value
  store.stopStream(activeTab.value)
  clearLogs()
  emit('restartStream', activeTab.value, showPrevious.value)
}

function popOut() {
  const tab = activeTab.value
  if (!tab) return
  const w = window.open('', '_blank', 'width=900,height=600')
  w.document.write(`<html><body style="background:#111;color:#ccc;font-family:monospace;font-size:12px;white-space:pre-wrap;padding:10px">${tab.lines.join('')}</body></html>`)
}

// ── Shell input ────────────────────────────────────────────────────────────
const cmdHistory = ref([])
const historyIdx = ref(-1)
const suggestion = ref('')

function sendInput() {
  const tab = activeTab.value
  if (!tab?.ws || tab.ws.readyState !== 1) return
  const cmd = cmdInput.value
  if (cmd.trim()) {
    cmdHistory.value.unshift(cmd)
    if (cmdHistory.value.length > 200) cmdHistory.value.pop()

  }
  historyIdx.value = -1
  suggestion.value = ''
  tab.ws.send(JSON.stringify({ action: 'stdin', data: cmd + '\n' }))
  store.pushLine(tab, cmd, 'cmd')
  cmdInput.value = ''
}

function historyUp() {
  if (!cmdHistory.value.length) return
  historyIdx.value = Math.min(historyIdx.value + 1, cmdHistory.value.length - 1)
  cmdInput.value   = cmdHistory.value[historyIdx.value]
  suggestion.value = ''
}

function historyDown() {
  if (historyIdx.value <= 0) { historyIdx.value = -1; cmdInput.value = ''; return }
  historyIdx.value--
  cmdInput.value   = cmdHistory.value[historyIdx.value]
  suggestion.value = ''
}

function sendCtrlC() {
  const tab = activeTab.value
  if (!tab?.ws || tab.ws.readyState !== 1) return
  tab.ws.send(JSON.stringify({ action: 'stdin', data: '\x03' }))
}
function sendCtrlD() {
  const tab = activeTab.value
  if (!tab?.ws || tab.ws.readyState !== 1) return
  tab.ws.send(JSON.stringify({ action: 'stdin', data: '\x04' }))
}

// ── Autocomplete (Tab key) ─────────────────────────────────────────────────
async function tabComplete() {
  const tab = activeTab.value
  if (!tab) return

  // For pod exec: always send Tab directly to the remote shell — no local interference
  if (tab.context === 'pod' || tab.type === 'exec') {
    if (tab.ws?.readyState === 1) {
      tab.ws.send(JSON.stringify({ action: 'stdin', data: '\t' }))
    }
    return
  }

  // Local shell: use local filesystem for completion
  const input     = cmdInput.value
  const lastSpace = Math.max(input.lastIndexOf(' '), input.lastIndexOf('\t'))
  const token     = lastSpace >= 0 ? input.slice(lastSpace + 1) : input
  const prefix    = lastSpace >= 0 ? input.slice(0, lastSpace + 1) : ''

  if (!token) {
    showHistorySuggestions(input)
    return
  }

  // 1. Try to complete from file browser entries (current directory)
  if (browserEntries.value.length) {
    const sep     = browserSep.value
    const hasPath = token.includes('/') || token.includes('\\')
    if (!hasPath) {
      const matches = browserEntries.value
        .filter(e => e.name.toLowerCase().startsWith(token.toLowerCase()))
        .map(e => e.name + (e.isDir ? sep : ''))
      if (matches.length === 1) {
        cmdInput.value   = prefix + matches[0]
        suggestion.value = ''
        return
      }
      if (matches.length > 1) {
        store.pushLine(tab, '  ' + matches.join('   '), 'sys')
        scrollEnd()
        return
      }
    }
  }

  // 2. Query API for deeper path completion
  await apiPathComplete(prefix, token)
}

function showHistorySuggestions(input) {
  if (!cmdHistory.value.length) return
  const matches = cmdHistory.value.filter(c => c.startsWith(input))
  if (matches.length) {
    store.pushLine(activeTab.value, '  ' + matches.slice(0, 8).join('  |  '), 'sys')
    scrollEnd()
  }
}

async function apiPathComplete(prefix, token) {
  const sep  = browserSep.value || '/'
  const isPathToken = token.includes('/') || token.includes('\\')
  if (!isPathToken) return

  const lastSep = Math.max(token.lastIndexOf('/'), token.lastIndexOf('\\'))
  const dir     = lastSep >= 0 ? token.slice(0, lastSep + 1) : (browserCwd.value || '')
  const stub    = lastSep >= 0 ? token.slice(lastSep + 1) : token

  try {
    const res  = await fetch(`/api/local/ls?path=${encodeURIComponent(dir || browserCwd.value)}`)
    if (!res.ok) return
    const data = await res.json()
    const matches = data.entries
      .filter(e => e.name.toLowerCase().startsWith(stub.toLowerCase()))
      .map(e => dir + e.name + (e.isDir ? sep : ''))
    if (matches.length === 1) {
      cmdInput.value   = prefix + matches[0]
      suggestion.value = ''
    } else if (matches.length > 1) {
      store.pushLine(activeTab.value, '  ' + matches.map(m => m.split(sep).pop()).join('   '), 'sys')
      scrollEnd()
    }
  } catch (_) {}
}

// Inline suggestion: show suffix of best history match as ghost text (local only)
watch(cmdInput, val => {
  if (!val || historyIdx.value >= 0 || activeTab.value?.context !== 'local') {
    suggestion.value = ''
    return
  }
  const match = cmdHistory.value.find(c => c.startsWith(val) && c !== val)
  suggestion.value = match ? match.slice(val.length) : ''
})

function applySuggestion() {
  if (suggestion.value) {
    cmdInput.value  += suggestion.value
    suggestion.value = ''
  }
}

// ── File browser ───────────────────────────────────────────────────────────
const browserCwd     = ref('')
const browserParent  = ref(null)
const browserSep     = ref('/')
const browserEntries = ref([])
const browserLoading = ref(false)
const browserErr     = ref('')
let browserRefreshTimer = null  // kept for potential future use

const browserCrumbs = computed(() => {
  if (!browserCwd.value) return []
  const sep  = browserSep.value
  const segs = []
  if (sep === '\\') {
    const parts = browserCwd.value.replace(/\\/g, '/').split('/').filter(Boolean)
    let built = ''
    for (const p of parts) {
      built = built ? built + '\\' + p : p
      segs.push({ label: p, path: p.includes(':') ? p + '\\' : built })
    }
  } else {
    segs.push({ label: '/', path: '/' })
    const parts = browserCwd.value.split('/').filter(Boolean)
    let built = ''
    for (const p of parts) { built += '/' + p; segs.push({ label: p, path: built }) }
  }
  return segs
})

async function fetchBrowser(dirPath) {
  // Only for local context
  if (activeTab.value?.context !== 'local') return

  browserLoading.value = true
  browserErr.value     = ''
  const path = dirPath || browserCwd.value || null
  const url  = path
    ? `/api/local/ls?path=${encodeURIComponent(path)}`
    : '/api/local/home'

  try {
    if (!path) {
      // Get home dir first
      const homeRes  = await fetch('/api/local/home')
      const homeData = await homeRes.json()
      return fetchBrowser(homeData.path)
    }
    const res  = await fetch(url)
    const data = await res.json()
    if (!res.ok) throw new Error(data.error)
    browserCwd.value     = data.path
    browserParent.value  = data.parent
    browserSep.value     = data.sep
    browserEntries.value = data.entries
  } catch (err) {
    browserErr.value = err.message
  } finally {
    browserLoading.value = false
  }
}

function refreshBrowser()   { fetchBrowser(browserCwd.value) }
function toggleBrowser()    { showBrowser.value = !showBrowser.value }

async function browseNavigate(dirPath) {
  // Update the browser immediately for snappy UX
  await fetchBrowser(dirPath)
  // Also cd in the shell (only local); the server's CWD probe will confirm and re-sync
  if (activeTab.value?.context === 'local' && activeTab.value?.ws?.readyState === 1) {
    const cmd = browserSep.value === '\\' ? `cd "${dirPath}"` : `cd '${dirPath}'`
    activeTab.value.ws.send(JSON.stringify({ action: 'stdin', data: cmd + '\n' }))
    store.pushLine(activeTab.value, cmd, 'cmd')
  }
  nextTick(() => inputRef.value?.focus())
}

function fbClick(entry) {
  const full = browserCwd.value.replace(/[\\/]$/, '') + browserSep.value + entry.name
  if (entry.isDir) {
    browseNavigate(full)
  } else {
    fbPreview(full)
  }
}

function fbDblClick(entry) {
  if (!entry.isDir) {
    const full = browserCwd.value.replace(/[\\/]$/, '') + browserSep.value + entry.name
    const sep  = cmdInput.value.length && !cmdInput.value.endsWith(' ') ? ' ' : ''
    const quoted = browserSep.value === '\\' ? `"${full}"` : `'${full}'`
    cmdInput.value += sep + quoted
    nextTick(() => inputRef.value?.focus())
  }
}

async function fbPreview(filePath) {
  fileViewerPath.value = filePath
  fileViewerMode.value = 'auto'
}

function onViewerClose() {
  fileViewerPath.value = null
}

function onViewerSaved(path) {
  if (activeTab.value) store.pushLine(activeTab.value, `✔ Saved: ${path}`, 'ok')
}

// File icon helper
const FILE_ICONS = {
  dir:'📁', code:'📝', json:'📋', config:'⚙', doc:'📄', web:'🌐',
  script:'📜', img:'🖼', archive:'📦', pdf:'📑', lock:'🔒', git:'🔀', file:'📄',
}
function fileIcon(icon) { return FILE_ICONS[icon] || FILE_ICONS.file }

// Heuristic: detect CWD from shell output (parse pwd / PS1 patterns)
function parseOutputForCwd() {
  if (activeTab.value?.context !== 'local') return
  const lastLines = activeTab.value?.lines?.slice(-3) || []
  for (const html of lastLines) {
    // Look for absolute paths in recent output
    const match = html.match(/([A-Za-z]:[\\/][^\s<"]+|\/[^\s<"]{3,})/)
    if (match) {
      const candidate = match[1]
      // Only update if it looks like a directory path we haven't seen
      if (candidate !== browserCwd.value && candidate.length > 2) {
        browserCwd.value = candidate
      }
    }
  }
}

// ── Resize ─────────────────────────────────────────────────────────────────
function startResize(e) {
  resizing = true
  startY = e.clientY
  startH = store.height
  document.addEventListener('mousemove', onResize)
  document.addEventListener('mouseup', stopResize)
}
function onResize(e) {
  if (!resizing) return
  store.height = Math.min(Math.max(120, startH - (e.clientY - startY)), window.innerHeight * 0.8)
}
function stopResize() {
  resizing = false
  document.removeEventListener('mousemove', onResize)
  document.removeEventListener('mouseup', stopResize)
}

const emit = defineEmits(['restartStream'])

onMounted(() => nextTick(() => createIcons({ icons })))
onUnmounted(() => {
  document.removeEventListener('mousemove', onResize)
  document.removeEventListener('mouseup', stopResize)
})
</script>

