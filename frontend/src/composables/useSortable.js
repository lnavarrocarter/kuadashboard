import { ref } from 'vue'

/**
 * Provides column-sorting state and helpers for tables.
 *
 * Usage:
 *   const { sortBy, sortRows, sortIcon, thClass, resetSort } = useSortable()
 *
 *   <!-- template -->
 *   <th :class="thClass('name')" @click="sortBy('name')">Name {{ sortIcon('name') }}</th>
 *   <tr v-for="row in sortRows(filteredRows)" ...>
 */
export function useSortable() {
  const sortKey = ref(null)
  const sortDir = ref('asc')

  function sortBy(key) {
    if (sortKey.value === key) {
      sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
    } else {
      sortKey.value = key
      sortDir.value = 'asc'
    }
  }

  function resetSort() {
    sortKey.value = null
    sortDir.value = 'asc'
  }

  /**
   * Sort an array of objects by the current sortKey.
   * keyFn(row, key) is optional; defaults to row[key].
   */
  function sortRows(rows, keyFn) {
    if (!sortKey.value || !rows?.length) return rows
    const key = sortKey.value
    const dir = sortDir.value === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      const va = String(keyFn ? keyFn(a, key) : (a[key] ?? '')).toLowerCase()
      const vb = String(keyFn ? keyFn(b, key) : (b[key] ?? '')).toLowerCase()
      const na = parseFloat(va)
      const nb = parseFloat(vb)
      if (!isNaN(na) && !isNaN(nb)) return (na - nb) * dir
      return va < vb ? -dir : va > vb ? dir : 0
    })
  }

  function sortIcon(key) {
    if (sortKey.value !== key) return '⇅'
    return sortDir.value === 'asc' ? '↑' : '↓'
  }

  function thClass(key) {
    return sortKey.value === key ? 'sortable-th th-sorted' : 'sortable-th'
  }

  return { sortKey, sortDir, sortBy, resetSort, sortRows, sortIcon, thClass }
}
