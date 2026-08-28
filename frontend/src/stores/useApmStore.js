import { computed, ref } from 'vue'
import { acceptHMRUpdate, defineStore } from 'pinia'
import { useApi } from '../composables/useApi'

const RANGE_MS = {
  '6h': 6 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  '90d': 90 * 24 * 60 * 60 * 1000,
}

export const useApmStore = defineStore('apm', () => {
  const { apiFetch } = useApi()
  const activeProvider = ref('aws')
  const activeProfileId = ref(null)
  const applications = ref([])
  const selectedApplicationId = ref(null)
  const overview = ref(null)
  const topology = ref({ application: null, resources: [], edges: [] })
  const usage = ref(null)
  const forecast = ref(null)
  const series = ref({})
  const range = ref('24h')
  const environment = ref('')
  const team = ref('')
  const loading = ref(false)
  const collecting = ref(false)
  const analyzingTopology = ref(false)
  const tracingProcess = ref(false)
  const processTrace = ref(null)
  const architectureLink = ref(null)
  const architectureProjects = ref([])
  const linkingArchitecture = ref(false)
  const registry = ref(null)
  const reconcilingRegistry = ref(false)
  const reviewingRelationshipId = ref('')
  const syncStatus = ref(null)
  const kubernetesPreview = ref(null)
  const previewingKubernetes = ref(false)
  const kubernetesPreviewScopeKey = ref('')
  const kubernetesContexts = ref([])
  const loadingKubernetesContexts = ref(false)
  const error = ref(null)

  const selectedApplication = computed(() =>
    applications.value.find(application => application.id === selectedApplicationId.value) || null)
  const filteredApplications = computed(() => applications.value.filter(application =>
    (!environment.value || application.environment === environment.value) &&
    (!team.value || application.team === team.value)))
  const environments = computed(() => [...new Set(applications.value.map(item => item.environment).filter(Boolean))].sort())
  const teams = computed(() => [...new Set(applications.value.map(item => item.team).filter(Boolean))].sort())
  const rangeBounds = computed(() => {
    const to = Date.now()
    return { from: to - (RANGE_MS[range.value] || RANGE_MS['24h']), to }
  })

  function headers(json = false) {
    if (!activeProfileId.value) throw new Error('No cloud profile selected')
    return {
      'X-Profile-Id': activeProfileId.value,
      ...(json ? { 'Content-Type': 'application/json' } : {}),
    }
  }

  function request(path, options = {}) {
    return apiFetch(`/api/observability/${activeProvider.value}${path}`, options)
  }

  function resetApplicationData() {
    overview.value = null
    topology.value = { application: null, resources: [], edges: [] }
    forecast.value = null
    series.value = {}
    processTrace.value = null
    architectureLink.value = null
    architectureProjects.value = []
    registry.value = null
    syncStatus.value = null
    kubernetesPreview.value = null
    kubernetesPreviewScopeKey.value = ''
    kubernetesContexts.value = []
  }

  function setActiveProfile(profileId, provider = 'aws') {
    if (activeProfileId.value === (profileId || null) && activeProvider.value === provider) return
    activeProvider.value = provider
    activeProfileId.value = profileId || null
    applications.value = []
    selectedApplicationId.value = null
    usage.value = null
    resetApplicationData()
    error.value = null
  }

  async function loadApplications({ preserveSelection = true } = {}) {
    if (!activeProfileId.value) return []
    loading.value = true
    error.value = null
    try {
      const previous = preserveSelection ? selectedApplicationId.value : null
      applications.value = await request('/applications', { headers: headers() })
      selectedApplicationId.value = applications.value.some(item => item.id === previous)
        ? previous
        : applications.value[0]?.id || null
      return applications.value
    } catch (requestError) {
      error.value = requestError.message
      return []
    } finally {
      loading.value = false
    }
  }

  async function loadUsage() {
    if (!activeProfileId.value) return null
    try {
      usage.value = await request('/usage', { headers: headers() })
      return usage.value
    } catch (requestError) {
      error.value = requestError.message
      return null
    }
  }

  async function loadSelectedApplication() {
    const applicationId = selectedApplicationId.value
    if (!applicationId) {
      resetApplicationData()
      return null
    }
    loading.value = true
    error.value = null
    const { from, to } = rangeBounds.value
    try {
      const [nextOverview, nextTopology, nextForecast] = await Promise.all([
        request(`/applications/${applicationId}/overview?from=${from}&to=${to}`, { headers: headers() }),
        request(`/applications/${applicationId}/topology`, { headers: headers() }),
        request(`/applications/${applicationId}/forecast`, { headers: headers() }),
      ])
      overview.value = nextOverview
      topology.value = nextTopology
      forecast.value = nextForecast
      loadRegistrySyncStatus(applicationId)
      const contexts = [...new Set((nextTopology.resources || [])
        .filter(resource => resource.type === 'kubernetes' && resource.kubeContext)
        .map(resource => resource.kubeContext))].sort()
      const previewScopeKey = `${applicationId}:${contexts.join('|')}`
      if (contexts.length && kubernetesPreviewScopeKey.value !== previewScopeKey) {
        await previewKubernetesDiscovery({ contexts })
      }
      return nextOverview
    } catch (requestError) {
      error.value = requestError.message
      return null
    } finally {
      loading.value = false
    }
  }

  async function selectApplication(applicationId) {
    selectedApplicationId.value = applicationId || null
    series.value = {}
    return loadSelectedApplication()
  }

  async function refreshLocal() {
    await Promise.all([loadApplications(), loadUsage()])
    await loadSelectedApplication()
  }

  async function loadSeries(metricName, options = {}) {
    if (!selectedApplicationId.value) return []
    const { resourceId = '', resourceType = '', kind = '', key = '' } = typeof options === 'string'
      ? { resourceId: options }
      : options
    const { from, to } = rangeBounds.value
    const params = new URLSearchParams({ metric: metricName, from: String(from), to: String(to) })
    if (resourceId) params.set('resourceId', resourceId)
    if (resourceType) params.set('resourceType', resourceType)
    if (kind) params.set('kind', kind)
    try {
      const rows = await request(`/applications/${selectedApplicationId.value}/series?${params}`, { headers: headers() })
      const grouped = new Map()
      for (const row of rows) {
        const point = grouped.get(row.bucketStart) || { t: row.bucketStart, v: 0, quality: 'full' }
        point.v += row.sum
        if (row.quality === 'partial') point.quality = 'partial'
        grouped.set(row.bucketStart, point)
      }
      const points = [...grouped.values()].sort((left, right) => left.t - right.t)
      series.value = { ...series.value, [key || metricName]: points }
      return points
    } catch (requestError) {
      error.value = requestError.message
      return []
    }
  }

  async function createApplication(payload) {
    const application = await request('/applications', {
      method: 'POST',
      headers: headers(true),
      body: JSON.stringify(payload),
    })
    applications.value = [...applications.value, application]
    selectedApplicationId.value = application.id
    return application
  }

  async function updateApplication(applicationId, changes) {
    const updated = await request(`/applications/${applicationId}`, {
      method: 'PATCH',
      headers: headers(true),
      body: JSON.stringify(changes),
    })
    applications.value = applications.value.map(application => application.id === applicationId ? updated : application)
    return updated
  }

  function replaceApplication(application) {
    applications.value = applications.value.map(item => item.id === application.id ? application : item)
    if (topology.value.application?.id === application.id) {
      topology.value = { ...topology.value, application }
    }
  }

  async function loadArchitectureLink(applicationId = selectedApplicationId.value) {
    if (!applicationId) return null
    linkingArchitecture.value = true
    try {
      architectureLink.value = await request(`/applications/${applicationId}/architecture-link`, { headers: headers() })
      if (architectureLink.value.application) replaceApplication(architectureLink.value.application)
      return architectureLink.value
    } catch (requestError) {
      error.value = requestError.message
      return null
    } finally {
      linkingArchitecture.value = false
    }
  }

  async function loadArchitectureProjects() {
    try {
      architectureProjects.value = await apiFetch('/api/architecture/projects', { headers: headers() })
      return architectureProjects.value
    } catch (requestError) {
      error.value = requestError.message
      return []
    }
  }

  async function linkArchitectureProject(projectId) {
    if (!selectedApplicationId.value) return null
    linkingArchitecture.value = true
    try {
      architectureLink.value = await request(`/applications/${selectedApplicationId.value}/architecture-link`, {
        method: 'PATCH', headers: headers(true), body: JSON.stringify({ projectId }),
      })
      replaceApplication(architectureLink.value.application)
      return architectureLink.value
    } catch (requestError) {
      error.value = requestError.message
      return null
    } finally {
      linkingArchitecture.value = false
    }
  }

  async function createArchitectureProjectLink() {
    if (!selectedApplicationId.value) return null
    linkingArchitecture.value = true
    try {
      architectureLink.value = await request(`/applications/${selectedApplicationId.value}/architecture-link/project`, {
        method: 'POST', headers: headers(true), body: JSON.stringify({}),
      })
      replaceApplication(architectureLink.value.application)
      return architectureLink.value
    } catch (requestError) {
      error.value = requestError.message
      return null
    } finally {
      linkingArchitecture.value = false
    }
  }

  async function unlinkArchitectureProject() {
    if (!selectedApplicationId.value) return null
    linkingArchitecture.value = true
    try {
      const application = await request(`/applications/${selectedApplicationId.value}/architecture-link`, {
        method: 'DELETE', headers: headers(),
      })
      replaceApplication(application)
      architectureLink.value = { linked: false, project: null, resources: { matched: [], unmatched: [], duplicateIdentityWarnings: [] } }
      return application
    } catch (requestError) {
      error.value = requestError.message
      return null
    } finally {
      linkingArchitecture.value = false
    }
  }

  async function reconcileSharedRegistry() {
    if (!selectedApplicationId.value) return null
    reconcilingRegistry.value = true
    try {
      registry.value = await request(`/applications/${selectedApplicationId.value}/registry/reconcile`, {
        method: 'POST', headers: headers(),
      })
      syncStatus.value = registry.value?.syncStatus || syncStatus.value
      return registry.value
    } catch (requestError) {
      error.value = requestError.message
      await loadRegistrySyncStatus(selectedApplicationId.value)
      return null
    } finally {
      reconcilingRegistry.value = false
    }
  }

  // Non-blocking: diagnostics should never delay the main application overview.
  async function loadRegistrySyncStatus(applicationId = selectedApplicationId.value) {
    if (!applicationId) return null
    try {
      registry.value = await request(`/applications/${applicationId}/registry`, { headers: headers() })
      syncStatus.value = registry.value?.syncStatus || null
      return syncStatus.value
    } catch (_) {
      return null
    }
  }

  async function reviewRegistryRelationship(relationshipId, decision) {
    if (!selectedApplicationId.value || !relationshipId) return null
    reviewingRelationshipId.value = relationshipId
    error.value = null
    try {
      const result = await request(`/applications/${selectedApplicationId.value}/registry/relationships/${relationshipId}/review`, {
        method: 'POST',
        headers: { ...headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      })
      await loadRegistrySyncStatus(selectedApplicationId.value)
      return result
    } catch (requestError) {
      error.value = requestError.message
      return null
    } finally {
      reviewingRelationshipId.value = ''
    }
  }

  async function previewKubernetesDiscovery({ contexts = [], namespaces = [] } = {}) {
    if (!selectedApplicationId.value) return null
    previewingKubernetes.value = true
    try {
      kubernetesPreview.value = await request(`/applications/${selectedApplicationId.value}/discovery/kubernetes/preview`, {
        method: 'POST', headers: headers(true), body: JSON.stringify({ contexts, namespaces }),
      })
      kubernetesPreviewScopeKey.value = `${selectedApplicationId.value}:${[...contexts].sort().join('|')}`
      return kubernetesPreview.value
    } catch (requestError) {
      error.value = requestError.message
      return null
    } finally {
      previewingKubernetes.value = false
    }
  }

  async function loadApplicationKubernetesContexts() {
    if (!selectedApplicationId.value) return []
    loadingKubernetesContexts.value = true
    try {
      const result = await request(`/applications/${selectedApplicationId.value}/discovery/kubernetes/contexts`, { headers: headers() })
      kubernetesContexts.value = result.contexts || []
      return kubernetesContexts.value
    } catch (requestError) {
      error.value = requestError.message
      return []
    } finally {
      loadingKubernetesContexts.value = false
    }
  }

  async function deleteApplication(applicationId) {
    await request(`/applications/${applicationId}`, { method: 'DELETE', headers: headers() })
    applications.value = applications.value.filter(application => application.id !== applicationId)
    if (selectedApplicationId.value === applicationId) {
      selectedApplicationId.value = applications.value[0]?.id || null
      await loadSelectedApplication()
    }
  }

  async function addResource(applicationId, resource) {
    return request(`/applications/${applicationId}/resources`, {
      method: 'POST',
      headers: headers(true),
      body: JSON.stringify(resource),
    })
  }

  async function confirmDependency(applicationId, dependency) {
    await request(`/applications/${applicationId}/edges`, {
      method: 'POST',
      headers: headers(true),
      body: JSON.stringify({
        sourceResourceId: dependency.sourceResourceId,
        targetResourceId: dependency.targetResourceId,
        relationType: dependency.relationType,
      }),
    })
    await loadSelectedApplication()
  }

  async function analyzeCloudTopology(applicationId) {
    analyzingTopology.value = true
    error.value = null
    try {
      topology.value = await request(`/applications/${applicationId}/topology/analyze-cloud`, {
        method: 'POST',
        headers: headers(),
      })
      return topology.value.analysis
    } catch (requestError) {
      error.value = requestError.message
      return null
    } finally {
      analyzingTopology.value = false
    }
  }

  async function traceProcess(applicationId, query, { includeData = false } = {}) {
    const value = String(query || '').trim()
    const payload = value.includes(':execution:')
      ? { executionArn: value }
      : value.includes(':stateMachine:')
        ? { stateMachineArn: value }
        : { requestId: value }
      payload.includeData = includeData
    tracingProcess.value = true
    error.value = null
    try {
      const recentExecutions = processTrace.value?.availableExecutions || []
      const result = await request(`/applications/${applicationId}/process-traces`, {
        method: 'POST',
        headers: headers(true),
        body: JSON.stringify(payload),
      })
      if (payload.executionArn && recentExecutions.length && !result.availableExecutions?.length) {
        result.availableExecutions = recentExecutions
      }
      processTrace.value = result
      return processTrace.value
    } catch (requestError) {
      error.value = requestError.message
      return null
    } finally {
      tracingProcess.value = false
    }
  }

  async function discoverCandidates(application, resources) {
    return request('/candidates', {
      method: 'POST',
      headers: headers(true),
      body: JSON.stringify({ application, resources }),
    })
  }

  async function loadDeployments(region) {
    const params = new URLSearchParams({ region })
    return request(`/deployments?${params}`, { headers: headers() })
  }

  async function previewDeploymentResources(region, stackNames) {
    return request('/deployment-resources', {
      method: 'POST',
      headers: headers(true),
      body: JSON.stringify({ region, stackNames }),
    })
  }

  async function loadKubernetesContexts() {
    return request('/kubernetes-contexts', { headers: headers() })
  }

  async function loadKubernetesWorkloads(contexts = []) {
    const params = new URLSearchParams()
    if (contexts.length) params.set('contexts', contexts.join(','))
    const suffix = params.size ? `?${params}` : ''
    return request(`/kubernetes-workloads${suffix}`, { headers: headers() })
  }

  async function updateThresholds(applicationId, thresholds) {
    const updatedThresholds = await request(`/applications/${applicationId}/thresholds`, {
      method: 'PATCH',
      headers: headers(true),
      body: JSON.stringify(thresholds),
    })
    applications.value = applications.value.map(application => application.id === applicationId
      ? { ...application, thresholds: updatedThresholds }
      : application)
    if (topology.value.application?.id === applicationId) {
      topology.value = {
        ...topology.value,
        application: { ...topology.value.application, thresholds: updatedThresholds },
      }
    }
    return updatedThresholds
  }

  async function collectNow() {
    if (!selectedApplicationId.value) return null
    collecting.value = true
    error.value = null
    try {
      const result = await request(`/applications/${selectedApplicationId.value}/collect-now`, {
        method: 'POST',
        headers: headers(),
      })
      await Promise.all([loadSelectedApplication(), loadUsage()])
      return result
    } catch (requestError) {
      error.value = requestError.message
      return null
    } finally {
      collecting.value = false
    }
  }

  return {
    activeProvider,
    activeProfileId,
    applications,
    selectedApplicationId,
    selectedApplication,
    filteredApplications,
    environments,
    teams,
    overview,
    topology,
    usage,
    forecast,
    series,
    range,
    environment,
    team,
    loading,
    collecting,
    analyzingTopology,
    tracingProcess,
    processTrace,
    architectureLink,
    architectureProjects,
    linkingArchitecture,
    registry,
    reconcilingRegistry,
    reviewingRelationshipId,
    syncStatus,
    kubernetesPreview,
    previewingKubernetes,
    kubernetesContexts,
    loadingKubernetesContexts,
    error,
    setActiveProfile,
    loadApplications,
    loadUsage,
    loadSelectedApplication,
    selectApplication,
    refreshLocal,
    loadSeries,
    createApplication,
    updateApplication,
    loadArchitectureLink,
    loadArchitectureProjects,
    linkArchitectureProject,
    createArchitectureProjectLink,
    unlinkArchitectureProject,
    reconcileSharedRegistry,
    loadRegistrySyncStatus,
    reviewRegistryRelationship,
    previewKubernetesDiscovery,
    loadApplicationKubernetesContexts,
    deleteApplication,
    addResource,
    confirmDependency,
    analyzeCloudTopology,
    traceProcess,
    discoverCandidates,
    loadDeployments,
    previewDeploymentResources,
    loadKubernetesContexts,
    loadKubernetesWorkloads,
    updateThresholds,
    collectNow,
  }
})

export { RANGE_MS }

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useApmStore, import.meta.hot))
}