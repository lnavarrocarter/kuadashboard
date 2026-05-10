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
        <input v-model="filter" class="search-input" placeholder="Filter..." />
        <button class="btn btn-icon" title="Refresh (R)" @click="store.loadResources()">
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
      <div v-else-if="!filtered.length" class="empty-state">No resources found</div>
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
            :class="{ selected: selectedKey === rowKey(row), checked: selectedKeys.has(rowKey(row)) }"
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

defineProps({ resource: String, selectedKey: String })
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

const filtered = computed(() => {
  const q = filter.value.toLowerCase()
  let rows = store.rows
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
    store.loadResources()
  }
}

onMounted(() => {
  document.addEventListener('keydown', onKey)
  nextTick(() => createIcons({ icons }))
})
onUnmounted(() => document.removeEventListener('keydown', onKey))

watch(() => store.resource, () => { sortColIdx.value = null; sortDir.value = 'asc'; clearSelection() })
watch(() => store.namespace, () => clearSelection())
watch(() => store.rows, () => {
  const valid = new Set(store.rows.map(rowKey))
  selectedKeys.value = new Set([...selectedKeys.value].filter(key => valid.has(key)))
  nextTick(() => createIcons({ icons }))
})
</script>
