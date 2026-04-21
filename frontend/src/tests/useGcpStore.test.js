import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useGcpStore } from '../stores/useGcpStore'

// ─── fetch helpers ─────────────────────────────────────────────────────────────

function mockFetchOk(json) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    json: () => Promise.resolve(json),
    text: () => Promise.resolve(''),
  })
}

function mockFetchPaginated(items, nextPageToken = null) {
  return mockFetchOk({ items, nextPageToken })
}

function mockFetchError(errorMsg, status = 400) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: false,
    status,
    headers: { get: () => 'application/json' },
    json: () => Promise.resolve({ error: errorMsg }),
    text: () => Promise.resolve(''),
  })
}

function mockFetchNetworkError(msg = 'Network failure') {
  global.fetch = vi.fn().mockRejectedValue(new Error(msg))
}

// ─── Setup ────────────────────────────────────────────────────────────────────

let store

beforeEach(() => {
  setActivePinia(createPinia())
  store = useGcpStore()
  vi.restoreAllMocks()
})

// ─── Initial state ─────────────────────────────────────────────────────────────

describe('initial state', () => {
  it('has no active profile', () => {
    expect(store.activeProfileId).toBeNull()
  })

  it('has all expected tab keys', () => {
    const keys = Object.keys(store.tabs)
    expect(keys).toEqual(expect.arrayContaining([
      'cloudrun', 'gke', 'vms', 'sql', 'storage', 'functions', 'pubsub',
      'secrets', 'artifact', 'bigquery', 'workflows', 'dns', 'firestore',
      'spanner', 'memorystore', 'tasks', 'scheduler', 'build', 'iam',
    ]))
  })

  it('every tab starts with empty/false/null state', () => {
    Object.values(store.tabs).forEach(tab => {
      expect(tab.data).toEqual([])
      expect(tab.loading).toBe(false)
      expect(tab.error).toBeNull()
      expect(tab.enableUrl).toBeNull()
      expect(tab.nextPageToken).toBeNull()
      expect(tab.loadingMore).toBe(false)
    })
  })
})

// ─── setActiveProfile ──────────────────────────────────────────────────────────

describe('setActiveProfile()', () => {
  it('sets activeProfileId', () => {
    store.setActiveProfile('proj-123')
    expect(store.activeProfileId).toBe('proj-123')
  })

  it('resets all tabs when switching profile', async () => {
    store.setActiveProfile('proj-a')
    mockFetchPaginated([{ name: 'service-1' }], 'tok-next')
    await store.fetchCloudRunServices()
    expect(store.tabs.cloudrun.data).toHaveLength(1)

    store.setActiveProfile('proj-b')
    expect(store.tabs.cloudrun.data).toEqual([])
    expect(store.tabs.cloudrun.loading).toBe(false)
    expect(store.tabs.cloudrun.error).toBeNull()
    expect(store.tabs.cloudrun.nextPageToken).toBeNull()
  })

  it('clears errors on all tabs when switching profile', async () => {
    store.setActiveProfile('proj-a')
    mockFetchError('Permission denied')
    await store.fetchBuilds()
    expect(store.tabs.build.error).toBeTruthy()

    store.setActiveProfile('proj-b')
    expect(store.tabs.build.error).toBeNull()
  })
})

// ─── fetchTab / loading states ─────────────────────────────────────────────────

describe('fetchTab loading lifecycle', () => {
  it('sets loading=true during fetch and false after', async () => {
    store.setActiveProfile('proj-1')
    let resolveFn
    global.fetch = vi.fn().mockReturnValue(new Promise(r => { resolveFn = r }))
    const promise = store.fetchCloudRunServices()
    expect(store.tabs.cloudrun.loading).toBe(true)
    resolveFn({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: () => Promise.resolve([]) })
    await promise
    expect(store.tabs.cloudrun.loading).toBe(false)
  })

  it('clears previous error on new fetch', async () => {
    store.setActiveProfile('proj-1')
    mockFetchError('Something broke')
    await store.fetchGkeClusters()
    expect(store.tabs.gke.error).toBeTruthy()

    mockFetchOk([])
    await store.fetchGkeClusters()
    expect(store.tabs.gke.error).toBeNull()
  })
})

// ─── headers guard ────────────────────────────────────────────────────────────

describe('headers() guard', () => {
  it('throws if no profile is set before fetch', async () => {
    // No setActiveProfile call — store.activeProfileId is null
    await store.fetchCloudRunServices()
    // The error gets caught by fetchTab and stored in the tab
    expect(store.tabs.cloudrun.error).toMatch(/No GCP profile/i)
  })
})

// ─── fetchTab {items,nextPageToken} format ────────────────────────────────────

describe('fetchTab — paginated response format', () => {
  beforeEach(() => store.setActiveProfile('proj-1'))

  it('stores items and nextPageToken from {items,nextPageToken} response', async () => {
    mockFetchPaginated([{ id: 'b1' }, { id: 'b2' }], 'page-token-abc')
    await store.fetchBuilds()
    expect(store.tabs.build.data).toHaveLength(2)
    expect(store.tabs.build.nextPageToken).toBe('page-token-abc')
  })

  it('sets nextPageToken to null when response has no more pages', async () => {
    mockFetchPaginated([{ id: 'b1' }], null)
    await store.fetchBuilds()
    expect(store.tabs.build.nextPageToken).toBeNull()
  })

  it('still works with plain array responses (backward compat)', async () => {
    mockFetchOk([{ email: 'sa@proj.iam.gserviceaccount.com' }])
    await store.fetchCloudRunServices()
    expect(store.tabs.cloudrun.data).toHaveLength(1)
    expect(store.tabs.cloudrun.nextPageToken).toBeNull()
  })

  it('resets nextPageToken on new fetch', async () => {
    mockFetchPaginated([{ id: 'b1' }], 'tok-1')
    await store.fetchBuilds()
    expect(store.tabs.build.nextPageToken).toBe('tok-1')

    mockFetchPaginated([{ id: 'b2' }], null)
    await store.fetchBuilds()
    expect(store.tabs.build.nextPageToken).toBeNull()
  })
})

// ─── appendTab / fetchMore ─────────────────────────────────────────────────────

describe('fetchMoreBuilds()', () => {
  beforeEach(() => store.setActiveProfile('proj-1'))

  it('appends items and updates nextPageToken', async () => {
    mockFetchPaginated([{ id: 'b1' }], 'tok-1')
    await store.fetchBuilds()

    mockFetchPaginated([{ id: 'b2' }, { id: 'b3' }], 'tok-2')
    await store.fetchMoreBuilds()

    expect(store.tabs.build.data).toHaveLength(3)
    expect(store.tabs.build.data.map(b => b.id)).toEqual(['b1', 'b2', 'b3'])
    expect(store.tabs.build.nextPageToken).toBe('tok-2')
  })

  it('sends pageToken in the request URL', async () => {
    mockFetchPaginated([{ id: 'b1' }], 'my-token')
    await store.fetchBuilds()

    // New mock for the "load more" call — check its call directly
    mockFetchPaginated([{ id: 'b2' }], null)
    await store.fetchMoreBuilds()

    const [url] = global.fetch.mock.calls[0]
    expect(url).toContain('pageToken=my-token')
  })

  it('does nothing if nextPageToken is null', async () => {
    mockFetchPaginated([{ id: 'b1' }], null)
    await store.fetchBuilds()
    const callCount = global.fetch.mock.calls.length

    await store.fetchMoreBuilds()
    expect(global.fetch.mock.calls.length).toBe(callCount) // no extra call
  })

  it('clears loadingMore after completion', async () => {
    mockFetchPaginated([{ id: 'b1' }], 'tok')
    await store.fetchBuilds()
    mockFetchPaginated([{ id: 'b2' }], null)
    await store.fetchMoreBuilds()
    expect(store.tabs.build.loadingMore).toBe(false)
  })
})

describe('fetchMoreIamServiceAccounts()', () => {
  beforeEach(() => store.setActiveProfile('proj-1'))

  it('appends IAM accounts across pages', async () => {
    mockFetchPaginated([{ email: 'sa1@p.iam.gserviceaccount.com' }], 'tok-iam')
    await store.fetchIamServiceAccounts()

    mockFetchPaginated([{ email: 'sa2@p.iam.gserviceaccount.com' }], null)
    await store.fetchMoreIamServiceAccounts()

    expect(store.tabs.iam.data).toHaveLength(2)
    expect(store.tabs.iam.nextPageToken).toBeNull()
  })
})

// ─── Base fetch functions ──────────────────────────────────────────────────────

describe('base fetch functions', () => {
  beforeEach(() => store.setActiveProfile('proj-1'))

  const cases = [
    ['fetchCloudRunServices', 'cloudrun',    '/api/cloud/gcp/cloudrun'],
    ['fetchGkeClusters',      'gke',         '/api/cloud/gcp/gke'],
    ['fetchVMs',              'vms',         '/api/cloud/gcp/compute/vms'],
    ['fetchSqlInstances',     'sql',         '/api/cloud/gcp/sql'],
    ['fetchBuckets',          'storage',     '/api/cloud/gcp/storage/buckets'],
    ['fetchFunctions',        'functions',   '/api/cloud/gcp/functions'],
    ['fetchPubSubTopics',     'pubsub',      '/api/cloud/gcp/pubsub/topics'],
    ['fetchSecrets',          'secrets',     '/api/cloud/gcp/secrets'],
    ['fetchArtifactRegistry', 'artifact',    '/api/cloud/gcp/artifact-registry'],
    ['fetchBigQueryDatasets', 'bigquery',    '/api/cloud/gcp/bigquery/datasets'],
    ['fetchWorkflows',        'workflows',   '/api/cloud/gcp/workflows'],
    ['fetchDnsZones',         'dns',         '/api/cloud/gcp/dns/zones'],
    ['fetchFirestoreDbs',     'firestore',   '/api/cloud/gcp/firestore/databases'],
    ['fetchSpannerInstances', 'spanner',     '/api/cloud/gcp/spanner/instances'],
    ['fetchMemorystore',      'memorystore', '/api/cloud/gcp/memorystore/instances'],
    ['fetchTaskQueues',       'tasks',       '/api/cloud/gcp/tasks/queues'],
    ['fetchSchedulerJobs',    'scheduler',   '/api/cloud/gcp/scheduler/jobs'],
    ['fetchBuilds',           'build',       '/api/cloud/gcp/build/builds'],
    ['fetchIamServiceAccounts', 'iam',       '/api/cloud/gcp/iam/service-accounts'],
  ]

  it.each(cases)('%s() calls correct URL and stores data in tabs.%s', async (fn, tab, url) => {
    const payload = [{ id: 'item-1' }]
    mockFetchOk(payload)
    await store[fn]()
    expect(global.fetch).toHaveBeenCalledWith(url, expect.objectContaining({ method: 'GET' }))
    expect(store.tabs[tab].data).toEqual(payload)
    expect(store.tabs[tab].error).toBeNull()
  })

  it.each(cases)('%s() stores error in tabs.%s on failure', async (fn, tab) => {
    mockFetchError('PERMISSION_DENIED')
    await store[fn]()
    expect(store.tabs[tab].error).toBeTruthy()
    expect(store.tabs[tab].data).toEqual([])
  })

  it('sends X-Profile-Id header on every request', async () => {
    mockFetchOk([])
    await store.fetchBuilds()
    const [, opts] = global.fetch.mock.calls[0]
    expect(opts.headers['X-Profile-Id']).toBe('proj-1')
  })
})

// ─── enableUrl extraction ──────────────────────────────────────────────────────

describe('enableUrl extraction from PERMISSION_DENIED', () => {
  beforeEach(() => store.setActiveProfile('proj-1'))

  it('extracts enable URL from plain error message', async () => {
    const url = 'https://console.developers.google.com/apis/api/cloudbuild.googleapis.com/overview?project=my-proj'
    mockFetchError(`PERMISSION_DENIED: ${url}`)
    await store.fetchBuilds()
    expect(store.tabs.build.enableUrl).toBe(url)
  })

  it('leaves enableUrl null when error has no enable URL', async () => {
    mockFetchError('Some unrelated error')
    await store.fetchBuilds()
    expect(store.tabs.build.enableUrl).toBeNull()
  })
})

// ─── normalizeErrorMessage ─────────────────────────────────────────────────────

describe('error message normalization', () => {
  beforeEach(() => store.setActiveProfile('proj-1'))

  it('extracts message from JSON GCP error body', async () => {
    const gcpError = JSON.stringify({ error: { message: 'Quota exceeded' } })
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve({ error: gcpError }),
      text: () => Promise.resolve(''),
    })
    await store.fetchBuilds()
    // The raw error string is the gcpError JSON; normalizeErrorMessage should parse it
    expect(store.tabs.build.error).toContain('Quota exceeded')
  })

  it('returns raw string if not JSON', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      headers: { get: () => 'text/plain' },
      json: () => Promise.resolve({}),
      text: () => Promise.resolve('Service unavailable'),
    })
    await store.fetchBuilds()
    expect(store.tabs.build.error).toMatch(/Service unavailable/i)
  })
})

// ─── Cloud Run actions ─────────────────────────────────────────────────────────

describe('startCloudRunService() / stopCloudRunService()', () => {
  beforeEach(() => store.setActiveProfile('proj-1'))

  it('POSTs to correct URL for start', async () => {
    mockFetchOk({ status: 'RUNNING' })
    await store.startCloudRunService('us-central1', 'my-svc')
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/cloud/gcp/cloudrun/us-central1/my-svc/start',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('POSTs to correct URL for stop', async () => {
    mockFetchOk({ status: 'STOPPED' })
    await store.stopCloudRunService('us-east1', 'other-svc')
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/cloud/gcp/cloudrun/us-east1/other-svc/stop',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('returns null and sets tab error on failure', async () => {
    mockFetchError('Forbidden')
    const result = await store.startCloudRunService('us-central1', 'svc')
    expect(result).toBeNull()
    expect(store.tabs.cloudrun.error).toBe('Forbidden')
  })
})

// ─── VM actions ───────────────────────────────────────────────────────────────

describe('startVM() / stopVM()', () => {
  beforeEach(() => store.setActiveProfile('proj-1'))

  it('POSTs to correct start URL', async () => {
    mockFetchOk({ status: 'RUNNING' })
    await store.startVM('us-central1-a', 'vm-01')
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/cloud/gcp/compute/vms/us-central1-a/vm-01/start',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('POSTs to correct stop URL', async () => {
    mockFetchOk({ status: 'TERMINATED' })
    await store.stopVM('us-central1-b', 'vm-02')
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/cloud/gcp/compute/vms/us-central1-b/vm-02/stop',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('returns null and sets vms error on failure', async () => {
    mockFetchError('Not Found', 404)
    const result = await store.stopVM('us-central1-a', 'missing-vm')
    expect(result).toBeNull()
    expect(store.tabs.vms.error).toBe('Not Found')
  })
})

// ─── SQL actions ──────────────────────────────────────────────────────────────

describe('startSqlInstance() / stopSqlInstance()', () => {
  beforeEach(() => store.setActiveProfile('proj-1'))

  it('POSTs to start URL', async () => {
    mockFetchOk({ status: 'RUNNABLE' })
    await store.startSqlInstance('db-instance')
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/cloud/gcp/sql/db-instance/start',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('POSTs to stop URL', async () => {
    mockFetchOk({ status: 'SUSPENDED' })
    await store.stopSqlInstance('db-instance')
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/cloud/gcp/sql/db-instance/stop',
      expect.objectContaining({ method: 'POST' })
    )
  })
})

// ─── Cloud Functions ──────────────────────────────────────────────────────────

describe('invokeFunction()', () => {
  beforeEach(() => store.setActiveProfile('proj-1'))

  it('POSTs payload as JSON', async () => {
    mockFetchOk({ result: 'ok' })
    await store.invokeFunction('us-central1', 'my-fn', { key: 'val' })
    const [url, opts] = global.fetch.mock.calls[0]
    expect(url).toBe('/api/cloud/gcp/functions/us-central1/my-fn/invoke')
    expect(opts.method).toBe('POST')
    expect(JSON.parse(opts.body)).toEqual({ key: 'val' })
  })

  it('returns null and sets functions error on failure', async () => {
    mockFetchError('Invocation failed')
    const result = await store.invokeFunction('us-central1', 'bad-fn', {})
    expect(result).toBeNull()
    expect(store.tabs.functions.error).toBe('Invocation failed')
  })
})

describe('fetchFunctionLogs()', () => {
  beforeEach(() => store.setActiveProfile('proj-1'))

  it('fetches logs with query params', async () => {
    mockFetchOk([])
    await store.fetchFunctionLogs('us-central1', 'my-fn', { limit: 50, hours: 24 })
    const [url] = global.fetch.mock.calls[0]
    expect(url).toContain('/api/cloud/gcp/functions/us-central1/my-fn/logs')
    expect(url).toContain('limit=50')
    expect(url).toContain('hours=24')
  })
})

// ─── Secrets ──────────────────────────────────────────────────────────────────

describe('previewSecretKeys() / importSecretKeys()', () => {
  beforeEach(() => store.setActiveProfile('proj-1'))

  it('GETs preview-keys URL', async () => {
    mockFetchOk({ keys: ['KEY_A', 'KEY_B'] })
    const result = await store.previewSecretKeys('my-secret')
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/cloud/gcp/secrets/my-secret/preview-keys',
      expect.objectContaining({ method: 'GET' })
    )
    expect(result).toEqual({ keys: ['KEY_A', 'KEY_B'] })
  })

  it('POSTs selected keys to import-selected', async () => {
    mockFetchOk({ imported: 2 })
    await store.importSecretKeys('my-secret', { keys: ['KEY_A'] })
    const [url, opts] = global.fetch.mock.calls[0]
    expect(url).toBe('/api/cloud/gcp/secrets/my-secret/import-selected')
    expect(opts.method).toBe('POST')
    expect(JSON.parse(opts.body)).toEqual({ keys: ['KEY_A'] })
  })
})

// ─── Artifact Registry ────────────────────────────────────────────────────────

describe('fetchArtifactPackages()', () => {
  beforeEach(() => store.setActiveProfile('proj-1'))

  it('calls correct URL with encoded params', async () => {
    mockFetchOk([{ name: 'pkg-1' }])
    await store.fetchArtifactPackages('us-central1', 'my-repo')
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/cloud/gcp/artifact-registry/us-central1/my-repo/packages',
      expect.objectContaining({ method: 'GET' })
    )
  })
})

// ─── BigQuery ─────────────────────────────────────────────────────────────────

describe('BigQuery actions', () => {
  beforeEach(() => store.setActiveProfile('proj-1'))

  it('fetchBigQueryTables() calls datasets/:id/tables', async () => {
    mockFetchOk([{ tableId: 'tbl-1' }])
    const result = await store.fetchBigQueryTables('my-dataset')
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/cloud/gcp/bigquery/datasets/my-dataset/tables',
      expect.objectContaining({ method: 'GET' })
    )
    expect(result).toEqual([{ tableId: 'tbl-1' }])
  })

  it('runBigQuery() POSTs query and returns job result', async () => {
    mockFetchOk({ jobId: 'job-abc', done: true, rows: [] })
    const result = await store.runBigQuery('SELECT 1')
    const [url, opts] = global.fetch.mock.calls[0]
    expect(url).toBe('/api/cloud/gcp/bigquery/query')
    expect(opts.method).toBe('POST')
    expect(JSON.parse(opts.body)).toEqual({ query: 'SELECT 1' })
    expect(result.jobId).toBe('job-abc')
  })

  it('pollBigQueryJob() calls query/:jobId', async () => {
    mockFetchOk({ done: true, rows: [{ f: [{ v: '42' }] }] })
    const result = await store.pollBigQueryJob('job-xyz')
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/cloud/gcp/bigquery/query/job-xyz',
      expect.objectContaining({ method: 'GET' })
    )
    expect(result.done).toBe(true)
  })
})

// ─── Cloud Workflows ──────────────────────────────────────────────────────────

describe('Cloud Workflows actions', () => {
  beforeEach(() => store.setActiveProfile('proj-1'))

  it('fetchWorkflowExecutions() calls correct URL', async () => {
    mockFetchOk([{ name: 'exec-1' }])
    await store.fetchWorkflowExecutions('us-central1', 'my-workflow')
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/cloud/gcp/workflows/us-central1/my-workflow/executions',
      expect.objectContaining({ method: 'GET' })
    )
  })

  it('fetchWorkflowDefinition() calls correct URL', async () => {
    mockFetchOk({ source: 'main: ...' })
    await store.fetchWorkflowDefinition('us-east1', 'wf-2')
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/cloud/gcp/workflows/us-east1/wf-2/definition',
      expect.objectContaining({ method: 'GET' })
    )
  })
})

// ─── Cloud DNS ────────────────────────────────────────────────────────────────

describe('fetchDnsRecords()', () => {
  beforeEach(() => store.setActiveProfile('proj-1'))

  it('calls correct URL for zone records', async () => {
    mockFetchOk([{ type: 'A', name: 'example.com.' }])
    const result = await store.fetchDnsRecords('my-zone')
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/cloud/gcp/dns/zones/my-zone/records',
      expect.objectContaining({ method: 'GET' })
    )
    expect(result[0].type).toBe('A')
  })
})

// ─── Firestore ────────────────────────────────────────────────────────────────

describe('Firestore actions', () => {
  beforeEach(() => store.setActiveProfile('proj-1'))

  it('fetchFirestoreCollections() calls correct URL', async () => {
    mockFetchOk(['users', 'orders'])
    await store.fetchFirestoreCollections('(default)')
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/cloud/gcp/firestore/databases/(default)/collections',
      expect.objectContaining({ method: 'GET' })
    )
  })

  it('fetchFirestoreDocuments() sends pageToken and pageSize params', async () => {
    mockFetchOk({ documents: [] })
    await store.fetchFirestoreDocuments('(default)', 'users', { pageToken: 'tok-1', pageSize: 25 })
    const [url] = global.fetch.mock.calls[0]
    expect(url).toContain('/api/cloud/gcp/firestore/databases/(default)/collections/users/documents')
    expect(url).toContain('pageToken=tok-1')
    expect(url).toContain('pageSize=25')
  })

  it('fetchFirestoreDocuments() works without optional params', async () => {
    mockFetchOk({ documents: [] })
    await store.fetchFirestoreDocuments('(default)', 'orders')
    const [url] = global.fetch.mock.calls[0]
    expect(url).not.toContain('pageToken')
    expect(url).not.toContain('pageSize')
  })
})

// ─── Cloud Spanner ────────────────────────────────────────────────────────────

describe('Cloud Spanner actions', () => {
  beforeEach(() => store.setActiveProfile('proj-1'))

  it('fetchSpannerDatabases() calls correct URL', async () => {
    mockFetchOk([{ name: 'db-1' }])
    await store.fetchSpannerDatabases('my-instance')
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/cloud/gcp/spanner/instances/my-instance/databases',
      expect.objectContaining({ method: 'GET' })
    )
  })

  it('querySpanner() POSTs SQL and returns rows', async () => {
    mockFetchOk({ rows: [{ col: 'val' }] })
    const result = await store.querySpanner('inst-1', 'db-1', 'SELECT * FROM users')
    const [url, opts] = global.fetch.mock.calls[0]
    expect(url).toBe('/api/cloud/gcp/spanner/instances/inst-1/databases/db-1/query')
    expect(opts.method).toBe('POST')
    expect(JSON.parse(opts.body)).toEqual({ sql: 'SELECT * FROM users' })
    expect(result.rows).toHaveLength(1)
  })
})

// ─── Cloud Tasks ──────────────────────────────────────────────────────────────

describe('fetchQueueTasks()', () => {
  beforeEach(() => store.setActiveProfile('proj-1'))

  it('calls correct URL for queue tasks', async () => {
    mockFetchOk([{ name: 'task-1' }])
    await store.fetchQueueTasks('us-central1', 'my-queue')
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/cloud/gcp/tasks/queues/us-central1/my-queue/tasks',
      expect.objectContaining({ method: 'GET' })
    )
  })
})

// ─── Cloud Scheduler ──────────────────────────────────────────────────────────

describe('Cloud Scheduler actions', () => {
  beforeEach(() => store.setActiveProfile('proj-1'))

  it('runSchedulerJob() POSTs to run URL', async () => {
    mockFetchOk({})
    await store.runSchedulerJob('us-central1', 'my-job')
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/cloud/gcp/scheduler/jobs/us-central1/my-job/run',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('pauseSchedulerJob() POSTs to pause URL', async () => {
    mockFetchOk({})
    await store.pauseSchedulerJob('us-east1', 'cron-job')
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/cloud/gcp/scheduler/jobs/us-east1/cron-job/pause',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('resumeSchedulerJob() POSTs to resume URL', async () => {
    mockFetchOk({})
    await store.resumeSchedulerJob('europe-west1', 'paused-job')
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/cloud/gcp/scheduler/jobs/europe-west1/paused-job/resume',
      expect.objectContaining({ method: 'POST' })
    )
  })
})

// ─── Cloud Build ──────────────────────────────────────────────────────────────

describe('fetchBuildLogs()', () => {
  beforeEach(() => store.setActiveProfile('proj-1'))

  it('calls correct URL for build logs', async () => {
    mockFetchOk({ logsBucket: 'gs://bucket', logUrl: 'https://...' })
    const result = await store.fetchBuildLogs('build-abc123')
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/cloud/gcp/build/builds/build-abc123/logs',
      expect.objectContaining({ method: 'GET' })
    )
    expect(result.logsBucket).toBe('gs://bucket')
  })
})

// ─── IAM Service Accounts ─────────────────────────────────────────────────────

describe('fetchIamKeys()', () => {
  beforeEach(() => store.setActiveProfile('proj-1'))

  it('calls correct URL for service account keys', async () => {
    mockFetchOk([{ name: 'key-1', keyType: 'USER_MANAGED' }])
    const result = await store.fetchIamKeys('sa@proj.iam.gserviceaccount.com')
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/cloud/gcp/iam/service-accounts/sa%40proj.iam.gserviceaccount.com/keys',
      expect.objectContaining({ method: 'GET' })
    )
    expect(result[0].keyType).toBe('USER_MANAGED')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// FASE 4 – Cloud Run Jobs, Pub/Sub Subscriptions, VPC, Monitoring, Logging, KMS
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Cloud Run Jobs ───────────────────────────────────────────────────────────

describe('fetchCloudRunJobs()', () => {
  beforeEach(() => store.setActiveProfile('proj-1'))

  it('loads jobs into tabs.cloudrunJobs.data', async () => {
    mockFetchOk([{ name: 'job-1', location: 'us-central1' }])
    await store.fetchCloudRunJobs()
    expect(store.tabs.cloudrunJobs.data).toEqual([{ name: 'job-1', location: 'us-central1' }])
    expect(global.fetch).toHaveBeenCalledWith('/api/cloud/gcp/cloudrun-jobs', expect.anything())
  })

  it('sets error on failure', async () => {
    mockFetchError('Permission denied', 403)
    await store.fetchCloudRunJobs()
    expect(store.tabs.cloudrunJobs.error).toMatch(/Permission denied/i)
  })
})

describe('runCloudRunJob()', () => {
  beforeEach(() => store.setActiveProfile('proj-1'))

  it('calls correct POST URL', async () => {
    mockFetchOk({ ok: true })
    await store.runCloudRunJob('us-central1', 'my-job')
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/cloud/gcp/cloudrun-jobs/us-central1/my-job/run',
      expect.objectContaining({ method: 'POST' })
    )
  })
})

describe('fetchJobExecutions()', () => {
  beforeEach(() => store.setActiveProfile('proj-1'))

  it('calls correct URL for executions', async () => {
    mockFetchOk([{ name: 'exec-001', state: 'EXECUTION_SUCCEEDED' }])
    const result = await store.fetchJobExecutions('us-central1', 'my-job')
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/cloud/gcp/cloudrun-jobs/us-central1/my-job/executions',
      expect.objectContaining({ method: 'GET' })
    )
    expect(result[0].name).toBe('exec-001')
  })
})

// ─── Pub/Sub Subscriptions ────────────────────────────────────────────────────

describe('fetchPubSubSubscriptions()', () => {
  beforeEach(() => store.setActiveProfile('proj-1'))

  it('loads subscriptions into tabs.pubsubSubs.data', async () => {
    mockFetchOk([{ name: 'sub-1', topic: 'topic-a', type: 'pull' }])
    await store.fetchPubSubSubscriptions()
    expect(store.tabs.pubsubSubs.data).toEqual([{ name: 'sub-1', topic: 'topic-a', type: 'pull' }])
    expect(global.fetch).toHaveBeenCalledWith('/api/cloud/gcp/pubsub/subscriptions', expect.anything())
  })

  it('sets error on failure', async () => {
    mockFetchError('API disabled', 403)
    await store.fetchPubSubSubscriptions()
    expect(store.tabs.pubsubSubs.error).toMatch(/API disabled/i)
  })
})

// ─── VPC Networks ─────────────────────────────────────────────────────────────

describe('fetchVpcNetworks()', () => {
  beforeEach(() => store.setActiveProfile('proj-1'))

  it('loads VPC networks into tabs.vpc.data', async () => {
    mockFetchOk([{ name: 'default', autoSubnet: true, routingMode: 'REGIONAL' }])
    await store.fetchVpcNetworks()
    expect(store.tabs.vpc.data).toEqual([{ name: 'default', autoSubnet: true, routingMode: 'REGIONAL' }])
    expect(global.fetch).toHaveBeenCalledWith('/api/cloud/gcp/vpc/networks', expect.anything())
  })
})

describe('fetchVpcSubnets()', () => {
  beforeEach(() => store.setActiveProfile('proj-1'))

  it('calls correct URL for subnets', async () => {
    mockFetchOk([{ name: 'subnet-1', region: 'us-central1', ipRange: '10.0.0.0/24' }])
    const result = await store.fetchVpcSubnets('default')
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/cloud/gcp/vpc/networks/default/subnets',
      expect.objectContaining({ method: 'GET' })
    )
    expect(result[0].ipRange).toBe('10.0.0.0/24')
  })
})

// ─── Cloud Monitoring ─────────────────────────────────────────────────────────

describe('fetchAlertPolicies()', () => {
  beforeEach(() => store.setActiveProfile('proj-1'))

  it('loads alert policies into tabs.monitoring.data', async () => {
    mockFetchOk([{ name: 'policy-1', displayName: 'High CPU', enabled: true, state: 'ENABLED' }])
    await store.fetchAlertPolicies()
    expect(store.tabs.monitoring.data[0].displayName).toBe('High CPU')
    expect(global.fetch).toHaveBeenCalledWith('/api/cloud/gcp/monitoring/alerts', expect.anything())
  })

  it('sets error on failure', async () => {
    mockFetchError('Monitoring API not enabled', 403)
    await store.fetchAlertPolicies()
    expect(store.tabs.monitoring.error).toMatch(/Monitoring API not enabled/i)
  })
})

describe('fetchUptimeChecks()', () => {
  beforeEach(() => store.setActiveProfile('proj-1'))

  it('calls correct URL for uptime checks', async () => {
    mockFetchOk([{ name: 'check-1', displayName: 'HTTP Check', type: 'HTTP' }])
    const result = await store.fetchUptimeChecks()
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/cloud/gcp/monitoring/uptime-checks',
      expect.objectContaining({ method: 'GET' })
    )
    expect(result[0].type).toBe('HTTP')
  })
})

// ─── Cloud Logging ────────────────────────────────────────────────────────────

describe('queryLogs()', () => {
  beforeEach(() => store.setActiveProfile('proj-1'))

  it('stores log entries into tabs.logging.data', async () => {
    mockFetchOk({ entries: [{ timestamp: '2024-01-01T00:00:00Z', severity: 'INFO', message: 'hello' }], nextPageToken: null })
    await store.queryLogs('resource.type="gce_instance"', 50, 3)
    expect(store.tabs.logging.data).toHaveLength(1)
    expect(store.tabs.logging.data[0].message).toBe('hello')
  })

  it('calls logging endpoint via POST', async () => {
    mockFetchOk({ entries: [], nextPageToken: null })
    await store.queryLogs('severity>=ERROR', 100, 6)
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/cloud/gcp/logging/query',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('sets error on failure', async () => {
    mockFetchError('Logging API disabled', 403)
    await store.queryLogs('')
    expect(store.tabs.logging.error).toMatch(/Logging API disabled/i)
  })
})

// ─── Cloud KMS ────────────────────────────────────────────────────────────────

describe('fetchKmsKeyrings()', () => {
  beforeEach(() => store.setActiveProfile('proj-1'))

  it('loads key rings into tabs.kms.data', async () => {
    mockFetchOk([{ name: 'keyring-1', location: 'global', created: '2023-01-01T00:00:00Z' }])
    await store.fetchKmsKeyrings()
    expect(store.tabs.kms.data[0].name).toBe('keyring-1')
    expect(global.fetch).toHaveBeenCalledWith('/api/cloud/gcp/kms/keyrings', expect.anything())
  })

  it('sets error on failure', async () => {
    mockFetchError('KMS API not enabled', 403)
    await store.fetchKmsKeyrings()
    expect(store.tabs.kms.error).toMatch(/KMS API not enabled/i)
  })
})

describe('fetchKmsKeys()', () => {
  beforeEach(() => store.setActiveProfile('proj-1'))

  it('calls correct URL for crypto keys', async () => {
    mockFetchOk([{ name: 'key-1', purpose: 'ENCRYPT_DECRYPT', state: 'ENABLED' }])
    const result = await store.fetchKmsKeys('global', 'keyring-1')
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/cloud/gcp/kms/keyrings/global/keyring-1/keys',
      expect.objectContaining({ method: 'GET' })
    )
    expect(result[0].purpose).toBe('ENCRYPT_DECRYPT')
  })
})

// ─── Initial state for Fase 4 tabs ───────────────────────────────────────────

describe('Fase 4 tabs initial state', () => {
  it('all new tabs start empty and idle', () => {
    const f4 = ['cloudrunJobs', 'pubsubSubs', 'vpc', 'monitoring', 'logging', 'kms']
    for (const id of f4) {
      expect(store.tabs[id].data).toEqual([])
      expect(store.tabs[id].loading).toBe(false)
      expect(store.tabs[id].error).toBeNull()
    }
  })

  it('setActiveProfile resets all Fase 4 tabs', () => {
    store.tabs.cloudrunJobs.data = [{ name: 'job-x' }]
    store.tabs.kms.data = [{ name: 'ring-x' }]
    store.setActiveProfile('other-profile')
    expect(store.tabs.cloudrunJobs.data).toEqual([])
    expect(store.tabs.kms.data).toEqual([])
  })
})
