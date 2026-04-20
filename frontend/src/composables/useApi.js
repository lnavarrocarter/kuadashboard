// Thin wrapper around fetch — throws Error with server message on failure
export async function api(method, path, body) {
  const opts = { method, headers: {} }
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json'
    opts.body = JSON.stringify(body)
  }
  const res = await fetch(path, opts)
  const ct = res.headers.get('content-type') || ''
  if (!res.ok) {
    const err = ct.includes('json')
      ? (await res.json()).error
      : await res.text()
    throw new Error(err || `HTTP ${res.status}`)
  }
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
  async function apiFetch(path, options = {}) {
    const { method = 'GET', headers = {}, body } = options
    const res = await fetch(path, { method, headers, body })
    const ct  = res.headers.get('content-type') || ''
    if (!res.ok) {
      const err = ct.includes('json')
        ? (await res.json()).error
        : await res.text()
      throw new Error(err || `HTTP ${res.status}`)
    }
    return ct.includes('json') ? res.json() : res.text()
  }
  return { apiFetch }
}
