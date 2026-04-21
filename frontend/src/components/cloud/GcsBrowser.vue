<template>
  <Teleport to="body">
    <div v-if="open" class="s3b-backdrop" @mousedown.self="$emit('close')">
      <div class="s3b-modal">

        <!-- Header -->
        <div class="s3b-header">
          <div class="s3b-title">
            <span class="s3b-icon">&#x1F5C2;</span>
            <span>{{ bucket }}</span>
            <span class="s3b-badge region">GCS</span>
          </div>
          <button class="s3b-close" @click="$emit('close')">&#x2715;</button>
        </div>

        <!-- Breadcrumb -->
        <div class="s3b-breadcrumb">
          <span class="s3b-crumb root" @click="navigate('')">&#x1F3E0; root</span>
          <template v-for="(crumb, i) in breadcrumbs" :key="i">
            <span class="s3b-sep">/</span>
            <span class="s3b-crumb" :class="{ active: i === breadcrumbs.length - 1 }" @click="navigate(crumb.prefix)">
              {{ crumb.label }}
            </span>
          </template>
        </div>

        <!-- Main content -->
        <div class="s3b-content">

          <!-- File list pane -->
          <div class="s3b-filelist">
            <div v-if="loading" class="s3b-empty">Loading...</div>
            <div v-else-if="error" class="s3b-error">{{ error }}</div>
            <div v-else-if="!folders.length && !files.length" class="s3b-empty">Empty folder.</div>
            <div v-else>
              <div
                v-for="folder in folders" :key="folder.key"
                class="s3b-entry folder"
                @click="navigate(folder.key)"
              >
                <span class="s3b-entry-icon">&#x1F4C1;</span>
                <span class="s3b-entry-name">{{ folder.name }}/</span>
              </div>
              <div
                v-for="file in files" :key="file.key"
                class="s3b-entry file"
                :class="{ selected: selectedFile?.key === file.key }"
                @click="selectFile(file)"
              >
                <span class="s3b-entry-icon">{{ fileIcon(file.name) }}</span>
                <span class="s3b-entry-name">{{ file.name }}</span>
                <span class="s3b-entry-size">{{ formatSize(file.size) }}</span>
                <span class="s3b-entry-date">{{ file.lastModified ? shortDate(file.lastModified) : '' }}</span>
              </div>
              <div v-if="nextPageToken" class="s3b-load-more">
                <button class="s3b-btn" @click="loadMore">Load more...</button>
              </div>
            </div>
          </div>

          <!-- Preview pane -->
          <div class="s3b-preview">
            <div v-if="!selectedFile" class="s3b-empty" style="padding-top:40px">Select a file to preview</div>
            <template v-else>
              <div class="s3b-preview-header">
                <div class="s3b-preview-title">
                  <span class="s3b-preview-name">{{ selectedFile.name }}</span>
                  <span class="s3b-badge">{{ formatSize(selectedFile.size) }}</span>
                </div>
                <div class="s3b-preview-actions">
                  <button class="s3b-btn accent" @click="downloadFile(selectedFile)" :disabled="downloading">
                    {{ downloading ? 'Downloading...' : '&#x2913; Download' }}
                  </button>
                </div>
              </div>

              <!-- Metadata table -->
              <div v-if="previewData && !previewLoading" class="s3b-meta">
                <table class="s3b-meta-table">
                  <tbody>
                    <tr><td class="s3b-meta-label">Key</td><td class="s3b-meta-val mono-xs">{{ previewData.key }}</td></tr>
                    <tr><td class="s3b-meta-label">Content-Type</td><td class="s3b-meta-val">{{ previewData.contentType || '-' }}</td></tr>
                    <tr><td class="s3b-meta-label">Size</td><td class="s3b-meta-val">{{ formatSize(previewData.size) }}</td></tr>
                    <tr><td class="s3b-meta-label">Last Modified</td><td class="s3b-meta-val">{{ previewData.lastModified ? new Date(previewData.lastModified).toLocaleString() : '-' }}</td></tr>
                    <tr><td class="s3b-meta-label">ETag</td><td class="s3b-meta-val mono-xs">{{ previewData.etag || '-' }}</td></tr>
                    <tr><td class="s3b-meta-label">Storage Class</td><td class="s3b-meta-val">{{ previewData.storageClass || '-' }}</td></tr>
                    <tr><td class="s3b-meta-label">Generation</td><td class="s3b-meta-val mono-xs">{{ previewData.generation || '-' }}</td></tr>
                    <tr><td class="s3b-meta-label">MD5</td><td class="s3b-meta-val mono-xs">{{ previewData.md5Hash || '-' }}</td></tr>
                    <template v-if="previewData.metadata && Object.keys(previewData.metadata).length">
                      <tr v-for="(val, mkey) in previewData.metadata" :key="mkey">
                        <td class="s3b-meta-label">{{ mkey }}</td>
                        <td class="s3b-meta-val mono-xs">{{ val }}</td>
                      </tr>
                    </template>
                  </tbody>
                </table>
              </div>

              <!-- Loading preview -->
              <div v-if="previewLoading" class="s3b-preview-content">
                <div class="s3b-empty">Loading...</div>
              </div>
              <div v-else-if="previewError" class="s3b-preview-content">
                <div class="s3b-error">{{ previewError }}</div>
              </div>

              <!-- Image preview -->
              <div v-else-if="previewData?.image" class="s3b-preview-content s3b-img-wrap">
                <img :src="`data:${previewData.contentType};base64,${previewData.base64}`" class="s3b-img-preview" />
              </div>

              <!-- PDF preview -->
              <div v-else-if="previewData?.pdf" class="s3b-preview-content s3b-pdf-wrap">
                <iframe :src="`data:application/pdf;base64,${previewData.base64}`" class="s3b-pdf-frame"></iframe>
              </div>

              <!-- Text preview -->
              <pre v-else-if="previewData?.body" class="s3b-preview-code">{{ previewData.body }}</pre>

              <!-- Binary fallback -->
              <div v-else-if="previewData?.binary" class="s3b-preview-content">
                <div class="s3b-empty" style="padding-top:12px">
                  <div style="font-size:1.5rem">📎</div>
                  <div style="margin-top:6px;color:#8b949e;font-size:12px">Binary file — use Download</div>
                </div>
              </div>
            </template>
          </div>
        </div>

        <!-- Footer -->
        <div class="s3b-footer">
          <span class="s3b-footer-info">
            {{ folders.length }} folder(s) &nbsp;&bull;&nbsp; {{ files.length }} file(s)
          </span>
          <input v-model="filterText" class="s3b-filter" placeholder="Filter files..." @input="applyFilter" />
        </div>

      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, computed, watch } from 'vue'

const props = defineProps({
  open:      { type: Boolean, default: false },
  bucket:    { type: String,  default: '' },
  profileId: { type: String,  default: '' },
})
defineEmits(['close'])

const loading    = ref(false)
const error      = ref(null)
const folders    = ref([])
const allFiles   = ref([])
const files      = ref([])
const currentPrefix  = ref('')
const nextPageToken  = ref(null)

const selectedFile   = ref(null)
const previewLoading = ref(false)
const previewError   = ref(null)
const previewData    = ref(null)
const downloading    = ref(false)
const filterText     = ref('')

const breadcrumbs = computed(() => {
  const p = currentPrefix.value
  if (!p) return []
  return p.split('/').filter(Boolean).map((part, i, arr) => ({
    label:  part,
    prefix: arr.slice(0, i + 1).join('/') + '/',
  }))
})

function apiHeaders() {
  return { 'X-Profile-Id': props.profileId }
}

watch(() => props.open, (val) => {
  if (val) {
    currentPrefix.value = ''
    selectedFile.value  = null
    previewData.value   = null
    previewError.value  = null
    filterText.value    = ''
    loadFolder('')
  }
})

async function loadFolder(prefix, token = null) {
  loading.value = true
  error.value   = null
  if (!token) { folders.value = []; allFiles.value = []; files.value = [] }
  try {
    const params = new URLSearchParams({ prefix })
    if (token) params.append('pageToken', token)
    const resp = await fetch(
      `/api/cloud/gcp/storage/${encodeURIComponent(props.bucket)}/browse?${params}`,
      { headers: apiHeaders() }
    )
    const data = await resp.json()
    if (!resp.ok) throw new Error(data.error || resp.statusText)
    currentPrefix.value = prefix
    if (!token) {
      folders.value  = data.folders || []
      allFiles.value = data.files   || []
    } else {
      allFiles.value.push(...(data.files || []))
    }
    applyFilter()
    nextPageToken.value = data.nextPageToken || null
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

function applyFilter() {
  const q = filterText.value.trim().toLowerCase()
  files.value = q ? allFiles.value.filter(f => f.name.toLowerCase().includes(q)) : allFiles.value
}

async function navigate(prefix) {
  selectedFile.value = null
  previewData.value  = null
  previewError.value = null
  filterText.value   = ''
  await loadFolder(prefix)
}

async function loadMore() {
  if (!nextPageToken.value) return
  await loadFolder(currentPrefix.value, nextPageToken.value)
}

async function selectFile(file) {
  if (selectedFile.value?.key === file.key) return
  selectedFile.value   = file
  previewData.value    = null
  previewError.value   = null
  previewLoading.value = true
  try {
    const resp = await fetch(
      `/api/cloud/gcp/storage/${encodeURIComponent(props.bucket)}/object?key=${encodeURIComponent(file.key)}`,
      { headers: apiHeaders() }
    )
    const data = await resp.json()
    if (!resp.ok) throw new Error(data.error || resp.statusText)
    previewData.value = data
  } catch (e) {
    previewError.value = e.message
  } finally {
    previewLoading.value = false
  }
}

async function downloadFile(file) {
  downloading.value = true
  try {
    const resp = await fetch(
      `/api/cloud/gcp/storage/${encodeURIComponent(props.bucket)}/download?key=${encodeURIComponent(file.key)}`,
      { headers: apiHeaders() }
    )
    if (!resp.ok) throw new Error((await resp.json().catch(() => ({}))).error || resp.statusText)
    const blob    = await resp.blob()
    const objUrl  = URL.createObjectURL(blob)
    const a       = document.createElement('a')
    a.href        = objUrl
    a.download    = file.name
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(objUrl)
  } catch (e) {
    alert('Download error: ' + e.message)
  } finally {
    downloading.value = false
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatSize(bytes) {
  if (bytes == null || bytes === 0) return bytes === 0 ? '0 B' : ''
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return (bytes / Math.pow(k, i)).toFixed(i === 0 ? 0 : 1) + ' ' + sizes[i]
}

function shortDate(d) {
  return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

const EXT_ICONS = {
  json: '{ }', yaml: '📋', yml: '📋', xml: '📋', txt: '📄', md: '📝', log: '📜',
  sh: '🐚', py: '🐍', js: '📃', ts: '📃', html: '🌍', css: '🎨',
  png: '🖼', jpg: '🖼', jpeg: '🖼', gif: '🖼', svg: '🖼',
  zip: '📦', gz: '📦', tar: '📦', csv: '📊', xlsx: '📊', xls: '📊', pdf: '📄',
}
function fileIcon(name) {
  const ext = (name.split('.').pop() || '').toLowerCase()
  return EXT_ICONS[ext] || '📄'
}
</script>

<style scoped>
.s3b-backdrop {
  position: fixed; inset: 0; background: rgba(0,0,0,.65);
  display: flex; align-items: center; justify-content: center; z-index: 900;
}
.s3b-modal {
  background: #0d1117; border: 1px solid #30363d; border-radius: 10px;
  width: min(96vw, 1100px); height: min(85vh, 700px);
  display: flex; flex-direction: column; overflow: hidden;
  box-shadow: 0 24px 60px rgba(0,0,0,.7);
}
.s3b-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 16px; background: #161b22; border-bottom: 1px solid #21262d;
  flex-shrink: 0;
}
.s3b-title { display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 14px; }
.s3b-icon  { font-size: 18px; }
.s3b-badge { font-size: 10px; padding: 2px 7px; border-radius: 10px; background: rgba(124,158,248,.15); color: #7ca9f8; font-weight: 600; }
.s3b-badge.region { background: rgba(34,197,94,.12); color: #4ade80; }
.s3b-close { background: none; border: none; cursor: pointer; color: #8b949e; font-size: 18px; line-height: 1; padding: 2px 6px; border-radius: 4px; }
.s3b-close:hover { background: #21262d; color: #e6edf3; }
.s3b-breadcrumb {
  display: flex; align-items: center; gap: 2px; padding: 6px 16px;
  font-size: 12px; background: #161b22; border-bottom: 1px solid #21262d; flex-shrink: 0; flex-wrap: wrap;
}
.s3b-crumb       { cursor: pointer; color: #8b949e; padding: 2px 6px; border-radius: 4px; }
.s3b-crumb:hover,
.s3b-crumb.root:hover { background: #21262d; color: #e6edf3; }
.s3b-crumb.active { color: #e6edf3; cursor: default; }
.s3b-sep          { color: #30363d; padding: 0 2px; }
.s3b-content {
  display: flex; flex: 1; overflow: hidden;
}
.s3b-filelist {
  width: 320px; flex-shrink: 0; overflow-y: auto; border-right: 1px solid #21262d; background: #0d1117;
}
.s3b-entry {
  display: flex; align-items: center; gap: 6px;
  padding: 5px 10px; cursor: pointer; font-size: 12px; border-radius: 4px; margin: 1px 4px;
}
.s3b-entry:hover         { background: #161b22; }
.s3b-entry.selected      { background: rgba(124,158,248,.15); }
.s3b-entry-icon          { font-size: 14px; flex-shrink: 0; }
.s3b-entry-name          { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.s3b-entry-size          { color: #8b949e; font-size: 10px; flex-shrink: 0; }
.s3b-entry-date          { color: #8b949e; font-size: 10px; flex-shrink: 0; }
.s3b-entry.folder        { color: #7ca9f8; }
.s3b-load-more           { text-align: center; padding: 8px; }
.s3b-preview {
  flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 10px;
}
.s3b-preview-header  { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.s3b-preview-title   { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.s3b-preview-name    { font-weight: 600; font-size: 13px; word-break: break-all; }
.s3b-preview-actions { display: flex; gap: 6px; flex-shrink: 0; }
.s3b-meta            { font-size: 11px; }
.s3b-meta-table      { width: 100%; border-collapse: collapse; }
.s3b-meta-table tr   { border-bottom: 1px solid #21262d; }
.s3b-meta-label      { color: #8b949e; padding: 3px 8px 3px 0; white-space: nowrap; width: 140px; vertical-align: top; }
.s3b-meta-val        { color: #e6edf3; padding: 3px 0; word-break: break-all; }
.s3b-preview-content { flex: 1; min-height: 100px; }
.s3b-img-wrap        { display: flex; align-items: flex-start; justify-content: center; }
.s3b-img-preview     { max-width: 100%; max-height: 400px; border-radius: 6px; border: 1px solid #21262d; }
.s3b-pdf-wrap        { height: 400px; }
.s3b-pdf-frame       { width: 100%; height: 100%; border: none; }
.s3b-preview-code {
  font-size: 11px; font-family: monospace; background: #161b22;
  border: 1px solid #21262d; border-radius: 6px; padding: 10px;
  overflow: auto; max-height: 360px; white-space: pre-wrap; word-break: break-all;
  color: #e6edf3; margin: 0;
}
.s3b-footer {
  display: flex; align-items: center; justify-content: space-between;
  padding: 6px 14px; background: #161b22; border-top: 1px solid #21262d;
  flex-shrink: 0; font-size: 11px; color: #8b949e;
}
.s3b-filter {
  background: #0d1117; border: 1px solid #30363d; border-radius: 5px;
  color: #e6edf3; font-size: 11px; padding: 3px 8px; outline: none; width: 160px;
}
.s3b-filter:focus    { border-color: #58a6ff; }
.s3b-empty  { color: #8b949e; text-align: center; padding: 20px; font-size: 12px; }
.s3b-error  { color: #f85149; padding: 10px; font-size: 12px; }
.s3b-btn {
  background: #21262d; border: 1px solid #30363d; color: #e6edf3;
  font-size: 11px; padding: 4px 10px; border-radius: 5px; cursor: pointer;
}
.s3b-btn:hover         { background: #30363d; }
.s3b-btn.accent        { background: rgba(88,166,255,.18); border-color: #58a6ff; color: #58a6ff; }
.s3b-btn.accent:hover  { background: rgba(88,166,255,.3); }
.s3b-btn:disabled      { opacity: .5; cursor: not-allowed; }
.mono-xs { font-family: monospace; }
</style>
