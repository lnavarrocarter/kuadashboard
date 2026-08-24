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
    if (!selectedProjectId.value) return null
    if (manageLoading) loading.value = true
    error.value = null
    try {
      const [nextGraph, nextSnapshots] = await Promise.all([
        apiFetch(`/api/architecture/projects/${selectedProjectId.value}/graph`, { headers: headers() }),
        apiFetch(`/api/architecture/projects/${selectedProjectId.value}/snapshots`, { headers: headers() }),
      ])
      graph.value = nextGraph
      snapshots.value = nextSnapshots
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

  return {
    activeProfileId,
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
    snapshots,
  }
})

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useArchitectureStore, import.meta.hot))
}