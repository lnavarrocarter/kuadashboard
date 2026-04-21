/**
 * stores/useGcpStore.js
 * Pinia store for Google Cloud Platform resources.
 *
 * Each tab has its own { data, loading, error } state so a PERMISSION_DENIED
 * on one API does not block the others from loading.
 */
import { defineStore } from 'pinia'
import { ref, reactive } from 'vue'
import { useApi } from '../composables/useApi'

// Extract the "enable API" URL from a PERMISSION_DENIED gRPC error message.
function extractEnableUrl(msg) {
  if (!msg) return null

  const m = msg.match(/https:\/\/console\.developers\.google\.com\/apis\/api\/[^\s]+/)
  if (m) return m[0]

  try {
    const parsed = JSON.parse(msg)
    const fromMeta = parsed?.error?.details
      ?.find(d => d?.metadata?.activationUrl)
      ?.metadata?.activationUrl
    if (fromMeta) return fromMeta

    const fromHelp = parsed?.error?.details
      ?.find(d => Array.isArray(d?.links) && d.links.length)
      ?.links?.[0]?.url
    return fromHelp || null
  } catch {
    return null
  }
}

function normalizeErrorMessage(msg) {
  if (!msg) return 'Unknown GCP error'
  try {
    const parsed = JSON.parse(msg)
    const apiMsg = parsed?.error?.message
    if (apiMsg) return apiMsg
  } catch {
    // Non-JSON message, return as-is.
  }
  return msg
}

function makeTab() {
  return reactive({ data: [], loading: false, error: null, enableUrl: null, nextPageToken: null, loadingMore: false })
}

export const useGcpStore = defineStore('gcp', () => {
  const { apiFetch } = useApi()

  // ─── State ──────────────────────────────────────────────────────────────────
  const activeProfileId = ref(null)

  const tabs = reactive({
    cloudrun:  makeTab(),
    gke:       makeTab(),
    vms:       makeTab(),
    sql:       makeTab(),
    storage:   makeTab(),
    functions: makeTab(),
    pubsub:    makeTab(),
    secrets:   makeTab(),
    artifact:  makeTab(),
    bigquery:  makeTab(),
    workflows: makeTab(),
    dns:       makeTab(),
    firestore: makeTab(),
    spanner:   makeTab(),
    memorystore: makeTab(),
    tasks:     makeTab(),
    scheduler: makeTab(),
    build:     makeTab(),
    iam:       makeTab(),
    // Fase 4
    cloudrunJobs: makeTab(),
    pubsubSubs:   makeTab(),
    vpc:          makeTab(),
    monitoring:   makeTab(),
    logging:      makeTab(),
    kms:          makeTab(),
  })

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  function headers() {
    if (!activeProfileId.value) throw new Error('No GCP profile selected')
    return { 'X-Profile-Id': activeProfileId.value }
  }

  function resetTab(tab) {
    tab.data         = []
    tab.loading      = false
    tab.error        = null
    tab.enableUrl    = null
    tab.nextPageToken = null
    tab.loadingMore  = false
  }

  async function fetchTab(tab, url) {
    tab.loading      = true
    tab.error        = null
    tab.enableUrl    = null
    tab.nextPageToken = null
    try {
      const result = await apiFetch(url, { headers: headers() })
      if (result && typeof result === 'object' && !Array.isArray(result) && Array.isArray(result.items)) {
        tab.data         = result.items
        tab.nextPageToken = result.nextPageToken || null
      } else {
        tab.data         = result
        tab.nextPageToken = null
      }
    } catch (e) {
      const raw = e?.message || String(e)
      tab.error = normalizeErrorMessage(raw)
      tab.enableUrl = extractEnableUrl(raw) || extractEnableUrl(tab.error)
    } finally {
      tab.loading = false
    }
  }

  async function appendTab(tab, url) {
    if (!tab.nextPageToken) return
    tab.loadingMore  = true
    tab.error        = null
    try {
      const result = await apiFetch(url, { headers: headers() })
      if (result && typeof result === 'object' && !Array.isArray(result) && Array.isArray(result.items)) {
        tab.data         = [...tab.data, ...result.items]
        tab.nextPageToken = result.nextPageToken || null
      }
    } catch (e) {
      const raw = e?.message || String(e)
      tab.error = normalizeErrorMessage(raw)
    } finally {
      tab.loadingMore = false
    }
  }

  // ─── Actions ─────────────────────────────────────────────────────────────────

  function setActiveProfile(id) {
    activeProfileId.value = id
    Object.values(tabs).forEach(resetTab)
  }

  function fetchCloudRunServices() { return fetchTab(tabs.cloudrun,  '/api/cloud/gcp/cloudrun') }
  function fetchGkeClusters()      { return fetchTab(tabs.gke,       '/api/cloud/gcp/gke') }
  function fetchVMs()              { return fetchTab(tabs.vms,       '/api/cloud/gcp/compute/vms') }
  function fetchSqlInstances()     { return fetchTab(tabs.sql,       '/api/cloud/gcp/sql') }
  function fetchBuckets()          { return fetchTab(tabs.storage,   '/api/cloud/gcp/storage/buckets') }
  function fetchFunctions()        { return fetchTab(tabs.functions, '/api/cloud/gcp/functions') }
  function fetchPubSubTopics()     { return fetchTab(tabs.pubsub,    '/api/cloud/gcp/pubsub/topics') }
  function fetchSecrets()          { return fetchTab(tabs.secrets,   '/api/cloud/gcp/secrets') }
  function fetchArtifactRegistry() { return fetchTab(tabs.artifact,  '/api/cloud/gcp/artifact-registry') }
  function fetchBigQueryDatasets() { return fetchTab(tabs.bigquery,  '/api/cloud/gcp/bigquery/datasets') }
  function fetchWorkflows()        { return fetchTab(tabs.workflows, '/api/cloud/gcp/workflows') }
  function fetchDnsZones()         { return fetchTab(tabs.dns,       '/api/cloud/gcp/dns/zones') }
  function fetchFirestoreDbs()     { return fetchTab(tabs.firestore, '/api/cloud/gcp/firestore/databases') }
  function fetchSpannerInstances() { return fetchTab(tabs.spanner,   '/api/cloud/gcp/spanner/instances') }
  function fetchMemorystore()      { return fetchTab(tabs.memorystore, '/api/cloud/gcp/memorystore/instances') }
  function fetchTaskQueues()       { return fetchTab(tabs.tasks,     '/api/cloud/gcp/tasks/queues') }
  function fetchSchedulerJobs()    { return fetchTab(tabs.scheduler, '/api/cloud/gcp/scheduler/jobs') }
  function fetchBuilds()           { return fetchTab(tabs.build,     '/api/cloud/gcp/build/builds') }
  function fetchIamServiceAccounts() { return fetchTab(tabs.iam,    '/api/cloud/gcp/iam/service-accounts') }

  // ── Fase 4 base fetches ──────────────────────────────────────────────────────
  function fetchCloudRunJobs()         { return fetchTab(tabs.cloudrunJobs, '/api/cloud/gcp/cloudrun-jobs') }
  function fetchPubSubSubscriptions()  { return fetchTab(tabs.pubsubSubs,   '/api/cloud/gcp/pubsub/subscriptions') }
  function fetchVpcNetworks()          { return fetchTab(tabs.vpc,          '/api/cloud/gcp/vpc/networks') }
  function fetchAlertPolicies()        { return fetchTab(tabs.monitoring,   '/api/cloud/gcp/monitoring/alerts') }
  function fetchKmsKeyrings()          { return fetchTab(tabs.kms,          '/api/cloud/gcp/kms/keyrings') }

  // Logging is query-based: no auto-fetch, but we expose a query action
  async function queryLogs(filter = '', limit = 100, hours = 3) {
    tabs.logging.loading = true
    tabs.logging.error   = null
    try {
      const result = await apiFetch('/api/cloud/gcp/logging/query', {
        method: 'POST',
        headers: { ...headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ filter, limit, hours }),
      })
      tabs.logging.data = result.entries || []
      tabs.logging.nextPageToken = result.nextPageToken || null
    } catch (e) {
      const raw = e?.message || String(e)
      tabs.logging.error = normalizeErrorMessage(raw)
      tabs.logging.enableUrl = extractEnableUrl(raw) || extractEnableUrl(tabs.logging.error)
    } finally {
      tabs.logging.loading = false
    }
  }

  // ── Fase 4 drill-down actions ─────────────────────────────────────────────
  async function runCloudRunJob(location, job) {
    return apiFetch(`/api/cloud/gcp/cloudrun-jobs/${encodeURIComponent(location)}/${encodeURIComponent(job)}/run`, {
      method: 'POST', headers: { ...headers(), 'Content-Type': 'application/json' }, body: '{}',
    })
  }

  async function fetchJobExecutions(location, job) {
    return apiFetch(
      `/api/cloud/gcp/cloudrun-jobs/${encodeURIComponent(location)}/${encodeURIComponent(job)}/executions`,
      { headers: headers() }
    )
  }

  async function fetchVpcSubnets(network) {
    return apiFetch(`/api/cloud/gcp/vpc/networks/${encodeURIComponent(network)}/subnets`, { headers: headers() })
  }

  async function fetchUptimeChecks() {
    return apiFetch('/api/cloud/gcp/monitoring/uptime-checks', { headers: headers() })
  }

  async function fetchKmsKeys(location, keyring) {
    return apiFetch(
      `/api/cloud/gcp/kms/keyrings/${encodeURIComponent(location)}/${encodeURIComponent(keyring)}/keys`,
      { headers: headers() }
    )
  }

  async function startCloudRunService(region, service) {
    try {
      return await apiFetch(`/api/cloud/gcp/cloudrun/${region}/${service}/start`, {
        method: 'POST', headers: headers(),
      })
    } catch (e) { tabs.cloudrun.error = e.message; return null }
  }

  async function stopCloudRunService(region, service) {
    try {
      return await apiFetch(`/api/cloud/gcp/cloudrun/${region}/${service}/stop`, {
        method: 'POST', headers: headers(),
      })
    } catch (e) { tabs.cloudrun.error = e.message; return null }
  }

  async function startVM(zone, name) {
    try {
      return await apiFetch(`/api/cloud/gcp/compute/vms/${zone}/${name}/start`, {
        method: 'POST', headers: headers(),
      })
    } catch (e) { tabs.vms.error = e.message; return null }
  }

  async function stopVM(zone, name) {
    try {
      return await apiFetch(`/api/cloud/gcp/compute/vms/${zone}/${name}/stop`, {
        method: 'POST', headers: headers(),
      })
    } catch (e) { tabs.vms.error = e.message; return null }
  }

  async function startSqlInstance(name) {
    try {
      return await apiFetch(`/api/cloud/gcp/sql/${name}/start`, {
        method: 'POST', headers: headers(),
      })
    } catch (e) { tabs.sql.error = e.message; return null }
  }

  async function stopSqlInstance(name) {
    try {
      return await apiFetch(`/api/cloud/gcp/sql/${name}/stop`, {
        method: 'POST', headers: headers(),
      })
    } catch (e) { tabs.sql.error = e.message; return null }
  }

  async function invokeFunction(location, name, payload = {}) {
    try {
      return await apiFetch(
        `/api/cloud/gcp/functions/${encodeURIComponent(location)}/${encodeURIComponent(name)}/invoke`,
        { method: 'POST', headers: { ...headers(), 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
      )
    } catch (e) { tabs.functions.error = e.message; return null }
  }

  async function fetchFunctionLogs(location, name, opts = {}) {
    const params = new URLSearchParams()
    if (opts.limit)  params.append('limit', opts.limit)
    if (opts.hours)  params.append('hours', opts.hours)
    return apiFetch(
      `/api/cloud/gcp/functions/${encodeURIComponent(location)}/${encodeURIComponent(name)}/logs?${params}`,
      { headers: headers() }
    )
  }

  async function previewSecretKeys(name) {
    return apiFetch(`/api/cloud/gcp/secrets/${encodeURIComponent(name)}/preview-keys`, { headers: headers() })
  }

  async function importSecretKeys(name, body) {
    return apiFetch(`/api/cloud/gcp/secrets/${encodeURIComponent(name)}/import-selected`, {
      method: 'POST', headers: { ...headers(), 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
  }

  async function fetchArtifactPackages(location, repo) {
    return apiFetch(
      `/api/cloud/gcp/artifact-registry/${encodeURIComponent(location)}/${encodeURIComponent(repo)}/packages`,
      { headers: headers() }
    )
  }

  // ── BigQuery ────────────────────────────────────────────────────────────────
  async function fetchBigQueryTables(dataset) {
    return apiFetch(`/api/cloud/gcp/bigquery/datasets/${encodeURIComponent(dataset)}/tables`, { headers: headers() })
  }

  async function runBigQuery(query) {
    return apiFetch('/api/cloud/gcp/bigquery/query', {
      method: 'POST',
      headers: { ...headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    })
  }

  async function pollBigQueryJob(jobId) {
    return apiFetch(`/api/cloud/gcp/bigquery/query/${encodeURIComponent(jobId)}`, { headers: headers() })
  }

  // ── Cloud Workflows ─────────────────────────────────────────────────────────
  async function fetchWorkflowExecutions(location, name) {
    return apiFetch(
      `/api/cloud/gcp/workflows/${encodeURIComponent(location)}/${encodeURIComponent(name)}/executions`,
      { headers: headers() }
    )
  }

  async function fetchWorkflowDefinition(location, name) {
    return apiFetch(
      `/api/cloud/gcp/workflows/${encodeURIComponent(location)}/${encodeURIComponent(name)}/definition`,
      { headers: headers() }
    )
  }

  // ── Cloud DNS ───────────────────────────────────────────────────────────────
  async function fetchDnsRecords(zone) {
    return apiFetch(`/api/cloud/gcp/dns/zones/${encodeURIComponent(zone)}/records`, { headers: headers() })
  }

  // ── Firestore ───────────────────────────────────────────────────────────────
  async function fetchFirestoreCollections(db) {
    return apiFetch(`/api/cloud/gcp/firestore/databases/${encodeURIComponent(db)}/collections`, { headers: headers() })
  }

  async function fetchFirestoreDocuments(db, collection, opts = {}) {
    const params = new URLSearchParams()
    if (opts.pageToken) params.append('pageToken', opts.pageToken)
    if (opts.pageSize)  params.append('pageSize',  opts.pageSize)
    return apiFetch(
      `/api/cloud/gcp/firestore/databases/${encodeURIComponent(db)}/collections/${encodeURIComponent(collection)}/documents?${params}`,
      { headers: headers() }
    )
  }

  // ── Cloud Spanner ────────────────────────────────────────────────────────────
  async function fetchSpannerDatabases(instance) {
    return apiFetch(`/api/cloud/gcp/spanner/instances/${encodeURIComponent(instance)}/databases`, { headers: headers() })
  }

  async function querySpanner(instance, database, sql) {
    return apiFetch(`/api/cloud/gcp/spanner/instances/${encodeURIComponent(instance)}/databases/${encodeURIComponent(database)}/query`, {
      method: 'POST',
      headers: { ...headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql }),
    })
  }

  // ── Cloud Tasks ──────────────────────────────────────────────────────────────
  async function fetchQueueTasks(location, queue) {
    return apiFetch(`/api/cloud/gcp/tasks/queues/${encodeURIComponent(location)}/${encodeURIComponent(queue)}/tasks`, { headers: headers() })
  }

  // ── Cloud Scheduler ──────────────────────────────────────────────────────────
  async function runSchedulerJob(location, name) {
    return apiFetch(`/api/cloud/gcp/scheduler/jobs/${encodeURIComponent(location)}/${encodeURIComponent(name)}/run`, {
      method: 'POST', headers: { ...headers(), 'Content-Type': 'application/json' }, body: '{}',
    })
  }

  async function pauseSchedulerJob(location, name) {
    return apiFetch(`/api/cloud/gcp/scheduler/jobs/${encodeURIComponent(location)}/${encodeURIComponent(name)}/pause`, {
      method: 'POST', headers: { ...headers(), 'Content-Type': 'application/json' }, body: '{}',
    })
  }

  async function resumeSchedulerJob(location, name) {
    return apiFetch(`/api/cloud/gcp/scheduler/jobs/${encodeURIComponent(location)}/${encodeURIComponent(name)}/resume`, {
      method: 'POST', headers: { ...headers(), 'Content-Type': 'application/json' }, body: '{}',
    })
  }

  // ── Cloud Build ──────────────────────────────────────────────────────────────
  async function fetchBuildLogs(id) {
    return apiFetch(`/api/cloud/gcp/build/builds/${encodeURIComponent(id)}/logs`, { headers: headers() })
  }

  // ── IAM Service Accounts ─────────────────────────────────────────────────────
  async function fetchIamKeys(email) {
    return apiFetch(`/api/cloud/gcp/iam/service-accounts/${encodeURIComponent(email)}/keys`, { headers: headers() })
  }

  function fetchMoreBuilds() {
    if (!tabs.build.nextPageToken) return
    return appendTab(tabs.build, `/api/cloud/gcp/build/builds?pageToken=${encodeURIComponent(tabs.build.nextPageToken)}`)
  }

  function fetchMoreIamServiceAccounts() {
    if (!tabs.iam.nextPageToken) return
    return appendTab(tabs.iam, `/api/cloud/gcp/iam/service-accounts?pageToken=${encodeURIComponent(tabs.iam.nextPageToken)}`)
  }

  function fetchMoreQueueTasks(location, queue) {
    if (!tabs.tasks.nextPageToken) return
    return appendTab(tabs.tasks, `/api/cloud/gcp/tasks/queues/${encodeURIComponent(location)}/${encodeURIComponent(queue)}/tasks?pageToken=${encodeURIComponent(tabs.tasks.nextPageToken)}`)
  }

  // Computed shortcuts for templates
  const cloudRunServices = { get value() { return tabs.cloudrun.data } }
  const gkeClusters      = { get value() { return tabs.gke.data } }
  const vms              = { get value() { return tabs.vms.data } }

  return {
    activeProfileId, tabs,
    cloudRunServices, gkeClusters, vms,
    setActiveProfile,
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
  }
})
