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
    expect(tab.connectionState).toBe('closed')
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
})
