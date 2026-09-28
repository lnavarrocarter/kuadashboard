import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAwsStore, ACTIVITY_TTL_MS, OVERVIEW_TTL_MS } from '../stores/useAwsStore'

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
