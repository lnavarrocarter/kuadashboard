import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useApmStore } from '../stores/useApmStore'

function response(body, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => body === null ? '' : 'application/json' },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(''),
  })
}

let store

beforeEach(() => {
  setActivePinia(createPinia())
  store = useApmStore()
  vi.restoreAllMocks()
})

describe('profile-scoped local reads', () => {
  it('resets state when the AWS profile changes', () => {
    store.setActiveProfile('local:dev')
    store.applications = [{ id: 'app-a' }]
    store.selectedApplicationId = 'app-a'
    store.setActiveProfile('local:other')
    expect(store.applications).toEqual([])
    expect(store.selectedApplicationId).toBeNull()
    expect(store.activeProfileId).toBe('local:other')
  })

  it('resets state when the provider changes and uses its isolated route', async () => {
    global.fetch = vi.fn((url) => {
      expect(url).toContain('/api/observability/gcp/applications')
      return response([])
    })
    store.setActiveProfile('shared-profile', 'aws')
    store.applications = [{ id: 'aws-app' }]
    store.setActiveProfile('shared-profile', 'gcp')

    expect(store.applications).toEqual([])
    expect(store.activeProvider).toBe('gcp')
    await store.loadApplications()
    expect(global.fetch).toHaveBeenCalledOnce()
  })

  it('loads provider-free applications from the local generic scope', async () => {
    global.fetch = vi.fn((url, options) => {
      expect(url).toContain('/api/observability/generic/applications')
      expect(options.headers['X-Profile-Id']).toBe('local')
      return response([])
    })
    store.setActiveProfile('local', 'generic')

    await store.loadApplications()

    expect(store.activeProvider).toBe('generic')
    expect(global.fetch).toHaveBeenCalledOnce()
  })

  it('refreshes only SQLite-backed GET endpoints', async () => {
    global.fetch = vi.fn((url, options = {}) => {
      expect(options.headers['X-Profile-Id']).toBe('local:dev')
      if (url.endsWith('/applications')) return response([{ id: 'app-a', name: 'orders' }])
      if (url.endsWith('/usage')) return response({ total: 4, limit: 100000 })
      if (url.includes('/overview')) return response({ metrics: [], resources: [] })
      if (url.endsWith('/topology')) return response({ application: { id: 'app-a' }, resources: [], edges: [] })
      if (url.endsWith('/forecast')) return response({ monthlyRequestsMaximum: 2880 })
      if (url.endsWith('/registry')) return response({ resources: [], relationships: [], syncStatus: null })
      throw new Error(`Unexpected URL: ${url}`)
    })
    store.setActiveProfile('local:dev')
    await store.refreshLocal()
    expect(global.fetch).toHaveBeenCalledTimes(6)
    expect(global.fetch.mock.calls.every(([, options]) => (options.method || 'GET') === 'GET')).toBe(true)
    expect(store.selectedApplicationId).toBe('app-a')
  })

  it('aggregates resource series by bucket and keeps partial quality', async () => {
    global.fetch = vi.fn().mockImplementation(() => response([
      { bucketStart: 1000, sum: 2, quality: 'full' },
      { bucketStart: 1000, sum: 3, quality: 'partial' },
      { bucketStart: 2000, sum: 1, quality: 'full' },
    ]))
    store.setActiveProfile('local:dev')
    store.selectedApplicationId = 'app-a'
    const points = await store.loadSeries('invocations_observed')
    expect(points).toEqual([
      { t: 1000, v: 5, quality: 'partial' },
      { t: 2000, v: 1, quality: 'full' },
    ])
  })
})

describe('registry sync diagnostics', () => {
  it('loads the last sync status without blocking on failure', async () => {
    global.fetch = vi.fn(() => response({ error: 'boom' }, 500))
    store.setActiveProfile('local:dev')
    store.selectedApplicationId = 'app-a'

    const status = await store.loadRegistrySyncStatus()

    expect(status).toBeNull()
    expect(store.syncStatus).toBeNull()
  })

  it('stores the sync status returned by the registry endpoint', async () => {
    global.fetch = vi.fn(() => response({
      resources: [], relationships: [],
      syncStatus: { lastSuccessAt: '2026-08-27T10:00:00.000Z', lastError: null, divergentResourceCount: 1, divergentRelationshipCount: 0 },
    }))
    store.setActiveProfile('local:dev')
    store.selectedApplicationId = 'app-a'

    const status = await store.loadRegistrySyncStatus()

    expect(status.divergentResourceCount).toBe(1)
    expect(store.syncStatus.lastSuccessAt).toBe('2026-08-27T10:00:00.000Z')
  })

  it('updates the sync status after a manual reconcile', async () => {
    global.fetch = vi.fn((url, options = {}) => {
      expect(url).toContain('/registry/reconcile')
      expect(options.method).toBe('POST')
      return response({
        resources: [], relationships: [],
        syncStatus: { lastSuccessAt: '2026-08-27T11:00:00.000Z', lastError: null, divergentResourceCount: 0, divergentRelationshipCount: 0 },
      })
    })
    store.setActiveProfile('local:dev')
    store.selectedApplicationId = 'app-a'

    await store.reconcileSharedRegistry()

    expect(store.syncStatus.lastSuccessAt).toBe('2026-08-27T11:00:00.000Z')
  })
})

describe('explicit writes', () => {
  it('uses POST only when collectNow is called', async () => {
    global.fetch = vi.fn((url, options = {}) => {
      if (url.endsWith('/collect-now')) {
        expect(options.method).toBe('POST')
        return response({ run: { status: 'completed' } })
      }
      if (url.includes('/overview')) return response({ metrics: [], resources: [] })
      if (url.endsWith('/topology')) return response({ application: {}, resources: [], edges: [] })
      if (url.endsWith('/forecast')) return response({ monthlyRequestsMaximum: 0 })
      if (url.endsWith('/usage')) return response({ total: 1 })
      throw new Error(`Unexpected URL: ${url}`)
    })
    store.setActiveProfile('local:dev')
    store.selectedApplicationId = 'app-a'
    const result = await store.collectNow()
    expect(result.run.status).toBe('completed')
    expect(global.fetch.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(1)
  })

  it('runs candidate analysis and threshold updates only when explicitly requested', async () => {
    global.fetch = vi.fn((url, options = {}) => {
      if (url.endsWith('/candidates')) {
        expect(options.method).toBe('POST')
        return response({ estimate: { awsRequests: 0 }, candidates: [{ name: 'orders', status: 'suggested' }] })
      }
      if (url.endsWith('/applications/app-a/thresholds')) {
        expect(options.method).toBe('PATCH')
        return response({ errorRatePercent: 2, durationMs: 750, readyPodsPercent: 100, restartDelta: 1 })
      }
      throw new Error(`Unexpected URL: ${url}`)
    })
    store.setActiveProfile('local:dev')
    store.applications = [{ id: 'app-a', name: 'orders' }]

    const discovery = await store.discoverCandidates({ name: 'orders' }, [{ type: 'lambda', name: 'orders' }])
    expect(discovery.candidates[0].status).toBe('suggested')
    const thresholds = await store.updateThresholds('app-a', { errorRatePercent: 2 })
    expect(thresholds.durationMs).toBe(750)
    expect(store.applications[0].thresholds.errorRatePercent).toBe(2)
  })

  it('replaces topology with explicit cloud analysis without confirming suggestions', async () => {
    global.fetch = vi.fn((url, options = {}) => {
      expect(url).toContain('/applications/app-a/topology/analyze-cloud')
      expect(options.method).toBe('POST')
      return response({
        application: { id: 'app-a' }, resources: [], edges: [],
        analysis: {
          suggestions: [{ confirmed: false, relationType: 'invokes' }],
          cloudScan: { suggestions: [{ sourceResourceId: 'flow', targetResourceId: 'worker', relationType: 'invokes' }] },
        },
      })
    })
    store.setActiveProfile('local:prod')
    store.selectedApplicationId = 'app-a'

    const analysis = await store.analyzeCloudTopology('app-a')

    expect(analysis.suggestions[0].confirmed).toBe(false)
    expect(store.topology.edges).toEqual([])
  })

  it('confirms every distinct suggested dependency before one topology refresh', async () => {
    global.fetch = vi.fn((url, options = {}) => {
      if (url.endsWith('/edges')) {
        expect(options.method).toBe('POST')
        return response({ id: 'edge' }, 201)
      }
      if (url.includes('/overview')) return response({ metrics: [], resources: [] })
      if (url.endsWith('/topology')) return response({ application: { id: 'app-a' }, resources: [], edges: [], analysis: {} })
      if (url.includes('/forecast')) return response({ monthlyRequestsMaximum: 0 })
      if (url.endsWith('/registry')) return response({ resources: [], relationships: [], syncStatus: null })
      throw new Error(`Unexpected URL: ${url}`)
    })
    store.setActiveProfile('local:prod')
    store.selectedApplicationId = 'app-a'

    await store.confirmDependencies('app-a', [
      { sourceResourceId: 'flow', targetResourceId: 'worker', relationType: 'invokes' },
      { sourceResourceId: 'flow', targetResourceId: 'worker', relationType: 'invokes' },
      { sourceResourceId: 'queue', targetResourceId: 'worker', relationType: 'consumed_by' },
    ])

    expect(global.fetch.mock.calls.filter(([url]) => url.endsWith('/edges'))).toHaveLength(2)
    expect(global.fetch.mock.calls.filter(([url]) => url.endsWith('/topology'))).toHaveLength(1)
  })

  it('keeps AWS definition suggestions after a normal topology refresh', async () => {
    global.fetch = vi.fn((url) => {
      if (url.includes('/topology/analyze-cloud')) return response({
        application: { id: 'app-a' },
        resources: [{ id: 'flow' }, { id: 'worker' }],
        edges: [],
        analysis: {
          suggestions: [{ sourceResourceId: 'flow', targetResourceId: 'worker', relationType: 'invokes', confidence: 1 }],
          cloudScan: { suggestions: [{ sourceResourceId: 'flow', targetResourceId: 'worker', relationType: 'invokes', confidence: 1 }] },
        },
      })
      if (url.includes('/overview')) return response({ metrics: [], resources: [] })
      if (url.endsWith('/topology')) return response({
        application: { id: 'app-a' }, resources: [{ id: 'flow' }, { id: 'worker' }], edges: [],
        analysis: { suggestions: [], counts: { suggestions: 0 }, findings: [] },
      })
      if (url.includes('/forecast')) return response({ monthlyRequestsMaximum: 0 })
      if (url.endsWith('/registry')) return response({ resources: [], relationships: [], syncStatus: null })
      throw new Error(`Unexpected URL: ${url}`)
    })
    store.setActiveProfile('local:prod')
    store.selectedApplicationId = 'app-a'

    await store.analyzeCloudTopology('app-a')
    await store.loadSelectedApplication()

    expect(store.topology.analysis.suggestions).toHaveLength(1)
    expect(store.topology.analysis.suggestions[0].relationType).toBe('invokes')
    expect(store.topology.analysis.counts.suggestions).toBe(1)
  })

  it('classifies Step Function and execution ARNs before tracing', async () => {
    const bodies = []
    global.fetch = vi.fn((url, options = {}) => {
      expect(url).toContain('/applications/app-a/process-traces')
      bodies.push(JSON.parse(options.body))
      return response({ traces: [] })
    })
    store.setActiveProfile('local:prod')

    await store.traceProcess('app-a', 'arn:aws:states:us-east-1:123:stateMachine:orders')
    await store.traceProcess('app-a', 'arn:aws:states:us-east-1:123:execution:orders:run-id', { includeData: true })

    expect(bodies).toEqual([
      { stateMachineArn: 'arn:aws:states:us-east-1:123:stateMachine:orders', includeData: false },
      { executionArn: 'arn:aws:states:us-east-1:123:execution:orders:run-id', includeData: true },
    ])
  })

  it('preserves recent executions while opening a selected trace', async () => {
    global.fetch = vi.fn()
      .mockImplementationOnce(() => response({
        traces: [{ executionArn: 'arn:execution:first' }],
        availableExecutions: [{ executionArn: 'arn:execution:first' }, { executionArn: 'arn:execution:second' }],
      }))
      .mockImplementationOnce(() => response({
        traces: [{ executionArn: 'arn:execution:second' }], availableExecutions: [], dataIncluded: true,
      }))
    store.setActiveProfile('local:prod')

    await store.traceProcess('app-a', 'arn:aws:states:us-east-1:123:stateMachine:orders')
    await store.traceProcess('app-a', 'arn:execution:second', { includeData: true })

    expect(store.processTrace.availableExecutions).toHaveLength(2)
    expect(store.processTrace.traces[0].executionArn).toBe('arn:execution:second')
    expect(store.processTrace.dataIncluded).toBe(true)
  })
})