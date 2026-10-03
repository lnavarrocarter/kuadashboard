/**
 * Collapsed state of named panel sections, shared by every instance and
 * remembered per viewer (localStorage). A section closed in one log group
 * stays closed in the others, which is what a reading preference means.
 */
import { reactive } from 'vue'

const STORAGE_KEY = 'kua.sections.collapsed'

function read() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {} } catch { return {} }
}

const collapsed = reactive(read())

export function useCollapsedSections() {
  const isCollapsed = id => collapsed[id] === true
  function toggle(id) {
    if (collapsed[id]) delete collapsed[id]
    else collapsed[id] = true
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(collapsed)) } catch { /* per-viewer convenience only */ }
  }
  return { isCollapsed, toggle }
}
