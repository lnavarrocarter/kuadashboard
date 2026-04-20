<template>
  <div class="resource-table">
    <div class="toolbar">
      <h2 class="resource-title">{{ cfg.title }}</h2>
      <div class="toolbar-right">
        <input v-model="filter" class="search-input" placeholder="Filter..." @input="filterRows" />
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
          <tr v-for="row in filtered" :key="rowKey(row)">
            <td v-for="(cell, i) in cfg.row(row)" :key="i" v-html="renderCell(cell)"></td>
            <td class="col-actions">
              <button
                v-for="action in cfg.actions(row)"
                :key="action.fn + action.label"
                :class="`action-btn icon-${action.icon} ${action.cls}`"
                :title="action.label"
                @click="emit('action', action.fn, action.args)"
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

const props = defineProps({ resource: String })
const emit  = defineEmits(['action'])

const store  = useKubeStore()
const filter = ref('')

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
    const va = cellSortVal(cells_a[sortColIdx.value]).toLowerCase()
    const vb = cellSortVal(cells_b[sortColIdx.value]).toLowerCase()
    const na = parseFloat(va), nb = parseFloat(vb)
    if (!isNaN(na) && !isNaN(nb)) return (na - nb) * dir
    return va < vb ? -dir : va > vb ? dir : 0
  })
})

function rowKey(row) { return row.name + (row.namespace || '') }

function renderCell(cell) {
  if (cell === null || cell === undefined) return '-'
  if (typeof cell === 'object' && cell.badge) {
    const key = (cell.badge || 'unknown').toLowerCase().replace(/[^a-z]/g, '')
    return `<span class="badge ${key}">${cell.badge}</span>`
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

watch(() => store.resource, () => { sortColIdx.value = null; sortDir.value = 'asc' })
watch(() => store.rows, () => nextTick(() => createIcons({ icons })))
</script>
