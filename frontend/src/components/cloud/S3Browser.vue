<template>
  <Teleport to="body">
    <div v-if="open" class="s3b-backdrop" @mousedown.self="$emit('close')">
      <div class="s3b-modal">

        <!-- Header -->
        <div class="s3b-header">
          <div class="s3b-title">
            <span class="s3b-icon">&#x1F5C2;</span>
            <span>{{ bucket }}</span>
            <span v-if="currentRegion" class="s3b-badge region">{{ currentRegion }}</span>
          </div>
          <button class="s3b-close" @click="$emit('close')">&#x2715;</button>
        </div>

        <!-- Breadcrumb -->
        <div class="s3b-breadcrumb">
          <span class="s3b-crumb root" @click="navigate('')">
            &#x1F3E0; root
          </span>
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
              <!-- Folders -->
              <div
                v-for="folder in folders" :key="folder.key"
                class="s3b-entry folder"
                @click="navigate(folder.key)"
              >
                <span class="s3b-entry-icon">&#x1F4C1;</span>
                <span class="s3b-entry-name">{{ folder.name }}/</span>
              </div>

              <!-- Files -->
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

              <div v-if="nextContinuationToken" class="s3b-load-more">
                <button class="s3b-btn" @click="loadMore">Load more...</button>
              </div>
            </div>
          </div>

          <!-- Preview pane -->
          <div class="s3b-preview">
            <div v-if="!selectedFile" class="s3b-empty" style="padding-top:40px">
              Select a file to preview
            </div>
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
                    <tr v-if="previewData.versionId"><td class="s3b-meta-label">Version ID</td><td class="s3b-meta-val mono-xs">{{ previewData.versionId }}</td></tr>
                    <tr><td class="s3b-meta-label">Storage Class</td><td class="s3b-meta-val">{{ previewData.storageClass || '-' }}</td></tr>
                    <tr v-if="previewData.serverSideEncryption"><td class="s3b-meta-label">Encryption</td><td class="s3b-meta-val">{{ previewData.serverSideEncryption }}</td></tr>
                    <tr v-if="previewData.cacheControl"><td class="s3b-meta-label">Cache-Control</td><td class="s3b-meta-val">{{ previewData.cacheControl }}</td></tr>
                    <tr v-if="previewData.contentEncoding"><td class="s3b-meta-label">Content-Encoding</td><td class="s3b-meta-val">{{ previewData.contentEncoding }}</td></tr>
                    <tr v-if="previewData.contentDisposition"><td class="s3b-meta-label">Content-Disposition</td><td class="s3b-meta-val">{{ previewData.contentDisposition }}</td></tr>
                    <tr v-if="previewData.contentLanguage"><td class="s3b-meta-label">Content-Language</td><td class="s3b-meta-val">{{ previewData.contentLanguage }}</td></tr>
                    <template v-if="previewData.metadata && Object.keys(previewData.metadata).length">
                      <tr v-for="(val, mkey) in previewData.metadata" :key="mkey">
                        <td class="s3b-meta-label">x-amz-meta-{{ mkey }}</td>
                        <td class="s3b-meta-val mono-xs">{{ val }}</td>
                      </tr>
                    </template>
                  </tbody>
                </table>
              </div>

              <!-- Content preview -->
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

              <!-- CSV preview -->
              <div v-else-if="previewData?.csv && previewData?.body" class="s3b-preview-content s3b-csv-wrap">
                <table class="s3b-csv-table">
                  <thead>
                    <tr>
                      <th v-for="(col, ci) in csvParsed.headers" :key="ci">{{ col }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="(row, ri) in csvParsed.rows" :key="ri">
                      <td v-for="(cell, ci) in row" :key="ci">{{ cell }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <!-- Binary fallback -->
              <div v-else-if="previewData?.binary" class="s3b-preview-content">
                <div class="s3b-empty" style="padding-top:12px">
                  <div style="font-size:1.5rem">📎</div>
                  <div style="margin-top:6px;color:#8b949e;font-size:12px">Binary file &mdash; use Download</div>
                </div>
              </div>

              <!-- Text preview -->
              <pre v-else-if="previewData?.body" class="s3b-preview-code">{{ previewData.body }}</pre>
            </template>
          </div>
        </div>

        <!-- Footer -->
        <div class="s3b-footer">
          <span class="s3b-footer-info">
            {{ folders.length }} folder(s) &nbsp;&bull;&nbsp; {{ files.length }} file(s)
          </span>
          <div style="display:flex;gap:6px">
            <input
              v-model="filterText"
              class="s3b-filter"
              placeholder="Filter files..."
              @input="onFilterChange"
            />
          </div>
        </div>

      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, computed, watch } from 'vue'

const props = defineProps({
  open:       { type: Boolean, default: false },
  bucket:     { type: String,  default: '' },
  profileId:  { type: String,  default: '' },
  region:     { type: String,  default: '' },
})
defineEmits(['close'])

const loading        = ref(false)
const error          = ref(null)
const folders        = ref([])
const files          = ref([])
const allFiles       = ref([])  // for client-side filter
const currentPrefix  = ref('')
const currentRegion  = ref(props.region)
const nextContinuationToken = ref(null)

const selectedFile   = ref(null)
const previewLoading = ref(false)
const previewError   = ref(null)
const previewData    = ref(null)
const downloading    = ref(false)

const filterText     = ref('')

// Breadcrumbs from currentPrefix
const breadcrumbs = computed(() => {
  const p = currentPrefix.value
  if (!p) return []
  const parts = p.split('/').filter(Boolean)
  return parts.map((part, i) => ({
    label: part,
    prefix: parts.slice(0, i + 1).join('/') + '/',
  }))
})

function apiHeaders() {
  return { 'X-Profile-Id': props.profileId }
}

function baseUrl() {
  return ''
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

async function loadFolder(prefix, contToken = null) {
  loading.value = true
  error.value   = null
  if (!contToken) {
    folders.value  = []
    allFiles.value = []
    files.value    = []
  }
  try {
    let url = `${baseUrl()}/api/cloud/aws/s3/${encodeURIComponent(props.bucket)}/browse?prefix=${encodeURIComponent(prefix)}`
    if (contToken) url += `&continuationToken=${encodeURIComponent(contToken)}`
    const resp = await fetch(url, { headers: apiHeaders() })
    const data = await resp.json()
    if (!resp.ok) throw new Error(data.error || resp.statusText)

    currentRegion.value = data.region || currentRegion.value
    currentPrefix.value = prefix

    if (!contToken) {
      folders.value  = (data.folders || []).map(f => {
        const parts = f.replace(/\/$/, '').split('/')
        return { key: f, name: parts[parts.length - 1] || f }
      })
      allFiles.value = data.files   || []
    } else {
      allFiles.value.push(...(data.files || []))
    }
    applyFilter()
    nextContinuationToken.value = data.nextContinuationToken || null
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

function applyFilter() {
  const q = filterText.value.trim().toLowerCase()
  files.value = q
    ? allFiles.value.filter(f => f.name.toLowerCase().includes(q))
    : allFiles.value
}

function onFilterChange() { applyFilter() }

async function navigate(prefix) {
  selectedFile.value = null
  previewData.value  = null
  previewError.value = null
  filterText.value   = ''
  await loadFolder(prefix)
}

async function loadMore() {
  if (!nextContinuationToken.value) return
  await loadFolder(currentPrefix.value, nextContinuationToken.value)
}

async function selectFile(file) {
  if (selectedFile.value?.key === file.key) return
  selectedFile.value = file
  previewData.value  = null
  previewError.value = null
  // Auto-load metadata
  previewLoading.value = true
  try {
    const url  = `${baseUrl()}/api/cloud/aws/s3/${encodeURIComponent(props.bucket)}/object?key=${encodeURIComponent(file.key)}`
    const resp = await fetch(url, { headers: apiHeaders() })
    const data = await resp.json()
    if (!resp.ok) throw new Error(data.error || resp.statusText)
    previewData.value = data
  } catch (e) {
    previewError.value = e.message
  } finally {
    previewLoading.value = false
  }
}

async function loadPreview(file) {
  previewLoading.value = true
  previewError.value   = null
  previewData.value    = null
  try {
    const url  = `${baseUrl()}/api/cloud/aws/s3/${encodeURIComponent(props.bucket)}/object?key=${encodeURIComponent(file.key)}`
    const resp = await fetch(url, { headers: apiHeaders() })
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
    const url  = `${baseUrl()}/api/cloud/aws/s3/${encodeURIComponent(props.bucket)}/download?key=${encodeURIComponent(file.key)}&profileId=${encodeURIComponent(props.profileId)}`
    const resp = await fetch(url, { headers: apiHeaders() })
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}))
      throw new Error(data.error || resp.statusText)
    }
    const blob     = await resp.blob()
    const objUrl   = URL.createObjectURL(blob)
    const a        = document.createElement('a')
    a.href         = objUrl
    a.download     = file.name
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

// Simple CSV parser (handles quoted fields with commas/newlines)
const csvParsed = computed(() => {
  const body = previewData.value?.body
  if (!body) return { headers: [], rows: [] }
  const lines = []
  let cur = '', inQuote = false
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (inQuote) {
      if (ch === '"' && body[i + 1] === '"') { cur += '"'; i++ }
      else if (ch === '"') inQuote = false
      else cur += ch
    } else {
      if (ch === '"') inQuote = true
      else if (ch === '\n' || (ch === '\r' && body[i + 1] === '\n')) {
        lines.push(cur); cur = ''
        if (ch === '\r') i++
      } else cur += ch
    }
  }
  if (cur) lines.push(cur)

  const split = line => {
    const cols = []; let c = '', q = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (q) {
        if (ch === '"' && line[i + 1] === '"') { c += '"'; i++ }
        else if (ch === '"') q = false
        else c += ch
      } else {
        if (ch === '"') q = true
        else if (ch === ',') { cols.push(c); c = '' }
        else c += ch
      }
    }
    cols.push(c)
    return cols
  }

  const headers = split(lines[0] || '')
  const rows = lines.slice(1).filter(l => l.trim()).map(split)
  return { headers, rows }
})
function formatSize(bytes) {
  if (bytes == null) return ''
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return (bytes / Math.pow(k, i)).toFixed(i === 0 ? 0 : 1) + ' ' + sizes[i]
}

function shortDate(d) {
  const dt = new Date(d)
  return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

const EXT_ICONS = {
  json: '{ }', yaml: '\uD83D\uDCCB', yml: '\uD83D\uDCCB', xml: '\uD83D\uDCCB',
  txt: '\uD83D\uDCC4', md: '\uD83D\uDCDD', log: '\uD83D\uDCDC',
  sh: '\uD83D\uDC1A', py: '\uD83D\uDC0D', js: '\uD83D\uDCC3', ts: '\uD83D\uDCC3',
  html: '\uD83C\uDF0D', css: '\uD83C\uDFA8',
  png: '\uD83D\uDDBC', jpg: '\uD83D\uDDBC', jpeg: '\uD83D\uDDBC', gif: '\uD83D\uDDBC', svg: '\uD83D\uDDBC',
  zip: '\uD83D\uDCE6', gz: '\uD83D\uDCE6', tar: '\uD83D\uDCE6',
  csv: '\uD83D\uDCCA', xlsx: '\uD83D\uDCCA', xls: '\uD83D\uDCCA',
  pdf: '\uD83D\uDCC4',
}
function fileIcon(name) {
  const ext = (name.split('.').pop() || '').toLowerCase()
  return EXT_ICONS[ext] || '\uD83D\uDCC4'
}
</script>

<style scoped>
.s3b-backdrop {
  position: fixed; inset: 0; background: rgba(0,0,0,.65);
  display: flex; align-items: center; justify-content: center;
  z-index: 900;
}
.s3b-modal {
  background: #0d1117; border: 1px solid #30363d; border-radius: 10px;
  width: min(96vw, 1100px); height: min(85vh, 700px);
  display: flex; flex-direction: column; overflow: hidden;
  box-shadow: 0 24px 60px rgba(0,0,0,.7);
}

/* Header */
.s3b-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 16px; background: #161b22; border-bottom: 1px solid #21262d;
  flex-shrink: 0;
}
.s3b-title {
  display: flex; align-items: center; gap: 8px;
  font-weight: 600; font-size: .95rem; color: #e6edf3;
}
.s3b-icon { font-size: 1.1rem; }
.s3b-badge {
  background: rgba(88,166,255,.15); color: #58a6ff;
  border: 1px solid rgba(88,166,255,.3); border-radius: 4px;
  padding: 1px 7px; font-size: .75rem;
}
.s3b-badge.region { font-family: monospace; }
.s3b-close {
  background: none; border: none; color: #8b949e; cursor: pointer;
  font-size: 1rem; padding: 2px 4px; border-radius: 4px;
}
.s3b-close:hover { color: #e6edf3; background: rgba(255,255,255,.1); }

/* Breadcrumb */
.s3b-breadcrumb {
  display: flex; align-items: center; gap: 2px; flex-wrap: wrap;
  padding: 7px 16px; background: #0d1117; border-bottom: 1px solid #21262d;
  font-size: .8rem; flex-shrink: 0;
}
.s3b-crumb {
  color: #58a6ff; cursor: pointer; padding: 2px 5px; border-radius: 4px;
}
.s3b-crumb:hover { background: rgba(88,166,255,.12); }
.s3b-crumb.root { color: #8b949e; }
.s3b-crumb.active { color: #e6edf3; cursor: default; }
.s3b-crumb.active:hover { background: transparent; }
.s3b-sep { color: #484f58; }

/* Content split */
.s3b-content {
  display: flex; flex: 1; min-height: 0; overflow: hidden;
}

/* File list */
.s3b-filelist {
  width: 45%; border-right: 1px solid #21262d;
  overflow-y: auto; padding: 8px;
}
.s3b-entry {
  display: grid;
  grid-template-columns: 24px 1fr auto auto;
  align-items: center; gap: 6px;
  padding: 5px 8px; border-radius: 6px; cursor: pointer;
  font-size: .83rem;
  transition: background .1s;
}
.s3b-entry:hover { background: rgba(255,255,255,.05); }
.s3b-entry.selected { background: rgba(88,166,255,.12); }
.s3b-entry.folder .s3b-entry-name { color: #58a6ff; }
.s3b-entry.file .s3b-entry-name   { color: #e6edf3; word-break: break-all; }
.s3b-entry-icon  { text-align: center; font-size: .9rem; }
.s3b-entry-size  { color: #484f58; font-size: .75rem; white-space: nowrap; }
.s3b-entry-date  { color: #484f58; font-size: .75rem; white-space: nowrap; }
.s3b-load-more   { padding: 8px; text-align: center; }

/* Preview pane */
.s3b-preview {
  flex: 1; display: flex; flex-direction: column; overflow: hidden;
}
.s3b-preview-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 12px; background: #161b22; border-bottom: 1px solid #21262d;
  flex-shrink: 0; gap: 8px;
}
.s3b-preview-title { display: flex; align-items: center; gap: 8px; flex: 1; overflow: hidden; }
.s3b-preview-name { font-weight: 600; color: #e6edf3; font-size: .85rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.s3b-preview-actions { display: flex; gap: 6px; flex-shrink: 0; }
.s3b-preview-content { flex: 1; overflow-y: auto; padding: 12px; }
.s3b-preview-code {
  flex: 1; overflow: auto; margin: 0;
  padding: 12px 14px;
  font-family: 'Consolas', 'Menlo', monospace;
  font-size: .78rem; line-height: 1.5;
  color: #e6edf3; white-space: pre-wrap; word-break: break-all;
  background: #0d1117;
}

/* Footer */
.s3b-footer {
  display: flex; align-items: center; justify-content: space-between;
  padding: 7px 14px; background: #161b22; border-top: 1px solid #21262d;
  flex-shrink: 0; gap: 10px;
}
.s3b-footer-info { color: #8b949e; font-size: .8rem; }
.s3b-filter {
  background: #0d1117; border: 1px solid #30363d; color: #e6edf3;
  border-radius: 6px; padding: 4px 9px; font-size: .8rem; outline: none;
  width: 200px;
}
.s3b-filter:focus { border-color: #388bfd; }

/* Buttons */
.s3b-btn {
  background: rgba(139,148,158,.12); border: 1px solid #30363d;
  color: #8b949e; border-radius: 5px; padding: 3px 10px;
  font-size: .77rem; cursor: pointer; transition: all .15s;
}
.s3b-btn:hover { background: rgba(255,255,255,.08); color: #e6edf3; }
.s3b-btn:disabled { opacity: .4; cursor: not-allowed; }
.s3b-btn.accent { background: rgba(88,166,255,.15); border-color: rgba(88,166,255,.4); color: #58a6ff; }
.s3b-btn.accent:hover { background: rgba(88,166,255,.25); }

.s3b-empty { color: #8b949e; text-align: center; padding: 24px; font-size: .87rem; }
.s3b-error { color: #f85149; padding: 12px; font-size: .85rem; }

/* Metadata table */
.s3b-meta {
  padding: 8px 12px; border-bottom: 1px solid #21262d;
  overflow-y: auto; max-height: 220px; flex-shrink: 0;
}
.s3b-meta-table { width: 100%; border-collapse: collapse; font-size: .78rem; }
.s3b-meta-table tr { border-bottom: 1px solid rgba(48,54,61,.5); }
.s3b-meta-table tr:last-child { border-bottom: none; }
.s3b-meta-label {
  color: #8b949e; white-space: nowrap; padding: 3px 10px 3px 0;
  vertical-align: top; width: 140px; font-size: .75rem;
}
.s3b-meta-val {
  color: #e6edf3; padding: 3px 0; word-break: break-all;
}
.mono-xs { font-family: 'Consolas', 'Menlo', monospace; font-size: .73rem; }

/* Image preview */
.s3b-img-wrap {
  display: flex; align-items: center; justify-content: center;
  background: repeating-conic-gradient(#1c2128 0% 25%, #161b22 0% 50%) 0 0 / 16px 16px;
}
.s3b-img-preview {
  max-width: 100%; max-height: 100%; object-fit: contain;
  border-radius: 4px;
}

/* PDF preview */
.s3b-pdf-wrap { padding: 0; }
.s3b-pdf-frame {
  width: 100%; height: 100%; border: none;
  background: #fff; border-radius: 0 0 4px 0;
}

/* CSV preview */
.s3b-csv-wrap { padding: 0; overflow: auto; }
.s3b-csv-table {
  width: 100%; border-collapse: collapse; font-size: .78rem;
}
.s3b-csv-table th {
  position: sticky; top: 0;
  background: #161b22; color: #8b949e; text-align: left;
  padding: 6px 10px; border-bottom: 1px solid #30363d;
  font-weight: 600; white-space: nowrap;
}
.s3b-csv-table td {
  padding: 4px 10px; border-bottom: 1px solid rgba(48,54,61,.4);
  color: #e6edf3; white-space: nowrap; max-width: 300px;
  overflow: hidden; text-overflow: ellipsis;
}
.s3b-csv-table tr:hover td { background: rgba(255,255,255,.03); }
</style>
