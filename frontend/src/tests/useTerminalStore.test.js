import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useTerminalStore } from '../stores/useTerminalStore'

describe('useTerminalStore', () => {
  let store

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useTerminalStore()
  })

  describe('initial state', () => {
    it('starts with empty tabs and panel hidden', () => {
      expect(store.tabs).toEqual([])
      expect(store.activeId).toBeNull()
      expect(store.visible).toBe(false)
      expect(store.wrap).toBe(false)
    })
  })

  describe('openLogsTab()', () => {
    it('creates a log tab and makes panel visible', () => {
      const tab = store.openLogsTab('default', 'my-pod', ['nginx'])
      expect(tab.type).toBe('log')
      expect(tab.ns).toBe('default')
      expect(tab.pod).toBe('my-pod')
      expect(tab.containers).toEqual(['nginx'])
      expect(tab.container).toBe('nginx')
      expect(store.visible).toBe(true)
      expect(store.activeId).toBe(tab.id)
      expect(store.tabs).toHaveLength(1)
    })

    it('reuses existing log tab for same pod+ns', () => {
      const tab1 = store.openLogsTab('default', 'pod-a', ['app'])
      const tab2 = store.openLogsTab('default', 'pod-a', ['app'])
      expect(tab1.id).toBe(tab2.id)
      expect(store.tabs).toHaveLength(1)
    })

    it('creates separate tabs for same pod in different namespaces', () => {
      store.openLogsTab('ns-a', 'pod', ['app'])
      store.openLogsTab('ns-b', 'pod', ['app'])
      expect(store.tabs).toHaveLength(2)
    })
  })

  describe('openExecTab()', () => {
    it('always creates a new exec tab (no dedup)', () => {
      store.openExecTab('default', 'pod-a', ['app'])
      store.openExecTab('default', 'pod-a', ['app'])
      expect(store.tabs).toHaveLength(2)
    })

    it('sets tab type to "exec"', () => {
      const tab = store.openExecTab('default', 'pod-a', ['sh'])
      expect(tab.type).toBe('exec')
    })

    it('handles empty containers array gracefully', () => {
      const tab = store.openExecTab('default', 'pod-x', [])
      expect(tab.container).toBeNull()
    })
  })

  describe('activateTab()', () => {
    it('sets activeId to the given id', () => {
      const tab = store.openLogsTab('default', 'pod', ['c'])
      const tab2 = store.openLogsTab('ns2', 'pod2', ['c'])
      store.activateTab(tab.id)
      expect(store.activeId).toBe(tab.id)
    })
  })

  describe('closeTab()', () => {
    it('removes tab and hides panel when last tab is closed', () => {
      const tab = store.openLogsTab('default', 'pod', ['c'])
      store.closeTab(tab.id)
      expect(store.tabs).toHaveLength(0)
      expect(store.visible).toBe(false)
      expect(store.activeId).toBeNull()
    })

    it('activates adjacent tab when closed tab was active', () => {
      const t1 = store.openLogsTab('default', 'pod1', ['c'])
      const t2 = store.openLogsTab('default', 'pod2', ['c'])
      store.closeTab(t1.id)
      expect(store.tabs).toHaveLength(1)
      expect(store.activeId).toBe(t2.id)
    })

    it('calls stopStream before removing tab', () => {
      const tab = store.openLogsTab('default', 'pod', ['c'])
      const mockWs = {
        send:  vi.fn(),
        close: vi.fn(),
      }
      tab.ws = mockWs
      tab.streaming = true
      store.closeTab(tab.id)
      expect(mockWs.send).toHaveBeenCalled()
      expect(mockWs.close).toHaveBeenCalled()
    })

    it('does nothing for unknown id', () => {
      store.openLogsTab('default', 'pod', ['c'])
      expect(() => store.closeTab('nonexistent-id')).not.toThrow()
      expect(store.tabs).toHaveLength(1)
    })
  })

  describe('stopStream()', () => {
    it('sends stop action and closes WebSocket', () => {
      const tab = store.openLogsTab('default', 'pod', ['c'])
      const ws = { send: vi.fn(), close: vi.fn() }
      tab.ws = ws
      tab.streaming = true
      store.stopStream(tab)
      expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ action: 'stop' }))
      expect(ws.close).toHaveBeenCalled()
      expect(tab.ws).toBeNull()
      expect(tab.streaming).toBe(false)
    })

    it('handles tab with no WebSocket gracefully', () => {
      const tab = store.openLogsTab('default', 'pod', ['c'])
      tab.ws = null
      expect(() => store.stopStream(tab)).not.toThrow()
    })
  })

  describe('pushLine()', () => {
    it('appends a formatted HTML line to tab.lines', () => {
      const tab = store.openLogsTab('default', 'pod', ['c'])
      store.pushLine(tab, 'hello world')
      expect(tab.lines).toHaveLength(1)
      expect(tab.lines[0]).toContain('hello world')
      expect(tab.lines[0]).toContain('term-line')
      expect(tab.lines[0]).toContain('<span class="ts">')
    })

    it('increments lineCount', () => {
      const tab = store.openLogsTab('default', 'pod', ['c'])
      store.pushLine(tab, 'line1')
      store.pushLine(tab, 'line2')
      expect(tab.lineCount).toBe(2)
    })

    it('applies custom CSS class', () => {
      const tab = store.openLogsTab('default', 'pod', ['c'])
      store.pushLine(tab, 'error!', 'err')
      expect(tab.lines[0]).toContain('term-line err')
    })

    it('escapes HTML special characters', () => {
      const tab = store.openLogsTab('default', 'pod', ['c'])
      store.pushLine(tab, '<script>alert("xss")</script>')
      expect(tab.lines[0]).toContain('&lt;script&gt;')
      expect(tab.lines[0]).not.toContain('<script>')
    })
  })

  describe('activeTab()', () => {
    it('returns null when no tabs', () => {
      expect(store.activeTab()).toBeNull()
    })

    it('returns the active tab', () => {
      const tab = store.openLogsTab('default', 'pod', ['c'])
      // Pinia returns reactive proxies; compare by identity property
      expect(store.activeTab()?.id).toBe(tab.id)
    })
  })
})
