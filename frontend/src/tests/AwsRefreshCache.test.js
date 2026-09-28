import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAwsStore, ACTIVITY_TTL_MS, OVERVIEW_TTL_MS } from '../stores/useAwsStore'
import { settings, SETTINGS_DEFAULTS } from '../composables/useSettings'
import { shouldAutoRunLogs } from '../components/cloud/dashboard/dashboardFormat'

// Background auto-refresh must not repeat billed CloudWatch reads (GetMetricData).
describe('AWS store: cached activity and overview for auto-refresh', () => {
  let store
  let fetchMock
  beforeEach(() => {
    vi.useFakeTimers()
    setActivePinia(createPinia())
    fetchMock = vi.fn(async () => ({ ok: true, headers: { get: () => 'application/json' }, json: async () => ({ functions: {}, regions: {} }) }))
    vi.stubGlobal('fetch', fetchMock)
    store = useAwsStore()
    store.activeProfileId = 'p1'
    store.lambdas = [{ name: 'fn-a', logGroup: '/aws/lambda/fn-a' }]
  })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

  const calls = path => fetchMock.mock.calls.filter(([url]) => String(url).includes(path)).length

  it('reuses Lambda activity until it expires, unless forced', async () => {
    await store.fetchLambdaActivity()
    await store.fetchLambdaActivity()
    expect(calls('/lambda/activity')).toBe(1)
    await store.fetchLambdaActivity({ force: true })
    expect(calls('/lambda/activity')).toBe(2)
    vi.advanceTimersByTime(ACTIVITY_TTL_MS + 1)
    await store.fetchLambdaActivity()
    expect(calls('/lambda/activity')).toBe(3)
  })

  it('reloads activity when the set of functions changes', async () => {
    await store.fetchLambdaActivity()
    store.lambdas = [...store.lambdas, { name: 'fn-b' }]
    await store.fetchLambdaActivity()
    expect(calls('/lambda/activity')).toBe(2)
  })

  it('reuses the overview and insights between background refreshes', async () => {
    await store.fetchOverview()
    await store.fetchOverview()
    await store.fetchOverviewInsights()
    await store.fetchOverviewInsights()
    expect(calls('/overview/insights')).toBe(1)
    expect(calls('/overview') - calls('/overview/insights')).toBe(1)
    await store.fetchOverviewInsights({ refreshCosts: true })
    expect(calls('/overview/insights')).toBe(2)
    vi.advanceTimersByTime(OVERVIEW_TTL_MS + 1)
    await store.fetchOverview()
    expect(calls('/overview') - calls('/overview/insights')).toBe(2)
  })
})

describe('cache times chosen in Options', () => {
  let store
  let fetchMock
  beforeEach(() => {
    vi.useFakeTimers()
    setActivePinia(createPinia())
    fetchMock = vi.fn(async () => ({ ok: true, headers: { get: () => 'application/json' }, json: async () => ({}) }))
    vi.stubGlobal('fetch', fetchMock)
    store = useAwsStore()
    store.activeProfileId = 'p1'
    store.lambdas = [{ name: 'fn-a' }]
  })
  afterEach(() => {
    Object.assign(settings, { awsActivityCacheMin: SETTINGS_DEFAULTS.awsActivityCacheMin, awsCostCacheHours: SETTINGS_DEFAULTS.awsCostCacheHours })
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('uses the activity cache time from settings', async () => {
    settings.awsActivityCacheMin = 60
    await store.fetchLambdaActivity()
    vi.advanceTimersByTime(30 * 60 * 1000)
    await store.fetchLambdaActivity()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(31 * 60 * 1000)
    await store.fetchLambdaActivity()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('sends the cost cache time only when it differs from the 12h default', async () => {
    await store.fetchOverviewInsights({ force: true })
    settings.awsCostCacheHours = 24
    await store.fetchOverviewInsights({ force: true, refreshCosts: true })
    expect(fetchMock.mock.calls.map(c => c[0])).toEqual([
      '/api/cloud/aws/overview/insights',
      '/api/cloud/aws/overview/insights?refreshCosts=1&costCacheHours=24',
    ])
  })
})

describe('Logs Insights auto-run limit', () => {
  it('runs on its own only under the chosen limit', () => {
    expect(shouldAutoRunLogs({ estimatedBytes: 100 * 1024 ** 2 }, 1024)).toBe(true)
    expect(shouldAutoRunLogs({ estimatedBytes: 2 * 1024 ** 3 }, 1024)).toBe(false)
    expect(shouldAutoRunLogs({ estimatedBytes: 2 * 1024 ** 3 }, 5120)).toBe(true)
    expect(shouldAutoRunLogs({ estimatedBytes: 1 }, 0)).toBe(false)
    expect(shouldAutoRunLogs({ estimatedBytes: null, unknown: true }, 5120)).toBe(false)
    expect(shouldAutoRunLogs({ estimatedBytes: 0, logGroups: [] }, 1024)).toBe(false)
  })
})
