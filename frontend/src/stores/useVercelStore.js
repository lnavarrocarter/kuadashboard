/**
 * stores/useVercelStore.js
 * Pinia store for Vercel resources.
 *
 * Follows the flat-state pattern of useAwsStore.js.
 * All API calls inject X-Profile-Id from activeProfileId.
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { useApi } from '../composables/useApi'

export const useVercelStore = defineStore('vercel', () => {
  const { apiFetch: request } = useApi()
  let backgroundRequests = 0
  let projectChangeRequestId = 0

  // ─── State ──────────────────────────────────────────────────────────────────
  const activeProfileId = ref(null)
  const teams           = ref([])
  const projects        = ref([])
  const selectedProject = ref(null)   // { id, name, ... }
  const deployments     = ref([])
  const domains         = ref([])
  const envVars         = ref([])
  const functions       = ref([])
  const checks          = ref([])
  const events          = ref([])
  const aliases         = ref([])
  const webhooks        = ref([])
  const edgeConfigs     = ref([])
  const edgeConfigItems = ref([])
  const dnsRecords      = ref([])
  const cronJobs        = ref([])
  const selectedDomain      = ref(null)
  const selectedEdgeConfig  = ref(null)
  const selectedDeploymentForFunctions = ref(null)
  const selectedDeploymentForChecks    = ref(null)
  const logsDeployment                 = ref(null)
  const deploymentTarget               = ref('')
  const loading         = ref(false)
  const error           = ref(null)

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  function headers() {
    if (!activeProfileId.value) throw new Error('No Vercel profile selected')
    return { 'X-Profile-Id': activeProfileId.value }
  }

  function setError(e) { error.value = e?.message || String(e) }

  function shouldIgnoreResponse(requestId) {
    return requestId !== projectChangeRequestId
  }

  function apiFetch(path, options = {}) {
    return request(path, {
      ...options,
      background: backgroundRequests > 0,
      stabilize: true,
    })
  }

  async function runInBackground(callback) {
    backgroundRequests += 1
    try {
      const pending = callback()
      loading.value = false
      return await pending
    } finally {
      backgroundRequests -= 1
      loading.value = false
    }
  }

  // ─── Actions ─────────────────────────────────────────────────────────────────

  function setActiveProfile(id) {
    projectChangeRequestId++
    activeProfileId.value = id
    teams.value           = []
    projects.value        = []
    selectedProject.value = null
    deployments.value     = []
    domains.value         = []
    envVars.value         = []
    functions.value       = []
    checks.value          = []
    events.value          = []
    aliases.value         = []
    webhooks.value        = []
    edgeConfigs.value     = []
    edgeConfigItems.value = []
    dnsRecords.value      = []
    cronJobs.value        = []
    selectedDomain.value      = null
    selectedEdgeConfig.value  = null
    selectedDeploymentForFunctions.value = null
    selectedDeploymentForChecks.value    = null
    logsDeployment.value                 = null
    deploymentTarget.value               = ''
    error.value           = null
  }

  function selectProject(project) {
    projectChangeRequestId++
    selectedProject.value = project
    deployments.value     = []
    domains.value         = []
    envVars.value         = []
    functions.value       = []
    checks.value          = []
    dnsRecords.value      = []
    cronJobs.value        = []
    selectedDomain.value  = null
    selectedDeploymentForFunctions.value = null
    selectedDeploymentForChecks.value    = null
    logsDeployment.value                 = null
    deploymentTarget.value               = ''
    error.value           = null
  }

  async function fetchTeams() {
    loading.value = true; error.value = null
    try {
      teams.value = await apiFetch('/api/cloud/vercel/teams', { headers: headers() })
    } catch (e) { setError(e) } finally { loading.value = false }
  }

  async function fetchProjects() {
    loading.value = true; error.value = null
    try {
      projects.value = await apiFetch('/api/cloud/vercel/projects', { headers: headers() })
    } catch (e) { setError(e) } finally { loading.value = false }
  }

  async function fetchDeployments(projectId, { limit = 20, target = '' } = {}) {
    const requestId = projectChangeRequestId
    loading.value = true; error.value = null
    try {
      let path = `/api/cloud/vercel/projects/${encodeURIComponent(projectId)}/deployments?limit=${limit}`
      if (target) path += `&target=${encodeURIComponent(target)}`
      const nextData = await apiFetch(path, { headers: headers() })
      if (shouldIgnoreResponse(requestId)) return
      deployments.value = nextData
    } catch (e) {
      if (shouldIgnoreResponse(requestId)) return
      setError(e)
    } finally {
      if (!shouldIgnoreResponse(requestId)) loading.value = false
    }
  }

  async function fetchDomains(projectId) {
    const requestId = projectChangeRequestId
    loading.value = true; error.value = null
    try {
      const nextData = await apiFetch(
        `/api/cloud/vercel/projects/${encodeURIComponent(projectId)}/domains`,
        { headers: headers() }
      )
      if (shouldIgnoreResponse(requestId)) return
      domains.value = nextData
    } catch (e) {
      if (shouldIgnoreResponse(requestId)) return
      setError(e)
    } finally {
      if (!shouldIgnoreResponse(requestId)) loading.value = false
    }
  }

  async function fetchEnvVars(projectId) {
    const requestId = projectChangeRequestId
    loading.value = true; error.value = null
    try {
      const nextData = await apiFetch(
        `/api/cloud/vercel/projects/${encodeURIComponent(projectId)}/env`,
        { headers: headers() }
      )
      if (shouldIgnoreResponse(requestId)) return
      envVars.value = nextData
    } catch (e) {
      if (shouldIgnoreResponse(requestId)) return
      setError(e)
    } finally {
      if (!shouldIgnoreResponse(requestId)) loading.value = false
    }
  }

  async function fetchFunctions(deploymentId) {
    const requestId = projectChangeRequestId
    loading.value = true; error.value = null
    try {
      const nextData = await apiFetch(
        `/api/cloud/vercel/deployments/${encodeURIComponent(deploymentId)}/functions`,
        { headers: headers() }
      )
      if (shouldIgnoreResponse(requestId)) return
      functions.value = nextData
    } catch (e) {
      if (shouldIgnoreResponse(requestId)) return
      setError(e)
    } finally {
      if (!shouldIgnoreResponse(requestId)) loading.value = false
    }
  }

  async function fetchChecks(deploymentId) {
    const requestId = projectChangeRequestId
    loading.value = true; error.value = null
    try {
      const nextData = await apiFetch(
        `/api/cloud/vercel/deployments/${encodeURIComponent(deploymentId)}/checks`,
        { headers: headers() }
      )
      if (shouldIgnoreResponse(requestId)) return
      checks.value = nextData
    } catch (e) {
      if (shouldIgnoreResponse(requestId)) return
      setError(e)
    } finally {
      if (!shouldIgnoreResponse(requestId)) loading.value = false
    }
  }

  // ─── Mutative actions ─────────────────────────────────────────────────────────

  async function redeployDeployment(deploymentId) {
    error.value = null
    try {
      return await apiFetch(
        `/api/cloud/vercel/deployments/${encodeURIComponent(deploymentId)}/redeploy`,
        { method: 'POST', headers: headers() }
      )
    } catch (e) { setError(e); return null }
  }

  async function promoteDeployment(deploymentId, projectId) {
    error.value = null
    try {
      return await apiFetch(
        `/api/cloud/vercel/deployments/${encodeURIComponent(deploymentId)}/promote`,
        {
          method: 'PATCH',
          headers: { ...headers(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId }),
        }
      )
    } catch (e) { setError(e); return null }
  }

  async function cancelDeployment(deploymentId) {
    error.value = null
    try {
      return await apiFetch(
        `/api/cloud/vercel/deployments/${encodeURIComponent(deploymentId)}/cancel`,
        { method: 'PATCH', headers: headers() }
      )
    } catch (e) { setError(e); return null }
  }

  // ─── New feature actions ──────────────────────────────────────────────────────

  async function fetchEvents(limit = 50) {
    loading.value = true; error.value = null
    try {
      events.value = await apiFetch(
        `/api/cloud/vercel/events?limit=${limit}`,
        { headers: headers() }
      )
    } catch (e) { setError(e) } finally { loading.value = false }
  }

  async function fetchAliases(limit = 50) {
    loading.value = true; error.value = null
    try {
      aliases.value = await apiFetch(
        `/api/cloud/vercel/aliases?limit=${limit}`,
        { headers: headers() }
      )
    } catch (e) { setError(e) } finally { loading.value = false }
  }

  async function fetchWebhooks() {
    loading.value = true; error.value = null
    try {
      webhooks.value = await apiFetch(
        '/api/cloud/vercel/webhooks',
        { headers: headers() }
      )
    } catch (e) { setError(e) } finally { loading.value = false }
  }

  async function fetchEdgeConfigs() {
    loading.value = true; error.value = null
    try {
      edgeConfigs.value = await apiFetch(
        '/api/cloud/vercel/edge-config',
        { headers: headers() }
      )
    } catch (e) { setError(e) } finally { loading.value = false }
  }

  async function fetchEdgeConfigItems(id) {
    loading.value = true; error.value = null
    try {
      edgeConfigItems.value = await apiFetch(
        `/api/cloud/vercel/edge-config/${encodeURIComponent(id)}/items`,
        { headers: headers() }
      )
    } catch (e) { setError(e) } finally { loading.value = false }
  }

  async function fetchDnsRecords(domain) {
    loading.value = true; error.value = null
    try {
      dnsRecords.value = await apiFetch(
        `/api/cloud/vercel/domains/${encodeURIComponent(domain)}/dns`,
        { headers: headers() }
      )
    } catch (e) { setError(e) } finally { loading.value = false }
  }

  async function fetchCronJobs(projectId) {
    const requestId = projectChangeRequestId
    loading.value = true; error.value = null
    try {
      const nextData = await apiFetch(
        `/api/cloud/vercel/projects/${encodeURIComponent(projectId)}/cron`,
        { headers: headers() }
      )
      if (shouldIgnoreResponse(requestId)) return
      cronJobs.value = nextData
    } catch (e) {
      if (shouldIgnoreResponse(requestId)) return
      setError(e)
    } finally {
      if (!shouldIgnoreResponse(requestId)) loading.value = false
    }
  }

  return {
    // state
    activeProfileId,
    teams,
    projects,
    selectedProject,
    deployments,
    domains,
    envVars,
    functions,
    checks,
    events,
    aliases,
    webhooks,
    edgeConfigs,
    edgeConfigItems,
    dnsRecords,
    cronJobs,
    selectedDomain,
    selectedEdgeConfig,
    selectedDeploymentForFunctions,
    selectedDeploymentForChecks,
    logsDeployment,
    deploymentTarget,
    loading,
    error,
    // actions
    setActiveProfile,
    runInBackground,
    selectProject,
    fetchTeams,
    fetchProjects,
    fetchDeployments,
    fetchDomains,
    fetchEnvVars,
    fetchFunctions,
    fetchChecks,
    redeployDeployment,
    promoteDeployment,
    cancelDeployment,
    fetchEvents,
    fetchAliases,
    fetchWebhooks,
    fetchEdgeConfigs,
    fetchEdgeConfigItems,
    fetchDnsRecords,
    fetchCronJobs,
    shouldIgnoreResponse,
  }
})
