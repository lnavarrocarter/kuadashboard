import { nextTick, watch } from 'vue'

// Keeps the URL in step with the main view, so a copied URL opens an equivalent
// view and Back returns to the previous one. Params owned here:
//   view     provider (kubernetes | aws | gcp | vercel | kuapps)
//   service  AWS service tab
//   profile  AWS profile id (a local id, never credentials)
//   q, f.<id> AWS search and filters of that service (they replace the current
//            entry: reloading or sharing keeps the result without new history)
// KUApps owns ?app= and ?tab=. They are removed while another provider is
// shown (a stale ?app= reopened KUApps on load) and put back when KUApps returns.

export const VIEWS = ['kubernetes', 'aws', 'gcp', 'vercel', 'kuapps']
const KUAPPS_PARAMS = ['app', 'tab']

export function readViewUrl(search = '') {
  let params
  try { params = new URLSearchParams(search) } catch { return { view: '', service: '', profile: '', filters: {} } }
  const view = params.get('view') || ''
  const filters = {}
  for (const [key, value] of params) {
    if (!value) continue
    if (key === 'q') filters.q = value
    else if (key.startsWith('f.')) filters[key.slice(2)] = value
  }
  return {
    view: VIEWS.includes(view) ? view : '',
    service: params.get('service') || '',
    profile: params.get('profile') || '',
    filters,
  }
}

/**
 * The URL for a view state. `stash` holds the KUApps params removed while
 * another provider is shown; it is returned updated.
 */
export function nextViewUrl(href, { view, service, profile, filters = {} }, stash = {}) {
  const url = new URL(href)
  const kept = { ...stash }
  if (view) url.searchParams.set('view', view)
  else url.searchParams.delete('view')
  if (view === 'aws' && service) url.searchParams.set('service', service)
  else url.searchParams.delete('service')
  if (view === 'aws' && profile) url.searchParams.set('profile', profile)
  else url.searchParams.delete('profile')
  for (const key of [...url.searchParams.keys()]) if (key === 'q' || key.startsWith('f.')) url.searchParams.delete(key)
  if (view === 'aws') {
    for (const [key, value] of Object.entries(filters)) {
      if (value) url.searchParams.set(key === 'q' ? 'q' : `f.${key}`, value)
    }
  }
  for (const key of KUAPPS_PARAMS) {
    if (view === 'kuapps') {
      if (kept[key] && !url.searchParams.has(key)) url.searchParams.set(key, kept[key])
      delete kept[key]
    } else if (url.searchParams.has(key)) {
      kept[key] = url.searchParams.get(key)
      url.searchParams.delete(key)
    }
  }
  return { href: url.href, stash: kept }
}

/**
 * @param {object} options
 * @param {() => { view, service, profile }} options.state  current view
 * @param {Array} options.navigation  sources whose change is a navigation (new history entry)
 * @param {Array} options.context     sources whose change only updates the current entry
 * @param {(linked: object) => void} options.onPop  applies a state from Back/Forward
 */
export function useViewUrl({ state, navigation, context = [], onPop, location = globalThis.location, history = globalThis.history }) {
  const initial = readViewUrl(location?.search || '')
  let stash = {}
  let applying = false

  function sync(push) {
    if (!location || !history?.replaceState) return
    try {
      const next = nextViewUrl(location.href, state(), stash)
      stash = next.stash
      if (next.href === location.href) return
      if (push && !applying) history.pushState({ kuaView: state() }, '', next.href)
      else history.replaceState({ ...(history.state || {}), kuaView: state() }, '', next.href)
    } catch { /* non-http locations (tests, file://) keep working without the params */ }
  }

  async function onPopState() {
    applying = true
    try {
      await onPop(readViewUrl(location.search))
      await nextTick()
    } finally {
      applying = false
      sync(false)
    }
  }

  // Called once the linked view is applied, so that applying it is not a navigation.
  function start() {
    sync(false)
    watch(navigation, () => sync(true))
    if (context.length) watch(context, () => sync(false))
    globalThis.addEventListener?.('popstate', onPopState)
  }

  function stop() {
    globalThis.removeEventListener?.('popstate', onPopState)
  }

  return { initial, start, stop, sync }
}
