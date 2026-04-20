<template>
  <Teleport to="body">
  <div v-if="visible" class="fvm-overlay" @click.self="tryClose">
    <div class="fvm-window" :class="`mode-${mode}`" ref="windowRef">

      <!-- ── Title bar ──────────────────────────────────────────────────── -->
      <div class="fvm-titlebar">
        <div class="fvm-title-left">
          <span class="fvm-mode-chip" :class="mode">{{ MODE_LABELS[mode] }}</span>
          <span class="fvm-filename" :title="filePath">{{ fileName }}</span>
          <span v-if="dirty" class="fvm-dirty" title="Unsaved changes">●</span>
        </div>
        <div class="fvm-title-right">
          <span class="fvm-meta">{{ lineCount }} lines · {{ sizeHuman }}</span>
          <!-- Mode switcher -->
          <button
            v-if="isMarkdown"
            class="fvm-btn"
            :class="{ active: mode === 'md' }"
            title="Markdown preview (Ctrl+P)"
            @click="setMode('md')"
          >Preview</button>
          <button
            v-if="mode !== 'cat'"
            class="fvm-btn"
            :class="{ active: mode === 'view' }"
            title="View mode (read-only)"
            @click="setMode('view')"
          >View</button>
          <button
            class="fvm-btn"
            :class="{ active: mode === 'edit' }"
            title="Edit mode"
            @click="setMode('edit')"
          >Edit</button>
          <div class="fvm-sep"></div>
          <button class="fvm-btn" title="Copy all" @click="copyAll">Copy</button>
          <button v-if="dirty" class="fvm-btn primary" title="Save (Ctrl+S)" @click="save">Save</button>
          <button class="fvm-btn close" title="Close (Esc)" @click="tryClose">✕</button>
        </div>
      </div>

      <!-- ── Status bar (nano-style) ────────────────────────────────────── -->
      <div v-if="mode !== 'cat' && mode !== 'md'" class="fvm-statusbar">
        <span>{{ filePath }}</span>
        <span class="fvm-sb-pos">Ln {{ cursorLine }}, Col {{ cursorCol }}</span>
        <span v-if="searchActive" class="fvm-sb-search">🔍 {{ searchQuery }}</span>
        <div style="flex:1"></div>
        <span v-if="mode === 'view'" class="fvm-sb-hint">
          <kbd>Ctrl+E</kbd> Edit &nbsp;
          <kbd>Ctrl+F</kbd> Find &nbsp;
          <kbd>Esc</kbd> Close
        </span>
        <span v-else class="fvm-sb-hint">
          <kbd>Ctrl+S</kbd> Save &nbsp;
          <kbd>Ctrl+F</kbd> Find &nbsp;
          <kbd>Esc</kbd> Close
        </span>
      </div>

      <!-- ── Search bar ─────────────────────────────────────────────────── -->
      <div v-if="searchActive" class="fvm-searchbar">
        <span>Find:</span>
        <input
          ref="searchRef"
          v-model="searchQuery"
          class="fvm-search-input"
          placeholder="Search…"
          @keydown.enter="findNext"
          @keydown.escape="closeSearch"
          @input="doSearch"
          spellcheck="false"
        />
        <button class="fvm-btn sm" @click="findPrev">▲</button>
        <button class="fvm-btn sm" @click="findNext">▼</button>
        <span class="fvm-search-count">{{ searchMatchInfo }}</span>
        <button class="fvm-btn sm close" @click="closeSearch">✕</button>
      </div>

      <!-- ── Body: MARKDOWN preview ────────────────────────────────────── -->
      <div
        v-if="mode === 'md'"
        class="fvm-md-body md-content"
        ref="mdBodyRef"
        v-html="renderedMd"
      ></div>

      <!-- ── Body: CAT mode ─────────────────────────────────────────────── -->
      <div v-else-if="mode === 'cat'" class="fvm-cat-body" ref="catBodyRef">
        <div
          v-for="(line, i) in displayLines"
          :key="i"
          :class="['fvm-cat-line', classifyLine(line)]"
        >
          <span class="fvm-ln">{{ i + 1 }}</span>
          <span class="fvm-lc" v-html="highlightSearch(escapeHtml(line))"></span>
        </div>
      </div>

      <!-- ── Body: VIEW mode (nano-style, read-only) ────────────────────── -->
      <div
        v-else-if="mode === 'view'"
        class="fvm-view-body"
        ref="viewBodyRef"
        tabindex="0"
        @keydown="onViewKey"
      >
        <div
          v-for="(line, i) in displayLines"
          :key="i"
          :class="['fvm-view-line', { 'fvm-search-match': isMatchLine(i), 'fvm-search-current': isCurrentMatch(i) }]"
        >
          <span class="fvm-ln">{{ i + 1 }}</span>
          <span class="fvm-lc" v-html="highlightSearch(highlightSyntax(line))"></span>
        </div>
      </div>

      <!-- ── Body: EDIT mode (vim-inspired textarea) ───────────────────── -->
      <div v-else class="fvm-edit-body">
        <div class="fvm-edit-gutters" ref="gutterRef" aria-hidden="true">
          <div
            v-for="n in lineCount"
            :key="n"
            :class="['fvm-gutter-ln', { active: cursorLine === n }]"
          >{{ n }}</div>
        </div>
        <textarea
          ref="editorRef"
          v-model="editContent"
          class="fvm-editor"
          spellcheck="false"
          autocomplete="off"
          autocorrect="off"
          autocapitalize="off"
          @keydown="onEditorKey"
          @scroll="syncGutterScroll"
          @click="updateCursor"
          @keyup="updateCursor"
        ></textarea>
      </div>

      <!-- ── Footer ─────────────────────────────────────────────────────── -->
      <div class="fvm-footer">
        <span v-if="saveMsg" :class="['fvm-save-msg', saveMsg.ok ? 'ok' : 'err']">{{ saveMsg.text }}</span>
        <span v-else class="fvm-footer-hint">
          {{ mode === 'cat' ? 'Read-only log view' : mode === 'md' ? 'Markdown preview — Ctrl+E para editar fuente' : mode === 'view' ? 'Read-only — Ctrl+E to edit' : 'Editing — Ctrl+S to save' }}
        </span>
        <span style="margin-left:auto; color:#555; font-size:10px">{{ ext.toUpperCase() || 'TXT' }}</span>
      </div>

    </div>
  </div>
  </Teleport>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { marked } from 'marked'

// ── Props / emits ──────────────────────────────────────────────────────────
const props  = defineProps({ filePath: String, initialMode: { type: String, default: 'auto' } })
const emit   = defineEmits(['close', 'saved'])

// ── State ──────────────────────────────────────────────────────────────────
const visible     = ref(false)
const rawContent  = ref('')
const editContent = ref('')
const mode        = ref('view')
const dirty       = computed(() => editContent.value !== rawContent.value)
const lineCount   = computed(() => (mode.value === 'edit' ? editContent.value : rawContent.value).split('\n').length)
const sizeHuman   = ref('')
const saveMsg     = ref(null)
let   saveMsgTimer = null

const windowRef   = ref(null)
const catBodyRef  = ref(null)
const viewBodyRef = ref(null)
const editorRef   = ref(null)
const gutterRef   = ref(null)
const searchRef   = ref(null)

// Cursor tracking
const cursorLine = ref(1)
const cursorCol  = ref(1)

// Search
const searchActive    = ref(false)
const searchQuery     = ref('')
const searchMatches   = ref([])   // array of line indexes (0-based) with matches
const searchCurrent   = ref(0)
const searchMatchInfo = computed(() => {
  if (!searchQuery.value) return ''
  return searchMatches.value.length
    ? `${searchCurrent.value + 1} / ${searchMatches.value.length}`
    : 'No results'
})

const MODE_LABELS = { cat: 'CAT', view: 'VIEW', edit: 'EDIT', md: 'MD' }

// ── Markdown ───────────────────────────────────────────────────────────────
const mdBodyRef  = ref(null)
const isMarkdown = computed(() => ext.value === 'md' || ext.value === 'markdown')
const renderedMd = computed(() => {
  if (!isMarkdown.value) return ''
  const src = mode.value === 'edit' ? editContent.value : rawContent.value
  return marked.parse(src, { breaks: true, gfm: true })
})

// ── Computed helpers ───────────────────────────────────────────────────────
const fileName = computed(() => {
  if (!props.filePath) return ''
  return props.filePath.replace(/\\/g, '/').split('/').pop()
})

const ext = computed(() => {
  const name = fileName.value
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i + 1).toLowerCase() : ''
})

const displayLines = computed(() => rawContent.value.split('\n'))

// ── Auto-mode detection ────────────────────────────────────────────────────
const LOG_EXTS  = new Set(['log', 'out', 'txt', 'csv'])
const EDIT_EXTS = new Set(['js','ts','vue','jsx','tsx','json','yaml','yml','toml','env','sh','bash','ps1','bat','cmd','py','rb','go','rs','c','cpp','h','java','css','scss','html','conf','config','ini'])

function autoMode() {
  if (props.initialMode !== 'auto') return props.initialMode
  if (ext.value === 'md' || ext.value === 'markdown') return 'md'
  if (LOG_EXTS.has(ext.value))  return 'cat'
  if (EDIT_EXTS.has(ext.value)) return 'edit'
  return 'view'
}

// ── Load file ──────────────────────────────────────────────────────────────
async function load() {
  try {
    const res  = await fetch(`/api/local/read?path=${encodeURIComponent(props.filePath)}`)
    const data = await res.json()
    if (!res.ok) throw new Error(data.error)
    rawContent.value  = data.content
    editContent.value = data.content
    sizeHuman.value   = data.sizeHuman
    mode.value        = autoMode()
    visible.value     = true
    nextTick(() => {
      if (mode.value === 'view') viewBodyRef.value?.focus()
      if (mode.value === 'cat') catBodyRef.value?.scrollTo(0, catBodyRef.value.scrollHeight)
    })
  } catch (err) {
    console.error('[FileViewer] load error', err)
    emit('close')
  }
}

onMounted(load)

// ── Mode switch ────────────────────────────────────────────────────────────
function setMode(m) {
  if (m === 'edit' && mode.value !== 'edit') editContent.value = rawContent.value
  mode.value = m
  nextTick(() => {
    if (m === 'view') viewBodyRef.value?.focus()
    if (m === 'edit') editorRef.value?.focus()
    if (m === 'md')   mdBodyRef.value?.scrollTo(0, 0)
  })
}

// ── Save ───────────────────────────────────────────────────────────────────
async function save() {
  try {
    const res  = await fetch('/api/local/write', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ path: props.filePath, content: editContent.value }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error)
    rawContent.value = editContent.value
    sizeHuman.value  = data.sizeHuman
    showSaveMsg({ ok: true, text: `Saved — ${data.sizeHuman}` })
    emit('saved', props.filePath)
  } catch (err) {
    showSaveMsg({ ok: false, text: `Save failed: ${err.message}` })
  }
}

function showSaveMsg(msg) {
  clearTimeout(saveMsgTimer)
  saveMsg.value = msg
  saveMsgTimer  = setTimeout(() => (saveMsg.value = null), 3000)
}

// ── Close / dirty guard ────────────────────────────────────────────────────
function tryClose() {
  if (dirty.value && mode.value === 'edit') {
    if (!confirm('You have unsaved changes. Close anyway?')) return
  }
  visible.value = false
  emit('close')
}

// ── Copy ───────────────────────────────────────────────────────────────────
function copyAll() {
  navigator.clipboard.writeText(mode.value === 'edit' ? editContent.value : rawContent.value)
    .then(() => showSaveMsg({ ok: true, text: 'Copied to clipboard' }))
    .catch(() => {})
}

// ── Search ─────────────────────────────────────────────────────────────────
function openSearch() {
  searchActive.value = true
  nextTick(() => searchRef.value?.focus())
}
function closeSearch() {
  searchActive.value = false
  searchQuery.value  = ''
  searchMatches.value = []
}
function doSearch() {
  if (!searchQuery.value) { searchMatches.value = []; return }
  const q     = searchQuery.value.toLowerCase()
  const lines = displayLines.value
  searchMatches.value = lines.reduce((acc, l, i) => {
    if (l.toLowerCase().includes(q)) acc.push(i)
    return acc
  }, [])
  searchCurrent.value = 0
  scrollToMatch()
}
function findNext() {
  if (!searchMatches.value.length) return
  searchCurrent.value = (searchCurrent.value + 1) % searchMatches.value.length
  scrollToMatch()
}
function findPrev() {
  if (!searchMatches.value.length) return
  searchCurrent.value = (searchCurrent.value - 1 + searchMatches.value.length) % searchMatches.value.length
  scrollToMatch()
}
function scrollToMatch() {
  if (!searchMatches.value.length) return
  const lineIdx = searchMatches.value[searchCurrent.value]
  const body    = viewBodyRef.value || catBodyRef.value
  if (!body) return
  const el = body.querySelectorAll('.fvm-view-line, .fvm-cat-line')[lineIdx]
  el?.scrollIntoView({ block: 'center' })
}
function isMatchLine(i)   { return searchMatches.value.includes(i) }
function isCurrentMatch(i){ return searchMatches.value[searchCurrent.value] === i }

// ── Keyboard handlers ──────────────────────────────────────────────────────
function onViewKey(e) {
  if (e.ctrlKey && e.key === 'f') { e.preventDefault(); openSearch() }
  if (e.ctrlKey && e.key === 'e') { e.preventDefault(); setMode('edit') }
  if (e.ctrlKey && e.key === 'p' && isMarkdown.value) { e.preventDefault(); setMode('md') }
  if (e.key === 'Escape')         { e.preventDefault(); tryClose() }
}

function onEditorKey(e) {
  if (e.ctrlKey && e.key === 's') { e.preventDefault(); save() }
  if (e.ctrlKey && e.key === 'f') { e.preventDefault(); openSearch() }
  if (e.ctrlKey && e.key === 'p' && isMarkdown.value) { e.preventDefault(); setMode('md') }
  if (e.key === 'Escape')         { e.preventDefault(); tryClose() }
  // Tab inserts spaces instead of focus-leaving
  if (e.key === 'Tab') {
    e.preventDefault()
    const ta  = editorRef.value
    const s   = ta.selectionStart
    const end = ta.selectionEnd
    const spaces = '  '
    editContent.value = editContent.value.slice(0, s) + spaces + editContent.value.slice(end)
    nextTick(() => { ta.selectionStart = ta.selectionEnd = s + spaces.length })
  }
  nextTick(updateCursor)
}

function updateCursor() {
  const ta = editorRef.value
  if (!ta) return
  const text = ta.value.slice(0, ta.selectionStart)
  const lines = text.split('\n')
  cursorLine.value = lines.length
  cursorCol.value  = lines[lines.length - 1].length + 1
}

function syncGutterScroll() {
  if (gutterRef.value && editorRef.value)
    gutterRef.value.scrollTop = editorRef.value.scrollTop
}

// ── Global ESC ────────────────────────────────────────────────────────────
function onGlobalKey(e) {
  if (e.key === 'Escape' && visible.value && !searchActive.value) tryClose()
}
onMounted(() => window.addEventListener('keydown', onGlobalKey))
onUnmounted(() => {
  window.removeEventListener('keydown', onGlobalKey)
  clearTimeout(saveMsgTimer)
})

// ── Syntax / line classification ───────────────────────────────────────────
const LOG_ERR  = /error|exception|fail(ed)?|fatal|panic|critical/i
const LOG_WARN = /warn(ing)?/i
const LOG_OK   = /\b(ok|done|success|complete|pass(ed)?|running|ready|started)\b/i

function classifyLine(line) {
  if (LOG_ERR.test(line))  return 'log-err'
  if (LOG_WARN.test(line)) return 'log-warn'
  if (LOG_OK.test(line))   return 'log-ok'
  return ''
}

const KEYWORDS = {
  js:   /\b(const|let|var|function|return|if|else|for|while|class|import|export|from|async|await|new|this|typeof|null|undefined|true|false)\b/g,
  ts:   /\b(const|let|var|function|return|if|else|for|while|class|import|export|from|async|await|new|this|typeof|null|undefined|true|false|interface|type|enum|readonly|public|private|protected)\b/g,
  py:   /\b(def|class|import|from|return|if|elif|else|for|while|with|as|try|except|finally|pass|None|True|False|and|or|not|in|is|lambda|yield|async|await)\b/g,
  sh:   /\b(if|then|else|elif|fi|for|while|do|done|case|esac|function|return|export|local|echo|cd|ls|grep|awk|sed|cat)\b/g,
}
const KEYWORD_MAP = { vue: 'js', jsx: 'js', tsx: 'ts', mjs: 'js', cjs: 'js', bash: 'sh', ps1: 'sh', cmd: 'sh', bat: 'sh' }

function highlightSyntax(line) {
  const esc = escapeHtml(line)
  const lang = KEYWORD_MAP[ext.value] || ext.value
  const re   = KEYWORDS[lang]
  if (!re) return esc
  re.lastIndex = 0
  return esc.replace(re, '<span class="syn-kw">$&</span>')
}

function highlightSearch(html) {
  if (!searchQuery.value || !searchActive.value) return html
  const q   = escapeHtml(searchQuery.value)
  const re  = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
  return html.replace(re, '<mark class="fvm-hl">$&</mark>')
}

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
</script>

<style scoped>
/* ── Overlay ─────────────────────────────────────────────────────────────── */
.fvm-overlay {
  position: fixed; inset: 0; z-index: 2000;
  background: rgba(0,0,0,.75);
  display: flex; align-items: center; justify-content: center;
  backdrop-filter: blur(2px);
}

/* ── Window ──────────────────────────────────────────────────────────────── */
.fvm-window {
  background: #141414;
  border: 1px solid #333;
  border-radius: 6px;
  display: flex;
  flex-direction: column;
  width: min(90vw, 960px);
  height: min(85vh, 720px);
  box-shadow: 0 24px 64px rgba(0,0,0,.7);
  overflow: hidden;
  font-family: 'Cascadia Code','Fira Code','Consolas',monospace;
  font-size: 12px;
}

/* ── Title bar ───────────────────────────────────────────────────────────── */
.fvm-titlebar {
  display: flex; align-items: center;
  background: #1c1c1c; border-bottom: 1px solid #2a2a2a;
  padding: 0 10px; height: 36px; gap: 8px; flex-shrink: 0;
}
.fvm-title-left  { display: flex; align-items: center; gap: 6px; flex: 1; min-width: 0; }
.fvm-title-right { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }

.fvm-mode-chip {
  font-size: 9px; font-weight: 800; padding: 2px 5px; border-radius: 3px;
  text-transform: uppercase; letter-spacing: .8px;
}
.fvm-mode-chip.cat  { background: #1e3a2a; color: #66bb6a; }
.fvm-mode-chip.view { background: #1a2d3e; color: #64b5f6; }
.fvm-mode-chip.edit { background: #3a2a1a; color: #ffa726; }
.fvm-mode-chip.md   { background: #2a1f3a; color: #ce93d8; }

.fvm-filename {
  color: #e0e0e0; font-size: 13px; font-weight: 600;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.fvm-dirty { color: #ffa726; font-size: 14px; }
.fvm-meta  { color: #555; font-size: 10px; white-space: nowrap; }
.fvm-sep   { width: 1px; height: 16px; background: #333; margin: 0 2px; }

.fvm-btn {
  background: #252525; border: 1px solid #333; color: #aaa;
  padding: 2px 8px; border-radius: 3px; cursor: pointer;
  font-size: 11px; white-space: nowrap; transition: background .12s, color .12s;
}
.fvm-btn:hover         { background: #333; color: #ddd; }
.fvm-btn.active        { background: #0e9de8; border-color: #0e9de8; color: #fff; }
.fvm-btn.primary       { background: #1e7d34; border-color: #2a9d44; color: #aaffb0; }
.fvm-btn.primary:hover { background: #2a9d44; }
.fvm-btn.close:hover   { background: #7f1d1d; border-color: #ef5350; color: #ef9a9a; }
.fvm-btn.sm            { padding: 1px 5px; font-size: 10px; }

/* ── Status bar ──────────────────────────────────────────────────────────── */
.fvm-statusbar {
  display: flex; align-items: center; gap: 12px;
  background: #111; border-bottom: 1px solid #222;
  padding: 2px 10px; height: 22px; flex-shrink: 0;
  font-size: 10px; color: #555;
}
.fvm-sb-pos    { color: #777; white-space: nowrap; }
.fvm-sb-search { color: #ffa726; }
.fvm-sb-hint kbd {
  background: #1d1d1d; border: 1px solid #333; border-radius: 2px;
  padding: 0 4px; font-size: 9px; font-family: monospace;
}

/* ── Search bar ──────────────────────────────────────────────────────────── */
.fvm-searchbar {
  display: flex; align-items: center; gap: 6px;
  background: #1a1a1a; border-bottom: 1px solid #2a2a2a;
  padding: 4px 10px; flex-shrink: 0;
}
.fvm-search-input {
  flex: 1; max-width: 300px; background: #111; border: 1px solid #333;
  color: #e0e0e0; padding: 2px 6px; border-radius: 3px; outline: none;
  font-family: inherit; font-size: 12px;
}
.fvm-search-count { color: #777; font-size: 10px; white-space: nowrap; }

/* ── CAT body ────────────────────────────────────────────────────────────── */
.fvm-cat-body {
  flex: 1; overflow: auto; padding: 6px 0;
  background: #0d0d0d; scrollbar-width: thin;
}
.fvm-cat-line {
  display: flex; align-items: baseline;
  line-height: 1.55; padding: 0 10px 0 0;
  white-space: pre;
}
.fvm-cat-line.log-err  { color: #ef5350; background: rgba(239,83,80,.06); }
.fvm-cat-line.log-warn { color: #ffa726; background: rgba(255,167,38,.04); }
.fvm-cat-line.log-ok   { color: #66bb6a; }

/* ── VIEW body (nano-style) ──────────────────────────────────────────────── */
.fvm-view-body {
  flex: 1; overflow: auto; padding: 6px 0;
  background: #0d0d0d; scrollbar-width: thin; outline: none;
}
.fvm-view-line {
  display: flex; align-items: baseline;
  line-height: 1.55; padding: 0 10px 0 0;
  white-space: pre;
}
.fvm-view-line.fvm-search-match   { background: rgba(255,213,79,.08); }
.fvm-view-line.fvm-search-current { background: rgba(255,213,79,.25); }

/* Shared line number + content */
.fvm-ln {
  min-width: 48px; padding: 0 10px 0 6px;
  color: #3a3a3a; user-select: none; text-align: right;
  flex-shrink: 0; font-size: 10px;
}
.fvm-lc { color: #c8c8c8; flex: 1; }

/* ── EDIT body ───────────────────────────────────────────────────────────── */
.fvm-edit-body {
  flex: 1; display: flex; overflow: hidden;
  background: #0d0d0d;
}

.fvm-edit-gutters {
  width: 48px; overflow: hidden; flex-shrink: 0;
  background: #111; border-right: 1px solid #222;
  padding: 6px 0;
}
.fvm-gutter-ln {
  height: 1.55em; line-height: 1.55;
  padding: 0 6px; text-align: right;
  font-size: 10px; color: #3a3a3a; user-select: none;
}
.fvm-gutter-ln.active { color: #777; }

.fvm-editor {
  flex: 1; resize: none; border: none; outline: none;
  background: transparent; color: #c8c8c8;
  font-family: 'Cascadia Code','Fira Code','Consolas',monospace;
  font-size: 12px; line-height: 1.55;
  padding: 6px 10px 6px 0;
  tab-size: 2; white-space: pre;
  overflow-wrap: normal; overflow-x: auto;
  caret-color: #64b5f6;
}

/* ── Syntax highlight ────────────────────────────────────────────────────── */
:deep(.syn-kw) { color: #c792ea; }
:deep(.fvm-hl) { background: rgba(255,213,79,.35); color: inherit; border-radius: 2px; }

/* ── Markdown preview ────────────────────────────────────────────────────── */
.fvm-md-body {
  flex: 1; overflow: auto; padding: 24px 32px;
  background: #111; scrollbar-width: thin; color: #d4d4d4;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 14px; line-height: 1.7;
}

/* GitHub-style markdown */
:deep(.md-content h1),
:deep(.md-content h2),
:deep(.md-content h3),
:deep(.md-content h4),
:deep(.md-content h5),
:deep(.md-content h6) {
  color: #e0e0e0; font-weight: 600; margin: 1.2em 0 .5em;
  border-bottom: 1px solid #2a2a2a; padding-bottom: .2em;
}
:deep(.md-content h1) { font-size: 2em; }
:deep(.md-content h2) { font-size: 1.5em; }
:deep(.md-content h3) { font-size: 1.25em; }
:deep(.md-content p)  { margin: .6em 0; }

:deep(.md-content a) { color: #64b5f6; text-decoration: underline; }
:deep(.md-content a:hover) { color: #90caf9; }

:deep(.md-content code) {
  background: #1e1e1e; border: 1px solid #2a2a2a;
  border-radius: 3px; padding: 1px 5px;
  font-family: 'Cascadia Code','Fira Code',monospace; font-size: 12px;
  color: #ce93d8;
}

:deep(.md-content pre) {
  background: #1a1a1a; border: 1px solid #2a2a2a;
  border-radius: 6px; padding: 14px 16px; overflow-x: auto;
  margin: 1em 0;
}
:deep(.md-content pre code) {
  background: none; border: none; padding: 0;
  font-size: 12px; color: #c8c8c8;
}

:deep(.md-content blockquote) {
  border-left: 3px solid #444; margin: 1em 0;
  padding: .3em 1em; color: #888; background: #161616;
}

:deep(.md-content ul),
:deep(.md-content ol) { padding-left: 1.6em; margin: .5em 0; }
:deep(.md-content li) { margin: .2em 0; }

:deep(.md-content table) {
  border-collapse: collapse; width: 100%; margin: 1em 0;
}
:deep(.md-content th),
:deep(.md-content td) {
  border: 1px solid #2a2a2a; padding: 6px 12px;
}
:deep(.md-content th) { background: #1a1a1a; color: #e0e0e0; font-weight: 600; }
:deep(.md-content tr:nth-child(even)) { background: #141414; }

:deep(.md-content hr) { border: none; border-top: 1px solid #2a2a2a; margin: 1.5em 0; }

:deep(.md-content img) { max-width: 100%; border-radius: 4px; }

/* ── Footer ──────────────────────────────────────────────────────────────── */
.fvm-footer {
  display: flex; align-items: center;
  background: #111; border-top: 1px solid #1e1e1e;
  padding: 3px 10px; height: 22px; flex-shrink: 0;
  font-size: 10px;
}
.fvm-footer-hint { color: #444; }
.fvm-save-msg.ok  { color: #66bb6a; }
.fvm-save-msg.err { color: #ef5350; }
</style>
