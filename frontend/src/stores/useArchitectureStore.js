import { computed, ref } from 'vue'
import { acceptHMRUpdate, defineStore } from 'pinia'
import { useApi } from '../composables/useApi'

export const useArchitectureStore = defineStore('architecture', () => {
  const { apiFetch } = useApi()
  const activeProfileId = ref(null)
  const applications = ref([])
  const selectedApplicationId = ref(null)
  const projects = ref([])
  const selectedProjectId = ref(null)
  const linkedApplication = ref(null)
  const registry = ref(null)
  const registryLoading = ref(false)
  const graph = ref(null)
  const snapshots = ref([])
  const changes = ref([])
  const snapshotDiff = ref(null)
  const syncPreview = ref(null)
  const syncPreviewing = ref(false)
  const discoveryCatalog = ref(null)
  const discoveryPreview = ref(null)
  const kubernetesContexts = ref([])
  const kubernetesPreview = ref(null)
  const discovering = ref(false)
  const discoveryPhase = ref(null)
  const loading = ref(false)
  const saving = ref(false)
  const error = ref(null)

  const selectedApplication = computed(() =>
    applications.value.find(application => application.id === selectedApplicationId.value) || null)
  const selectedProject = computed(() =>
    projects.value.find(project => project.id === selectedProjectId.value) || null)

  function headers(json = false) {
    if (!activeProfileId.value) throw new Error('No application profile selected')
    return {
      'X-Profile-Id': activeProfileId.value,
      ...(json ? { 'Content-Type': 'application/json' } : {}),
    }
  }

  function resetProjectData() {
    selectedProjectId.value = null
    linkedApplication.value = null
    registry.value = null
    graph.value = null
    snapshots.value = []
    changes.value = []
    snapshotDiff.value = null
    syncPreview.value = null
    discoveryCatalog.value = null
    discoveryPreview.value = null
    kubernetesContexts.value = []
    kubernetesPreview.value = null
    discoveryPhase.value = null
  }

  function setActiveProfile(profileId) {
    const nextProfileId = profileId || null
    if (activeProfileId.value === nextProfileId) return
    activeProfileId.value = nextProfileId
    applications.value = []
    selectedApplicationId.value = null
    projects.value = []
    resetProjectData()
    error.value = null
  }

  async function loadApplications({ preserveSelection = true } = {}) {
    if (!activeProfileId.value) return []
    loading.value = true
    error.value = null
    try {
      const previous = preserveSelection ? selectedApplicationId.value : null
      applications.value = await apiFetch('/api/architecture/applications', { headers: headers() })
      selectedApplicationId.value = applications.value.some(application => application.id === previous)
        ? previous
        : null
      return applications.value
    } catch (requestError) {
      error.value = requestError.message
      return []
    } finally {
      loading.value = false
    }
  }

  async function loadProjects({ preserveSelection = true, applicationId = '' } = {}) {
    if (!activeProfileId.value) return []
    loading.value = true
    error.value = null
    try {
      const previous = preserveSelection ? selectedProjectId.value : null
      const params = applicationId ? `?applicationId=${encodeURIComponent(applicationId)}` : ''
      projects.value = await apiFetch(`/api/architecture/projects${params}`, { headers: headers() })
      const nextProjectId = projects.value.some(project => project.id === previous)
        ? previous
        : projects.value[0]?.id || null
      await selectProject(nextProjectId, { manageLoading: false })
      return projects.value
    } catch (requestError) {
      error.value = requestError.message
      return []
    } finally {
      loading.value = false
    }
  }

  async function selectApplication(applicationId) {
    selectedApplicationId.value = applicationId || null
    const application = selectedApplication.value
    linkedApplication.value = application
    if (!application) return loadProjects({ preserveSelection: false })
    const result = await loadProjects({ preserveSelection: false, applicationId: application.id })
    linkedApplication.value = application
    return result
  }

  async function selectProject(projectId, { manageLoading = true } = {}) {
    selectedProjectId.value = projectId || null
    linkedApplication.value = null
    registry.value = null
    graph.value = null
    snapshots.value = []
    changes.value = []
    snapshotDiff.value = null
    syncPreview.value = null
    discoveryCatalog.value = null
    discoveryPreview.value = null
    kubernetesContexts.value = []
    kubernetesPreview.value = null
    if (!selectedProjectId.value) return null
    if (manageLoading) loading.value = true
    error.value = null
    try {
      const [nextGraph, nextSnapshots, nextChanges] = await Promise.all([
        apiFetch(`/api/architecture/projects/${selectedProjectId.value}/graph`, { headers: headers() }),
        apiFetch(`/api/architecture/projects/${selectedProjectId.value}/snapshots`, { headers: headers() }),
        apiFetch(`/api/architecture/projects/${selectedProjectId.value}/changes?limit=50`, { headers: headers() }),
      ])
      graph.value = nextGraph
      snapshots.value = nextSnapshots
      changes.value = nextChanges
      try {
        const link = await apiFetch(`/api/architecture/projects/${selectedProjectId.value}/application`, { headers: headers() })
        linkedApplication.value = link.application || null
        if (linkedApplication.value?.id && !applications.value.some(application => application.id === linkedApplication.value.id)) {
          applications.value = [...applications.value, linkedApplication.value]
        }
        selectedApplicationId.value = linkedApplication.value?.id || selectedApplicationId.value
      } catch (_) {
        linkedApplication.value = null
      }
      return nextGraph
    } catch (requestError) {
      error.value = requestError.message
      return null
    } finally {
      if (manageLoading) loading.value = false
    }
  }

  async function loadRegistry() {
    if (!linkedApplication.value?.id) {
      registry.value = null
      return null
    }
    registryLoading.value = true
    error.value = null
    try {
      registry.value = await apiFetch(`/api/apm/applications/${linkedApplication.value.id}/registry`, { headers: headers() })
      return registry.value
    } catch (requestError) {
      error.value = requestError.message
      return null
    } finally {
      registryLoading.value = false
    }
  }

  async function createProject(input) {
    saving.value = true
    error.value = null
    try {
      const project = await apiFetch('/api/architecture/projects', {
        method: 'POST',
        headers: headers(true),
        body: JSON.stringify(input),
      })
      projects.value = [project, ...projects.value]
      await selectProject(project.id, { manageLoading: false })
      return project
    } catch (requestError) {
      error.value = requestError.message
      return null
    } finally {
      saving.value = false
    }
  }

  async function deleteProject(projectId = selectedProjectId.value) {
    if (!projectId) return false
    saving.value = true
    error.value = null
    try {
      await apiFetch(`/api/architecture/projects/${projectId}`, {
        method: 'DELETE',
        headers: headers(),
      })
      projects.value = projects.value.filter(project => project.id !== projectId)
      if (selectedProjectId.value === projectId) {
        await selectProject(projects.value[0]?.id || null, { manageLoading: false })
      }
      return true
    } catch (requestError) {
      error.value = requestError.message
      return false
    } finally {
      saving.value = false
    }
  }

  async function createSnapshot(input) {
    if (!selectedProjectId.value) return null
    saving.value = true
    error.value = null
    try {
      const snapshot = await apiFetch(`/api/architecture/projects/${selectedProjectId.value}/snapshots`, {
        method: 'POST',
        headers: headers(true),
        body: JSON.stringify(input),
      })
      snapshots.value = [{ ...snapshot, document: undefined }, ...snapshots.value]
      return snapshot
    } catch (requestError) {
      error.value = requestError.message
      return null
    } finally {
      saving.value = false
    }
  }

  async function applyOperation(operation, { reason = '' } = {}) {
    if (!selectedProjectId.value || !graph.value) return null
    saving.value = true
    error.value = null
    try {
      graph.value = await apiFetch(`/api/architecture/projects/${selectedProjectId.value}/operations`, {
        method: 'POST',
        headers: headers(true),
        body: JSON.stringify({ expectedRevision: graph.value.revision, operation, reason }),
      })
      await loadChanges()
      snapshotDiff.value = null
      syncPreview.value = null
      return graph.value
    } catch (requestError) {
      error.value = requestError.message
      return null
    } finally {
      saving.value = false
    }
  }

  async function loadChanges() {
    if (!selectedProjectId.value) return []
    try {
      changes.value = await apiFetch(`/api/architecture/projects/${selectedProjectId.value}/changes?limit=50`, {
        headers: headers(),
      })
      return changes.value
    } catch (requestError) {
      error.value = requestError.message
      return []
    }
  }

  async function compareSnapshot(snapshotId) {
    if (!selectedProjectId.value) return null
    error.value = null
    try {
      snapshotDiff.value = await apiFetch(
        `/api/architecture/projects/${selectedProjectId.value}/snapshots/${snapshotId}/diff`,
        { headers: headers() },
      )
      return snapshotDiff.value
    } catch (requestError) {
      error.value = requestError.message
      return null
    }
  }

  async function revertSnapshot(snapshotId, { reason = '' } = {}) {
    if (!selectedProjectId.value || !graph.value) return null
    saving.value = true
    error.value = null
    try {
      const result = await apiFetch(
        `/api/architecture/projects/${selectedProjectId.value}/snapshots/${snapshotId}/revert`,
        {
          method: 'POST',
          headers: headers(true),
          body: JSON.stringify({ expectedRevision: graph.value.revision, reason }),
        },
      )
      graph.value = result.graph
      snapshots.value = [{ ...result.snapshot, document: undefined }, ...snapshots.value]
      snapshotDiff.value = null
      await loadChanges()
      return result
    } catch (requestError) {
      error.value = requestError.message
      return null
    } finally {
      saving.value = false
    }
  }

  async function loadAwsDeployments(region) {
    if (!selectedProjectId.value) return null
    discovering.value = true
    discoveryPhase.value = 'stacks'
    error.value = null
    discoveryPreview.value = null
    try {
      const params = new URLSearchParams({ region })
      discoveryCatalog.value = await apiFetch(
        `/api/architecture/projects/${selectedProjectId.value}/discovery/aws/deployments?${params}`,
        { headers: headers() },
      )
      return discoveryCatalog.value
    } catch (requestError) {
      error.value = requestError.message
      return null
    } finally {
      discovering.value = false
      discoveryPhase.value = null
    }
  }

  async function previewAwsResources({ region, accountId, stackNames }) {
    if (!selectedProjectId.value) return null
    discovering.value = true
    discoveryPhase.value = 'resources'
    error.value = null
    try {
      discoveryPreview.value = await apiFetch(
        `/api/architecture/projects/${selectedProjectId.value}/discovery/aws/preview`,
        {
          method: 'POST',
          headers: headers(true),
          body: JSON.stringify({ region, accountId, stackNames }),
        },
      )
      return discoveryPreview.value
    } catch (requestError) {
      error.value = requestError.message
      return null
    } finally {
      discovering.value = false
      discoveryPhase.value = null
    }
  }

  async function loadKubernetesContexts() {
    if (!selectedProjectId.value) return []
    discovering.value = true
    discoveryPhase.value = 'kubernetes-contexts'
    error.value = null
    try {
      const result = await apiFetch(`/api/architecture/projects/${selectedProjectId.value}/discovery/kubernetes/contexts`, { headers: headers() })
      kubernetesContexts.value = result.contexts || []
      return kubernetesContexts.value
    } catch (requestError) {
      error.value = requestError.message
      return []
    } finally {
      discovering.value = false
      discoveryPhase.value = null
    }
  }

  async function previewKubernetesResources({ contexts, namespaces = [] }) {
    if (!selectedProjectId.value) return null
    discovering.value = true
    discoveryPhase.value = 'kubernetes-resources'
    error.value = null
    try {
      kubernetesPreview.value = await apiFetch(
        `/api/architecture/projects/${selectedProjectId.value}/discovery/kubernetes/preview`,
        { method: 'POST', headers: headers(true), body: JSON.stringify({ contexts, namespaces }) },
      )
      return kubernetesPreview.value
    } catch (requestError) {
      error.value = requestError.message
      return null
    } finally {
      discovering.value = false
      discoveryPhase.value = null
    }
  }

  async function importKubernetesResources({ selectedNodeIds }) {
    if (!selectedProjectId.value || !graph.value || !kubernetesPreview.value) return null
    const selected = new Set(selectedNodeIds || [])
    const nodes = kubernetesPreview.value.nodes.filter(node => selected.has(node.id))
    if (!nodes.length) return null
    const nodeIds = new Set(nodes.map(node => node.id))
    const edges = kubernetesPreview.value.relationships.filter(edge =>
      nodeIds.has(edge.sourceNodeId) && nodeIds.has(edge.targetNodeId))
    saving.value = true
    error.value = null
    try {
      graph.value = await apiFetch(`/api/architecture/projects/${selectedProjectId.value}/operations`, {
        method: 'POST',
        headers: headers(true),
        body: JSON.stringify({
          expectedRevision: graph.value.revision,
          reason: `Import ${nodes.length} Kubernetes resources`,
          operation: {
            type: 'discovery.import',
            value: {
              scopes: [...new Map(kubernetesPreview.value.sources.map(source => [source.context, {
                id: `kubernetes:${source.context}`, provider: 'kubernetes', profileId: activeProfileId.value, context: source.context,
              }])).values()],
              sources: kubernetesPreview.value.sources,
              nodes,
              edges,
              retiredNodeKinds: [],
            },
          },
        }),
      })
      kubernetesPreview.value = null
      await loadChanges()
      return graph.value
    } catch (requestError) {
      error.value = requestError.message
      return null
    } finally {
      saving.value = false
    }
  }

  async function previewAwsSync({ region, accountId, stackNames }) {
    if (!selectedProjectId.value) return null
    syncPreviewing.value = true
    error.value = null
    try {
      syncPreview.value = await apiFetch(
        `/api/architecture/projects/${selectedProjectId.value}/discovery/aws/sync-preview`,
        {
          method: 'POST',
          headers: headers(true),
          body: JSON.stringify({ region, accountId, stackNames }),
        },
      )
      return syncPreview.value
    } catch (requestError) {
      error.value = requestError.message
      return null
    } finally {
      syncPreviewing.value = false
    }
  }

  async function applyAwsSync({ region, accountId, stackNames }) {
    if (!selectedProjectId.value || !graph.value) return null
    saving.value = true
    error.value = null
    try {
      graph.value = await apiFetch(
        `/api/architecture/projects/${selectedProjectId.value}/discovery/aws/sync-apply`,
        {
          method: 'POST',
          headers: headers(true),
          body: JSON.stringify({
            region, accountId, stackNames,
            expectedRevision: graph.value.revision,
            reason: `Synchronize ${stackNames.length} CloudFormation stack${stackNames.length === 1 ? '' : 's'}`,
          }),
        },
      )
      syncPreview.value = null
      await loadChanges()
      return graph.value
    } catch (requestError) {
      error.value = requestError.message
      return null
    } finally {
      saving.value = false
    }
  }

  async function importAwsResources({ region, accountId, stackNames, selectedNodeIds }) {
    if (!selectedProjectId.value || !graph.value) return null
    saving.value = true
    error.value = null
    try {
      graph.value = await apiFetch(
        `/api/architecture/projects/${selectedProjectId.value}/discovery/aws/import`,
        {
          method: 'POST',
          headers: headers(true),
          body: JSON.stringify({
            region, accountId, stackNames, selectedNodeIds,
            expectedRevision: graph.value.revision,
            reason: `Import ${selectedNodeIds.length} AWS resources`,
          }),
        },
      )
      discoveryPreview.value = null
      syncPreview.value = null
      await loadChanges()
      return graph.value
    } catch (requestError) {
      error.value = requestError.message
      return null
    } finally {
      saving.value = false
    }
  }

  return {
    activeProfileId,
    applications,
    selectedApplicationId,
    selectedApplication,
    applyOperation,
    applyAwsSync,
    changes,
    compareSnapshot,
    createProject,
    createSnapshot,
    deleteProject,
    discovering,
    discoveryPhase,
    discoveryCatalog,
    discoveryPreview,
    kubernetesContexts,
    kubernetesPreview,
    error,
    graph,
    importAwsResources,
    importKubernetesResources,
    loadAwsDeployments,
    loadKubernetesContexts,
    loadApplications,
    loadProjects,
    selectApplication,
    loading,
    linkedApplication,
    loadRegistry,
    registry,
    registryLoading,
    projects,
    previewAwsResources,
    previewKubernetesResources,
    previewAwsSync,
    saving,
    selectProject,
    selectedProject,
    selectedProjectId,
    setActiveProfile,
    snapshotDiff,
    snapshots,
    syncPreview,
    syncPreviewing,
    revertSnapshot,
  }
})

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useArchitectureStore, import.meta.hot))
}
