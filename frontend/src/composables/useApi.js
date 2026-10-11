import { noteReadOnlyRefusal } from './useReadOnly'
import { useI18n } from './useI18n'

const { t } = useI18n()
const READ_ONLY_AREAS = { aws: 'AWS', gcp: 'GCP', vercel: 'Vercel', helm: 'Helm', kubernetes: 'Kubernetes' }

// Error with the server message; `status` and the JSON body (`details`) are
// kept so callers can react to structured errors (e.g. AWS access requests).
async function responseError(res, ct) {
  const body = ct.includes('json') ? await res.json().catch(() => null) : null
  let message = body ? body.error : await res.text().catch(() => '')
  // Read-only mode refused a change: say it in the UI language, whatever the view shows.
  if (body?.code === 'READ_ONLY') {
    noteReadOnlyRefusal()
    message = t(body.area === 'console' ? 'readOnly.refusedTerminal' : 'readOnly.refused', { area: READ_ONLY_AREAS[body.area] || body.area })
  }
  return Object.assign(new Error(message || `HTTP ${res.status}`), { status: res.status, details: body })
}

// Thin wrapper around fetch — throws Error with server message on failure
export async function api(method, path, body) {
  const opts = { method, headers: {} }
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json'
    opts.body = JSON.stringify(body)
  }
  const res = await fetch(path, opts)
  const ct = res.headers.get('content-type') || ''
  if (!res.ok) throw await responseError(res, ct)
  return ct.includes('json') ? res.json() : res.text()
}

/**
 * Composable that returns `apiFetch` — a fetch-compatible helper that:
 *   - Defaults to GET
 *   - Throws on non-ok responses (with server error message)
 *   - Supports extra headers (e.g. X-Profile-Id for cloud routes)
 *
 * Desktop-ready: swap this implementation for Electron IPC in the future
 * without changing any store or component code.
 */
export function useApi() {
  const stableResponses = new Map()

  async function apiFetch(path, options = {}) {
    const { method = 'GET', headers = {}, body, background = false, stabilize = false } = options
    const requestHeaders = { ...headers }
    if (background) requestHeaders['X-KUA-Background'] = '1'
    const res = await fetch(path, { method, headers: requestHeaders, body })
    const ct  = res.headers.get('content-type') || ''
    if (!res.ok) throw await responseError(res, ct)
    const result = ct.includes('json') ? await res.json() : await res.text()
    const isList = Array.isArray(result) || Array.isArray(result?.items)
    if (method === 'GET' && stabilize && isList) {
      const profileId = requestHeaders['X-Profile-Id'] || ''
      const key = `${profileId}\u0000${path}`
      const serialized = JSON.stringify(result)
      const previous = stableResponses.get(key)
      if (previous?.serialized === serialized) return previous.value
      stableResponses.set(key, { serialized, value: result })
    }
    return result
  }
  return { apiFetch }
}
