import { markRaw } from 'vue'
import { useTerminalStore } from '../stores/useTerminalStore'
import { useToast } from './useToast'

// Resolve the correct WebSocket URL for any environment:
//   - Dev (Vite proxy)   → ws://localhost:<vite-port>/ws/... (proxy forwards to backend)
//   - Production Electron → ws://localhost:7190/ws/... (served directly by Express)
// NOTE: The server uses noServer:true + manual upgrade routing, so the Vite
// proxy correctly forwards WS upgrades without "Invalid frame header" issues.
function wsUrl(path) {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${location.host}${path}`
}

export function useTerminalStreams() {
  const store     = useTerminalStore()
  const { toast } = useToast()

  function startLogStream(tab, previous = false) {
    store.stopStream(tab)
    tab._logBuffers = {}
    tab.streaming = true

    const ws = markRaw(new WebSocket(wsUrl('/ws/logs')))
    tab.ws = ws

    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({
        action: 'start',
        namespace:  tab.ns,
        pod:        tab.pod,
        resourceType: tab.resourceType || 'pods',
        container:  tab.container || null,
        previous,
        tailLines:  500,
      }))
      const target = tab.resourceType && tab.resourceType !== 'pods' ? `${tab.resourceType}/${tab.pod}` : tab.pod
      store.pushLine(tab, `▶ Streaming ${target}${tab.container ? ' / ' + tab.container : ''}`, 'sys')
    })

    ws.addEventListener('message', e => {
      let msg
      try { msg = JSON.parse(e.data) } catch (_) { return }
      if (msg.type === 'log') {
        _appendLog(tab, msg.data, msg.pod)
      } else if (msg.type === 'error') {
        flushLogBuffers(tab)
        store.pushLine(tab, '✖ ' + msg.data, 'err')
      } else if (msg.type === 'done') {
        flushLogBuffers(tab)
        tab.streaming = false
        store.pushLine(tab, '■ Stream ended', 'sys')
      }
    })

    ws.addEventListener('close', () => {
      if (tab.ws !== ws) return
      flushLogBuffers(tab)
      tab.ws = null
      tab.streaming = false
    })

    ws.addEventListener('error', () => {
      store.pushLine(tab, '✖ WebSocket connection error', 'err')
      tab.streaming = false
    })
  }

  function startExecStream(tab) {
    store.stopStream(tab)
    tab.streaming = true

    const ws = markRaw(new WebSocket(wsUrl('/ws/exec')))
    tab.ws = ws

    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({
        action:    'start',
        namespace: tab.ns,
        pod:       tab.pod,
        container: tab.container || null,
      }))
    })

    ws.addEventListener('message', e => {
      let msg
      try { msg = JSON.parse(e.data) } catch (_) { return }
      if (msg.type === 'connected') {
        store.pushLine(tab, `▶ Shell ${tab.pod}${tab.container ? ' / ' + tab.container : ''}`, 'sys')
      } else if (msg.type === 'out') {
        _appendRaw(tab, msg.data, '')
      } else if (msg.type === 'err') {
        _appendRaw(tab, msg.data, 'err')
      } else if (msg.type === 'error') {
        store.pushLine(tab, '✖ ' + msg.data, 'err')
        tab.streaming = false
      } else if (msg.type === 'done') {
        tab.streaming = false
        store.pushLine(tab, '■ Session ended', 'sys')
      }
    })

    ws.addEventListener('close', () => {
      if (tab.ws !== ws) return
      tab.ws = null
      tab.streaming = false
    })

    ws.addEventListener('error', () => {
      store.pushLine(tab, '✖ WebSocket error', 'err')
      tab.streaming = false
    })
  }

  function _appendLog(tab, raw, sourcePod = null) {
    const key = sourcePod || '__default__'
    const buffers = tab._logBuffers || (tab._logBuffers = {})
    const clean = normalizeTerminalText(raw)
    const text = `${buffers[key] || ''}${clean}`
    const lines = text.split('\n')
    buffers[key] = lines.pop() || ''
    lines.forEach(line => pushLogLine(tab, line, sourcePod))
  }

  function pushLogLine(tab, line, sourcePod = null) {
    if (!line.trim()) return
    const text = sourcePod && tab.resourceType !== 'pods' ? `[${sourcePod}] ${line}` : line
    let cls = ''
    if (/error|exception|fatal|panic/i.test(text)) cls = 'err'
    else if (/warn/i.test(text)) cls = 'warn'
    else if (/\b(info|debug|log)\b/i.test(text)) cls = 'info'
    store.pushLine(tab, text, cls)
  }

  function flushLogBuffers(tab) {
    const buffers = tab._logBuffers || {}
    Object.entries(buffers).forEach(([key, pending]) => {
      if (pending) pushLogLine(tab, pending, key === '__default__' ? null : key)
    })
    tab._logBuffers = {}
  }

  function _appendRaw(tab, raw, cls) {
    const clean = normalizeTerminalText(raw)
    clean.split('\n').forEach(line => {
      if (!line) return
      // Auto-classify if no class was forced
      const lineCls = cls || autoClassify(line)
      store.pushLine(tab, line, lineCls)
    })
  }

  /** Classify a shell output line by content patterns */
  function autoClassify(line) {
    const l = line.toLowerCase()
    if (/error|exception|fail(ed)?|fatal|panic|denied|not found|no such/i.test(l)) return 'err'
    if (/warn(ing)?/i.test(l)) return 'warn'
    if (/\b(ok|done|success(ful)?|complete|passed|running|ready)\b/i.test(l)) return 'ok'
    return ''
  }

  function normalizeTerminalText(raw = '') {
    return String(raw)
      .replace(/\x1b\[[\x30-\x3F]*[\x20-\x2F]*[\x40-\x7E]/g, '')
      .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '')
      .replace(/\x1b[()][A-B0-9]/g, '')
      .replace(/\x1b[@-_]/g, '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
  }

  /** Connect to the local shell WebSocket (/ws/shell) */
  function startLocalStream(tab) {
    store.stopStream(tab)
    tab.streaming = true

    const ws = markRaw(new WebSocket(wsUrl('/ws/shell')))
    tab.ws = ws

    ws.addEventListener('open', () => {
      store.pushLine(tab, '▶ Connecting to local shell…', 'sys')
    })

    ws.addEventListener('message', e => {
      let msg
      try { msg = JSON.parse(e.data) } catch (_) { return }
      if (msg.type === 'connected') {
        store.pushLine(tab, `▶ ${msg.shell}  |  cwd: ${msg.cwd}`, 'sys')
        tab.label = 'Local Shell'
        tab.streaming = true
        // Signal initial CWD to file browser
        tab.cwd = msg.cwd
      } else if (msg.type === 'cwd') {
        // Shell changed directory — update reactive CWD on the tab
        tab.cwd = msg.path
      } else if (msg.type === 'out') {
        _appendRaw(tab, msg.data, '')
      } else if (msg.type === 'err') {
        _appendRaw(tab, msg.data, 'err')
      } else if (msg.type === 'error') {
        store.pushLine(tab, '✖ ' + msg.data, 'err')
        tab.streaming = false
      } else if (msg.type === 'done') {
        tab.streaming = false
        store.pushLine(tab, `■ Session ended (exit ${msg.code})`, 'sys')
      }
    })

    ws.addEventListener('close', () => {
      if (tab.ws !== ws) return
      tab.ws = null
      tab.streaming = false
    })

    ws.addEventListener('error', () => {
      store.pushLine(tab, '✖ WebSocket error', 'err')
      tab.streaming = false
    })
  }

  return { startLogStream, startExecStream, startLocalStream }
}
