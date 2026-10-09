<template>
  <BaseModal :show="show" :wide="true" @close="$emit('close')">
    <template #title><i data-lucide="file-code-2"></i> YAML — {{ title }}</template>
    <div class="yaml-modal-body">
      <KubeActionTarget v-if="context" compact :context="context" :namespace="namespace" :resource="`${kubeKindLabel(resourceType)} / ${name}`" />
      <div class="yaml-toolbar">
        <div class="yaml-search">
          <i data-lucide="search"></i>
          <input
            ref="searchInputRef"
            v-model="searchDraft"
            class="ctrl-input yaml-search-input"
            :placeholder="t('yamlm.searchPlaceholder')"
            @keydown.enter.exact.prevent="applySearch()"
            @keydown.shift.enter.prevent="applySearch('previous')"
          />
          <button class="btn sm" :disabled="!searchDraft" @click="applySearch()">
            <i data-lucide="search"></i> {{ t('yamlm.search') }}
          </button>
          <span class="yaml-search-count">{{ searchStatus }}</span>
          <button class="btn btn-icon" :title="t('yamlm.previous')" :disabled="!matchCount" @click="findPrevious"><i data-lucide="chevron-up"></i></button>
          <button class="btn btn-icon" :title="t('yamlm.next')" :disabled="!matchCount" @click="findNext"><i data-lucide="chevron-down"></i></button>
        </div>
        <div :class="['yaml-lint-status', lintState]">
          <i :data-lucide="lintState === 'ok' ? 'check-circle-2' : lintState === 'error' ? 'alert-triangle' : 'circle-dashed'"></i>
          <span>{{ lintMessage }}</span>
        </div>
      </div>

      <textarea
        ref="editorRef"
        class="yaml-editor yaml-editor-modal"
        v-model="content"
        spellcheck="false"
        :disabled="loading"
        @click="updateCursor"
        @input="updateCursor"
        @keyup="updateCursor"
        @select="updateCursor"
        @keydown.meta.s.prevent="saveYaml"
        @keydown.ctrl.s.prevent="saveYaml"
        @keydown.ctrl.space.prevent="triggerAutocomplete"
        @keydown.meta.space.prevent="triggerAutocomplete"
        @keydown.escape.prevent="hideAutocomplete"
      ></textarea>

      <div v-if="showSuggestions" class="yaml-autocomplete">
        <button
          v-for="item in filteredSuggestions"
          :key="item.label"
          class="yaml-suggestion"
          @mousedown.prevent="applySuggestion(item)"
        >
          <span class="yaml-suggestion-label">{{ item.label }}</span>
          <span class="yaml-suggestion-detail">{{ t(item.detailKey) }}</span>
        </button>
        <div v-if="!filteredSuggestions.length" class="yaml-suggestion-empty">{{ t('yamlm.noSuggestions') }}</div>
      </div>

      <div class="yaml-editor-status">
        <span class="yaml-section" :title="currentSection"><i data-lucide="map"></i> {{ currentSection }}</span>
        <span>Ln {{ cursorLine }}, Col {{ cursorCol }}</span>
        <span>{{ t('yamlm.lines', { n: totalLines }) }}</span>
        <button class="btn sm" title="Ctrl+Space" @click="triggerAutocomplete">
          <i data-lucide="sparkles"></i> {{ t('yamlm.autocomplete') }}
        </button>
      </div>

      <div v-if="lintError" class="yaml-validation error">
        <i data-lucide="alert-triangle"></i>
        <span>{{ lintError }}</span>
      </div>
      <div v-else-if="lintState === 'ok'" class="yaml-validation ok">
        <i data-lucide="check-circle-2"></i>
        <span>{{ t('yamlm.valid') }}</span>
      </div>
      <p v-if="error" class="kubeconfig-error">{{ error }}</p>
    </div>
    <template #footer>
      <button class="btn" @click="validateYaml(true)"><i data-lucide="check-circle-2"></i> {{ t('yamlm.validate') }}</button>
      <button class="btn primary" :disabled="loading || saving || !!lintError" @click="saveYaml">
        <i data-lucide="save"></i> {{ saving ? t('yamlm.saving') : t('yamlm.save') }}
      </button>
      <button class="btn"         @click="$emit('close')">{{ t('action.close') }}</button>
    </template>
  </BaseModal>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { createIcons, icons } from 'lucide'
import yaml from 'js-yaml'
import BaseModal from '../BaseModal.vue'
import KubeActionTarget from './KubeActionTarget.vue'
import { kubeKindLabel } from '../../lib/kubeContext'
import { api } from '../../composables/useApi'
import { useToast } from '../../composables/useToast'
import { useI18n } from '../../composables/useI18n'

// `context` is the kube context captured when the editor opened; applying is
// refused by the server if the active context changed since.
const props = defineProps({ show: Boolean, title: String, resourceType: String, namespace: String, name: String, context: String })
const emit  = defineEmits(['close'])

const { toast } = useToast()
const { t } = useI18n()
const CLUSTER_RESOURCES = new Set([
  'nodes', 'namespaces', 'pvs', 'storageclasses', 'ingressclasses',
  'priorityclasses', 'runtimeclasses', 'mutatingwebhookconfigurations',
  'validatingwebhookconfigurations',
])
const content = ref('')
const error   = ref('')
const lintError = ref('')
const parsedYaml = ref(null)
const loading = ref(false)
const saving = ref(false)
const searchDraft = ref('')
const searchQuery = ref('')
const activeMatch = ref(-1)
const cursorIndex = ref(0)
const showSuggestions = ref(false)
const editorRef = ref(null)
const searchInputRef = ref(null)

const YAML_COMPLETIONS = [
  { label: 'apiVersion', insert: 'apiVersion: ', detailKey: 'yamlm.field.apiVersion' },
  { label: 'kind', insert: 'kind: ', detailKey: 'yamlm.field.kind' },
  { label: 'metadata', insert: 'metadata:', detailKey: 'yamlm.field.metadata' },
  { label: 'name', insert: 'name: ', detailKey: 'yamlm.field.name' },
  { label: 'namespace', insert: 'namespace: ', detailKey: 'yamlm.field.namespace' },
  { label: 'labels', insert: 'labels:', detailKey: 'yamlm.field.labels' },
  { label: 'annotations', insert: 'annotations:', detailKey: 'yamlm.field.annotations' },
  { label: 'spec', insert: 'spec:', detailKey: 'yamlm.field.spec' },
  { label: 'replicas', insert: 'replicas: ', detailKey: 'yamlm.field.replicas' },
  { label: 'selector', insert: 'selector:', detailKey: 'yamlm.field.selector' },
  { label: 'matchLabels', insert: 'matchLabels:', detailKey: 'yamlm.field.matchLabels' },
  { label: 'template', insert: 'template:', detailKey: 'yamlm.field.template' },
  { label: 'containers', insert: 'containers:', detailKey: 'yamlm.field.containers' },
  { label: 'image', insert: 'image: ', detailKey: 'yamlm.field.image' },
  { label: 'ports', insert: 'ports:', detailKey: 'yamlm.field.ports' },
  { label: 'containerPort', insert: 'containerPort: ', detailKey: 'yamlm.field.containerPort' },
  { label: 'env', insert: 'env:', detailKey: 'yamlm.field.env' },
  { label: 'resources', insert: 'resources:', detailKey: 'yamlm.field.resources' },
  { label: 'requests', insert: 'requests:', detailKey: 'yamlm.field.requests' },
  { label: 'limits', insert: 'limits:', detailKey: 'yamlm.field.limits' },
  { label: 'volumeMounts', insert: 'volumeMounts:', detailKey: 'yamlm.field.volumeMounts' },
  { label: 'volumes', insert: 'volumes:', detailKey: 'yamlm.field.volumes' },
  { label: 'serviceAccountName', insert: 'serviceAccountName: ', detailKey: 'yamlm.field.serviceAccountName' },
  { label: 'nodeSelector', insert: 'nodeSelector:', detailKey: 'yamlm.field.nodeSelector' },
  { label: 'tolerations', insert: 'tolerations:', detailKey: 'yamlm.field.tolerations' },
  { label: 'affinity', insert: 'affinity:', detailKey: 'yamlm.field.affinity' },
  { label: 'data', insert: 'data:', detailKey: 'yamlm.field.data' },
  { label: 'stringData', insert: 'stringData:', detailKey: 'yamlm.field.stringData' },
  { label: 'type', insert: 'type: ', detailKey: 'yamlm.field.type' },
]

const matches = computed(() => {
  if (!searchQuery.value) return []
  const query = searchQuery.value.toLowerCase()
  const text = content.value.toLowerCase()
  const found = []
  let index = text.indexOf(query)
  while (index !== -1) {
    found.push(index)
    index = text.indexOf(query, index + Math.max(query.length, 1))
  }
  return found
})

const matchCount = computed(() => matches.value.length)
const searchStatus = computed(() => {
  if (searchDraft.value && searchDraft.value !== searchQuery.value) return t('yamlm.pending')
  if (!searchQuery.value) return ''
  if (!matchCount.value) return '0/0'
  return `${activeMatch.value + 1}/${matchCount.value}`
})
const lintState = computed(() => {
  if (loading.value || content.value === 'Loading…') return 'pending'
  return lintError.value ? 'error' : 'ok'
})
const lintMessage = computed(() => {
  if (loading.value) return t('yamlm.loading')
  if (lintError.value) return t('yamlm.invalid')
  return t('yamlm.valid')
})
const totalLines = computed(() => content.value ? content.value.split('\n').length : 0)
const cursorLine = computed(() => content.value.slice(0, cursorIndex.value).split('\n').length)
const cursorCol = computed(() => {
  const lineStart = content.value.lastIndexOf('\n', Math.max(cursorIndex.value - 1, 0)) + 1
  return cursorIndex.value - lineStart + 1
})
const currentSection = computed(() => yamlPathAtCursor() || t('yamlm.document'))
const currentWord = computed(() => getCurrentWordRange().word)
const filteredSuggestions = computed(() => {
  const prefix = currentWord.value.toLowerCase()
  if (!prefix) return YAML_COMPLETIONS
  return YAML_COMPLETIONS.filter(item => item.label.toLowerCase().startsWith(prefix))
})

watch(() => props.show, async v => {
  if (!v) return
  loading.value = true
  content.value = 'Loading…'
  error.value   = ''
  lintError.value = ''
  parsedYaml.value = null
  searchDraft.value = ''
  searchQuery.value = ''
  activeMatch.value = -1
  try {
    const url = CLUSTER_RESOURCES.has(props.resourceType)
      ? `/api/${props.resourceType}/${encodeURIComponent(props.name)}/yaml`
      : `/api/${encodeURIComponent(props.namespace)}/${props.resourceType}/${encodeURIComponent(props.name)}/yaml`
    content.value = await api('GET', url)
    validateYaml()
  } catch (e) {
    content.value = `# Error: ${e.message}`
    lintError.value = e.message
  } finally {
    loading.value = false
    nextTick(() => {
      updateCursor()
      createIcons({ icons })
    })
  }
})

watch(content, () => {
  if (!props.show || loading.value) return
  validateYaml()
  updateCursor()
})

function updateCursor() {
  const editor = editorRef.value
  cursorIndex.value = editor?.selectionStart ?? 0
}

function validateYaml(showToast = false) {
  error.value = ''
  lintError.value = ''
  parsedYaml.value = null
  try {
    const parsed = yaml.load(content.value)
    if (!parsed || typeof parsed !== 'object') throw new Error(t('yamlm.needObject'))
    if (!parsed.kind) throw new Error(t('yamlm.missingField', { field: 'kind' }))
    if (!parsed.metadata?.name) throw new Error(t('yamlm.missingField', { field: 'metadata.name' }))
    parsedYaml.value = parsed
    if (showToast) toast(t('yamlm.valid'), 'success')
    nextTick(() => createIcons({ icons }))
    return true
  } catch (e) {
    const mark = e.mark ? `Linea ${e.mark.line + 1}, columna ${e.mark.column + 1}: ` : ''
    lintError.value = `${mark}${e.reason || e.message}`
    if (showToast) toast(t('yamlm.invalid'), 'error')
    nextTick(() => createIcons({ icons }))
    return false
  }
}

function applySearch(direction = 'next') {
  const nextQuery = searchDraft.value
  if (!nextQuery) {
    searchQuery.value = ''
    activeMatch.value = -1
    return
  }

  if (nextQuery !== searchQuery.value) {
    searchQuery.value = nextQuery
    activeMatch.value = matchCount.value ? (direction === 'previous' ? matchCount.value - 1 : 0) : -1
    selectActiveMatch()
    return
  }

  if (direction === 'previous') findPrevious()
  else findNext()
}

function selectActiveMatch() {
  nextTick(() => {
    const editor = editorRef.value
    if (!editor || activeMatch.value < 0) return
    const start = matches.value[activeMatch.value]
    const end = start + searchQuery.value.length
    editor.focus()
    editor.setSelectionRange(start, end)
    const lineHeight = parseFloat(getComputedStyle(editor).lineHeight) || 20
    const line = content.value.slice(0, start).split('\n').length - 1
    editor.scrollTop = Math.max(0, line * lineHeight - editor.clientHeight / 2)
  })
}

function findNext() {
  if (!matchCount.value) return
  activeMatch.value = (activeMatch.value + 1) % matchCount.value
  selectActiveMatch()
}

function findPrevious() {
  if (!matchCount.value) return
  activeMatch.value = (activeMatch.value - 1 + matchCount.value) % matchCount.value
  selectActiveMatch()
}

function yamlPathAtCursor() {
  const lines = content.value.split('\n')
  const currentLineIndex = Math.max(cursorLine.value - 1, 0)
  const stack = []
  for (let i = 0; i <= currentLineIndex; i += 1) {
    const line = lines[i]
    if (!line || /^\s*#/.test(line)) continue
    const indent = line.match(/^\s*/)?.[0].length ?? 0
    const key = yamlKeyFromLine(line)
    if (!key) continue
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop()
    stack.push({ indent, key })
  }
  return stack.map(item => item.key).join(' > ')
}

function yamlKeyFromLine(line) {
  const clean = line.trim().replace(/^-\s+/, '')
  const match = clean.match(/^([A-Za-z0-9_.-]+)\s*:/)
  return match?.[1] || ''
}

function getCurrentWordRange() {
  const beforeCursor = content.value.slice(0, cursorIndex.value)
  const lineStart = beforeCursor.lastIndexOf('\n') + 1
  const linePrefix = beforeCursor.slice(lineStart)
  const match = linePrefix.match(/[A-Za-z0-9_.-]*$/)
  const word = match?.[0] || ''
  return { start: cursorIndex.value - word.length, end: cursorIndex.value, word }
}

function triggerAutocomplete() {
  updateCursor()
  showSuggestions.value = true
  nextTick(() => createIcons({ icons }))
}

function hideAutocomplete() {
  showSuggestions.value = false
}

function applySuggestion(item) {
  const { start, end } = getCurrentWordRange()
  content.value = `${content.value.slice(0, start)}${item.insert}${content.value.slice(end)}`
  const nextCursor = start + item.insert.length
  showSuggestions.value = false
  nextTick(() => {
    const editor = editorRef.value
    if (!editor) return
    editor.focus()
    editor.setSelectionRange(nextCursor, nextCursor)
    updateCursor()
  })
}

async function saveYaml() {
  if (loading.value || saving.value) return
  if (!validateYaml(true)) return
  error.value = ''
  saving.value = true
  try {
    await api('PUT', '/api/apply', { yamlContent: content.value, expectedContext: props.context || undefined })
    toast(t('yamlm.saved'), 'success')
    emit('close')
  } catch (e) {
    error.value = e.message
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.yaml-modal-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 520px;
}
.yaml-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.yaml-search {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.yaml-search i,
.yaml-search svg,
.yaml-lint-status i,
.yaml-lint-status svg,
.yaml-validation i,
.yaml-validation svg {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}
.yaml-search-input {
  width: 240px;
  height: 28px;
  font-size: 12px;
}
.yaml-search-count {
  min-width: 34px;
  color: var(--text-dim);
  font-size: 11px;
  text-align: center;
}
.yaml-lint-status {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-dim);
  white-space: nowrap;
}
.yaml-lint-status.ok,
.yaml-validation.ok { color: var(--green); }
.yaml-lint-status.error,
.yaml-validation.error { color: var(--red); }
.yaml-editor-modal {
  min-height: 420px;
  border: 1px solid var(--border);
  border-radius: 6px;
}
.yaml-editor-status {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 28px;
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--bg-row);
  color: var(--text-dim);
  font-size: 11px;
}
.yaml-editor-status span {
  white-space: nowrap;
}
.yaml-editor-status .btn {
  margin-left: auto;
}
.yaml-section {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  max-width: 55%;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text);
}
.yaml-section i,
.yaml-section svg,
.yaml-editor-status .btn i,
.yaml-editor-status .btn svg {
  width: 12px;
  height: 12px;
  flex-shrink: 0;
}
.yaml-autocomplete {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 4px;
  max-height: 128px;
  overflow: auto;
  padding: 6px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-row);
}
.yaml-suggestion {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
  padding: 6px 8px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: var(--text);
  text-align: left;
}
.yaml-suggestion:hover {
  border-color: var(--accent);
  background: var(--bg-hover);
}
.yaml-suggestion-label {
  font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.yaml-suggestion-detail,
.yaml-suggestion-empty {
  color: var(--text-dim);
  font-size: 11px;
}
.yaml-suggestion-empty {
  padding: 6px 8px;
}
.yaml-validation {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  min-height: 18px;
  font-size: 12px;
  line-height: 1.45;
}
.btn i,
.btn svg {
  width: 13px;
  height: 13px;
}
</style>
