/**
 * stores/useAwsStore.js
 * Pinia store for Amazon Web Services resources.
 *
 * All API calls inject X-Profile-Id from the activeProfileId state.
 * Desktop-ready: apiFetch can be replaced by an Electron IPC adapter.
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { useApi } from '../composables/useApi'

export const useAwsStore = defineStore('aws', () => {
  const { apiFetch } = useApi()

  // ─── State ──────────────────────────────────────────────────────────────────
  const activeProfileId = ref(null)
  const regions         = ref([])
  const eksClusters     = ref([])
  const ecsServices     = ref([])
  const ec2Instances    = ref([])
  const loading         = ref(false)
  const error           = ref(null)

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  function headers() {
    if (!activeProfileId.value) throw new Error('No AWS profile selected')
    return { 'X-Profile-Id': activeProfileId.value }
  }

  function setError(e) { error.value = e.message }

  // ─── Actions ─────────────────────────────────────────────────────────────────

  function setActiveProfile(id) {
    activeProfileId.value = id
    regions.value      = []
    eksClusters.value  = []
    ecsServices.value  = []
    ec2Instances.value = []
  }

  async function fetchRegions() {
    loading.value = true; error.value = null
    try {
      regions.value = await apiFetch('/api/cloud/aws/regions', { headers: headers() })
    } catch (e) { setError(e) } finally { loading.value = false }
  }

  async function fetchEksClusters() {
    loading.value = true; error.value = null
    try {
      eksClusters.value = await apiFetch('/api/cloud/aws/eks', { headers: headers() })
    } catch (e) { setError(e) } finally { loading.value = false }
  }

  async function fetchEcsServices() {
    loading.value = true; error.value = null
    try {
      ecsServices.value = await apiFetch('/api/cloud/aws/ecs', { headers: headers() })
    } catch (e) { setError(e) } finally { loading.value = false }
  }

  async function startEcsService(cluster, service) {
    try {
      return await apiFetch(`/api/cloud/aws/ecs/${cluster}/${service}/start`, {
        method: 'POST', headers: headers(),
      })
    } catch (e) { setError(e); return null }
  }

  async function stopEcsService(cluster, service) {
    try {
      return await apiFetch(`/api/cloud/aws/ecs/${cluster}/${service}/stop`, {
        method: 'POST', headers: headers(),
      })
    } catch (e) { setError(e); return null }
  }

  async function fetchEc2Instances() {
    loading.value = true; error.value = null
    try {
      ec2Instances.value = await apiFetch('/api/cloud/aws/ec2', { headers: headers() })
    } catch (e) { setError(e) } finally { loading.value = false }
  }

  async function startEc2Instance(id) {
    try {
      return await apiFetch(`/api/cloud/aws/ec2/${id}/start`, {
        method: 'POST', headers: headers(),
      })
    } catch (e) { setError(e); return null }
  }

  async function stopEc2Instance(id) {
    try {
      return await apiFetch(`/api/cloud/aws/ec2/${id}/stop`, {
        method: 'POST', headers: headers(),
      })
    } catch (e) { setError(e); return null }
  }

  return {
    activeProfileId, regions, eksClusters, ecsServices, ec2Instances, loading, error,
    setActiveProfile,
    fetchRegions, fetchEksClusters,
    fetchEcsServices, startEcsService, stopEcsService,
    fetchEc2Instances, startEc2Instance, stopEc2Instance,
  }
})
