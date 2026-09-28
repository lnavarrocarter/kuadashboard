<template>
  <div class="resource-table">
    <div class="toolbar">
      <h2 class="resource-title">{{ cfg.title }}</h2>
      <div v-if="selectedRows.length" class="bulk-actions">
        <span>{{ selectedRows.length }} seleccionado(s)</span>
        <button class="btn sm danger" title="Eliminar seleccionados" @click="emit('bulk-delete', selectedRows)">
          <i data-lucide="trash-2"></i> Eliminar
        </button>
        <button class="btn sm" title="Limpiar seleccion" @click="clearSelection">
          <i data-lucide="x"></i>
        </button>
      </div>
      <div class="toolbar-right">
        <div v-if="cfg.facet" class="facet-chips" role="group" :aria-label="cfg.facet.label">
          <button
            v-for="opt in cfg.facet.options" :key="opt.value"
            :class="['facet-chip', `facet-${opt.value}`, { active: activeFacets.has(opt.value) }]"
            :aria-pressed="activeFacets.has(opt.value)"
            :title="`${activeFacets.has(opt.value) ? 'Quitar' : 'Mostrar solo'} ${opt.label}`"
            @click="toggleFacet(opt.value)"
          >{{ opt.label }} <span class="facet-count">{{ facetCounts[opt.value] || 0 }}</span></button>
          <button v-if="activeFacets.size" class="facet-clear" title="Mostrar todos" @click="activeFacets = new Set()">✕</button>
        </div>
        <div v-if="cfg.quickFilters?.length" class="facet-chips" role="group" aria-label="Filtros rápidos">
          <button
            v-for="qf in cfg.quickFilters" :key="qf.id"
            :class="['facet-chip', 'quick-chip', { active: activeQuick.has(qf.id) }]"
            :aria-pressed="activeQuick.has(qf.id)"
            :title="`${activeQuick.has(qf.id) ? 'Quitar' : 'Mostrar solo'} ${qf.label}`"
            @click="toggleQuick(qf.id)"
          >{{ qf.label }} <span class="facet-count">{{ quickCounts[qf.id] || 0 }}</span></button>
          <button v-if="activeQuick.size" class="facet-clear" title="Quitar filtros rápidos" @click="activeQuick = new Set()">✕</button>
        </div>
        <div class="filter-box">
          <input
            v-model="filter" class="search-input" placeholder="Filter..."
            @focus="historyOpen = true" @blur="onFilterBlur" @keydown.enter="rememberCurrent"
            @keydown.esc="historyOpen = false"
          />
          <button
            v-if="filter.trim()" class="filter-save" :class="{ saved: isSaved }"
            :title="isSaved ? 'Quitar de guardados' : 'Guardar filtro'"
            @mousedown.prevent @click="toggleSaved(filter)"
          >{{ isSaved ? '★' : '☆' }}</button>
          <div v-if="historyOpen && (history.saved.length || history.recent.length)" class="filter-history" role="listbox">
            <template v-for="section in historySections" :key="section.label">
              <div v-if="section.items.length" class="filter-history-label">{{ section.label }}</div>
              <div
                v-for="item in section.items" :key="section.label + item"
                class="filter-history-item" role="option" :title="`Filtrar por ${item}`"
                @mousedown.prevent="applyHistory(item)"
              >
                <span class="filter-history-text">{{ item }}</span>
                <button
                  class="filter-history-btn" :class="{ saved: section.saved }"
                  :title="section.saved ? 'Quitar de guardados' : 'Guardar filtro'"
                  @mousedown.prevent.stop="toggleSaved(item)"
                >{{ section.saved ? '★' : '☆' }}</button>
                <button class="filter-history-btn" title="Olvidar" @mousedown.prevent.stop="forget(item)">✕</button>
              </div>
            </template>
          </div>
        </div>
        <button class="btn btn-icon" :class="{ refreshing: store.refreshing }" :disabled="store.loading || store.refreshing" title="Refresh (R)" @click="store.loadResources({ silent: true, force: true })">
          <i data-lucide="refresh-cw"></i>
        </button>
      </div>
    </div>

    <div class="table-wrap">
      <div v-if="store.loading" class="loading-state">Loading...</div>
      <div v-else-if="store.error" class="error-state">
        <i data-lucide="alert-triangle"></i>
        <span>{{ store.error }}</span>
        <button class="btn sm" @click="store.loadResources()">Retry</button>
      </div>
      <div v-else-if="!filtered.length" class="empty-state">{{ store.rows.length ? 'No resources match the current filters' : 'No resources found' }}</div>
      <table v-else class="rtable">
        <thead>
          <tr>
            <th v-if="hasBulkDeleteRows" class="col-select">
              <input
                type="checkbox"
                :checked="allVisibleSelected"
                :disabled="!filtered.length"
                title="Seleccionar visibles"
                @change="toggleAllVisible"
                @click.stop
              />
            </th>
            <th
              v-for="(col, i) in cfg.cols" :key="col"
              :class="sortColIdx === i ? 'sortable-th th-sorted' : 'sortable-th'"
              @click="sortByCol(i)"
            >
              {{ col }}
              <span class="sort-icon">{{ colSortIcon(i) }}</span>
            </th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in filtered"
            :key="rowKey(row)"
            :class="[cfg.rowClass?.(row), { selected: selectedKey === rowKey(row), checked: selectedKeys.has(rowKey(row)) }]"
            @click="emit('select', store.resource, row)"
          >
            <td v-if="hasBulkDeleteRows" class="col-select" @click.stop>
              <input type="checkbox" :checked="selectedKeys.has(rowKey(row))" :disabled="!rowSupportsBulkDelete(row)" :title="`Seleccionar ${row.name}`" @change="toggleRow(row)" />
            </td>
            <td v-for="(cell, i) in cfg.row(row)" :key="i" v-html="renderCell(cell)"></td>
            <td class="col-actions">
              <button
                v-for="action in cfg.actions(row)"
                :key="action.fn + action.label"
                :class="`action-btn icon-${action.icon} ${action.cls}`"
                :title="action.label"
                @click.stop="emit('action', action.fn, action.args)"
              ></button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useKubeStore } from '../stores/useKubeStore'
import { RESOURCES } from '../config/resources'
import { createIcons, icons } from 'lucide'
import {
  loadTableView, saveTableView, loadFilterHistory, saveFilterHistory,
  rememberFilter, toggleSavedFilter, forgetFilter,
} from '../composables/useTableViews'

const props = defineProps({ resource: String, selectedKey: String, initialFilter: { type: String, default: '' } })
const emit  = defineEmits(['action', 'select', 'bulk-delete'])

const store  = useKubeStore()
const filter = ref('')
const selectedKeys = ref(new Set())

const cfg = computed(() => RESOURCES[store.resource] || RESOURCES.pods)

// ── Sorting ────────────────────────────────────────────────────────────────
const sortColIdx = ref(null)
const sortDir    = ref('asc')

function sortByCol(i) {
  if (sortColIdx.value === i) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortColIdx.value = i
    sortDir.value = 'asc'
  }
}

function colSortIcon(i) {
  if (sortColIdx.value !== i) return '⇅'
  return sortDir.value === 'asc' ? '↑' : '↓'
}

function cellSortVal(cell) {
  if (cell === null || cell === undefined) return ''
  if (typeof cell === 'object') {
    if (cell.sort    !== undefined) return cell.sort
    if (cell.text    !== undefined) return String(cell.text ?? '')
    if (cell.link    !== undefined) return String(cell.text || cell.link || '')
    if (cell.badge    !== undefined) return String(cell.badge ?? '')
    if (cell.truncate !== undefined) return String(cell.truncate ?? '')
  }
  return String(cell)
}

// ── Facet chips (e.g. event severity) ──────────────────────────────────────
// No chip active = show everything; otherwise show rows matching any active chip.
const activeFacets = ref(new Set())

const facetCounts = computed(() => {
  const facet = cfg.value.facet
  if (!facet) return {}
  const counts = {}
  for (const row of store.rows) {
    const v = facet.value(row)
    counts[v] = (counts[v] || 0) + 1
  }
  return counts
})

function toggleFacet(value) {
  const next = new Set(activeFacets.value)
  if (next.has(value)) next.delete(value)
  else next.add(value)
  activeFacets.value = next
}

// ── Quick filters (one-click predefined predicates, combined with AND) ─────
const activeQuick = ref(new Set())

const quickCounts = computed(() => {
  const counts = {}
  for (const qf of cfg.value.quickFilters || []) counts[qf.id] = store.rows.filter(qf.test).length
  return counts
})

function toggleQuick(id) {
  const next = new Set(activeQuick.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  activeQuick.value = next
}

// ── Per-resource view state and filter history ─────────────────────────────
// Filter, sort and chips are kept per resource, so navigating away and back
// (or reloading) shows the table as the user left it.
const history = ref({ saved: [], recent: [] })
const historyOpen = ref(false)
const isSaved = computed(() => history.value.saved.includes(filter.value.trim()))
const historySections = computed(() => [
  { label: 'Guardados', items: history.value.saved, saved: true },
  { label: 'Recientes', items: history.value.recent, saved: false },
])

function restoreView(resource) {
  const view = loadTableView(resource)
  const resourceCfg = RESOURCES[resource] || RESOURCES.pods
  const quickIds = new Set((resourceCfg.quickFilters || []).map(qf => qf.id))
  const facetValues = new Set((resourceCfg.facet?.options || []).map(opt => opt.value))
  const col = resourceCfg.cols.indexOf(view.sortCol)
  filter.value = view.filter
  sortColIdx.value = col >= 0 ? col : null
  sortDir.value = view.sortDir === 'desc' ? 'desc' : 'asc'
  activeFacets.value = new Set(view.facets.filter(v => facetValues.has(v)))
  activeQuick.value = new Set(view.quick.filter(id => quickIds.has(id)))
  history.value = loadFilterHistory(resource)
}

function persistView() {
  saveTableView(store.resource, {
    filter: filter.value,
    sortCol: sortColIdx.value === null ? null : cfg.value.cols[sortColIdx.value],
    sortDir: sortDir.value,
    facets: [...activeFacets.value],
    quick: [...activeQuick.value],
  })
}

function updateHistory(resource, next) {
  if (resource === store.resource) history.value = next
  saveFilterHistory(resource, next)
}

function rememberCurrent() {
  updateHistory(store.resource, rememberFilter(history.value, filter.value))
}

function onFilterBlur() {
  historyOpen.value = false
  rememberCurrent()
}

function applyHistory(item) {
  filter.value = item
  historyOpen.value = false
  rememberCurrent()
}

function toggleSaved(item) {
  updateHistory(store.resource, toggleSavedFilter(history.value, item))
}

function forget(item) {
  updateHistory(store.resource, forgetFilter(history.value, item))
}

restoreView(store.resource)
if (props.initialFilter) filter.value = props.initialFilter

// Allows external navigation (e.g. Architecture "view pods") to seed the search box.
watch(() => props.initialFilter, v => { if (v) filter.value = v })
watch([filter, sortColIdx, sortDir, activeFacets, activeQuick], persistView)

const filtered = computed(() => {
  const q = filter.value.toLowerCase()
  let rows = store.rows
  const facet = cfg.value.facet
  if (facet && activeFacets.value.size) rows = rows.filter(r => activeFacets.value.has(facet.value(r)))
  for (const qf of cfg.value.quickFilters || []) {
    if (activeQuick.value.has(qf.id)) rows = rows.filter(qf.test)
  }
  if (q) rows = rows.filter(r => JSON.stringify(r).toLowerCase().includes(q))

  if (sortColIdx.value === null) return rows
  const dir = sortDir.value === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const cells_a = cfg.value.row(a)
    const cells_b = cfg.value.row(b)
    const va = cellSortVal(cells_a[sortColIdx.value])
    const vb = cellSortVal(cells_b[sortColIdx.value])
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir
    const sa = String(va ?? '').toLowerCase()
    const sb = String(vb ?? '').toLowerCase()
    const na = parseFloat(sa), nb = parseFloat(sb)
    if (!isNaN(na) && !isNaN(nb)) return (na - nb) * dir
    return sa < sb ? -dir : sa > sb ? dir : 0
  })
})

const selectedRows = computed(() => store.rows.filter(row => selectedKeys.value.has(rowKey(row)) && rowSupportsBulkDelete(row)))
const bulkDeleteRows = computed(() => filtered.value.filter(rowSupportsBulkDelete))
const hasBulkDeleteRows = computed(() => bulkDeleteRows.value.length > 0)
const allVisibleSelected = computed(() => bulkDeleteRows.value.length > 0 && bulkDeleteRows.value.every(row => selectedKeys.value.has(rowKey(row))))

function rowKey(row) { return row.name + (row.namespace || '') }

function toggleRow(row) {
  if (!rowSupportsBulkDelete(row)) return
  const next = new Set(selectedKeys.value)
  const key = rowKey(row)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  selectedKeys.value = next
  nextTick(() => createIcons({ icons }))
}

function toggleAllVisible() {
  const next = new Set(selectedKeys.value)
  if (allVisibleSelected.value) bulkDeleteRows.value.forEach(row => next.delete(rowKey(row)))
  else bulkDeleteRows.value.forEach(row => next.add(rowKey(row)))
  selectedKeys.value = next
  nextTick(() => createIcons({ icons }))
}

function rowSupportsBulkDelete(row) {
  return cfg.value.actions(row).some(action => action.fn === 'confirmDelete')
}

function clearSelection() {
  selectedKeys.value = new Set()
  nextTick(() => createIcons({ icons }))
}

function renderCell(cell) {
  if (cell === null || cell === undefined) return '-'
  if (typeof cell === 'object' && cell.link !== undefined) {
    const href = String(cell.link || '')
    const label = String(cell.text || cell.link || '-')
    if (!href || href === '-') return '-'
    const cut = cell.max || 80
    const text = label.length > cut ? label.substring(0, cut) + '…' : label
    const escHref = href.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    const escText = text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    const escTitle = label.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    return `<a class="rtable-link" href="${escHref}" target="_blank" rel="noopener noreferrer" title="${escTitle}">${escText}</a>`
  }
  if (typeof cell === 'object' && cell.badge) {
    const key = (cell.badge || 'unknown').toLowerCase().replace(/[^a-z]/g, '')
    return `<span class="badge ${key}">${cell.badge}</span>`
  }
  if (typeof cell === 'object' && cell.text !== undefined) {
    return String(cell.text ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  }
  if (typeof cell === 'object' && cell.truncate !== undefined) {
    const s = String(cell.truncate ?? '')
    const cut = cell.max || 80
    const text = s.length > cut ? s.substring(0, cut) + '…' : s
    const full = s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    return `<span title="${full}">${text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</span>`
  }
  return String(cell ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
}

// Keyboard shortcut R
function onKey(e) {
  if (e.key === 'r' && !e.ctrlKey && !e.metaKey &&
      !['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)) {
    store.loadResources({ silent: true, force: true })
  }
}

onMounted(() => {
  document.addEventListener('keydown', onKey)
  nextTick(() => createIcons({ icons }))
})
onUnmounted(() => document.removeEventListener('keydown', onKey))

// Sync flush: the leaving filter is recorded under the previous resource
// before the next resource's view replaces it.
watch(() => store.resource, (next, previous) => {
  updateHistory(previous, rememberFilter(loadFilterHistory(previous), filter.value))
  restoreView(next)
  clearSelection()
}, { flush: 'sync' })
watch(() => store.namespace, () => clearSelection())
watch(() => store.rows, () => {
  const valid = new Set(store.rows.map(rowKey))
  selectedKeys.value = new Set([...selectedKeys.value].filter(key => valid.has(key)))
  nextTick(() => createIcons({ icons }))
})
</script>
