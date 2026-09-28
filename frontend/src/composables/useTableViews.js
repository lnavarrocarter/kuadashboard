/**
 * composables/useTableViews.js
 * Per-resource table view (text filter, sort, facet and quick-filter chips)
 * and filter history (recent + saved), persisted in localStorage so a table
 * looks the same when the user navigates back to it or reloads the app.
 */

const VIEWS_KEY = 'kua.kubeTableViews'
const HISTORY_KEY = 'kua.kubeFilterHistory'
export const RECENT_LIMIT = 8
export const SAVED_LIMIT = 20

function readJson(key) {
  try { return JSON.parse(localStorage.getItem(key)) || {} } catch { return {} }
}

function writeJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* storage unavailable */ }
}

export function emptyView() {
  return { filter: '', sortCol: null, sortDir: 'asc', facets: [], quick: [] }
}

export function loadTableView(resource) {
  const view = readJson(VIEWS_KEY)[resource]
  return { ...emptyView(), ...(view && typeof view === 'object' ? view : {}) }
}

export function saveTableView(resource, view) {
  const views = readJson(VIEWS_KEY)
  const isDefault = !view.filter && view.sortCol === null && !view.facets.length && !view.quick.length
  if (isDefault) delete views[resource]
  else views[resource] = view
  writeJson(VIEWS_KEY, views)
}

export function loadFilterHistory(resource) {
  const history = readJson(HISTORY_KEY)[resource] || {}
  return {
    saved: Array.isArray(history.saved) ? history.saved : [],
    recent: Array.isArray(history.recent) ? history.recent : [],
  }
}

export function saveFilterHistory(resource, history) {
  const all = readJson(HISTORY_KEY)
  if (!history.saved.length && !history.recent.length) delete all[resource]
  else all[resource] = history
  writeJson(HISTORY_KEY, all)
}

// Moves the filter to the top of the recents; saved filters stay out of recents.
export function rememberFilter(history, value) {
  const q = String(value || '').trim()
  if (!q || history.saved.includes(q)) return history
  const recent = [q, ...history.recent.filter(item => item !== q)].slice(0, RECENT_LIMIT)
  return { ...history, recent }
}

export function toggleSavedFilter(history, value) {
  const q = String(value || '').trim()
  if (!q) return history
  if (history.saved.includes(q)) {
    return { saved: history.saved.filter(item => item !== q), recent: [q, ...history.recent].slice(0, RECENT_LIMIT) }
  }
  return {
    saved: [...history.saved, q].slice(-SAVED_LIMIT),
    recent: history.recent.filter(item => item !== q),
  }
}

export function forgetFilter(history, value) {
  return {
    saved: history.saved.filter(item => item !== value),
    recent: history.recent.filter(item => item !== value),
  }
}
