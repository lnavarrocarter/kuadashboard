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
      <div v-else-if="!filtered.length" class="empty-state">No resources found</div>
      <table v-else class="rtable">
        <thead>
          <tr>
            <th v-for="col in cfg.cols" :key="col">{{ col }}</th>
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

    <div v-if="store.error" class="status-error">{{ store.error }}</div>
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

const filtered = computed(() => {
  const q = filter.value.toLowerCase()
  if (!q) return store.rows
  return store.rows.filter(r => JSON.stringify(r).toLowerCase().includes(q))
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

watch(() => store.rows, () => nextTick(() => createIcons({ icons })))
</script>
