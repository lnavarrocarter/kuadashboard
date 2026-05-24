import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useTerminalStore = defineStore('terminal', () => {
  const tabs     = ref([])   // [{ id, ns, pod, containers, container, ws, lines, lineCount, streaming, type }]
  const activeId = ref(null)
  const visible  = ref(false)
  const wrap     = ref(false)
  const height   = ref(280)
  let tabSeq = 0

  function nextTabId() {
    tabSeq += 1
    return `tab-${Date.now()}-${tabSeq}`
  }

  function activeTab() {
    return tabs.value.find(t => t.id === activeId.value) || null
  }

  function openLogsTab(ns, pod, containers, resourceType = 'pods') {
    const existing = tabs.value.find(t => t.pod === pod && t.ns === ns && t.type === 'log' && t.resourceType === resourceType)
    if (existing) { activateTab(existing.id); return existing }
    const isPod = resourceType === 'pods'
    const tab = {
      id: nextTabId(),
      type: 'log', context: 'pod', resourceType, ns, pod,
      label: `${pod} (${isPod ? 'logs' : `${resourceType} logs`})`,
      containers: containers || [],
      container: containers?.[0] || null,
      ws: null, lines: [], entries: [], lineCount: 0, streaming: false
    }
    tabs.value.push(tab)
    visible.value = true
    activateTab(tab.id)
    return tabs.value.find(t => t.id === tab.id)
  }

  function openExecTab(ns, pod, containers) {
    const tab = {
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
    return tabs.value.find(t => t.id === tab.id)
  }

  /** Open a local shell tab (connects to /ws/shell) */
  function openLocalTab() {
    // Reuse existing idle local tab if available
    const existing = tabs.value.find(t => t.type === 'local' && !t.streaming)
    if (existing) { activateTab(existing.id); visible.value = true; return existing }
    const tab = {
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
    return tabs.value.find(t => t.id === tab.id)
  }

  /** Open a cloud shell tab (future: AWS SSM, GCP Cloud Shell, etc.) */
  function openCloudTab(contextType, label, meta = {}) {
    const tab = {
      id: nextTabId(),
      type: contextType, context: contextType,
      label,
      pod: label,
      containers: [], container: null,
      meta,  // extra info like instanceId, region, projectId
      ws: null, lines: [], entries: [], lineCount: 0, streaming: false
    }
    tabs.value.push(tab)
    visible.value = true
    activateTab(tab.id)
    return tabs.value.find(t => t.id === tab.id)
  }

  function activateTab(id) {
    activeId.value = id
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
  }

  function stopStream(tab) {
    if (tab.ws) {
      try { tab.ws.send(JSON.stringify({ action: 'stop' })) } catch (_) {}
      try { tab.ws.close() } catch (_) {}
      tab.ws = null
    }
    tab.streaming = false
  }

  function pushLine(tab, text, cls = '') {
    const now = new Date()
    const ts  = `${now.toTimeString().slice(0, 8)}.${String(now.getMilliseconds()).padStart(3, '0')}`
    const escaped = text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    const html = `<div class="term-line${cls ? ' '+cls : ''}"><span class="ts">${ts}</span>${escaped}</div>`
    if (!tab.entries) tab.entries = []
    tab.entries.push({ ts, time: now.getTime(), text, cls, html, serializedAt: parseSerializedDate(text) })
    tab.lines.push(html)
    tab.lineCount++
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

  return {
    tabs, activeId, visible, wrap, height,
    activeTab, openLogsTab, openExecTab, openLocalTab, openCloudTab,
    activateTab, closeTab, stopStream, pushLine,
  }
})
