<template>
  <div class="opts-group storage">
    <div class="opts-group-title storage-title">
      <span>{{ t('storage.title') }}</span>
      <button class="btn sm storage-refresh" :disabled="loading" :title="t('action.refresh')" @click="load">
        <i data-lucide="refresh-cw"></i>
      </button>
    </div>

    <div v-if="error" class="storage-error">{{ t('storage.error', { msg: error }) }}</div>
    <div v-else-if="!report" class="storage-empty">{{ t('storage.loading') }}</div>
    <template v-else>
      <div class="storage-kpis">
        <div class="storage-kpi">
          <span class="storage-kpi-value">{{ formatBytes(report.totalBytes) }}</span>
          <span class="storage-kpi-label">{{ t('storage.total') }}</span>
        </div>
        <div class="storage-kpi">
          <span class="storage-kpi-value">{{ formatBytes(databaseBytes) }}</span>
          <span class="storage-kpi-label">{{ t('storage.databases', { n: report.databases.length }) }}</span>
        </div>
        <div class="storage-kpi">
          <span class="storage-kpi-value">{{ formatBytes(browserBytes) }}</span>
          <span class="storage-kpi-label">{{ t('storage.browser') }}</span>
        </div>
        <div v-if="report.freeDiskBytes != null" class="storage-kpi">
          <span class="storage-kpi-value">{{ formatBytes(report.freeDiskBytes) }}</span>
          <span class="storage-kpi-label">{{ t('storage.freeDisk') }}</span>
        </div>
      </div>
      <div class="storage-dir" :title="report.dir">
        <i data-lucide="folder"></i><code>{{ report.dir }}</code>
      </div>

      <div v-for="db in report.databases" :key="db.name" class="storage-db">
        <button class="storage-db-head" :aria-expanded="expanded.has(db.name)" @click="toggle(db.name)">
          <i data-lucide="database"></i>
          <span class="storage-db-name">{{ db.label }}</span>
          <span class="storage-db-size">{{ formatBytes(db.bytes) }}</span>
          <i :data-lucide="expanded.has(db.name) ? 'chevron-up' : 'chevron-down'" class="storage-chevron"></i>
        </button>
        <div v-if="db.status === 'ok'" class="storage-bar" role="img" :aria-label="barLabel(db)">
          <span class="seg used" :style="{ width: pct(db.usedBytes, db.bytes) }"></span>
          <span class="seg free" :style="{ width: pct(db.freeBytes, db.bytes) }"></span>
          <span class="seg wal" :style="{ width: pct(db.walBytes + db.shmBytes, db.bytes) }"></span>
        </div>
        <div class="storage-legend">
          <template v-if="db.status === 'ok'">
            <span><i class="dot used"></i>{{ t('storage.used') }} {{ formatBytes(db.usedBytes) }}</span>
            <span><i class="dot free"></i>{{ t('storage.free') }} {{ formatBytes(db.freeBytes) }}</span>
            <span><i class="dot wal"></i>{{ t('storage.wal') }} {{ formatBytes(db.walBytes + db.shmBytes) }}</span>
          </template>
          <span v-else class="storage-error">{{ t('storage.dbError', { msg: db.error }) }}</span>
        </div>
        <div v-if="expanded.has(db.name)" class="storage-detail">
          <div class="storage-meta">
            <span>{{ db.name }}</span>
            <span v-if="db.status === 'ok'">{{ t('storage.meta', { pages: db.pageCount, size: formatBytes(db.pageSize), mode: db.journalMode, version: db.schemaVersion }) }}</span>
          </div>
          <table class="storage-table">
            <thead><tr><th>{{ t('storage.table') }}</th><th class="num">{{ t('storage.rows') }}</th><th class="num">{{ t('storage.size') }}</th></tr></thead>
            <tbody>
              <tr v-for="table in db.tables" :key="table.name">
                <td :title="table.name">{{ table.name }}</td>
                <td class="num">{{ table.rows == null ? '—' : table.rows.toLocaleString(locale) }}</td>
                <td class="num">{{ formatBytes(table.bytes) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <table class="storage-table storage-files">
        <thead><tr><th>{{ t('storage.file') }}</th><th class="num">{{ t('storage.size') }}</th><th class="num">{{ t('storage.modified') }}</th></tr></thead>
        <tbody>
          <tr v-for="file in report.files" :key="file.name">
            <td :title="file.name">{{ file.label ? `${file.label} · ` : '' }}<span class="text-dim">{{ file.name }}</span></td>
            <td class="num">{{ formatBytes(file.bytes) }}</td>
            <td class="num">{{ formatDate(file.modifiedAt) }}</td>
          </tr>
          <tr>
            <td>{{ t('storage.browserRow') }} <span class="text-dim">localStorage · {{ t('storage.keys', { n: browserKeys }) }}</span></td>
            <td class="num">{{ formatBytes(browserBytes) }}</td>
            <td class="num">—</td>
          </tr>
        </tbody>
      </table>

      <div v-if="report.awsCostCache.length" class="storage-note">
        <i data-lucide="receipt"></i>
        {{ t('storage.costCache', { list: report.awsCostCache.map(e => `${e.profile} (${formatDate(e.fetchedAt)})`).join(', ') }) }}
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, ref } from 'vue'
import { createIcons, icons } from 'lucide'
import { api } from '../composables/useApi'
import { useI18n } from '../composables/useI18n'
import { settings } from '../composables/useSettings'
import { formatBytes } from './cloud/dashboard/dashboardFormat'

const { t } = useI18n()
const report = ref(null)
const loading = ref(false)
const error = ref(null)
const expanded = ref(new Set())
const browser = ref({ bytes: 0, keys: 0 })

const databaseBytes = computed(() => (report.value?.databases || []).reduce((sum, db) => sum + db.bytes, 0))
const browserBytes = computed(() => browser.value.bytes)
const browserKeys = computed(() => browser.value.keys)

// Saved connections, table views, filters and settings (UTF-16: 2 bytes per char).
function measureBrowser() {
  let bytes = 0
  let keys = 0
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key?.startsWith('kua')) continue
      keys += 1
      bytes += (key.length + (localStorage.getItem(key) || '').length) * 2
    }
  } catch { /* storage unavailable */ }
  browser.value = { bytes, keys }
}

function pct(part, whole) {
  return whole > 0 ? `${Math.max(0, Math.min(100, (part / whole) * 100))}%` : '0%'
}
function barLabel(db) {
  return `${t('storage.used')} ${formatBytes(db.usedBytes)}, ${t('storage.free')} ${formatBytes(db.freeBytes)}, ${t('storage.wal')} ${formatBytes(db.walBytes + db.shmBytes)}`
}
const locale = computed(() => (settings.lang === 'es' ? 'es' : 'en-US'))
function formatDate(ms) {
  if (!ms) return '—'
  return new Date(ms).toLocaleString(locale.value, { dateStyle: 'short', timeStyle: 'short' })
}
function toggle(name) {
  const next = new Set(expanded.value)
  next.has(name) ? next.delete(name) : next.add(name)
  expanded.value = next
  nextTick(() => createIcons({ icons }))
}

async function load() {
  loading.value = true
  error.value = null
  measureBrowser()
  try {
    report.value = await api('GET', '/api/system/storage')
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
    nextTick(() => createIcons({ icons }))
  }
}

onMounted(load)
defineExpose({ load })
</script>

<style scoped>
.storage-title {
  display: flex; align-items: center; justify-content: space-between;
  font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .6px; color: var(--text-dim);
  padding: 5px 8px 4px 14px; border-bottom: 1px solid var(--border);
}
.storage-refresh { padding: 2px 6px; }
.storage-refresh :deep(svg) { width: 11px; height: 11px; }
.storage-empty, .storage-error { padding: 10px 14px; font-size: 12px; color: var(--text-dim); }
.storage-error { color: var(--red); }
.storage-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 8px; padding: 10px 14px 4px; }
.storage-kpi { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.storage-kpi-value { font-size: 16px; font-weight: 700; color: var(--text); font-variant-numeric: tabular-nums; }
.storage-kpi-label { font-size: 11px; color: var(--text-dim); }
.storage-dir { display: flex; align-items: center; gap: 6px; padding: 4px 14px 10px; font-size: 11px; color: var(--text-dim); min-width: 0; border-bottom: 1px solid var(--border); }
.storage-dir code { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.storage-dir :deep(svg) { width: 12px; height: 12px; flex-shrink: 0; }
.storage-db { padding: 8px 14px; border-bottom: 1px solid var(--border); }
.storage-db-head { display: flex; align-items: center; gap: 8px; width: 100%; background: none; border: 0; padding: 0; color: var(--text); cursor: pointer; font: inherit; }
.storage-db-head :deep(svg) { width: 14px; height: 14px; color: var(--accent); flex-shrink: 0; }
.storage-db-name { font-size: 12px; font-weight: 600; flex: 1; text-align: left; }
.storage-db-size { font-size: 12px; font-variant-numeric: tabular-nums; }
.storage-db-head :deep(.storage-chevron) { color: var(--text-dim); }
.storage-bar { display: flex; gap: 2px; height: 8px; margin: 8px 0 6px; border-radius: 4px; overflow: hidden; background: var(--border); }
.storage-bar .seg { display: block; height: 100%; min-width: 0; }
.seg.used, .dot.used { background: var(--accent); }
.seg.free, .dot.free { background: color-mix(in srgb, var(--accent) 35%, transparent); }
.seg.wal,  .dot.wal  { background: var(--text-dim); }
.storage-legend { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 11px; color: var(--text-dim); }
.storage-legend .dot { display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 5px; vertical-align: middle; }
.storage-detail { margin-top: 8px; }
.storage-meta { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px 12px; font-size: 11px; color: var(--text-dim); margin-bottom: 6px; }
.storage-table { width: 100%; border-collapse: collapse; font-size: 11px; table-layout: fixed; }
.storage-table th { text-align: left; font-weight: 600; color: var(--text-dim); padding: 4px 6px; border-bottom: 1px solid var(--border); }
.storage-table td { padding: 3px 6px; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.storage-table .num { text-align: right; width: 90px; font-variant-numeric: tabular-nums; }
.storage-files { margin: 8px 0; }
.storage-files th:first-child, .storage-files td:first-child { padding-left: 14px; }
.storage-files .num:last-child { width: 120px; padding-right: 14px; }
.storage-note { display: flex; align-items: flex-start; gap: 6px; padding: 8px 14px 10px; font-size: 11px; color: var(--text-dim); border-top: 1px solid var(--border); }
.storage-note :deep(svg) { width: 12px; height: 12px; flex-shrink: 0; margin-top: 1px; }
.text-dim { color: var(--text-dim); }
</style>
