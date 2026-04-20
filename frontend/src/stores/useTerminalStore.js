import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useTerminalStore = defineStore('terminal', () => {
  const tabs     = ref([])   // [{ id, ns, pod, containers, container, ws, lines, lineCount, streaming, type }]
  const activeId = ref(null)
  const visible  = ref(false)
  const wrap     = ref(false)
  const height   = ref(280)

  function activeTab() {
    return tabs.value.find(t => t.id === activeId.value) || null
  }

  function openLogsTab(ns, pod, containers) {
    const existing = tabs.value.find(t => t.pod === pod && t.ns === ns && t.type === 'log')
    if (existing) { activateTab(existing.id); return existing }
    const tab = {
      id: `tab-${Date.now()}`,
      type: 'log', context: 'pod', ns, pod,
      label: `${pod} (logs)`,
      containers: containers || [],
      container: containers?.[0] || null,
      ws: null, lines: [], lineCount: 0, streaming: false
    }
    tabs.value.push(tab)
    visible.value = true
    activateTab(tab.id)
    return tabs.value.find(t => t.id === tab.id)
  }

  function openExecTab(ns, pod, containers) {
    const tab = {
      id: `tab-${Date.now()}`,
      type: 'exec', context: 'pod', ns, pod,
      label: pod,
      containers: containers || [],
      container: containers?.[0] || null,
      ws: null, lines: [], lineCount: 0, streaming: false
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
      id: `tab-${Date.now()}`,
      type: 'local', context: 'local',
      label: 'Local Shell',
      pod: 'local',
      containers: [], container: null,
      ws: null, lines: [], lineCount: 0, streaming: false
    }
    tabs.value.push(tab)
    visible.value = true
    activateTab(tab.id)
    return tabs.value.find(t => t.id === tab.id)
  }

  /** Open a cloud shell tab (future: AWS SSM, GCP Cloud Shell, etc.) */
  function openCloudTab(contextType, label, meta = {}) {
    const tab = {
      id: `tab-${Date.now()}`,
      type: contextType, context: contextType,
      label,
      pod: label,
      containers: [], container: null,
      meta,  // extra info like instanceId, region, projectId
      ws: null, lines: [], lineCount: 0, streaming: false
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
    tab.lines.push(html)
    tab.lineCount++
    return html
  }

  return {
    tabs, activeId, visible, wrap, height,
    activeTab, openLogsTab, openExecTab, openLocalTab, openCloudTab,
    activateTab, closeTab, stopStream, pushLine,
  }
})
