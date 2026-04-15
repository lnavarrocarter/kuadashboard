<template>
  <div
    class="term-panel"
    :style="{ height: store.height + 'px', display: store.visible ? 'flex' : 'none' }"
    ref="panelRef"
  >
    <!-- Resize handle -->
    <div class="term-resize-handle" @mousedown="startResize"></div>

    <!-- Header: tabs + controls -->
    <div class="term-header">
      <div class="term-tabs">
        <div
          v-for="tab in store.tabs"
          :key="tab.id"
          :class="['term-tab', { active: tab.id === store.activeId }, tab.type === 'exec' ? 'exec-tab' : '']"
          @click.self="store.activateTab(tab.id)"
        >
          <span :class="['tab-dot', { streaming: tab.streaming, stopped: !tab.streaming }]"></span>
          <span class="tab-label" :title="tab.pod" @click="store.activateTab(tab.id)">{{ tab.pod }}</span>
          <button class="tab-close" title="Close" @click.stop="closeTab(tab.id)">✕</button>
        </div>
      </div>

      <div class="term-header-actions">
        <select class="ctrl-select sm" v-model="activeContainer" @change="changeContainer">
          <option v-for="c in activeTabContainers" :key="c" :value="c">{{ c }}</option>
        </select>
        <label class="chk-label"><input type="checkbox" v-model="showPrevious" /> Previous</label>
        <button class="btn sm" title="Clear"    @click="clearLogs"><i data-lucide="eraser"></i> Clear</button>
        <button class="btn sm" title="Wrap"     @click="store.wrap = !store.wrap"><i data-lucide="wrap-text"></i> Wrap</button>
        <button class="btn sm" title="End"      @click="scrollEnd"><i data-lucide="arrow-down-to-line"></i> End</button>
        <button class="btn sm danger"           @click="stopActive"><i data-lucide="square"></i> Stop</button>
        <button class="btn sm"                  @click="popOut"><i data-lucide="external-link"></i></button>
        <button class="btn sm" title="Minimise" @click="minimised = !minimised"><i data-lucide="minus"></i></button>
        <button class="btn sm"                  @click="closeAll"><i data-lucide="x"></i></button>
      </div>
    </div>

    <!-- Body -->
    <div
      v-show="!minimised"
      class="term-body"
      :class="{ wrap: store.wrap }"
      ref="bodyRef"
      v-html="bodyHtml"
    ></div>

    <!-- Exec input bar (only for exec tabs) -->
    <div v-if="isExecTab && !minimised" class="term-input-bar">
      <span class="term-prompt">$ </span>
      <input
        ref="inputRef"
        v-model="cmdInput"
        class="term-input-field"
        autocomplete="off"
        spellcheck="false"
        placeholder="Type command and press Enter..."
        @keydown.enter="sendInput"
      />
      <button class="btn sm danger" title="Send Ctrl+C" @click="sendCtrlC">&#x2715;</button>
    </div>

    <!-- Footer -->
    <div v-show="!minimised" class="term-footer" ref="footerRef">
      <span>{{ statusText }}</span>
      <span id="termLineCount" style="margin-left:auto">{{ lineCount }} lines</span>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { useTerminalStore } from '../stores/useTerminalStore'
import { createIcons, icons } from 'lucide'

const store       = useTerminalStore()
const bodyRef     = ref(null)
const panelRef    = ref(null)
const inputRef    = ref(null)
const minimised   = ref(false)
const showPrevious = ref(false)
const cmdInput    = ref('')
let resizing = false, startY = 0, startH = 0

// ── Current tab state ──────────────────────────────────────────────────────
const activeTab = computed(() => store.tabs.find(t => t.id === store.activeId) || null)
const isExecTab = computed(() => activeTab.value?.type === 'exec')
const activeTabContainers = computed(() => activeTab.value?.containers || [])
const activeContainer = ref('')
const bodyHtml = computed(() => activeTab.value?.lines.join('') || '')
const lineCount = computed(() => activeTab.value?.lineCount ?? 0)
const statusText = computed(() => {
  const tab = activeTab.value
  if (!tab) return 'Idle'
  return tab.streaming ? `Streaming ${tab.pod}` : `Stopped — ${tab.pod}`
})

watch(activeTab, tab => {
  if (tab) activeContainer.value = tab.container || ''
  nextTick(() => createIcons({ icons }))
})

watch(bodyHtml, () => nextTick(() => {
  if (bodyRef.value) bodyRef.value.scrollTop = bodyRef.value.scrollHeight
}))

watch(isExecTab, v => { if (v) nextTick(() => inputRef.value?.focus()) })

// ── Tab actions ────────────────────────────────────────────────────────────
function closeTab(id) { store.closeTab(id) }
function closeAll()   { [...store.tabs].forEach(t => store.closeTab(t.id)) }

function clearLogs() {
  if (!activeTab.value) return
  activeTab.value.lines = []
  activeTab.value.lineCount = 0
}

function stopActive() {
  if (activeTab.value) store.stopStream(activeTab.value)
}

function scrollEnd() {
  if (bodyRef.value) bodyRef.value.scrollTop = bodyRef.value.scrollHeight
}

function changeContainer() {
  if (!activeTab.value) return
  activeTab.value.container = activeContainer.value
  store.stopStream(activeTab.value)
  clearLogs()
  emit('restartStream', activeTab.value)
}

function popOut() {
  const tab = activeTab.value
  if (!tab) return
  const w = window.open('', '_blank', 'width=900,height=600')
  w.document.write(`<html><body style="background:#111;color:#ccc;font-family:monospace;font-size:12px;white-space:pre-wrap;padding:10px">${tab.lines.join('')}</body></html>`)
}

// ── Exec input ─────────────────────────────────────────────────────────────
function sendInput() {
  const tab = activeTab.value
  if (!tab?.ws || tab.ws.readyState !== 1) return
  tab.ws.send(JSON.stringify({ action: 'stdin', data: cmdInput.value + '\n' }))
  cmdInput.value = ''
}

function sendCtrlC() {
  const tab = activeTab.value
  if (!tab?.ws || tab.ws.readyState !== 1) return
  tab.ws.send(JSON.stringify({ action: 'stdin', data: '\x03' }))
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
onUnmounted(() => { document.removeEventListener('mousemove', onResize); document.removeEventListener('mouseup', stopResize) })
</script>
