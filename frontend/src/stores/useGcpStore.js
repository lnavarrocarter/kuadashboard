import { acceptHMRUpdate, defineStore } from 'pinia'
import { ref } from 'vue'
import { useApi } from '../composables/useApi'
import { useI18n } from '../composables/useI18n'

const { t } = useI18n()

export const useGcpStore = defineStore('gcp', () => {
  const { apiFetch: request } = useApi()
  let backgroundRequests = 0

  // ─── State ──────────────────────────────────────────────────────────────────
  const activeProfileId = ref(null)
  const overview = ref(null)
  const overviewHistory = ref([])
  const overviewLoading = ref(false)
  const overviewError = ref(null)

  function createTab() {
    return { data: [], loading: false, error: null, enableUrl: null, nextPageToken: null, loadingMore: false }
  }

  const tabs = ref({
    cloudrun: createTab(), gke: createTab(), vms: createTab(), sql: createTab(),
    storage: createTab(), functions: createTab(), pubsub: createTab(),
    secrets: createTab(), artifact: createTab(), bigquery: createTab(),
    workflows: createTab(), dns: createTab(), firestore: createTab(),
    spanner: createTab(), memorystore: createTab(), tasks: createTab(),
    scheduler: createTab(), build: createTab(), iam: createTab(),
    // Fase 4
    cloudrunJobs: createTab(), pubsubSubs: createTab(), vpc: createTab(),
    monitoring: createTab(), logging: createTab(), kms: createTab(),
  })

  // ─── Helpers ─────────────────────────────────────────────────────────────────
  function headers() {
    if (!activeProfileId.value) throw new Error(t('store.noGcpProfile'))
    return { 'X-Profile-Id': activeProfileId.value }
  }

  function setError(e, tabKey) {
    const msg = e.message || String(e)
    tabs.value[tabKey].error = msg
    const match = msg.match(/https?:\/\/[^\s]+/)
    tabs.value[tabKey].enableUrl = match ? match[0] : null
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
      return await callback()
    } finally {
      backgroundRequests -= 1
    }
  }

  async function fetchTab(tabKey, url) {
    const tab = tabs.value[tabKey]
    const background = backgroundRequests > 0
    if (!background) {
      tab.loading = true
      tab.error = null
      tab.nextPageToken = null
    }
    try {
      const res = await apiFetch(url, { headers: headers() })
      if (Array.isArray(res)) {
        if (tab.data !== res) tab.data = res
      } else if (res && res.items) {
        if (tab.data !== res.items) tab.data = res.items
        tab.nextPageToken = res.nextPageToken || null
      } else {
        tab.data = []
      }
    } catch (e) {
      setError(e, tabKey)
      if (!background) tab.data = []
    } finally {
      if (!background) tab.loading = false
    }
  }

  async function appendTab(tabKey, url) {
    const tab = tabs.value[tabKey]
    if (!tab.nextPageToken) return
    tab.loadingMore = true
    try {
      const res = await apiFetch(url, { headers: headers() })
      if (res && res.items) {
        tab.data.push(...res.items)
        tab.nextPageToken = res.nextPageToken || null
      }
    } catch (e) { setError(e, tabKey) }
    finally { tab.loadingMore = false }
  }

  // ─── setActiveProfile ────────────────────────────────────────────────────────
  function setActiveProfile(id) {
    activeProfileId.value = id
    overview.value = null
    overviewHistory.value = []
    overviewLoading.value = false
    overviewError.value = null
    Object.values(tabs.value).forEach(t => {
      t.data = []
      t.loading = false
      t.error = null
      t.enableUrl = null
      t.nextPageToken = null
      t.loadingMore = false
      t.query = null
    })
  }

  // ─── Base fetch functions ────────────────────────────────────────────────────
  async function fetchOverview({ force = false, region = '' } = {}) {
    overviewLoading.value = true
    overviewError.value = null
    const params = new URLSearchParams()
    if (force) params.set('force', '1')
    if (region) params.set('region', region)
    try {
      overview.value = await apiFetch(`/api/cloud/gcp/overview${params.toString() ? `?${params}` : ''}`, { headers: headers() })
      return overview.value
    } catch (e) {
      overviewError.value = e.message || String(e)
      throw e
    } finally {
      overviewLoading.value = false
    }
  }

  async function fetchOverviewHistory({ days = 7, region = '' } = {}) {
    const params = new URLSearchParams({ days: String(days) })
    if (region) params.set('region', region)
    try {
      const response = await apiFetch(`/api/cloud/gcp/overview/history?${params}`, { headers: headers() })
      overviewHistory.value = response.snapshots || []
      return overviewHistory.value
    } catch (e) {
      overviewError.value = e.message || String(e)
      throw e
    }
  }

  async function fetchCloudRunServices()    { return fetchTab('cloudrun',    '/api/cloud/gcp/cloudrun') }
  async function fetchGkeClusters()         { return fetchTab('gke',         '/api/cloud/gcp/gke') }
  async function fetchVMs()                 { return fetchTab('vms',         '/api/cloud/gcp/compute/vms') }
  async function fetchSqlInstances()        { return fetchTab('sql',         '/api/cloud/gcp/sql') }
  async function fetchBuckets()             { return fetchTab('storage',     '/api/cloud/gcp/storage/buckets') }
  async function fetchFunctions()           { return fetchTab('functions',   '/api/cloud/gcp/functions') }
  async function fetchPubSubTopics()        { return fetchTab('pubsub',      '/api/cloud/gcp/pubsub/topics') }
  async function fetchSecrets()             { return fetchTab('secrets',     '/api/cloud/gcp/secrets') }
  async function fetchArtifactRegistry()    { return fetchTab('artifact',    '/api/cloud/gcp/artifact-registry') }
  async function fetchBigQueryDatasets()    { return fetchTab('bigquery',    '/api/cloud/gcp/bigquery/datasets') }
  async function fetchWorkflows()           { return fetchTab('workflows',   '/api/cloud/gcp/workflows') }
  async function fetchDnsZones()            { return fetchTab('dns',         '/api/cloud/gcp/dns/zones') }
  async function fetchFirestoreDbs()        { return fetchTab('firestore',   '/api/cloud/gcp/firestore/databases') }
  async function fetchSpannerInstances()    { return fetchTab('spanner',     '/api/cloud/gcp/spanner/instances') }
  async function fetchMemorystore()         { return fetchTab('memorystore', '/api/cloud/gcp/memorystore/instances') }
  async function fetchTaskQueues()          { return fetchTab('tasks',       '/api/cloud/gcp/tasks/queues') }
  async function fetchSchedulerJobs()       { return fetchTab('scheduler',   '/api/cloud/gcp/scheduler/jobs') }
  async function fetchBuilds()              { return fetchTab('build',       '/api/cloud/gcp/build/builds') }
  async function fetchIamServiceAccounts()  { return fetchTab('iam',         '/api/cloud/gcp/iam/service-accounts') }

  // ─── Cloud Run actions ──────────────────────────────────────────────────────
  async function startCloudRunService(region, service) {
    try {
      return await apiFetch(`/api/cloud/gcp/cloudrun/${encodeURIComponent(region)}/${encodeURIComponent(service)}/start`, { method: 'POST', headers: headers() })
    } catch (e) { setError(e, 'cloudrun'); return null }
  }
  async function stopCloudRunService(region, service) {
    try {
      return await apiFetch(`/api/cloud/gcp/cloudrun/${encodeURIComponent(region)}/${encodeURIComponent(service)}/stop`, { method: 'POST', headers: headers() })
    } catch (e) { setError(e, 'cloudrun'); return null }
  }

  // ─── VM actions ─────────────────────────────────────────────────────────────
  async function startVM(zone, name) {
    try {
      return await apiFetch(`/api/cloud/gcp/compute/vms/${encodeURIComponent(zone)}/${encodeURIComponent(name)}/start`, { method: 'POST', headers: headers() })
    } catch (e) { setError(e, 'vms'); return null }
  }
  async function stopVM(zone, name) {
    try {
      return await apiFetch(`/api/cloud/gcp/compute/vms/${encodeURIComponent(zone)}/${encodeURIComponent(name)}/stop`, { method: 'POST', headers: headers() })
    } catch (e) { setError(e, 'vms'); return null }
  }

  // ─── SQL actions ────────────────────────────────────────────────────────────
  async function startSqlInstance(instance) {
    try {
      return await apiFetch(`/api/cloud/gcp/sql/${encodeURIComponent(instance)}/start`, { method: 'POST', headers: headers() })
    } catch (e) { setError(e, 'sql'); return null }
  }
  async function stopSqlInstance(instance) {
    try {
      return await apiFetch(`/api/cloud/gcp/sql/${encodeURIComponent(instance)}/stop`, { method: 'POST', headers: headers() })
    } catch (e) { setError(e, 'sql'); return null }
  }

  // ─── Create / delete (Cloud Run, VM, Cloud SQL) ──────────────────────────────
  // These throw so the confirmation modals can show the backend error inline.
  // The backend re-checks confirmName / acknowledgeCost / acknowledgeHighCost.

  function jsonRequest(method, body) {
    return { method, headers: { ...headers(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  }

  // Curated locations / machine types / tiers for the create forms (static: cached once)
  let presetsPromise = null
  function fetchPresets() {
    presetsPromise ||= apiFetch('/api/cloud/gcp/presets', { headers: headers() })
      .catch(e => { presetsPromise = null; throw e })
    return presetsPromise
  }

  async function estimateResource(kind, spec) {
    return await apiFetch(`/api/cloud/gcp/estimate/${encodeURIComponent(kind)}`, jsonRequest('POST', spec))
  }

  const CREATE_PATHS = { cloudrun: '/api/cloud/gcp/cloudrun', vm: '/api/cloud/gcp/compute/vms', sql: '/api/cloud/gcp/sql' }
  async function createResource(kind, body) {
    return await apiFetch(CREATE_PATHS[kind], jsonRequest('POST', body))
  }

  function deletePath(kind, resource) {
    const e = encodeURIComponent
    if (kind === 'cloudrun') return `/api/cloud/gcp/cloudrun/${e(resource.region)}/${e(resource.name)}`
    if (kind === 'vm') return `/api/cloud/gcp/compute/vms/${e(resource.zone)}/${e(resource.name)}`
    if (kind === 'sql') return `/api/cloud/gcp/sql/${e(resource.name)}`
    throw new Error(`Unknown resource kind: ${kind}`)
  }
  // ─── Labels / state history / polling (#81) ─────────────────────────────────
  function labelsPath(kind, resource) {
    const e = encodeURIComponent
    if (kind === 'cloudrun') return `/api/cloud/gcp/cloudrun/${e(resource.region)}/${e(resource.name)}/labels`
    if (kind === 'vm') return `/api/cloud/gcp/compute/vms/${e(resource.zone)}/${e(resource.name)}/labels`
    if (kind === 'sql') return `/api/cloud/gcp/sql/${e(resource.name)}/labels`
    throw new Error(`Unknown resource kind: ${kind}`)
  }
  async function updateLabels(kind, resource, labels) {
    return await apiFetch(labelsPath(kind, resource), jsonRequest('PUT', { labels }))
  }
  async function fetchHistory(type, key, { limit = 50, before = null } = {}) {
    const q = new URLSearchParams({ type, key, limit: String(limit) })
    if (before) q.set('before', String(before))
    return await request(`/api/cloud/gcp/history?${q}`, { headers: headers() })
  }
  async function fetchPollSettings() {
    return await request('/api/cloud/gcp/history/polling', { headers: headers() })
  }
  async function updatePollSettings(changes) {
    return await apiFetch('/api/cloud/gcp/history/polling', jsonRequest('PUT', changes))
  }
  async function runPollNow() {
    return await apiFetch('/api/cloud/gcp/history/polling/run', jsonRequest('POST', {}))
  }

  async function deleteResource(kind, resource, confirmName) {
    return await apiFetch(deletePath(kind, resource), jsonRequest('DELETE', { confirmName }))
  }

  // ─── Functions ──────────────────────────────────────────────────────────────
  async function invokeFunction(location, name, payload = {}) {
    try {
      return await apiFetch(`/api/cloud/gcp/functions/${encodeURIComponent(location)}/${encodeURIComponent(name)}/invoke`, { method: 'POST', headers: headers(), body: JSON.stringify(payload) })
    } catch (e) { setError(e, 'functions'); return null }
  }
  async function fetchFunctionLogs(location, name, opts = {}) {
    const params = new URLSearchParams()
    if (opts.limit) params.append('limit', opts.limit)
    if (opts.hours) params.append('hours', opts.hours)
    const qs = params.toString()
    return apiFetch(`/api/cloud/gcp/functions/${encodeURIComponent(location)}/${encodeURIComponent(name)}/logs${qs ? '?' + qs : ''}`, { headers: headers() })
  }

  // ─── Secrets ────────────────────────────────────────────────────────────────
  async function previewSecretKeys(name) {
    return apiFetch(`/api/cloud/gcp/secrets/${encodeURIComponent(name)}/preview-keys`, { headers: headers() })
  }
  async function importSecretKeys(name, body) {
    return apiFetch(`/api/cloud/gcp/secrets/${encodeURIComponent(name)}/import-selected`, { method: 'POST', headers: headers(), body: JSON.stringify(body) })
  }

  // ─── Artifact Registry ──────────────────────────────────────────────────────
  async function fetchArtifactPackages(location, repo) {
    return apiFetch(`/api/cloud/gcp/artifact-registry/${encodeURIComponent(location)}/${encodeURIComponent(repo)}/packages`, { headers: headers() })
  }

  // ─── BigQuery ───────────────────────────────────────────────────────────────
  async function fetchBigQueryTables(dataset) {
    return apiFetch(`/api/cloud/gcp/bigquery/datasets/${encodeURIComponent(dataset)}/tables`, { headers: headers() })
  }
  async function runBigQuery(query) {
    return apiFetch('/api/cloud/gcp/bigquery/query', { method: 'POST', headers: headers(), body: JSON.stringify({ query }) })
  }
  async function pollBigQueryJob(jobId) {
    return apiFetch(`/api/cloud/gcp/bigquery/query/${encodeURIComponent(jobId)}`, { headers: headers() })
  }

  // ─── Workflows ──────────────────────────────────────────────────────────────
  async function fetchWorkflowExecutions(location, name) {
    return apiFetch(`/api/cloud/gcp/workflows/${encodeURIComponent(location)}/${encodeURIComponent(name)}/executions`, { headers: headers() })
  }
  async function fetchWorkflowDefinition(location, name) {
    return apiFetch(`/api/cloud/gcp/workflows/${encodeURIComponent(location)}/${encodeURIComponent(name)}/definition`, { headers: headers() })
  }

  // ─── DNS ────────────────────────────────────────────────────────────────────
  async function fetchDnsRecords(zone) {
    return apiFetch(`/api/cloud/gcp/dns/zones/${encodeURIComponent(zone)}/records`, { headers: headers() })
  }

  // ─── Firestore ──────────────────────────────────────────────────────────────
  async function fetchFirestoreCollections(db) {
    return apiFetch(`/api/cloud/gcp/firestore/databases/${encodeURIComponent(db)}/collections`, { headers: headers() })
  }
  async function fetchFirestoreDocuments(db, collection, opts = {}) {
    const params = new URLSearchParams()
    if (opts.pageToken) params.append('pageToken', opts.pageToken)
    if (opts.pageSize) params.append('pageSize', opts.pageSize)
    if (opts.namespace !== undefined) params.append('namespace', opts.namespace)
    const qs = params.toString()
    return apiFetch(`/api/cloud/gcp/firestore/databases/${encodeURIComponent(db)}/collections/${encodeURIComponent(collection)}/documents${qs ? '?' + qs : ''}`, { headers: headers() })
  }

  // ─── Spanner ────────────────────────────────────────────────────────────────
  async function fetchSpannerDatabases(instance) {
    return apiFetch(`/api/cloud/gcp/spanner/instances/${encodeURIComponent(instance)}/databases`, { headers: headers() })
  }
  async function querySpanner(instance, database, sql) {
    return apiFetch(`/api/cloud/gcp/spanner/instances/${encodeURIComponent(instance)}/databases/${encodeURIComponent(database)}/query`, { method: 'POST', headers: headers(), body: JSON.stringify({ sql }) })
  }

  // ─── Task Queues ────────────────────────────────────────────────────────────
  async function fetchQueueTasks(location, queue) {
    return apiFetch(`/api/cloud/gcp/tasks/queues/${encodeURIComponent(location)}/${encodeURIComponent(queue)}/tasks`, { headers: headers() })
  }

  // ─── Cloud Scheduler ────────────────────────────────────────────────────────
  async function runSchedulerJob(location, job) {
    return apiFetch(`/api/cloud/gcp/scheduler/jobs/${encodeURIComponent(location)}/${encodeURIComponent(job)}/run`, { method: 'POST', headers: headers() })
  }
  async function pauseSchedulerJob(location, job) {
    return apiFetch(`/api/cloud/gcp/scheduler/jobs/${encodeURIComponent(location)}/${encodeURIComponent(job)}/pause`, { method: 'POST', headers: headers() })
  }
  async function resumeSchedulerJob(location, job) {
    return apiFetch(`/api/cloud/gcp/scheduler/jobs/${encodeURIComponent(location)}/${encodeURIComponent(job)}/resume`, { method: 'POST', headers: headers() })
  }

  // ─── Cloud Build ────────────────────────────────────────────────────────────
  async function fetchBuildLogs(id) {
    return apiFetch(`/api/cloud/gcp/build/builds/${encodeURIComponent(id)}/logs`, { headers: headers() })
  }

  // ─── IAM ────────────────────────────────────────────────────────────────────
  async function fetchIamKeys(email) {
    return apiFetch(`/api/cloud/gcp/iam/service-accounts/${encodeURIComponent(email)}/keys`, { headers: headers() })
  }

  // ─── fetchMore ──────────────────────────────────────────────────────────────
  function fetchMoreBuilds() {
    if (!tabs.value.build.nextPageToken) return
    return appendTab('build', `/api/cloud/gcp/build/builds?pageToken=${encodeURIComponent(tabs.value.build.nextPageToken)}`)
  }
  function fetchMoreIamServiceAccounts() {
    if (!tabs.value.iam.nextPageToken) return
    return appendTab('iam', `/api/cloud/gcp/iam/service-accounts?pageToken=${encodeURIComponent(tabs.value.iam.nextPageToken)}`)
  }
  function fetchMoreQueueTasks(location, queue) {
    if (!tabs.value.tasks.nextPageToken) return
    return appendTab('tasks', `/api/cloud/gcp/tasks/queues/${encodeURIComponent(location)}/${encodeURIComponent(queue)}/tasks?pageToken=${encodeURIComponent(tabs.value.tasks.nextPageToken)}`)
  }

  // ─── Fase 4 ─────────────────────────────────────────────────────────────────
  async function fetchCloudRunJobs()        { return fetchTab('cloudrunJobs', '/api/cloud/gcp/cloudrun-jobs') }
  async function fetchPubSubSubscriptions() { return fetchTab('pubsubSubs',   '/api/cloud/gcp/pubsub/subscriptions') }
  async function fetchVpcNetworks()         { return fetchTab('vpc',          '/api/cloud/gcp/vpc/networks') }
  async function fetchAlertPolicies()       { return fetchTab('monitoring',   '/api/cloud/gcp/monitoring/alerts') }
  async function fetchKmsKeyrings()         { return fetchTab('kms',          '/api/cloud/gcp/kms/keyrings') }
  async function fetchUptimeChecks() {
    try {
      const res = await apiFetch('/api/cloud/gcp/monitoring/uptime-checks', { headers: headers() })
      tabs.value.monitoring.data = Array.isArray(res) ? res : (res?.uptimeChecks || [])
      return tabs.value.monitoring.data
    } catch (e) { setError(e, 'monitoring'); return [] }
  }

  async function fetchKmsKeys(location, ring) {
    return apiFetch(`/api/cloud/gcp/kms/keyrings/${encodeURIComponent(location)}/${encodeURIComponent(ring)}/keys`, { headers: headers() })
  }
  async function fetchVpcSubnets(network) {
    return apiFetch(`/api/cloud/gcp/vpc/networks/${encodeURIComponent(network)}/subnets`, { headers: headers() })
  }
  async function runCloudRunJob(location, job) {
    return apiFetch(`/api/cloud/gcp/cloudrun-jobs/${encodeURIComponent(location)}/${encodeURIComponent(job)}/run`, { method: 'POST', headers: headers() })
  }
  async function fetchJobExecutions(location, job) {
    return apiFetch(`/api/cloud/gcp/cloudrun-jobs/${encodeURIComponent(location)}/${encodeURIComponent(job)}/executions`, { headers: headers() })
  }
  async function queryLogs(filter, limit = 100, hours = 3, opts = {}) {
    const tab = tabs.value.logging
    const profileId = activeProfileId.value
    const append = opts.append === true
    if (tab.loading || tab.loadingMore || (append && !tab.nextPageToken)) return null
    const query = append ? { ...tab.query, pageToken: tab.nextPageToken } : { filter, limit, hours }
    if (append) tab.loadingMore = true
    else { tab.loading = true; tab.nextPageToken = null; tab.data = [] }
    tab.error = null
    tab.enableUrl = null
    try {
      const res = await apiFetch('/api/cloud/gcp/logging/query', { method: 'POST', headers: headers(), body: JSON.stringify(query) })
      if (activeProfileId.value !== profileId) return null
      tab.data = append ? [...tab.data, ...(res?.entries || [])] : res?.entries || []
      tab.nextPageToken = res?.nextPageToken || null
      tab.query = { filter: query.filter, limit: query.limit, hours: query.hours, since: res?.since, until: res?.until }
      return res
    } catch (e) {
      if (activeProfileId.value === profileId) setError(e, 'logging')
      return null
    } finally { tab.loading = false; tab.loadingMore = false }
  }

  // ─── Fase 1: Logs por recurso ──────────────────────────────────────────────
  async function fetchCloudRunLogs(region, service, opts = {}) {
    const params = new URLSearchParams()
    if (opts.limit) params.append('limit', opts.limit)
    if (opts.hours) params.append('hours', opts.hours)
    return apiFetch(`/api/cloud/gcp/cloudrun/${encodeURIComponent(region)}/${encodeURIComponent(service)}/logs?${params}`, { headers: headers() })
  }
  async function fetchGkeLogs(location, cluster, opts = {}) {
    const params = new URLSearchParams()
    if (opts.limit) params.append('limit', opts.limit)
    if (opts.hours) params.append('hours', opts.hours)
    return apiFetch(`/api/cloud/gcp/gke/${encodeURIComponent(location)}/${encodeURIComponent(cluster)}/logs?${params}`, { headers: headers() })
  }
  async function fetchVmSerialLog(zone, name, opts = {}) {
    const params = new URLSearchParams()
    if (opts.limit) params.append('limit', opts.limit)
    return apiFetch(`/api/cloud/gcp/compute/vms/${encodeURIComponent(zone)}/${encodeURIComponent(name)}/serial-log?${params}`, { headers: headers() })
  }
  async function fetchSqlLogs(instance, opts = {}) {
    const params = new URLSearchParams()
    if (opts.limit) params.append('limit', opts.limit)
    if (opts.hours) params.append('hours', opts.hours)
    return apiFetch(`/api/cloud/gcp/sql/${encodeURIComponent(instance)}/logs?${params}`, { headers: headers() })
  }
  async function fetchWorkflowLogs(location, name, opts = {}) {
    const params = new URLSearchParams()
    if (opts.limit) params.append('limit', opts.limit)
    if (opts.hours) params.append('hours', opts.hours)
    return apiFetch(`/api/cloud/gcp/workflows/${encodeURIComponent(location)}/${encodeURIComponent(name)}/logs?${params}`, { headers: headers() })
  }

  // ─── Detail endpoints (master-detail panels) ──────────────────────────────
  async function fetchCloudRunDetail(region, service) {
    return apiFetch(`/api/cloud/gcp/cloudrun/${encodeURIComponent(region)}/${encodeURIComponent(service)}/detail`, { headers: headers() })
  }
  async function fetchVmDetail(zone, name) {
    return apiFetch(`/api/cloud/gcp/compute/vms/${encodeURIComponent(zone)}/${encodeURIComponent(name)}/detail`, { headers: headers() })
  }
  async function fetchVmLogs(zone, name, opts = {}) {
    const params = new URLSearchParams()
    if (opts.limit) params.append('limit', opts.limit)
    if (opts.hours) params.append('hours', opts.hours)
    return apiFetch(`/api/cloud/gcp/compute/vms/${encodeURIComponent(zone)}/${encodeURIComponent(name)}/logs?${params}`, { headers: headers() })
  }
  async function fetchSqlDetail(instance) {
    return apiFetch(`/api/cloud/gcp/sql/${encodeURIComponent(instance)}/detail`, { headers: headers() })
  }
  async function fetchFunctionDetail(location, name) {
    return apiFetch(`/api/cloud/gcp/functions/${encodeURIComponent(location)}/${encodeURIComponent(name)}/detail`, { headers: headers() })
  }

  async function fetchArtifactTags(location, repo, pkg) {
    return apiFetch(
      `/api/cloud/gcp/artifact-registry/${encodeURIComponent(location)}/${encodeURIComponent(repo)}/packages/${encodeURIComponent(pkg)}/tags`,
      { headers: headers() }
    )
  }
  async function fetchArtifactRepoInfo(location, repo) {
    return apiFetch(
      `/api/cloud/gcp/artifact-registry/${encodeURIComponent(location)}/${encodeURIComponent(repo)}/info`,
      { headers: headers() }
    )
  }

  async function fetchMonitoringTimeSeries(metric, filter, opts = {}) {
    const params = new URLSearchParams({ metric })
    if (filter)       params.append('filter', filter)
    if (opts.hours)   params.append('hours', opts.hours)
    if (opts.aligner) params.append('aligner', opts.aligner)
    if (opts.period)  params.append('period', opts.period)
    if (opts.reducer) params.append('reducer', opts.reducer)
    return apiFetch(`/api/cloud/gcp/monitoring/timeseries?${params}`, { headers: headers() })
  }

  async function deleteGcsObject(bucket, key) {
    return apiFetch(`/api/cloud/gcp/storage/${encodeURIComponent(bucket)}/object?key=${encodeURIComponent(key)}`, {
      method: 'DELETE', headers: headers()
    })
  }

  async function uploadGcsObject(bucket, key, file) {
    const url = `/api/cloud/gcp/storage/${encodeURIComponent(bucket)}/upload?key=${encodeURIComponent(key)}&contentType=${encodeURIComponent(file.type || 'application/octet-stream')}`
    const arrayBuf = await file.arrayBuffer()
    const body = new Uint8Array(arrayBuf)
    return apiFetch(url, {
      method: 'POST',
      headers: { ...headers(), 'Content-Type': file.type || 'application/octet-stream' },
      body
    })
  }

  // Computed shortcuts for templates
  const cloudRunServices = { get value() { return tabs.value.cloudrun.data } }
  const gkeClusters      = { get value() { return tabs.value.gke.data } }
  const vms              = { get value() { return tabs.value.vms.data } }

  return {
    estimateResource, createResource, deleteResource, fetchPresets,
    updateLabels, fetchHistory, fetchPollSettings, updatePollSettings, runPollNow,
    activeProfileId, tabs, overview, overviewHistory, overviewLoading, overviewError,
    cloudRunServices, gkeClusters, vms,
    setActiveProfile, runInBackground,
    fetchOverview, fetchOverviewHistory,
    fetchCloudRunServices, fetchGkeClusters, fetchVMs,
    fetchSqlInstances, fetchBuckets, fetchFunctions, fetchPubSubTopics,
    fetchSecrets, fetchArtifactRegistry,
    fetchBigQueryDatasets, fetchWorkflows, fetchDnsZones, fetchFirestoreDbs,
    fetchSpannerInstances, fetchMemorystore, fetchTaskQueues, fetchSchedulerJobs, fetchBuilds, fetchIamServiceAccounts,
    startCloudRunService, stopCloudRunService,
    startVM, stopVM,
    startSqlInstance, stopSqlInstance,
    invokeFunction, fetchFunctionLogs,
    previewSecretKeys, importSecretKeys,
    fetchArtifactPackages,
    fetchBigQueryTables, runBigQuery, pollBigQueryJob,
    fetchWorkflowExecutions, fetchWorkflowDefinition,
    fetchDnsRecords,
    fetchFirestoreCollections, fetchFirestoreDocuments,
    fetchSpannerDatabases, querySpanner,
    fetchQueueTasks,
    runSchedulerJob, pauseSchedulerJob, resumeSchedulerJob,
    fetchBuildLogs,
    fetchIamKeys,
    fetchMoreBuilds, fetchMoreIamServiceAccounts, fetchMoreQueueTasks,
    // Fase 4
    fetchCloudRunJobs, fetchPubSubSubscriptions, fetchVpcNetworks,
    fetchAlertPolicies, fetchKmsKeyrings, queryLogs,
    runCloudRunJob, fetchJobExecutions,
    fetchVpcSubnets,
    fetchUptimeChecks,
    fetchKmsKeys,
    // Fase 1: Logs por recurso
    fetchCloudRunLogs, fetchGkeLogs, fetchVmSerialLog, fetchSqlLogs, fetchWorkflowLogs,
    // Detail endpoints
    fetchCloudRunDetail, fetchVmDetail, fetchVmLogs, fetchSqlDetail, fetchFunctionDetail,
    // GCS mutations
    deleteGcsObject, uploadGcsObject,
    // Artifact Registry extras
    fetchArtifactTags, fetchArtifactRepoInfo,
    // Cloud Monitoring
    fetchMonitoringTimeSeries,
  }
})

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useGcpStore, import.meta.hot))
}
