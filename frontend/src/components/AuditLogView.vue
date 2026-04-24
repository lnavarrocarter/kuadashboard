<template>
  <div class="audit-view">
    <!-- Header -->
    <div class="audit-header">
      <div class="audit-header-left">
        <h2 class="audit-title">
          <i data-lucide="shield-check"></i>
          {{ t('audit.title') }}
        </h2>
        <span class="audit-total">{{ total }} {{ t('audit.entries') }}</span>
      </div>
      <div class="audit-header-right">
        <a :href="`/api/audit/logs/export`" class="btn sm" target="_blank" :title="t('audit.export')">
          <i data-lucide="download"></i> CSV
        </a>
        <button class="btn sm danger" @click="confirmClear" :title="t('audit.clear')">
          <i data-lucide="trash-2"></i>
        </button>
      </div>
    </div>

    <!-- Filters -->
    <div class="audit-filters">
      <input
        v-model="search"
        class="audit-search"
        type="text"
        :placeholder="t('audit.search')"
        @input="debouncedLoad"
      />
      <select v-model="filterCategory" class="ctrl-select audit-filter-sel" @change="loadLogs">
        <option value="">{{ t('audit.allCategories') }}</option>
        <option value="kubernetes">Kubernetes</option>
        <option value="aws">AWS</option>
        <option value="gcp">GCP</option>
        <option value="helm">Helm</option>
        <option value="envManager">{{ t('audit.catEnvManager') }}</option>
        <option value="system">{{ t('audit.catSystem') }}</option>
      </select>
      <select v-model="filterLevel" class="ctrl-select audit-filter-sel" @change="loadLogs">
        <option value="">{{ t('audit.allLevels') }}</option>
        <option value="info">Info</option>
        <option value="warning">Warning</option>
        <option value="error">Error</option>
        <option value="critical">Critical</option>
      </select>
      <button class="btn sm" @click="resetFilters"><i data-lucide="x"></i></button>
      <button class="btn sm primary" @click="loadLogs"><i data-lucide="refresh-cw"></i></button>
    </div>

    <!-- Stats bar -->
    <div class="audit-stats" v-if="stats">
      <span v-for="(count, lvl) in stats.byLevel" :key="lvl" :class="['audit-stat-badge', `lvl-${lvl}`]">
        {{ lvl }}: {{ count }}
      </span>
      <span class="audit-stats-sep" v-if="Object.keys(stats.byCategory).length">|</span>
      <span v-for="(count, cat) in stats.byCategory" :key="cat" class="audit-stat-badge lvl-info">
        {{ cat }}: {{ count }}
      </span>
    </div>

    <!-- Table -->
    <div class="audit-table-wrap">
      <table class="audit-table" v-if="entries.length">
        <thead>
          <tr>
            <th>{{ t('audit.colTime') }}</th>
            <th>{{ t('audit.colLevel') }}</th>
            <th>{{ t('audit.colCategory') }}</th>
            <th>{{ t('audit.colAction') }}</th>
            <th>{{ t('audit.colResource') }}</th>
            <th>{{ t('audit.colContext') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="e in entries"
            :key="e.id"
            :class="['audit-row', `lvl-${e.level}`]"
            @click="expandedId = expandedId === e.id ? null : e.id"
          >
            <template v-if="expandedId !== e.id">
              <td class="audit-time">{{ formatTime(e.timestamp) }}</td>
              <td><span :class="['audit-level-badge', `lvl-${e.level}`]">{{ e.level }}</span></td>
              <td><span class="audit-cat-badge">{{ e.category }}</span></td>
              <td class="audit-action">{{ e.action }}</td>
              <td class="audit-resource" :title="e.resource">{{ truncate(e.resource, 40) }}</td>
              <td class="audit-context">{{ truncate(e.context, 30) }}</td>
            </template>
            <template v-else>
              <td colspan="6" class="audit-expanded">
                <div class="audit-expanded-grid">
                  <div><strong>{{ t('audit.colTime') }}:</strong> {{ e.timestamp }}</div>
                  <div><strong>{{ t('audit.colLevel') }}:</strong> <span :class="['audit-level-badge', `lvl-${e.level}`]">{{ e.level }}</span></div>
                  <div><strong>{{ t('audit.colCategory') }}:</strong> {{ e.category }}</div>
                  <div><strong>{{ t('audit.colAction') }}:</strong> {{ e.action }}</div>
                  <div><strong>{{ t('audit.colResource') }}:</strong> {{ e.resource }}</div>
                  <div><strong>{{ t('audit.colContext') }}:</strong> {{ e.context }}</div>
                  <div v-if="Object.keys(e.details || {}).length" class="audit-details-full">
                    <strong>{{ t('audit.colDetails') }}:</strong>
                    <pre>{{ JSON.stringify(e.details, null, 2) }}</pre>
                  </div>
                </div>
              </td>
            </template>
          </tr>
        </tbody>
      </table>
      <div v-else class="audit-empty">
        <i data-lucide="inbox"></i>
        <p>{{ t('audit.empty') }}</p>
      </div>
    </div>

    <!-- Confirm clear modal -->
    <div v-if="showClearConfirm" class="audit-confirm-overlay" @click.self="showClearConfirm = false">
      <div class="audit-confirm-box">
        <p>{{ t('audit.clearConfirm') }}</p>
        <div class="audit-confirm-actions">
          <button class="btn danger" @click="clearLogs">{{ t('common.confirm') }}</button>
          <button class="btn" @click="showClearConfirm = false">{{ t('common.cancel') }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, nextTick } from 'vue'
import { createIcons, icons } from 'lucide'
import { api } from '../composables/useApi'
import { useI18n } from '../composables/useI18n'
import { useToast } from '../composables/useToast'

const { t } = useI18n()
const { toast } = useToast()

const entries         = ref([])
const total           = ref(0)
const stats           = ref(null)
const search          = ref('')
const filterCategory  = ref('')
const filterLevel     = ref('')
const expandedId      = ref(null)
const showClearConfirm = ref(false)

let debounceTimer = null
function debouncedLoad() {
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => loadLogs(), 300)
}

async function loadLogs() {
  try {
    const params = new URLSearchParams({ limit: 500 })
    if (search.value)         params.set('search',   search.value)
    if (filterCategory.value) params.set('category', filterCategory.value)
    if (filterLevel.value)    params.set('level',    filterLevel.value)
    const data = await api('GET', `/api/audit/logs?${params}`)
    entries.value = data.entries || []
    total.value   = data.total   || 0
  } catch (err) {
    toast('error', `Failed to load audit log: ${err.message}`)
  }
}

async function loadStats() {
  try {
    stats.value = await api('GET', '/api/audit/stats')
  } catch { /* stats are optional */ }
}

function resetFilters() {
  search.value         = ''
  filterCategory.value = ''
  filterLevel.value    = ''
  loadLogs()
}

function confirmClear() {
  showClearConfirm.value = true
}

async function clearLogs() {
  try {
    await api('DELETE', '/api/audit/logs')
    showClearConfirm.value = false
    entries.value = []
    total.value   = 0
    stats.value   = null
    toast('success', t('audit.cleared'))
  } catch (err) {
    toast('error', err.message)
  }
}

function formatTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleString()
}

function truncate(str, len) {
  if (!str) return ''
  return str.length > len ? str.slice(0, len) + '…' : str
}

onMounted(async () => {
  await Promise.all([loadLogs(), loadStats()])
  nextTick(() => createIcons({ icons }))
})
</script>

<style scoped>
.audit-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 16px 20px;
  gap: 12px;
  overflow: hidden;
}

/* Header */
.audit-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}
.audit-header-left { display: flex; align-items: center; gap: 12px; }
.audit-header-right { display: flex; gap: 6px; }
.audit-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 1.1rem;
  font-weight: 600;
  margin: 0;
}
.audit-title i { width: 18px; height: 18px; }
.audit-total {
  font-size: 0.8rem;
  color: var(--text-muted, #888);
  background: var(--bg-subtle, rgba(255,255,255,0.05));
  padding: 2px 8px;
  border-radius: 10px;
}

/* Filters */
.audit-filters {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-shrink: 0;
  flex-wrap: wrap;
}
.audit-search {
  flex: 1;
  min-width: 180px;
  padding: 6px 10px;
  border: 1px solid var(--border, #444);
  border-radius: 4px;
  background: var(--bg-input, #2a2a2a);
  color: var(--text, #ddd);
  font-size: 0.85rem;
}
.audit-filter-sel { min-width: 130px; }

/* Stats */
.audit-stats {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  flex-shrink: 0;
  align-items: center;
  font-size: 0.78rem;
}
.audit-stats-sep { color: var(--text-muted, #888); }

/* Level badges */
.audit-level-badge,
.audit-stat-badge {
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 0.72rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.lvl-info     { background: rgba(59,130,246,0.2);  color: #60a5fa; }
.lvl-warning  { background: rgba(234,179,8,0.2);   color: #facc15; }
.lvl-error    { background: rgba(239,68,68,0.2);   color: #f87171; }
.lvl-critical { background: rgba(168,85,247,0.2);  color: #c084fc; }

.audit-cat-badge {
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 0.72rem;
  background: rgba(255,255,255,0.06);
  color: var(--text-muted, #aaa);
}

/* Table */
.audit-table-wrap {
  flex: 1;
  overflow: auto;
  border: 1px solid var(--border, #444);
  border-radius: 6px;
}
.audit-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.82rem;
}
.audit-table th {
  position: sticky;
  top: 0;
  background: var(--bg-table-head, #1e1e1e);
  padding: 8px 12px;
  text-align: left;
  font-weight: 600;
  color: var(--text-muted, #aaa);
  border-bottom: 1px solid var(--border, #444);
  white-space: nowrap;
}
.audit-row {
  cursor: pointer;
  transition: background 0.1s;
}
.audit-row:hover { background: rgba(255,255,255,0.04); }
.audit-row.lvl-warning  { border-left: 2px solid #facc15; }
.audit-row.lvl-error    { border-left: 2px solid #f87171; }
.audit-row.lvl-critical { border-left: 2px solid #c084fc; }
.audit-row td {
  padding: 7px 12px;
  border-bottom: 1px solid var(--border-subtle, rgba(255,255,255,0.05));
  vertical-align: middle;
}
.audit-time    { white-space: nowrap; color: var(--text-muted, #888); font-family: monospace; font-size: 0.78rem; }
.audit-action  { max-width: 260px; }
.audit-resource { max-width: 200px; font-family: monospace; font-size: 0.78rem; color: var(--text-muted, #aaa); }
.audit-context { max-width: 160px; font-size: 0.78rem; color: var(--text-muted, #aaa); }

/* Expanded row */
.audit-expanded { padding: 12px 16px; }
.audit-expanded-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 8px 16px;
  font-size: 0.82rem;
}
.audit-details-full {
  grid-column: 1 / -1;
}
.audit-details-full pre {
  margin-top: 4px;
  padding: 8px;
  background: rgba(0,0,0,0.3);
  border-radius: 4px;
  font-size: 0.78rem;
  overflow: auto;
  max-height: 160px;
}

/* Empty */
.audit-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px;
  color: var(--text-muted, #888);
  gap: 8px;
}
.audit-empty i { width: 32px; height: 32px; }

/* Confirm overlay */
.audit-confirm-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.audit-confirm-box {
  background: var(--bg-modal, #252526);
  border: 1px solid var(--border, #444);
  border-radius: 8px;
  padding: 24px;
  min-width: 300px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.audit-confirm-actions { display: flex; gap: 8px; justify-content: flex-end; }

/* Danger button variant */
.btn.danger {
  background: rgba(239,68,68,0.15);
  color: #f87171;
  border: 1px solid rgba(239,68,68,0.3);
}
.btn.danger:hover {
  background: rgba(239,68,68,0.25);
}
</style>
