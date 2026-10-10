import { reactive } from 'vue'

// Global read-only mode (lib/readOnlyMode.js). The backend is what refuses the
// changes; this state only shows the mode and lets the user switch it.
export const readOnlyState = reactive({ enabled: false, forced: false, loaded: false })

async function request(method, body) {
  const res = await fetch('/api/system/read-only', {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  Object.assign(readOnlyState, { enabled: !!data.enabled, forced: !!data.forced, loaded: true })
  return readOnlyState
}

export const loadReadOnly = () => request('GET')
export const setReadOnly = enabled => request('PUT', { enabled })

// A refusal also tells the UI the mode is on (it may have been turned on in another window).
export function noteReadOnlyRefusal() {
  readOnlyState.enabled = true
}
