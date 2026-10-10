import { nextTick, watch } from 'vue'

// Keeps the URL in step with the main view, so a copied URL opens an equivalent
// view and Back returns to the previous one. Params owned here:
//   view     provider (kubernetes | aws | gcp | vercel | kuapps)
//   service  AWS, GCP or Vercel service tab
//   profile  AWS, GCP or Vercel profile id (a local id, never credentials)
//   project  Vercel project id
//   q, f.<id> search and filters of that service (they replace the current
//            entry: reloading or sharing keeps the result without new history)
//   selected GCP selected resource (region/name), never payloads or values
// KUApps owns ?app= and ?tab=. They are removed while another provider is
// shown (a stale ?app= reopened KUApps on load) and put back when KUApps returns.

export const VIEWS = ['kubernetes', 'aws', 'gcp', 'vercel', 'kuapps']
const KUAPPS_PARAMS = ['app', 'tab']
// Owned by lib/kubeUrl.js while Kubernetes is shown; dropped on the other views.
const KUBE_PARAMS = ['context', 'ns', 'resource', 'name']

export function readViewUrl(search = '') {
  let params
  try { params = new URLSearchParams(search) } catch { return { view: '', service: '', profile: '', resource: '', project: '', filters: {} } }
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
    resource: params.get('selected') || '',
    project: params.get('project') || '',
    filters,
  }
}

// Providers whose service and profile live in the URL; AWS and GCP also keep their filters.
const SERVICE_VIEWS = new Set(['aws', 'gcp', 'vercel'])
const FILTER_VIEWS = new Set(['aws', 'gcp'])

/**
 * The URL for a view state. `stash` holds the KUApps params removed while
 * another provider is shown; it is returned updated.
 */
export function nextViewUrl(href, { view, service, profile, resource = '', project = '', filters = {} }, stash = {}) {
  const url = new URL(href)
  const kept = { ...stash }
  const scoped = SERVICE_VIEWS.has(view)
  if (view) url.searchParams.set('view', view)
  else url.searchParams.delete('view')
  if (scoped && service) url.searchParams.set('service', service)
  else url.searchParams.delete('service')
  if (scoped && profile) url.searchParams.set('profile', profile)
  else url.searchParams.delete('profile')
  if (view === 'gcp' && resource) url.searchParams.set('selected', resource)
  else url.searchParams.delete('selected')
  if (view === 'vercel' && project) url.searchParams.set('project', project)
  else url.searchParams.delete('project')
  for (const key of [...url.searchParams.keys()]) if (key === 'q' || key.startsWith('f.')) url.searchParams.delete(key)
  if (view !== 'kubernetes') for (const key of KUBE_PARAMS) url.searchParams.delete(key)
  if (FILTER_VIEWS.has(view)) {
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
      // No state object: the params are read back from the URL, and a reactive
      // value (filters) cannot be cloned into history (DataCloneError).
      if (push && !applying) history.pushState(null, '', next.href)
      else history.replaceState(history.state, '', next.href)
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
