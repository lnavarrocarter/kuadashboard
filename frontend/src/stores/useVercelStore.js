/**
 * stores/useVercelStore.js
 * Pinia store for Vercel resources.
 *
 * Follows the flat-state pattern of useAwsStore.js.
 * All API calls inject X-Profile-Id from activeProfileId.
 */
import { acceptHMRUpdate, defineStore } from 'pinia'
import { ref } from 'vue'
import { useApi } from '../composables/useApi'
import { useI18n } from '../composables/useI18n'

const { t } = useI18n()

export const useVercelStore = defineStore('vercel', () => {
  const { apiFetch: request } = useApi()
  let backgroundRequests = 0
  let projectChangeRequestId = 0
  let profileChangeRequestId = 0   // guards the project list across profile switches
  let projectsInFlight = null       // { profileId, promise } — dedupes header + view loads

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
  const overview        = ref(null)   // GET /overview: account summary + Advisor, apart from the table loading state
  const overviewLoading = ref(false)
  const overviewError   = ref('')
  const loading         = ref(false)
  const projectsLoading = ref(false)
  const error           = ref(null)

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  function headers() {
    if (!activeProfileId.value) throw new Error(t('store.noVercelProfile'))
    return { 'X-Profile-Id': activeProfileId.value }
  }

  function setError(e) { error.value = e?.message || String(e) }

  function shouldIgnoreResponse(requestId) {
    return requestId !== projectChangeRequestId
  }

  // Last project chosen per profile, so the header selector survives reloads.
  const PROJECT_MEMORY_PREFIX = 'kua.vercel.project.'
  function rememberProject(profileId, projectId) {
    if (!profileId) return
    try {
      if (projectId) localStorage.setItem(PROJECT_MEMORY_PREFIX + profileId, projectId)
      else localStorage.removeItem(PROJECT_MEMORY_PREFIX + profileId)
    } catch { /* storage unavailable */ }
  }
  function rememberedProject(profileId) {
    try { return profileId ? localStorage.getItem(PROJECT_MEMORY_PREFIX + profileId) : null } catch { return null }
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
    profileChangeRequestId++
    projectsInFlight = null
    projectsLoading.value = false
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
    overview.value                       = null
    overviewError.value                  = ''
    error.value           = null
  }

  function selectProject(project) {
    projectChangeRequestId++
    selectedProject.value = project
    rememberProject(activeProfileId.value, project?.id || null)
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

  /** Select by id from the loaded list ('' / null clears the project context). */
  function selectProjectById(projectId) {
    if (!projectId) {
      if (selectedProject.value) selectProject(null)
      return
    }
    if (selectedProject.value?.id === projectId) return
    const project = projects.value.find(p => p.id === projectId)
    if (project) selectProject(project)
  }

  // After the list (re)loads: keep the selection in sync with fresh data, drop it if the
  // project no longer exists, or restore the last project used with this profile.
  function reconcileSelectedProject() {
    const current = selectedProject.value
    if (current) {
      const fresh = projects.value.find(p => p.id === current.id)
      if (fresh) selectedProject.value = fresh   // same id: no context change, no reload
      else selectProject(null)
      return
    }
    const remembered = rememberedProject(activeProfileId.value)
    const project = remembered && projects.value.find(p => p.id === remembered)
    if (project) selectProject(project)
  }

  // The backend caches the scan 15 min; refresh forces a new one (free Vercel API reads).
  async function fetchOverview({ refresh = false } = {}) {
    const requestId = profileChangeRequestId
    overviewLoading.value = true; overviewError.value = ''
    try {
      const data = await apiFetch(`/api/cloud/vercel/overview${refresh ? '?refresh=1' : ''}`, { headers: headers() })
      if (requestId === profileChangeRequestId) overview.value = data
    } catch (e) {
      if (requestId === profileChangeRequestId) overviewError.value = e?.message || String(e)
    } finally {
      if (requestId === profileChangeRequestId) overviewLoading.value = false
    }
  }

  async function fetchProjects() {
    const profileId = activeProfileId.value
    if (projectsInFlight?.profileId === profileId) return projectsInFlight.promise
    const requestId = profileChangeRequestId
    const promise = (async () => {
      loading.value = true; projectsLoading.value = true; error.value = null
      try {
        const nextProjects = await apiFetch('/api/cloud/vercel/projects', { headers: headers() })
        if (requestId !== profileChangeRequestId) return
        projects.value = nextProjects
        reconcileSelectedProject()
      } catch (e) {
        if (requestId === profileChangeRequestId) setError(e)
      } finally {
        if (requestId === profileChangeRequestId) {
          loading.value = false
          projectsLoading.value = false
          projectsInFlight = null
        }
      }
    })()
    projectsInFlight = { profileId, promise }
    return promise
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
    projectsLoading,
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
    overview,
    overviewLoading,
    overviewError,
    loading,
    error,
    // actions
    setActiveProfile,
    runInBackground,
    selectProject,
    fetchTeams,
    fetchProjects,
    fetchOverview,
    selectProjectById,
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

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useVercelStore, import.meta.hot))
}
