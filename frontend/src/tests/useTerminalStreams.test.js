import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useTerminalStreams } from '../composables/useTerminalStreams'
import { useTerminalStore } from '../stores/useTerminalStore'

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
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('startLogStream()', () => {
    it('creates a WebSocket to /ws/logs', () => {
      const tab = store.openLogsTab('default', 'my-pod', ['nginx'])
      streams.startLogStream(tab)
      const ws = getMockWs()
      expect(ws.url).toBe('ws://localhost:7190/ws/logs')
    })

    it('sends start action with correct payload on open', () => {
      const tab = store.openLogsTab('default', 'my-pod', ['nginx'])
      tab.container = 'nginx'
      streams.startLogStream(tab)
      const ws = getMockWs()
      ws._emit('open', {})
      const payload = JSON.parse(ws._lastSent)
      expect(payload.action).toBe('start')
      expect(payload.namespace).toBe('default')
      expect(payload.pod).toBe('my-pod')
      expect(payload.container).toBe('nginx')
      expect(payload.tailLines).toBe(500)
    })

    it('pushes "sys" line with pod name on open', () => {
      const tab = store.openLogsTab('default', 'my-pod', ['nginx'])
      streams.startLogStream(tab)
      getMockWs()._emit('open', {})
      expect(tab.lines.some(l => l.includes('my-pod'))).toBe(true)
    })

    it('appends log lines from messages', () => {
      const tab = store.openLogsTab('default', 'pod', ['c'])
      streams.startLogStream(tab)
      const ws = getMockWs()
      ws._emit('open', {})
      ws._emit('message', { data: JSON.stringify({ type: 'log', data: 'INFO starting server\nDEBUG loaded config' }) })
      expect(tab.lines.length).toBeGreaterThan(1)
    })

    it('marks error lines with err class', () => {
      const tab = store.openLogsTab('default', 'pod', ['c'])
      streams.startLogStream(tab)
      const ws = getMockWs()
      ws._emit('open', {})
      ws._emit('message', { data: JSON.stringify({ type: 'log', data: 'ERROR: something failed' }) })
      const errLine = tab.lines.find(l => l.includes('term-line err'))
      expect(errLine).toBeDefined()
    })

    it('marks stream done on "done" message', () => {
      const tab = store.openLogsTab('default', 'pod', ['c'])
      streams.startLogStream(tab)
      const ws = getMockWs()
      ws._emit('open', {})
      ws._emit('message', { data: JSON.stringify({ type: 'done' }) })
      expect(tab.streaming).toBe(false)
    })

    it('handles error messages from server', () => {
      const tab = store.openLogsTab('default', 'pod', ['c'])
      streams.startLogStream(tab)
      const ws = getMockWs()
      ws._emit('open', {})
      ws._emit('message', { data: JSON.stringify({ type: 'error', data: 'pod not found' }) })
      const errLine = tab.lines.find(l => l.includes('pod not found'))
      expect(errLine).toBeDefined()
    })

    it('sets streaming=false on websocket close', () => {
      const tab = store.openLogsTab('default', 'pod', ['c'])
      streams.startLogStream(tab)
      const ws = getMockWs()
      tab.streaming = true
      ws._emit('close', {})
      expect(tab.streaming).toBe(false)
    })

    it('stops previous stream before starting new one', () => {
      const tab = store.openLogsTab('default', 'pod', ['c'])
      const fakeWs = { send: vi.fn(), close: vi.fn() }
      tab.ws = fakeWs
      tab.streaming = true
      streams.startLogStream(tab)
      expect(fakeWs.close).toHaveBeenCalled()
    })
  })

  describe('startExecStream()', () => {
    it('creates a WebSocket to /ws/exec', () => {
      const tab = store.openExecTab('default', 'my-pod', ['sh'])
      streams.startExecStream(tab)
      const ws = getMockWs()
      expect(ws.url).toBe('ws://localhost:7190/ws/exec')
    })

    it('sends start action with correct payload on open', () => {
      const tab = store.openExecTab('default', 'my-pod', ['sh'])
      tab.container = 'sh'
      streams.startExecStream(tab)
      const ws = getMockWs()
      ws._emit('open', {})
      const payload = JSON.parse(ws._lastSent)
      expect(payload.action).toBe('start')
      expect(payload.namespace).toBe('default')
      expect(payload.pod).toBe('my-pod')
      expect(payload.container).toBe('sh')
    })

    it('pushes sys line on "connected" message', () => {
      const tab = store.openExecTab('default', 'pod', ['sh'])
      streams.startExecStream(tab)
      const ws = getMockWs()
      ws._emit('open', {})
      ws._emit('message', { data: JSON.stringify({ type: 'connected' }) })
      expect(tab.lines.some(l => l.includes('Shell'))).toBe(true)
    })

    it('appends stdout lines from "out" messages', () => {
      const tab = store.openExecTab('default', 'pod', ['sh'])
      streams.startExecStream(tab)
      const ws = getMockWs()
      ws._emit('open', {})
      ws._emit('message', { data: JSON.stringify({ type: 'out', data: 'total 8\n-rw-r 1 root' }) })
      expect(tab.lines.length).toBeGreaterThan(0)
    })

    it('strips ANSI escape codes from output', () => {
      const tab = store.openExecTab('default', 'pod', ['sh'])
      streams.startExecStream(tab)
      const ws = getMockWs()
      ws._emit('open', {})
      ws._emit('message', { data: JSON.stringify({ type: 'out', data: '\x1b[32mGreen text\x1b[0m' }) })
      const line = tab.lines.find(l => l.includes('Green text'))
      expect(line).toBeDefined()
      expect(line).not.toContain('\x1b')
    })

    it('ignores malformed JSON messages silently', () => {
      const tab = store.openExecTab('default', 'pod', ['sh'])
      streams.startExecStream(tab)
      const ws = getMockWs()
      ws._emit('open', {})
      expect(() => {
        ws._emit('message', { data: 'not-json' })
      }).not.toThrow()
    })
  })
})
