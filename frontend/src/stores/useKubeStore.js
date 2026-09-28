import { acceptHMRUpdate, defineStore } from 'pinia'
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
  // Last rows seen per context/namespace/resource, so returning to a visited
  // resource paints instantly while it revalidates in the background.
  const rowsCache = new Map()
  let rowsKey = null

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

  function resourceUrl(targetResource, targetNamespace) {
    if (CLUSTER_RESOURCES.has(targetResource)) return `/api/${targetResource}`
    if (targetResource === 'events') return `/api/${targetNamespace}/events`
    return `/api/${targetNamespace}/${targetResource}`
  }

  async function loadResources({ silent = false, background = false, force = false } = {}) {
    const requestId = ++resourceRequestId
    const targetResource = resource.value
    const targetNamespace = namespace.value
    const url = resourceUrl(targetResource, targetNamespace)
    const key = `${currentContext.value}\u0000${url}`
    const cached = rowsCache.get(key)
    // Rows present before the first load belong to the current target.
    const adopting = rowsKey === null && rows.value.length > 0
    const switching = rowsKey !== key && !adopting
    if (switching) rows.value = cached ? cached.rows : []
    rowsKey = key
    // Block the table only when there is nothing to show for the target.
    const blocking = !cached && (!silent || switching)
    if (blocking) loading.value = true
    else if (!background) refreshing.value = true
    error.value = null
    try {
      const nextRows = await api('GET', force ? `${url}?refresh=1` : url)
      // Serialize only the incoming payload; the cached signature stands in
      // for the current rows, so unchanged polls keep row identity cheaply.
      const signature = JSON.stringify(nextRows)
      let entry = rowsCache.get(key)
      if (entry?.signature !== signature) {
        entry = { rows: nextRows, signature }
        rowsCache.set(key, entry)
      }
      if (requestId !== resourceRequestId || rows.value === entry.rows) return
      if (JSON.stringify(rows.value) === signature) entry.rows = rows.value
      else rows.value = entry.rows
    } catch (e) {
      if (requestId !== resourceRequestId) return
      if (silent && !blocking) return
      rows.value  = []
      error.value = e.message
    } finally {
      if (requestId === resourceRequestId) {
        loading.value = false
        refreshing.value = false
      }
    }
  }

  function selectResource(name) {
    resource.value = name
    return loadResources({ silent: true })
  }

  return {
    resource, namespace, rows, contexts, currentContext,
    namespaces, loading, refreshing, error, pending,
    loadContexts, switchContext, deleteContext,
    loadNamespaces, loadResources, selectResource,
  }
})

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useKubeStore, import.meta.hot))
}
