import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))

const PLANS = {
  free: { plan: 'free', features: { logAutoRefresh: false }, limits: { logCacheMaxMb: 256, logRefreshMinMinutes: null } },
  pro: { plan: 'pro', features: { logAutoRefresh: true }, limits: { logCacheMaxMb: 2048, logRefreshMinMinutes: 15 } },
  team: { plan: 'team', features: { logAutoRefresh: true }, limits: { logCacheMaxMb: 20480, logRefreshMinMinutes: 1 } },
}

function stub({ plan, budget, patch }) {
  const calls = []
  vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
    calls.push({ url, method: options.method || 'GET', body: options.body })
    let body = {}
    if (url === '/api/system/plan') body = { ...PLANS[plan], source: 'env', plans: PLANS, refreshChoices: [1, 5, 15, 30, 60] }
    else if (url.startsWith('/api/system/log-cache-budget')) body = typeof budget === 'function' ? budget(options) : budget
    else if (options.method === 'PATCH') body = patch?.(JSON.parse(options.body)) ?? {}
    const status = body?.__status || 200
    return { ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body }
  }))
  return calls
}

async function freshComponents() {
  // usePlan caches the plan per module: reload modules for each plan.
  vi.resetModules()
  const { settings } = await import('../composables/useSettings')
  settings.lang = 'en'
  const LogRefreshControl = (await import('../components/cloud/logs/LogRefreshControl.vue')).default
  const LogCacheBudget = (await import('../components/cloud/logs/LogCacheBudget.vue')).default
  return { LogRefreshControl, LogCacheBudget }
}

describe('LogRefreshControl', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('free plan: every interval needs a paid plan', async () => {
    stub({ plan: 'free' })
    const { LogRefreshControl } = await freshComponents()
    const wrapper = mount(LogRefreshControl, { props: { group: '/g', profileId: 'p' } })
    await flushPromises()
    const options = wrapper.findAll('option')
    expect(options.filter(o => o.attributes('disabled') !== undefined).length).toBe(5)
    expect(options.find(o => o.attributes('value') === '1').text()).toContain('Team')
    expect(options.find(o => o.attributes('value') === '15').text()).toContain('Pro')
    expect(wrapper.find('.lrc-plan').text()).toBe('Pro')
  })

  it('pro plan: 15 minutes or more, saves through the log API and estimates requests', async () => {
    const calls = stub({ plan: 'pro', patch: body => ({ logGroup: body.group, refreshMinutes: body.refreshMinutes, lastSyncAt: 1 }) })
    const { LogRefreshControl } = await freshComponents()
    const wrapper = mount(LogRefreshControl, { props: { group: '/aws/lambda/x', profileId: 'p' } })
    await flushPromises()
    const disabled = wrapper.findAll('option').filter(o => o.attributes('disabled') !== undefined).map(o => o.attributes('value'))
    expect(disabled).toEqual(['1', '5'])
    await wrapper.get('select').setValue('15')
    await flushPromises()
    const patch = calls.find(c => c.method === 'PATCH')
    expect(patch.url).toBe('/api/cloud/aws/cloudwatch/log-cache')
    expect(JSON.parse(patch.body)).toEqual({ group: '/aws/lambda/x', refreshMinutes: 15 })
    expect(wrapper.emitted('updated')[0][0].refreshMinutes).toBe(15)

    await wrapper.setProps({ minutes: 15, lastSyncAt: Date.now(), pagesPerSync: 2 })
    expect(wrapper.get('[data-test="log-refresh-meta"]').text()).toContain('≈ 192 requests/day')
  })
})

describe('LogCacheBudget', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('offers sizes up to the plan and saves the budget', async () => {
    const choices = [256, 512, 1024, 2048, 5120].map(mb => ({ mb, allowed: mb <= 2048, plan: mb <= 256 ? 'free' : mb <= 2048 ? 'pro' : 'team' }))
    let current = { mb: 256, bytes: 256 * 1048576, source: 'default', maxMb: 2048, plan: 'pro', choices, usage: { bytes: 100 * 1048576, budgetBytes: 256 * 1048576 } }
    const calls = stub({ plan: 'pro', budget: options => (options.method === 'PUT' ? (current = { ...current, mb: JSON.parse(options.body).mb, bytes: JSON.parse(options.body).mb * 1048576 }) : current) })
    const { LogCacheBudget } = await freshComponents()
    const wrapper = mount(LogCacheBudget)
    await flushPromises()
    expect(wrapper.get('[data-test="plan-badge"]').text()).toBe('Pro')
    const option5g = wrapper.findAll('option').find(o => o.attributes('value') === '5120')
    expect(option5g.attributes('disabled')).toBeDefined()
    expect(option5g.text()).toContain('Team')
    await wrapper.get('[data-test="log-cache-budget-select"]').setValue('2048')
    await flushPromises()
    expect(JSON.parse(calls.find(c => c.method === 'PUT').body)).toEqual({ mb: 2048 })
    expect(wrapper.emitted('changed')).toHaveLength(1)
  })

  it('shows the environment override instead of a selector', async () => {
    stub({ plan: 'free', budget: { mb: 4096, bytes: 4096 * 1048576, source: 'env', maxMb: 256, plan: 'free', choices: [], usage: { bytes: 0, budgetBytes: 4096 * 1048576 } } })
    const { LogCacheBudget } = await freshComponents()
    const wrapper = mount(LogCacheBudget)
    await flushPromises()
    expect(wrapper.find('[data-test="log-cache-budget-select"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('KUA_LOG_CACHE_MB')
  })
})
