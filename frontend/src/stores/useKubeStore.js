import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '../composables/useApi'

export const useKubeStore = defineStore('kube', () => {
  // ── State ──────────────────────────────────────────────────────────────────
  const resource  = ref('pods')
  const namespace = ref('default')
  const rows      = ref([])
  const contexts  = ref([])
  const currentContext = ref('')
  const namespaces = ref([])
  const loading   = ref(false)
  const error     = ref(null)

  // pending confirmations
  const pending = ref({ delete: null, scale: null, drain: null, deleteContext: null })

  // ── Actions ────────────────────────────────────────────────────────────────
  async function loadContexts() {
    try {
      const data = await api('GET', '/api/contexts')
      contexts.value = data.contexts
      currentContext.value = data.current
    } catch (e) {
      error.value = e.message
    }
  }

  async function switchContext(name) {
    await api('POST', '/api/contexts/switch', { context: name })
    currentContext.value = name
    await loadNamespaces()
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

  async function loadResources() {
    loading.value = true
    error.value   = null
    try {
      let url
      if (resource.value === 'nodes')  url = '/api/nodes'
      else if (resource.value === 'events') url = `/api/${namespace.value}/events`
      else url = `/api/${namespace.value}/${resource.value}`
      rows.value = await api('GET', url)
    } catch (e) {
      rows.value  = []
      error.value = e.message
    } finally {
      loading.value = false
    }
  }

  return {
    resource, namespace, rows, contexts, currentContext,
    namespaces, loading, error, pending,
    loadContexts, switchContext, deleteContext,
    loadNamespaces, loadResources,
  }
})
