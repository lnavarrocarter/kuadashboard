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
  const { apiFetch } = useApi()

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
  const loading         = ref(false)
  const error           = ref(null)

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  function headers() {
    if (!activeProfileId.value) throw new Error('No Vercel profile selected')
    return { 'X-Profile-Id': activeProfileId.value }
  }

  function setError(e) { error.value = e?.message || String(e) }

  // ─── Actions ─────────────────────────────────────────────────────────────────

  function setActiveProfile(id) {
    activeProfileId.value = id
    teams.value           = []
    projects.value        = []
    selectedProject.value = null
    deployments.value     = []
    domains.value         = []
    envVars.value         = []
    functions.value       = []
    checks.value          = []
    error.value           = null
  }

  function selectProject(project) {
    selectedProject.value = project
    deployments.value     = []
    domains.value         = []
    envVars.value         = []
    functions.value       = []
    checks.value          = []
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
    loading.value = true; error.value = null
    try {
      let path = `/api/cloud/vercel/projects/${encodeURIComponent(projectId)}/deployments?limit=${limit}`
      if (target) path += `&target=${encodeURIComponent(target)}`
      deployments.value = await apiFetch(path, { headers: headers() })
    } catch (e) { setError(e) } finally { loading.value = false }
  }

  async function fetchDomains(projectId) {
    loading.value = true; error.value = null
    try {
      domains.value = await apiFetch(
        `/api/cloud/vercel/projects/${encodeURIComponent(projectId)}/domains`,
        { headers: headers() }
      )
    } catch (e) { setError(e) } finally { loading.value = false }
  }

  async function fetchEnvVars(projectId) {
    loading.value = true; error.value = null
    try {
      envVars.value = await apiFetch(
        `/api/cloud/vercel/projects/${encodeURIComponent(projectId)}/env`,
        { headers: headers() }
      )
    } catch (e) { setError(e) } finally { loading.value = false }
  }

  async function fetchFunctions(deploymentId) {
    loading.value = true; error.value = null
    try {
      functions.value = await apiFetch(
        `/api/cloud/vercel/deployments/${encodeURIComponent(deploymentId)}/functions`,
        { headers: headers() }
      )
    } catch (e) { setError(e) } finally { loading.value = false }
  }

  async function fetchChecks(deploymentId) {
    loading.value = true; error.value = null
    try {
      checks.value = await apiFetch(
        `/api/cloud/vercel/deployments/${encodeURIComponent(deploymentId)}/checks`,
        { headers: headers() }
      )
    } catch (e) { setError(e) } finally { loading.value = false }
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
    loading,
    error,
    // actions
    setActiveProfile,
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
  }
})
