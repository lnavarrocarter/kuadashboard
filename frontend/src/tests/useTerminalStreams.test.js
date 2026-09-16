import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useTerminalStreams } from '../composables/useTerminalStreams'
import { useTerminalStore } from '../stores/useTerminalStore'
import { capabilityRegistry } from '../shared/consoleSession.mjs'

// MockWebSocket from setup.js is available globally
function getMockWs() {
  return global.WebSocket.instances.at(-1)
}

describe('useTerminalStreams', () => {
  let store, streams

  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    global.WebSocket.reset()
    store   = useTerminalStore()
    streams = useTerminalStreams()
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
      const session = JSON.parse(options.body)
      return { ok: true, json: async () => ({ ticket: 'test-ticket', session,
        path: capabilityRegistry.find(c => c.provider === session.provider && c.transport === session.transport).path }) }
    }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('opens no socket for invalid or planned context', async () => {
    await streams.startExecStream(store.openExecTab('', '', []))
    await streams.startLocalStream(store.openCloudTab('ssm', 'Future'))
    expect(global.WebSocket.instances).toHaveLength(0)
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each(['missing', 'ambiguous', 'invalid'])('opens no socket for %s backend authority', async () => {
    fetch.mockResolvedValueOnce({ ok: false })
    const tab = store.openLocalTab()
    await streams.startLocalStream(tab)
    expect(global.WebSocket.instances).toHaveLength(0)
    expect(tab.connectionState).toBe('error')
    expect(tab.streaming).toBe(false)
  })

  it('does not connect after a pending tab is closed', async () => {
    let resolve
    fetch.mockReturnValueOnce(new Promise(done => { resolve = done }))
    const tab = store.openLocalTab()
    const pending = streams.startLocalStream(tab)
    store.closeTab(tab.id)
    resolve({ ok: true, json: async () => ({ ticket: 'late', path: '/ws/shell', session: { provider: 'local', transport: 'shell' } }) })
    await pending
    expect(global.WebSocket.instances).toHaveLength(0)
  })

  it('keeps secrets outside tabs, preflight bodies and WebSocket frames', async () => {
    const meta = { profileId: 'p', password: 'secret-password', token: 'secret-token',
      privateKey: 'secret-key', target: { host: 'host', user: 'user', password: 'nested-secret' } }
    const cloud = store.openCloudTab('ec2', 'EC2', meta)
    expect(JSON.stringify(cloud)).not.toMatch(/secret-password|secret-token|secret-key|nested-secret/)
    const tab = store.openExecTab('default', 'pod', ['app'])
    tab.meta = meta
    await streams.startExecStream(tab)
    getMockWs()._emit('open', {})
    expect(fetch.mock.calls[0][1].body).not.toMatch(/secret-password|secret-token|secret-key|nested-secret/)
    expect(getMockWs()._lastSent).not.toMatch(/secret-password|secret-token|secret-key|nested-secret/)
  })

  it('tracks local session connection lifecycle', async () => {
    const tab = store.openLocalTab()
    await streams.startLocalStream(tab)
    expect(tab.connectionState).toBe('connecting')
    getMockWs()._emit('open', {})
    expect(tab.connectionState).toBe('connected')
    getMockWs()._emit('close', {})
    expect(tab.connectionState).toBe('stopped')
  })

  describe('startLogStream()', () => {
    it('creates a WebSocket to /ws/logs', async () => {
      const tab = store.openLogsTab('default', 'my-pod', ['nginx'])
      await streams.startLogStream(tab)
      const ws = getMockWs()
      expect(ws.url).toBe('ws://localhost:7190/ws/logs?ticket=test-ticket')
    })

    it('sends start action with correct payload on open', async () => {
      const tab = store.openLogsTab('default', 'my-pod', ['nginx'])
      tab.container = 'nginx'
      await streams.startLogStream(tab)
      const ws = getMockWs()
      ws._emit('open', {})
      const payload = JSON.parse(ws._lastSent)
      expect(payload.action).toBe('start')
      expect(payload.namespace).toBe('default')
      expect(payload.pod).toBe('my-pod')
      expect(payload.resourceType).toBe('pods')
      expect(payload.container).toBe('nginx')
      expect(payload.tailLines).toBe(500)
    })

    it('sends workload resourceType when streaming deployment logs', async () => {
      const tab = store.openLogsTab('default', 'api', ['app'], 'deployments')
      tab.selectedPod = 'api-abc123'
      await streams.startLogStream(tab)
      const ws = getMockWs()
      ws._emit('open', {})
      const payload = JSON.parse(ws._lastSent)
      expect(payload.resourceType).toBe('deployments')
      expect(payload.pod).toBe('api')
      expect(payload.selectedPod).toBe('api-abc123')
    })

    it('stores workload pod targets announced by the server', async () => {
      const tab = store.openLogsTab('default', 'api', ['app'], 'deployments')
      await streams.startLogStream(tab)
      const ws = getMockWs()
      ws._emit('message', { data: JSON.stringify({ type: 'targets', pods: ['api-a', 'api-b'] }) })
      expect(tab.logPods).toEqual(['api-a', 'api-b'])
    })

    it('pushes "sys" line with pod name on open', async () => {
      const tab = store.openLogsTab('default', 'my-pod', ['nginx'])
      await streams.startLogStream(tab)
      getMockWs()._emit('open', {})
      expect(tab.lines.some(l => l.includes('my-pod'))).toBe(true)
    })

    it('appends log lines from messages', async () => {
      const tab = store.openLogsTab('default', 'pod', ['c'])
      await streams.startLogStream(tab)
      const ws = getMockWs()
      ws._emit('open', {})
      ws._emit('message', { data: JSON.stringify({ type: 'log', data: 'INFO starting server\nDEBUG loaded config' }) })
      expect(tab.lines.length).toBeGreaterThan(1)
    })

    it('strips ANSI escape codes from pod logs', async () => {
      const tab = store.openLogsTab('default', 'pod', ['c'])
      await streams.startLogStream(tab)
      const ws = getMockWs()
      ws._emit('open', {})
      ws._emit('message', { data: JSON.stringify({ type: 'log', data: '\x1b[32m[Nest] LOG\x1b[39m mapped route\n' }) })
      const line = tab.lines.find(l => l.includes('[Nest] LOG'))
      expect(line).toBeDefined()
      expect(line).not.toContain('\x1b')
    })

    it('buffers partial pod log chunks until a full line arrives', async () => {
      const tab = store.openLogsTab('default', 'pod', ['c'])
      await streams.startLogStream(tab)
      const ws = getMockWs()
      ws._emit('open', {})
      const initialCount = tab.lines.length
      ws._emit('message', { data: JSON.stringify({ type: 'log', data: 'INFO start' }) })
      expect(tab.lines).toHaveLength(initialCount)
      ws._emit('message', { data: JSON.stringify({ type: 'log', data: 'ed\nWARN next\n' }) })
      expect(tab.lines.some(l => l.includes('INFO started'))).toBe(true)
      expect(tab.lines.some(l => l.includes('WARN next'))).toBe(true)
    })

    it('prefixes workload log lines with source pod', async () => {
      const tab = store.openLogsTab('default', 'api', ['app'], 'deployments')
      await streams.startLogStream(tab)
      const ws = getMockWs()
      ws._emit('open', {})
      ws._emit('message', { data: JSON.stringify({ type: 'log', pod: 'api-abc123', data: 'INFO ready\n' }) })
      expect(tab.lines.some(l => l.includes('[api-abc123] INFO ready'))).toBe(true)
    })

    it('marks error lines with err class', async () => {
      const tab = store.openLogsTab('default', 'pod', ['c'])
      await streams.startLogStream(tab)
      const ws = getMockWs()
      ws._emit('open', {})
      ws._emit('message', { data: JSON.stringify({ type: 'log', data: 'ERROR: something failed\n' }) })
      const errLine = tab.lines.find(l => l.includes('term-line err'))
      expect(errLine).toBeDefined()
    })

    it('marks stream done on "done" message', async () => {
      const tab = store.openLogsTab('default', 'pod', ['c'])
      await streams.startLogStream(tab)
      const ws = getMockWs()
      ws._emit('open', {})
      ws._emit('message', { data: JSON.stringify({ type: 'done' }) })
      expect(tab.streaming).toBe(false)
    })

    it('handles error messages from server', async () => {
      const tab = store.openLogsTab('default', 'pod', ['c'])
      await streams.startLogStream(tab)
      const ws = getMockWs()
      ws._emit('open', {})
      ws._emit('message', { data: JSON.stringify({ type: 'error', data: 'pod not found' }) })
      const errLine = tab.lines.find(l => l.includes('pod not found'))
      expect(errLine).toBeDefined()
    })

    it('sets streaming=false on websocket close', async () => {
      const tab = store.openLogsTab('default', 'pod', ['c'])
      await streams.startLogStream(tab)
      const ws = getMockWs()
      tab.streaming = true
      ws._emit('close', {})
      expect(tab.streaming).toBe(false)
    })

    it('stops previous stream before starting new one', async () => {
      const tab = store.openLogsTab('default', 'pod', ['c'])
      const fakeWs = { send: vi.fn(), close: vi.fn() }
      tab.ws = fakeWs
      tab.streaming = true
      await streams.startLogStream(tab)
      expect(fakeWs.close).toHaveBeenCalled()
    })
  })

  describe('startExecStream()', () => {
    it('creates a WebSocket to /ws/exec', async () => {
      const tab = store.openExecTab('default', 'my-pod', ['sh'])
      await streams.startExecStream(tab)
      const ws = getMockWs()
      expect(ws.url).toBe('ws://localhost:7190/ws/exec?ticket=test-ticket')
    })

    it('sends start action with correct payload on open', async () => {
      const tab = store.openExecTab('default', 'my-pod', ['sh'])
      tab.container = 'sh'
      await streams.startExecStream(tab)
      const ws = getMockWs()
      ws._emit('open', {})
      const payload = JSON.parse(ws._lastSent)
      expect(payload.action).toBe('start')
      expect(payload.namespace).toBe('default')
      expect(payload.pod).toBe('my-pod')
      expect(payload.container).toBe('sh')
    })

    it('pushes sys line on "connected" message', async () => {
      const tab = store.openExecTab('default', 'pod', ['sh'])
      await streams.startExecStream(tab)
      const ws = getMockWs()
      ws._emit('open', {})
      ws._emit('message', { data: JSON.stringify({ type: 'connected' }) })
      expect(tab.lines.some(l => l.includes('Shell'))).toBe(true)
    })

    it('appends stdout lines from "out" messages', async () => {
      const tab = store.openExecTab('default', 'pod', ['sh'])
      await streams.startExecStream(tab)
      const ws = getMockWs()
      ws._emit('open', {})
      ws._emit('message', { data: JSON.stringify({ type: 'out', data: 'total 8\n-rw-r 1 root' }) })
      expect(tab.lines.length).toBeGreaterThan(0)
    })

    it('strips ANSI escape codes from output', async () => {
      const tab = store.openExecTab('default', 'pod', ['sh'])
      await streams.startExecStream(tab)
      const ws = getMockWs()
      ws._emit('open', {})
      ws._emit('message', { data: JSON.stringify({ type: 'out', data: '\x1b[32mGreen text\x1b[0m' }) })
      const line = tab.lines.find(l => l.includes('Green text'))
      expect(line).toBeDefined()
      expect(line).not.toContain('\x1b')
    })

    it('ignores malformed JSON messages silently', async () => {
      const tab = store.openExecTab('default', 'pod', ['sh'])
      await streams.startExecStream(tab)
      const ws = getMockWs()
      ws._emit('open', {})
      expect(() => {
        ws._emit('message', { data: 'not-json' })
      }).not.toThrow()
    })
  })

  describe('startSshStream()', () => {
    it('creates a WebSocket to /ws/ec2-shell', async () => {
      const tab = store.openCloudTab('ec2', 'ec2-user@1.2.3.4', { profileId: 'profile-1', target: { host: '1.2.3.4', user: 'ec2-user' } })
      await streams.startSshStream(tab)
      expect(getMockWs().url).toBe('ws://localhost:7190/ws/ec2-shell?ticket=test-ticket')
    })

    it('sends a connect action on open', async () => {
      const tab = store.openCloudTab('ec2', 'ec2-user@1.2.3.4', { profileId: 'profile-1', target: { host: '1.2.3.4', user: 'ec2-user' } })
      await streams.startSshStream(tab)
      const ws = getMockWs()
      ws._emit('open', {})
      expect(JSON.parse(ws._lastSent)).toEqual({ action: 'connect' })
    })

    it('pushes a sys line on "connected" and appends out/err output', async () => {
      const tab = store.openCloudTab('ec2', 'ec2-user@1.2.3.4', { profileId: 'profile-1', target: { host: '1.2.3.4', user: 'ec2-user' } })
      await streams.startSshStream(tab)
      const ws = getMockWs()
      ws._emit('open', {})
      ws._emit('message', { data: JSON.stringify({ type: 'connected', user: 'ec2-user', host: '1.2.3.4' }) })
      expect(tab.lines.some(l => l.includes('Connected to ec2-user@1.2.3.4'))).toBe(true)
      ws._emit('message', { data: JSON.stringify({ type: 'out', data: 'hello\n' }) })
      expect(tab.lines.some(l => l.includes('hello'))).toBe(true)
    })

    it('sets connectionState to "done" on a clean exit and "error" on a backend error', async () => {
      const tab = store.openCloudTab('ec2', 'a', { profileId: 'p', target: { host: 'a', user: 'u' } })
      await streams.startSshStream(tab)
      const ws = getMockWs()
      ws._emit('open', {})
      ws._emit('message', { data: JSON.stringify({ type: 'done', code: 0 }) })
      expect(tab.connectionState).toBe('done')

      const tab2 = store.openCloudTab('ec2', 'b', { profileId: 'p', target: { host: 'b', user: 'u' } })
      await streams.startSshStream(tab2)
      const ws2 = getMockWs()
      ws2._emit('open', {})
      ws2._emit('message', { data: JSON.stringify({ type: 'error', data: 'SSH connection failed' }) })
      expect(tab2.connectionState).toBe('error')
    })
  })

  describe('startSsmStream()', () => {
    it('creates a WebSocket to /ws/aws-ssm', async () => {
      const tab = store.openCloudTab('ssm', 'i-123', { profileId: 'profile-1', target: { instanceId: 'i-123' } })
      await streams.startSsmStream(tab)
      expect(getMockWs().url).toBe('ws://localhost:7190/ws/aws-ssm?ticket=test-ticket')
    })

    it('sends a connect action on open', async () => {
      const tab = store.openCloudTab('ssm', 'i-123', { profileId: 'profile-1', target: { instanceId: 'i-123' } })
      await streams.startSsmStream(tab)
      const ws = getMockWs()
      ws._emit('open', {})
      expect(JSON.parse(ws._lastSent)).toEqual({ action: 'connect' })
    })

    it('pushes a sys line on "connected" and appends out/err output', async () => {
      const tab = store.openCloudTab('ssm', 'i-123', { profileId: 'profile-1', target: { instanceId: 'i-123' } })
      await streams.startSsmStream(tab)
      const ws = getMockWs()
      ws._emit('open', {})
      ws._emit('message', { data: JSON.stringify({ type: 'connected', instanceId: 'i-123' }) })
      expect(tab.lines.some(l => l.includes('SSM session started on i-123'))).toBe(true)
      ws._emit('message', { data: JSON.stringify({ type: 'out', data: 'hello\n' }) })
      expect(tab.lines.some(l => l.includes('hello'))).toBe(true)
    })

    it('sets connectionState to "done" on a clean exit and "error" on a backend error', async () => {
      const tab = store.openCloudTab('ssm', 'i-1', { profileId: 'p', target: { instanceId: 'i-1' } })
      await streams.startSsmStream(tab)
      const ws = getMockWs()
      ws._emit('open', {})
      ws._emit('message', { data: JSON.stringify({ type: 'done', code: 0 }) })
      expect(tab.connectionState).toBe('done')

      const tab2 = store.openCloudTab('ssm', 'i-2', { profileId: 'p', target: { instanceId: 'i-2' } })
      await streams.startSsmStream(tab2)
      const ws2 = getMockWs()
      ws2._emit('open', {})
      ws2._emit('message', { data: JSON.stringify({ type: 'error', data: 'Access denied' }) })
      expect(tab2.connectionState).toBe('error')
    })
  })

  describe('reconnect state', () => {
    it('shows "reconnecting" while a reconnect attempt is preparing, distinct from a first connect', async () => {
      const tab = store.openLocalTab()
      await streams.startLocalStream(tab)
      getMockWs()._emit('open', {})
      expect(tab.connectionState).toBe('connected')

      let resolveFetch
      vi.stubGlobal('fetch', vi.fn(() => new Promise(resolve => { resolveFetch = resolve })))
      const reconnectPromise = streams.startLocalStream(tab, { reconnect: true })
      expect(tab.connectionState).toBe('reconnecting')
      resolveFetch({ ok: true, json: async () => ({ ticket: 't', session: tab, path: '/ws/shell' }) })
      await reconnectPromise
      expect(tab.connectionState).toBe('connecting')
    })

    it('does not downgrade a "done" state to "stopped" when the socket then closes', async () => {
      const tab = store.openLocalTab()
      await streams.startLocalStream(tab)
      const ws = getMockWs()
      ws._emit('open', {})
      ws._emit('message', { data: JSON.stringify({ type: 'done', code: 0 }) })
      expect(tab.connectionState).toBe('done')
      ws._emit('close', {})
      expect(tab.connectionState).toBe('done')
    })
  })
})
