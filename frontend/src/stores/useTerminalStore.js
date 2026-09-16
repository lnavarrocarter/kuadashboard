import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { capabilityRegistry, sessionDescriptor } from '../shared/consoleSession.mjs'

export const TERMINAL_MAX_LINES = 5000

// Persisted state (#40): tab descriptors, order, active tab and preferences survive a
// reload; live connections and raw output never do. Restored tabs always come back
// disconnected — nothing here ever silently reopens a remote session.
const TABS_STORAGE_KEY = 'kua:console:tabs'
const HISTORY_STORAGE_KEY = 'kua:console:history'
const STORAGE_VERSION = 1
const HISTORY_MAX_PER_TARGET = 200
const HISTORY_MAX_TARGETS = 50

// Only descriptor-ish fields are persisted. Never: ws, entries, lines, _logBuffers,
// _connectionAttempt, cwd, streaming, connectionState (recomputed as 'idle' on restore),
// capabilities (recomputed from the registry, not stored).
const PERSISTED_TAB_FIELDS = [
  'id', 'type', 'context', 'label', 'provider', 'environment', 'applicationId', 'profileId',
  'region', 'project', 'kubeContext', 'target', 'transport', 'ns', 'pod', 'resourceType',
  'containers', 'container', 'selectedPod',
]

function serializeTab(tab) {
  const out = {}
  for (const key of PERSISTED_TAB_FIELDS) out[key] = tab[key]
  return out
}

function restoreTab(saved) {
  return {
    ...saved,
    capabilities: capabilityRegistry.filter(c => c.provider === saved.provider).map(c => c.id),
    connectionState: 'idle',
    ws: null, lines: [], entries: [], lineCount: 0, streaming: false,
    logPods: saved.logPods || [],
  }
}

function loadPersistedTabs() {
  const empty = { tabs: [], activeId: null, wrap: false, height: 280, visible: false }
  try {
    const raw = JSON.parse(localStorage.getItem(TABS_STORAGE_KEY) || 'null')
    if (!raw || raw.version !== STORAGE_VERSION || !Array.isArray(raw.tabs)) return empty
    const tabs = raw.tabs.map(restoreTab)
    return {
      tabs,
      activeId: tabs.some(t => t.id === raw.activeId) ? raw.activeId : (tabs[0]?.id ?? null),
      wrap: Boolean(raw.wrap),
      height: Number.isFinite(raw.height) ? raw.height : 280,
      visible: Boolean(tabs.length),
    }
  } catch (_) {
    return empty
  }
}

function loadPersistedHistory() {
  try {
    const raw = JSON.parse(localStorage.getItem(HISTORY_STORAGE_KEY) || 'null')
    return raw && raw.version === STORAGE_VERSION && raw.entries && typeof raw.entries === 'object' ? raw.entries : {}
  } catch (_) {
    return {}
  }
}

function targetKeyFor(tab) {
  if (tab.provider === 'kubernetes') return `kubernetes:${tab.kubeContext || ''}:${tab.ns || ''}:${tab.resourceType || 'pods'}:${tab.container || ''}`
  if (tab.provider === 'local') return `local:${tab.environment || 'default'}:${tab.applicationId || ''}`
  if (tab.target?.host) return `${tab.type}:${tab.target.host}:${tab.target.user || ''}:${tab.profileId || ''}`
  return `${tab.provider || 'unknown'}:${tab.id}`
}

export const useTerminalStore = defineStore('terminal', () => {
  const restored = loadPersistedTabs()
  const tabs     = ref(restored.tabs)   // [{ id, ns, pod, containers, container, ws, lines, lineCount, streaming, type }]
  const activeId = ref(restored.activeId)
  const visible  = ref(restored.visible)
  const wrap     = ref(restored.wrap)
  const height   = ref(restored.height)
  const history  = ref(loadPersistedHistory())
  let tabSeq = 0

  function persistTabsNow() {
    try {
      localStorage.setItem(TABS_STORAGE_KEY, JSON.stringify({
        version: STORAGE_VERSION,
        tabs: tabs.value.map(serializeTab),
        activeId: activeId.value,
        wrap: wrap.value,
        height: height.value,
      }))
    } catch (_) {}
  }

  let persistTimer = null
  function schedulePersistTabs() {
    clearTimeout(persistTimer)
    persistTimer = setTimeout(persistTabsNow, 400)
  }
  // Preferences change on every resize-drag pixel/keystroke — debounce those; discrete
  // tab actions (open/close/activate) call persistTabsNow() directly, immediately.
  watch([wrap, height], schedulePersistTabs)

  function persistHistoryNow() {
    try {
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION, entries: history.value }))
    } catch (_) {}
  }

  function nextTabId() {
    tabSeq += 1
    return `tab-${Date.now()}-${tabSeq}`
  }

  function activeTab() {
    return tabs.value.find(t => t.id === activeId.value) || null
  }

  function openLogsTab(ns, pod, containers, resourceType = 'pods', context = {}) {
    const descriptor = sessionDescriptor({ ...context, provider: 'kubernetes', transport: 'logs', target: { namespace: ns, name: pod, resourceType } })
    const existing = tabs.value.find(t => t.pod === pod && t.ns === ns && t.type === 'log' && t.resourceType === resourceType
      && t.kubeContext === descriptor.kubeContext
      && t.environment === descriptor.environment && t.applicationId === descriptor.applicationId)
    if (existing) { activateTab(existing.id); return existing }
    const isPod = resourceType === 'pods'
    const tab = {
      ...descriptor,
      id: nextTabId(),
      type: 'log', context: 'pod', resourceType, ns, pod,
      label: `${pod} (${isPod ? 'logs' : `${resourceType} logs`})`,
      containers: containers || [],
      container: containers?.[0] || null,
      logPods: [], selectedPod: '',
      ws: null, lines: [], entries: [], lineCount: 0, streaming: false
    }
    tabs.value.push(tab)
    visible.value = true
    activateTab(tab.id)
    persistTabsNow()
    return tabs.value.find(t => t.id === tab.id)
  }

  function openExecTab(ns, pod, containers, context = {}) {
    const tab = {
      ...sessionDescriptor({ ...context, provider: 'kubernetes', transport: 'exec', target: { namespace: ns, name: pod, resourceType: 'pods' } }),
      id: nextTabId(),
      type: 'exec', context: 'pod', ns, pod,
      label: pod,
      containers: containers || [],
      container: containers?.[0] || null,
      ws: null, lines: [], entries: [], lineCount: 0, streaming: false
    }
    tabs.value.push(tab)
    visible.value = true
    activateTab(tab.id)
    persistTabsNow()
    return tabs.value.find(t => t.id === tab.id)
  }

  /** Open a local shell tab (connects to /ws/shell) */
  function openLocalTab(context = {}) {
    const descriptor = sessionDescriptor({ ...context, provider: 'local', transport: 'shell' })
    // Reuse existing idle local tab if available
    const existing = tabs.value.find(t => t.type === 'local' && !t.streaming && t.environment === descriptor.environment && t.applicationId === descriptor.applicationId)
    if (existing) { activateTab(existing.id); visible.value = true; return existing }
    const tab = {
      ...descriptor,
      id: nextTabId(),
      type: 'local', context: 'local',
      label: 'Local Shell',
      pod: 'local',
      containers: [], container: null,
      ws: null, lines: [], entries: [], lineCount: 0, streaming: false
    }
    tabs.value.push(tab)
    visible.value = true
    activateTab(tab.id)
    persistTabsNow()
    return tabs.value.find(t => t.id === tab.id)
  }

  /** Open a cloud shell tab (future: AWS SSM, GCP Cloud Shell, etc.) */
  function openCloudTab(contextType, label, meta = {}) {
    const aliases = { ec2: ['aws', 'ssh'], ssm: ['aws', 'ssm'], gcp: ['gcp', 'cloud-shell'], vercel: ['vercel', 'deployment-logs'] }
    const [provider, transport] = aliases[contextType] || [contextType, meta.transport]
    const descriptor = sessionDescriptor({ ...meta, provider, transport, target: meta.target || { instanceId: meta.instanceId } })
    if (descriptor.target.host) {
      const existing = tabs.value.find(t => t.type === contextType && t.target?.host === descriptor.target.host
        && t.target?.user === descriptor.target.user && t.profileId === descriptor.profileId)
      if (existing) { activateTab(existing.id); visible.value = true; return existing }
    }
    const tab = {
      ...descriptor,
      id: nextTabId(),
      type: contextType, context: contextType,
      label,
      pod: label,
      containers: [], container: null,
      meta: descriptor,
      ws: null, lines: [], entries: [], lineCount: 0, streaming: false
    }
    tabs.value.push(tab)
    visible.value = true
    activateTab(tab.id)
    persistTabsNow()
    return tabs.value.find(t => t.id === tab.id)
  }

  function activateTab(id) {
    activeId.value = id
    persistTabsNow()
  }

  function closeTab(id) {
    const idx = tabs.value.findIndex(t => t.id === id)
    if (idx === -1) return
    const tab = tabs.value[idx]
    stopStream(tab)
    tabs.value.splice(idx, 1)
    if (!tabs.value.length) {
      visible.value = false
      activeId.value = null
    } else {
      activateTab(tabs.value[Math.min(idx, tabs.value.length - 1)].id)
    }
    persistTabsNow()
  }

  /** Remove any tab the given predicate rejects (e.g. its profile/context no longer
   * exists) without blocking startup — called once the relevant list has loaded. */
  function pruneStaleTabs(isValid) {
    const stale = tabs.value.filter(tab => !isValid(tab))
    if (!stale.length) return
    for (const tab of stale) closeTab(tab.id)
  }

  function stopStream(tab) {
    tab._connectionAttempt = (tab._connectionAttempt || 0) + 1
    if (tab.ws) {
      try { tab.ws.send(JSON.stringify({ action: 'stop' })) } catch (_) {}
      try { tab.ws.close() } catch (_) {}
      tab.ws = null
    }
    tab.streaming = false
    tab.connectionState = 'stopped'
  }

  function pushLine(tab, text, cls = '') {
    const now = new Date()
    const ts  = `${now.toTimeString().slice(0, 8)}.${String(now.getMilliseconds()).padStart(3, '0')}`
    const escaped = text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    const html = `<div class="term-line${cls ? ' '+cls : ''}"><span class="ts">${ts}</span>${escaped}</div>`
    if (!tab.entries) tab.entries = []
    tab.entries.push({ ts, time: now.getTime(), text, cls, html, serializedAt: parseSerializedDate(text) })
    tab.lines.push(html)
    const overflow = tab.entries.length - TERMINAL_MAX_LINES
    if (overflow > 0) {
      tab.entries.splice(0, overflow)
      tab.lines.splice(0, overflow)
    }
    tab.lineCount = tab.entries.length
    return html
  }

  function parseSerializedDate(text) {
    const raw = String(text || '')
    const iso = raw.match(/\b(\d{4}-\d{2}-\d{2})[T\s](\d{2}:\d{2}:\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\b/)
    if (iso) {
      const date = new Date(iso[0])
      if (!Number.isNaN(date.getTime())) return date.getTime()
    }
    const local = raw.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s+(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)?\b/i)
    if (!local) return null
    let [, month, day, year, hour, minute, second, meridiem] = local
    let h = Number(hour)
    if (meridiem) {
      const upper = meridiem.toUpperCase()
      if (upper === 'PM' && h < 12) h += 12
      if (upper === 'AM' && h === 12) h = 0
    }
    const date = new Date(Number(year), Number(month) - 1, Number(day), h, Number(minute), Number(second))
    return Number.isNaN(date.getTime()) ? null : date.getTime()
  }

  // ── Per-target command history (#40) ─────────────────────────────────────────
  function pushHistory(tab, cmd) {
    if (!cmd || !cmd.trim()) return
    const key = targetKeyFor(tab)
    const entry = history.value[key] || { commands: [], lastUsed: 0 }
    entry.commands.unshift(cmd)
    if (entry.commands.length > HISTORY_MAX_PER_TARGET) entry.commands.length = HISTORY_MAX_PER_TARGET
    entry.lastUsed = Date.now()
    history.value[key] = entry
    const keys = Object.keys(history.value)
    if (keys.length > HISTORY_MAX_TARGETS) {
      const oldest = keys.sort((a, b) => history.value[a].lastUsed - history.value[b].lastUsed)[0]
      delete history.value[oldest]
    }
    persistHistoryNow()
  }

  function historyFor(tab) {
    return history.value[targetKeyFor(tab)]?.commands || []
  }

  function clearHistory(tab) {
    delete history.value[targetKeyFor(tab)]
    persistHistoryNow()
  }

  function clearAllHistory() {
    history.value = {}
    try { localStorage.removeItem(HISTORY_STORAGE_KEY) } catch (_) {}
  }

  return {
    tabs, activeId, visible, wrap, height, capabilityRegistry, history,
    activeTab, openLogsTab, openExecTab, openLocalTab, openCloudTab,
    activateTab, closeTab, stopStream, pushLine, pruneStaleTabs,
    pushHistory, historyFor, clearHistory, clearAllHistory,
  }
})
