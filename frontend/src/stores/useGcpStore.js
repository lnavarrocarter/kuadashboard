/**
 * stores/useGcpStore.js
 * Pinia store for Google Cloud Platform resources.
 *
 * All API calls inject X-Profile-Id from the activeProfileId state.
 * Desktop-ready: apiFetch can be replaced by an Electron IPC adapter.
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { useApi } from '../composables/useApi'

export const useGcpStore = defineStore('gcp', () => {
  const { apiFetch } = useApi()

  // ─── State ──────────────────────────────────────────────────────────────────
  const activeProfileId = ref(null)   // UUID of the GCP credential profile in use
  const projects        = ref([])
  const gkeClusters     = ref([])
  const cloudRunServices = ref([])
  const vms             = ref([])
  const loading         = ref(false)
  const error           = ref(null)

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  function headers() {
    if (!activeProfileId.value) throw new Error('No GCP profile selected')
    return { 'X-Profile-Id': activeProfileId.value }
  }

  function setError(e) { error.value = e.message }

  // ─── Actions ─────────────────────────────────────────────────────────────────

  function setActiveProfile(id) {
    activeProfileId.value = id
    // Clear cached data when switching profiles
    projects.value         = []
    gkeClusters.value      = []
    cloudRunServices.value = []
    vms.value              = []
  }

  async function fetchProjects() {
    loading.value = true; error.value = null
    try {
      projects.value = await apiFetch('/api/cloud/gcp/projects', { headers: headers() })
    } catch (e) { setError(e) } finally { loading.value = false }
  }

  async function fetchGkeClusters() {
    loading.value = true; error.value = null
    try {
      gkeClusters.value = await apiFetch('/api/cloud/gcp/gke', { headers: headers() })
    } catch (e) { setError(e) } finally { loading.value = false }
  }

  async function fetchCloudRunServices() {
    loading.value = true; error.value = null
    try {
      cloudRunServices.value = await apiFetch('/api/cloud/gcp/cloudrun', { headers: headers() })
    } catch (e) { setError(e) } finally { loading.value = false }
  }

  async function startCloudRunService(region, service) {
    try {
      return await apiFetch(`/api/cloud/gcp/cloudrun/${region}/${service}/start`, {
        method: 'POST', headers: headers(),
      })
    } catch (e) { setError(e); return null }
  }

  async function stopCloudRunService(region, service) {
    try {
      return await apiFetch(`/api/cloud/gcp/cloudrun/${region}/${service}/stop`, {
        method: 'POST', headers: headers(),
      })
    } catch (e) { setError(e); return null }
  }

  async function fetchVMs() {
    loading.value = true; error.value = null
    try {
      vms.value = await apiFetch('/api/cloud/gcp/compute/vms', { headers: headers() })
    } catch (e) { setError(e) } finally { loading.value = false }
  }

  async function startVM(zone, name) {
    try {
      return await apiFetch(`/api/cloud/gcp/compute/vms/${zone}/${name}/start`, {
        method: 'POST', headers: headers(),
      })
    } catch (e) { setError(e); return null }
  }

  async function stopVM(zone, name) {
    try {
      return await apiFetch(`/api/cloud/gcp/compute/vms/${zone}/${name}/stop`, {
        method: 'POST', headers: headers(),
      })
    } catch (e) { setError(e); return null }
  }

  return {
    activeProfileId, projects, gkeClusters, cloudRunServices, vms, loading, error,
    setActiveProfile,
    fetchProjects, fetchGkeClusters, fetchCloudRunServices,
    startCloudRunService, stopCloudRunService,
    fetchVMs, startVM, stopVM,
  }
})
