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

  it('refreshes only SQLite-backed GET endpoints', async () => {
    global.fetch = vi.fn((url, options = {}) => {
      expect(options.headers['X-Profile-Id']).toBe('local:dev')
      if (url.endsWith('/applications')) return response([{ id: 'app-a', name: 'orders' }])
      if (url.endsWith('/usage')) return response({ total: 4, limit: 100000 })
      if (url.includes('/overview')) return response({ metrics: [], resources: [] })
      if (url.endsWith('/topology')) return response({ application: { id: 'app-a' }, resources: [], edges: [] })
      if (url.endsWith('/forecast')) return response({ monthlyRequestsMaximum: 2880 })
      throw new Error(`Unexpected URL: ${url}`)
    })
    store.setActiveProfile('local:dev')
    await store.refreshLocal()
    expect(global.fetch).toHaveBeenCalledTimes(5)
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
})