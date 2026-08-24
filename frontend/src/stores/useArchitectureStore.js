import { computed, ref } from 'vue'
import { acceptHMRUpdate, defineStore } from 'pinia'
import { useApi } from '../composables/useApi'

export const useArchitectureStore = defineStore('architecture', () => {
  const { apiFetch } = useApi()
  const activeProfileId = ref(null)
  const projects = ref([])
  const selectedProjectId = ref(null)
  const graph = ref(null)
  const snapshots = ref([])
  const changes = ref([])
  const snapshotDiff = ref(null)
  const loading = ref(false)
  const saving = ref(false)
  const error = ref(null)

  const selectedProject = computed(() =>
    projects.value.find(project => project.id === selectedProjectId.value) || null)

  function headers(json = false) {
    if (!activeProfileId.value) throw new Error('No AWS profile selected')
    return {
      'X-Profile-Id': activeProfileId.value,
      ...(json ? { 'Content-Type': 'application/json' } : {}),
    }
  }

  function resetProjectData() {
    selectedProjectId.value = null
    graph.value = null
    snapshots.value = []
    changes.value = []
    snapshotDiff.value = null
  }

  function setActiveProfile(profileId) {
    const nextProfileId = profileId || null
    if (activeProfileId.value === nextProfileId) return
    activeProfileId.value = nextProfileId
    projects.value = []
    resetProjectData()
    error.value = null
  }

  async function loadProjects({ preserveSelection = true } = {}) {
    if (!activeProfileId.value) return []
    loading.value = true
    error.value = null
    try {
      const previous = preserveSelection ? selectedProjectId.value : null
      projects.value = await apiFetch('/api/architecture/projects', { headers: headers() })
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

  async function selectProject(projectId, { manageLoading = true } = {}) {
    selectedProjectId.value = projectId || null
    graph.value = null
    snapshots.value = []
    changes.value = []
    snapshotDiff.value = null
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
      return nextGraph
    } catch (requestError) {
      error.value = requestError.message
      return null
    } finally {
      if (manageLoading) loading.value = false
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

  return {
    activeProfileId,
    applyOperation,
    changes,
    compareSnapshot,
    createProject,
    createSnapshot,
    error,
    graph,
    loadProjects,
    loading,
    projects,
    saving,
    selectProject,
    selectedProject,
    selectedProjectId,
    setActiveProfile,
    snapshotDiff,
    snapshots,
    revertSnapshot,
  }
})

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useArchitectureStore, import.meta.hot))
}