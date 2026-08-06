import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
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
    if (!activeProfileId.value) throw new Error('No AWS profile selected')
    return {
      'X-Profile-Id': activeProfileId.value,
      ...(json ? { 'Content-Type': 'application/json' } : {}),
    }
  }

  function request(path, options = {}) {
    return apiFetch(`/api/observability/aws${path}`, options)
  }

  function resetApplicationData() {
    overview.value = null
    topology.value = { application: null, resources: [], edges: [] }
    forecast.value = null
    series.value = {}
  }

  function setActiveProfile(profileId) {
    if (activeProfileId.value === (profileId || null)) return
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

  async function loadSeries(metricName, resourceId = '') {
    if (!selectedApplicationId.value) return []
    const { from, to } = rangeBounds.value
    const params = new URLSearchParams({ metric: metricName, from: String(from), to: String(to) })
    if (resourceId) params.set('resourceId', resourceId)
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
      series.value = { ...series.value, [metricName]: points }
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
    deleteApplication,
    addResource,
    discoverCandidates,
    loadDeployments,
    previewDeploymentResources,
    updateThresholds,
    collectNow,
  }
})

export { RANGE_MS }