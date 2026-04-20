/**
 * stores/useGcpStore.js
 * Pinia store for Google Cloud Platform resources.
 *
 * Each tab has its own { data, loading, error } state so a PERMISSION_DENIED
 * on one API does not block the others from loading.
 */
import { defineStore } from 'pinia'
import { ref, reactive } from 'vue'
import { useApi } from '../composables/useApi'

// Extract the "enable API" URL from a PERMISSION_DENIED gRPC error message.
function extractEnableUrl(msg) {
  const m = msg?.match(/https:\/\/console\.developers\.google\.com\/apis\/api\/[^\s]+/)
  return m ? m[0] : null
}

function makeTab() {
  return reactive({ data: [], loading: false, error: null, enableUrl: null })
}

export const useGcpStore = defineStore('gcp', () => {
  const { apiFetch } = useApi()

  // ─── State ──────────────────────────────────────────────────────────────────
  const activeProfileId = ref(null)

  const tabs = reactive({
    cloudrun:  makeTab(),
    gke:       makeTab(),
    vms:       makeTab(),
    sql:       makeTab(),
    storage:   makeTab(),
    functions: makeTab(),
    pubsub:    makeTab(),
  })

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  function headers() {
    if (!activeProfileId.value) throw new Error('No GCP profile selected')
    return { 'X-Profile-Id': activeProfileId.value }
  }

  function resetTab(tab) {
    tab.data     = []
    tab.loading  = false
    tab.error    = null
    tab.enableUrl = null
  }

  async function fetchTab(tab, url) {
    tab.loading  = true
    tab.error    = null
    tab.enableUrl = null
    try {
      tab.data = await apiFetch(url, { headers: headers() })
    } catch (e) {
      tab.error    = e.message
      tab.enableUrl = extractEnableUrl(e.message)
    } finally {
      tab.loading = false
    }
  }

  // ─── Actions ─────────────────────────────────────────────────────────────────

  function setActiveProfile(id) {
    activeProfileId.value = id
    Object.values(tabs).forEach(resetTab)
  }

  function fetchCloudRunServices() { return fetchTab(tabs.cloudrun,  '/api/cloud/gcp/cloudrun') }
  function fetchGkeClusters()      { return fetchTab(tabs.gke,       '/api/cloud/gcp/gke') }
  function fetchVMs()              { return fetchTab(tabs.vms,       '/api/cloud/gcp/compute/vms') }
  function fetchSqlInstances()     { return fetchTab(tabs.sql,       '/api/cloud/gcp/sql') }
  function fetchBuckets()          { return fetchTab(tabs.storage,   '/api/cloud/gcp/storage/buckets') }
  function fetchFunctions()        { return fetchTab(tabs.functions, '/api/cloud/gcp/functions') }
  function fetchPubSubTopics()     { return fetchTab(tabs.pubsub,    '/api/cloud/gcp/pubsub/topics') }

  async function startCloudRunService(region, service) {
    try {
      return await apiFetch(`/api/cloud/gcp/cloudrun/${region}/${service}/start`, {
        method: 'POST', headers: headers(),
      })
    } catch (e) { tabs.cloudrun.error = e.message; return null }
  }

  async function stopCloudRunService(region, service) {
    try {
      return await apiFetch(`/api/cloud/gcp/cloudrun/${region}/${service}/stop`, {
        method: 'POST', headers: headers(),
      })
    } catch (e) { tabs.cloudrun.error = e.message; return null }
  }

  async function startVM(zone, name) {
    try {
      return await apiFetch(`/api/cloud/gcp/compute/vms/${zone}/${name}/start`, {
        method: 'POST', headers: headers(),
      })
    } catch (e) { tabs.vms.error = e.message; return null }
  }

  async function stopVM(zone, name) {
    try {
      return await apiFetch(`/api/cloud/gcp/compute/vms/${zone}/${name}/stop`, {
        method: 'POST', headers: headers(),
      })
    } catch (e) { tabs.vms.error = e.message; return null }
  }

  async function startSqlInstance(name) {
    try {
      return await apiFetch(`/api/cloud/gcp/sql/${name}/start`, {
        method: 'POST', headers: headers(),
      })
    } catch (e) { tabs.sql.error = e.message; return null }
  }

  async function stopSqlInstance(name) {
    try {
      return await apiFetch(`/api/cloud/gcp/sql/${name}/stop`, {
        method: 'POST', headers: headers(),
      })
    } catch (e) { tabs.sql.error = e.message; return null }
  }

  // Computed shortcuts for templates
  const cloudRunServices = { get value() { return tabs.cloudrun.data } }
  const gkeClusters      = { get value() { return tabs.gke.data } }
  const vms              = { get value() { return tabs.vms.data } }

  return {
    activeProfileId, tabs,
    cloudRunServices, gkeClusters, vms,
    setActiveProfile,
    fetchCloudRunServices, fetchGkeClusters, fetchVMs,
    fetchSqlInstances, fetchBuckets, fetchFunctions, fetchPubSubTopics,
    startCloudRunService, stopCloudRunService,
    startVM, stopVM,
    startSqlInstance, stopSqlInstance,
  }
})
