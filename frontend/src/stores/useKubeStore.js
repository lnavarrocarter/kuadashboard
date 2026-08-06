import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '../composables/useApi'

const CLUSTER_RESOURCES = new Set([
  'nodes', 'namespaces', 'pvs', 'storageclasses', 'ingressclasses',
  'priorityclasses', 'runtimeclasses', 'mutatingwebhookconfigurations',
  'validatingwebhookconfigurations',
])

export const useKubeStore = defineStore('kube', () => {
  // ── State ──────────────────────────────────────────────────────────────────
  const resource  = ref('pods')
  const namespace = ref('default')
  const rows      = ref([])
  const contexts  = ref([])
  const currentContext = ref('')
  const namespaces = ref([])
  const loading   = ref(false)
  const refreshing = ref(false)
  const error     = ref(null)
  let resourceRequestId = 0

  // pending confirmations
  const pending = ref({ delete: null, scale: null, drain: null, deleteContext: null })

  // ── Actions ────────────────────────────────────────────────────────────────
  async function loadContexts() {
    try {
      const data = await api('GET', '/api/contexts')
      contexts.value = data.contexts
      currentContext.value = data.current
      // Initialize namespace from active context (respects kubeconfig namespace field)
      const activeCtx = data.contexts.find(c => c.name === data.current)
      if (activeCtx?.namespace && activeCtx.namespace !== namespace.value) {
        namespace.value = activeCtx.namespace
      }
    } catch (e) {
      error.value = e.message
    }
  }

  async function switchContext(name) {
    await api('POST', '/api/contexts/switch', { context: name })
    currentContext.value = name
    await loadNamespaces()
    // Apply context's preferred namespace only if it exists on the cluster
    const ctx = contexts.value.find(c => c.name === name)
    const ctxNs = ctx?.namespace
    if (ctxNs && namespaces.value.includes(ctxNs)) {
      namespace.value = ctxNs
    }
    await loadResources()
  }

  async function deleteContext(name) {
    await api('DELETE', '/api/contexts/' + encodeURIComponent(name))
    await loadContexts()
  }

  async function loadNamespaces() {
    try {
      const list = await api('GET', '/api/namespaces')
      const names = list.map(n => n.name)
      if (!names.includes('default')) names.unshift('default')
      else { names.splice(names.indexOf('default'), 1); names.unshift('default') }
      namespaces.value = names
      if (!names.includes(namespace.value)) namespace.value = 'default'
    } catch (e) {
      error.value = e.message
    }
  }

  async function loadResources({ silent = false, background = false, force = false } = {}) {
    const requestId = ++resourceRequestId
    const targetResource = resource.value
    const targetNamespace = namespace.value
    if (silent) {
      if (!background) refreshing.value = true
    } else loading.value = true
    error.value = null
    try {
      let url
      if (CLUSTER_RESOURCES.has(targetResource)) url = `/api/${targetResource}`
      else if (targetResource === 'events') url = `/api/${targetNamespace}/events`
      else url = `/api/${targetNamespace}/${targetResource}`
      if (force) url += '?refresh=1'
      const nextRows = await api('GET', url)
      if (requestId !== resourceRequestId) return
      if (JSON.stringify(nextRows) !== JSON.stringify(rows.value)) rows.value = nextRows
    } catch (e) {
      if (requestId !== resourceRequestId) return
      if (silent) return
      rows.value  = []
      error.value = e.message
    } finally {
      if (requestId === resourceRequestId) {
        loading.value = false
        refreshing.value = false
      }
    }
  }

  return {
    resource, namespace, rows, contexts, currentContext,
    namespaces, loading, refreshing, error, pending,
    loadContexts, switchContext, deleteContext,
    loadNamespaces, loadResources,
  }
})
