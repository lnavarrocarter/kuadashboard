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
