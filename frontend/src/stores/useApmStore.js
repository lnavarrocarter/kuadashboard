import { computed, ref } from 'vue'
import { acceptHMRUpdate, defineStore } from 'pinia'
import { useApi } from '../composables/useApi'
import { useI18n } from '../composables/useI18n'
import { taskRun } from '../lib/taskTrace'
import { isAborted, taskCoordinatorFor } from '../lib/taskCoordinator'

const { t } = useI18n()

const RANGE_MS = {
  '6h': 6 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  '90d': 90 * 24 * 60 * 60 * 1000,
}

// What an application load is made of; writes invalidate only the parts they change (#326).
const APPLICATION_PARTS = ['overview', 'topology', 'forecast', 'registry']

export const useApmStore = defineStore('apm', () => {
  const { apiFetch } = useApi()
  const activeProvider = ref('aws')
  const activeProfileId = ref(null)
  const applications = ref([])
  const selectedApplicationId = ref(null)
  const overview = ref(null)
  const topology = ref({ application: null, resources: [], edges: [] })
  const cloudSuggestionsByApplication = ref({})
  const usage = ref(null)
  const forecast = ref(null)
  const series = ref({})
  const logHistory = ref(null)
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
  const registryLoading = ref(false)
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

  // task: X-KUA-Task value from taskRun(), so the backend task journal attributes the request (#325).
  function headers(json = false, task = null) {
    if (!activeProfileId.value) throw new Error(t('store.noCloudProfile'))
    return {
      'X-Profile-Id': activeProfileId.value,
      ...(json ? { 'Content-Type': 'application/json' } : {}),
      ...(task ? { 'X-KUA-Task': task } : {}),
    }
  }

  function request(path, options = {}) {
    return apiFetch(`/api/observability/${activeProvider.value}${path}`, options)
  }

  // Reads and writes of an application go through its shared task coordinator (#326): one
  // request per key at a time, writes in order, one reload per burst of writes, and reads
  // aborted when the application or profile changes. The store reloads the parts it owns
  // for the selected application only.
  let subscription = { applicationId: null, unsubscribe: () => {} }
  function tasksFor(applicationId) {
    const tasks = taskCoordinatorFor(applicationId)
    if (applicationId === selectedApplicationId.value && subscription.applicationId !== applicationId) {
      subscription.unsubscribe()
      subscription = { applicationId, unsubscribe: tasks.subscribe(parts => reloadParts(applicationId, parts)) }
    }
    return tasks
  }

  async function reloadParts(applicationId, parts) {
    if (applicationId !== selectedApplicationId.value) return
    const own = APPLICATION_PARTS.filter(part => parts.has(part) && part !== 'registry')
    await Promise.all([
      own.length ? loadSelectedApplication(own) : null,
      parts.has('registry') ? loadRegistrySyncStatus(applicationId) : null,
    ])
  }

  function cancelApplicationTasks(applicationId = selectedApplicationId.value) {
    if (applicationId) taskCoordinatorFor(applicationId).cancel()
  }

  function resetApplicationData() {
    overview.value = null
    topology.value = { application: null, resources: [], edges: [] }
    cloudSuggestionsByApplication.value = {}
    forecast.value = null
    series.value = {}
    logHistory.value = null
    processTrace.value = null
    architectureLink.value = null
    architectureProjects.value = []
    registry.value = null
    registryLoading.value = false
    syncStatus.value = null
    kubernetesPreview.value = null
    kubernetesPreviewScopeKey.value = ''
    kubernetesContexts.value = []
  }

  function setActiveProfile(profileId, provider = 'aws') {
    if (activeProfileId.value === (profileId || null) && activeProvider.value === provider) return
    cancelApplicationTasks()
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
      applications.value = await request('/applications', { headers: headers(false, taskRun('apps.list')) })
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
      usage.value = await request('/usage', { headers: headers(false, taskRun('usage')) })
      return usage.value
    } catch (requestError) {
      error.value = requestError.message
      return null
    }
  }

  /**
   * Loads the selected application, or only the given parts of it. The registry diagnostics are
   * started without waiting: they never delay the overview.
   */
  async function loadSelectedApplication(parts = APPLICATION_PARTS) {
    const applicationId = selectedApplicationId.value
    if (!applicationId) {
      resetApplicationData()
      return null
    }
    const tasks = tasksFor(applicationId)
    const current = () => selectedApplicationId.value === applicationId
    loading.value = true
    error.value = null
    const { from, to } = rangeBounds.value
    const get = (key, path, apply) => tasks.read(key, ({ signal, task }) => request(path, { headers: headers(false, task), signal }))
      .then(value => { if (current()) apply(value); return value })
    const loaders = {
      // The range is part of the key: a read for another range is not shared.
      overview: () => get(`app.overview:${range.value}`, `/applications/${applicationId}/overview?from=${from}&to=${to}`, value => { overview.value = value }),
      topology: () => get('app.topology', `/applications/${applicationId}/topology`, value => {
        topology.value = mergeCloudSuggestions(value, cloudSuggestionsByApplication.value[applicationId])
      }),
      forecast: () => get('app.forecast', `/applications/${applicationId}/forecast`, value => { forecast.value = value }),
    }
    if (parts.includes('registry')) loadRegistrySyncStatus(applicationId)
    const loaded = parts.filter(part => loaders[part])
    try {
      const results = await Promise.allSettled(loaded.map(part => loaders[part]()))
      if (!current()) return null
      const failure = results.find(result => result.status === 'rejected' && !isAborted(result.reason))
      if (failure) {
        error.value = failure.reason?.message || String(failure.reason)
        return null
      }
      const nextTopology = results[loaded.indexOf('topology')]?.value
      if (nextTopology) {
        const contexts = [...new Set((nextTopology.resources || [])
          .filter(resource => resource.type === 'kubernetes' && resource.kubeContext)
          .map(resource => resource.kubeContext))].sort()
        const previewScopeKey = `${applicationId}:${contexts.join('|')}`
        if (contexts.length && kubernetesPreviewScopeKey.value !== previewScopeKey) {
          await previewKubernetesDiscovery({ contexts })
        }
      }
      return overview.value
    } finally {
      if (current()) loading.value = false
    }
  }

  async function selectApplication(applicationId) {
    // Whatever the previous application was still loading is no longer wanted.
    if (selectedApplicationId.value && selectedApplicationId.value !== applicationId) cancelApplicationTasks()
    selectedApplicationId.value = applicationId || null
    series.value = {}
    logHistory.value = null
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

  async function loadLogHistory() {
    if (!selectedApplicationId.value) { logHistory.value = null; return null }
    const { from, to } = rangeBounds.value
    const params = new URLSearchParams({ from: String(from), to: String(to) })
    try {
      logHistory.value = await request(`/applications/${selectedApplicationId.value}/log-series?${params}`, { headers: headers() })
      return logHistory.value
    } catch (requestError) {
      logHistory.value = null
      error.value = requestError.message
      return null
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

  async function createArchitectureProjectLink(name = '') {
    if (!selectedApplicationId.value) return null
    linkingArchitecture.value = true
    try {
      architectureLink.value = await request(`/applications/${selectedApplicationId.value}/architecture-link/project`, {
        method: 'POST', headers: headers(true), body: JSON.stringify(name ? { name } : {}),
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

  async function unlinkArchitectureProject(projectId = '') {
    if (!selectedApplicationId.value) return null
    linkingArchitecture.value = true
    try {
      const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''
      const result = await request(`/applications/${selectedApplicationId.value}/architecture-link${query}`, {
        method: 'DELETE', headers: headers(),
      })
      const application = result.application || result
      replaceApplication(application)
      architectureLink.value = result.linked === undefined
        ? { linked: false, project: null, projects: [], resources: { matched: [], unmatched: [], duplicateIdentityWarnings: [] } }
        : result
      return application
    } catch (requestError) {
      error.value = requestError.message
      return null
    } finally {
      linkingArchitecture.value = false
    }
  }

  async function reconcileSharedRegistry() {
    const applicationId = selectedApplicationId.value
    if (!applicationId) return null
    reconcilingRegistry.value = true
    try {
      // The response is the registry itself; KUApps views reload theirs.
      registry.value = await tasksFor(applicationId).write('registry.reconcile', ({ task }) => request(`/applications/${applicationId}/registry/reconcile`, {
        method: 'POST', headers: headers(false, task),
      }), { invalidates: ['kuapps.registry'] })
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
    const current = () => selectedApplicationId.value === applicationId
    registryLoading.value = true
    try {
      const next = await tasksFor(applicationId).read('app.registry', ({ signal, task }) =>
        request(`/applications/${applicationId}/registry`, { headers: headers(false, task), signal }))
      if (!current()) return null
      registry.value = next
      syncStatus.value = registry.value?.syncStatus || null
      return syncStatus.value
    } catch (_) {
      return null
    } finally {
      if (current()) registryLoading.value = false
    }
  }

  async function reviewRegistryRelationship(relationshipId, decision) {
    if (!selectedApplicationId.value || !relationshipId) return null
    reviewingRelationshipId.value = relationshipId
    error.value = null
    const applicationId = selectedApplicationId.value
    try {
      return await tasksFor(applicationId).write('relationship.review', ({ task }) => request(`/applications/${applicationId}/registry/relationships/${relationshipId}/review`, {
        method: 'POST',
        headers: headers(true, task),
        body: JSON.stringify({ decision }),
      }), { invalidates: ['registry', 'kuapps.registry'] })
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
      const applicationId = selectedApplicationId.value
      const scope = [...contexts].sort().join(',')
      const next = await tasksFor(applicationId).read(`k8s.preview:${scope}`.slice(0, 80), ({ signal, task }) =>
        request(`/applications/${applicationId}/discovery/kubernetes/preview`, {
          method: 'POST', headers: headers(true, task), body: JSON.stringify({ contexts, namespaces }), signal,
        }))
      if (applicationId !== selectedApplicationId.value) return null
      kubernetesPreview.value = next
      kubernetesPreviewScopeKey.value = `${selectedApplicationId.value}:${[...contexts].sort().join('|')}`
      return kubernetesPreview.value
    } catch (requestError) {
      if (!isAborted(requestError)) error.value = requestError.message
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

  // reload: the application view shows the new resource. Setup flows that add many resources
  // and then select the application leave it off, so they do not reload once per resource.
  async function addResource(applicationId, resource, { reload = false } = {}) {
    return tasksFor(applicationId).write('resource.add', ({ task }) => request(`/applications/${applicationId}/resources`, {
      method: 'POST',
      headers: headers(true, task),
      body: JSON.stringify(resource),
    }), { invalidates: reload ? [...APPLICATION_PARTS, 'kuapps.registry'] : [] })
  }

  async function confirmDependency(applicationId, dependency) {
    await confirmDependencies(applicationId, [dependency])
  }

  async function confirmDependencies(applicationId, dependencies) {
    const uniqueDependencies = [...new Map((dependencies || []).map(dependency => [
      `${dependency.sourceResourceId}:${dependency.targetResourceId}:${dependency.relationType}`,
      dependency,
    ])).values()]
    if (!uniqueDependencies.length) return
    // One request and one registry reconciliation for the whole set (#327); the write settles
    // after the topology and registry reload it causes (#326).
    const result = await tasksFor(applicationId).write('review.confirm-dependencies', ({ task }) => request(`/applications/${applicationId}/edges/batch`, {
      method: 'POST',
      headers: headers(true, task),
      body: JSON.stringify({
        edges: uniqueDependencies.map(dependency => ({
          sourceResourceId: dependency.sourceResourceId,
          targetResourceId: dependency.targetResourceId,
          relationType: dependency.relationType,
        })),
      }),
    }), { invalidates: ['topology', 'registry', 'kuapps.registry'] })
    // After the reload, which clears the previous error.
    if (result?.invalid) error.value = t('apm.dependenciesNotConfirmed', { n: result.invalid })
  }

  // refresh: query AWS even when the backend has a recent analysis of the same resources (#328).
  async function analyzeCloudTopology(applicationId, { refresh = false } = {}) {
    analyzingTopology.value = true
    error.value = null
    try {
      const next = await tasksFor(applicationId).read(`topology.analyze-cloud${refresh ? ':refresh' : ''}`, ({ signal, task }) =>
        request(`/applications/${applicationId}/topology/analyze-cloud`, {
          method: 'POST',
          headers: headers(true, task),
          body: JSON.stringify({ refresh }),
          signal,
        }), { kind: 'cloud-read' })
      if (applicationId !== selectedApplicationId.value) return null
      topology.value = next
      cloudSuggestionsByApplication.value = {
        ...cloudSuggestionsByApplication.value,
        [applicationId]: topology.value.analysis?.cloudScan?.suggestions || [],
      }
      return topology.value.analysis
    } catch (requestError) {
      error.value = requestError.message
      return null
    } finally {
      analyzingTopology.value = false
    }
  }

  function mergeCloudSuggestions(nextTopology, cloudSuggestions = []) {
    if (!cloudSuggestions.length) return nextTopology
    const resourceIds = new Set((nextTopology.resources || []).map(resource => resource.id))
    // A confirmed pair is settled, whatever its relation type (same rule as the backend, #328).
    const confirmedPairs = new Set((nextTopology.edges || []).map(edge => `${edge.sourceResourceId}:${edge.targetResourceId}`))
    const visibleCloudSuggestions = cloudSuggestions.filter(suggestion =>
      resourceIds.has(suggestion.sourceResourceId) && resourceIds.has(suggestion.targetResourceId)
      && !confirmedPairs.has(`${suggestion.sourceResourceId}:${suggestion.targetResourceId}`))
    if (!visibleCloudSuggestions.length) return nextTopology
    const localSuggestions = nextTopology.analysis?.suggestions || []
    const suggestions = [...new Map([...localSuggestions, ...visibleCloudSuggestions].map(suggestion => [
      `${suggestion.sourceResourceId}:${suggestion.targetResourceId}:${suggestion.relationType}`,
      suggestion,
    ])).values()]
    const findings = nextTopology.analysis?.findings || []
    const hasSuggestionFinding = findings.some(finding => finding.code === 'dependency_suggestions')
    return {
      ...nextTopology,
      analysis: {
        ...nextTopology.analysis,
        suggestions,
        counts: { ...nextTopology.analysis?.counts, suggestions: suggestions.length },
        findings: hasSuggestionFinding
          ? findings
          : [...findings, { code: 'dependency_suggestions', severity: 'info', resourceIds: [] }],
      },
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
      let result
      try {
        result = await request(`/applications/${selectedApplicationId.value}/collect-now`, {
          method: 'POST',
          headers: headers(),
        })
      } catch (requestError) {
        if (requestError.status === 409 && requestError.details?.skipped === true && requestError.details?.reason === 'collection_in_progress') {
          result = requestError.details
        } else {
          throw requestError
        }
      }
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
    logHistory,
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
    loadLogHistory,
    createApplication,
    updateApplication,
    loadArchitectureLink,
    loadArchitectureProjects,
    linkArchitectureProject,
    createArchitectureProjectLink,
    unlinkArchitectureProject,
    reconcileSharedRegistry,
    registryLoading,
    loadRegistrySyncStatus,
    reviewRegistryRelationship,
    previewKubernetesDiscovery,
    loadApplicationKubernetesContexts,
    deleteApplication,
    addResource,
    confirmDependency,
    confirmDependencies,
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
