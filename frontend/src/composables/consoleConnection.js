import { capabilityRegistry, sessionDescriptor, validateSession } from '../shared/consoleSession.mjs'

export { capabilityRegistry, sessionDescriptor }

export async function prepareConsoleConnection(input) {
  const { session, capability } = validateSession(input)
  const response = await fetch('/api/console/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(session),
  })
  if (!response.ok) throw new Error('Invalid console context')
  const prepared = await response.json()
  if (prepared.path !== capability.path || typeof prepared.ticket !== 'string') throw new Error('Invalid console session')
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return { url: `${proto}//${location.host}${prepared.path}?ticket=${encodeURIComponent(prepared.ticket)}`, session: sessionDescriptor(prepared.session) }
}
