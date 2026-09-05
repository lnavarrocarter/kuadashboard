import { markRaw } from 'vue'
import { useTerminalStore } from '../stores/useTerminalStore'
import { prepareConsoleConnection } from './consoleConnection'

export function useTerminalStreams() {
  const store     = useTerminalStore()

  async function connect(tab) {
    store.stopStream(tab)
    const attempt = tab._connectionAttempt
    tab.connectionState = 'validating'
    try {
      const prepared = await prepareConsoleConnection({
        ...tab,
        target: tab.provider === 'kubernetes'
          ? { namespace: tab.ns, name: tab.pod, resourceType: tab.resourceType || 'pods', container: tab.container, selectedPod: tab.selectedPod }
          : tab.target,
      })
      if (tab._connectionAttempt !== attempt) return null
      Object.assign(tab, prepared.session)
      tab.connectionState = 'connecting'
      const ws = markRaw(new WebSocket(prepared.url))
      tab.ws = ws
      tab.streaming = true
      ws.addEventListener('open', () => { if (tab.ws === ws) tab.connectionState = 'connected' })
      ws.addEventListener('close', () => { if (tab.ws === ws) tab.connectionState = 'closed' })
      ws.addEventListener('error', () => { if (tab.ws === ws) tab.connectionState = 'error' })
      ws.addEventListener('message', e => {
        if (tab.ws !== ws) return
        try {
          const msg = JSON.parse(e.data)
          if (msg.type === 'error') tab.connectionState = 'error'
          if (msg.type === 'done') tab.connectionState = 'closed'
        } catch (_) {}
      })
      return ws
    } catch (_) {
      if (tab._connectionAttempt !== attempt) return null
      tab.connectionState = 'error'
      store.pushLine(tab, '✖ Invalid console context or credentials', 'err')
      return null
    }
  }

  async function startLogStream(tab, previous = false) {
    const ws = await connect(tab)
    if (!ws) return
    const targetContext = tab.target
    tab._logBuffers = {}

    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({
        action: 'start',
        namespace:  targetContext.namespace,
        pod:        targetContext.name,
        resourceType: targetContext.resourceType || 'pods',
        container:  targetContext.container || null,
        selectedPod: targetContext.selectedPod || null,
        previous: Boolean(previous),
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
      } else if (msg.type === 'targets') {
        tab.logPods = Array.isArray(msg.pods) ? msg.pods : []
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

  async function startExecStream(tab) {
    const ws = await connect(tab)
    if (!ws) return
    const targetContext = tab.target

    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({
        action:    'start',
        namespace: targetContext.namespace,
        pod:       targetContext.name,
        container: targetContext.container || null,
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
  async function startLocalStream(tab) {
    const ws = await connect(tab)
    if (!ws) return

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
