import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))

import KUAppSummary from '../components/kuapps/KUAppSummary.vue'

const legacy = { id: 'app-a', name: 'orders', provider: 'aws', profileId: 'local:prod' }

function respond({ overview, topology }) {
  global.fetch = vi.fn(url => Promise.resolve({
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    json: () => Promise.resolve(String(url).includes('/overview') ? overview : topology),
  }))
}

const card = (wrapper, name) => wrapper.get(`[data-test="summary-${name}"]`)

describe('KUApp summary (#171)', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('shows a degraded application with its worst signal, structure, pending and coverage', async () => {
    respond({
      overview: { health: { status: 'degraded', signals: [{ metric: 'errorRatePercent', value: 4.123, threshold: 2 }] }, latestRun: { status: 'completed', finishedAt: Date.now() } },
      topology: {
        resources: [{ id: 'api', type: 'lambda', name: 'api' }, { id: 'settings', type: 'kubernetes', kind: 'ConfigMap', name: 'settings' }],
        analysis: { score: 72, coveragePercent: 50, findings: [{ code: 'isolated_resources' }], suggestions: [{ sourceResourceId: 'api', targetResourceId: 'assets' }] },
      },
    })
    const wrapper = mount(KUAppSummary, { props: { application: legacy, provider: 'aws', reviewCount: 3, registry: { resources: [{ id: 1 }, { id: 2 }], relationships: [] } } })
    await flushPromises()

    expect(card(wrapper, 'health').classes()).toContain('bad')
    expect(card(wrapper, 'health').text()).toContain('Degraded')
    expect(card(wrapper, 'health').text()).toContain('4.12 (threshold 2)')
    expect(card(wrapper, 'structure').text()).toContain('72')
    expect(card(wrapper, 'structure').text()).toContain('1 finding(s) · 50% connected')
    expect(card(wrapper, 'review').text()).toContain('3')
    // Without signal states (an older backend), compatibility is never shown as data (#239).
    expect(card(wrapper, 'coverage').find('.kuapp-card-value').text()).toMatch(/^0\s*of 2 inventoried$/)
    expect(card(wrapper, 'coverage').text()).toContain('1 compatible; collect to see which have data')
    await wrapper.setProps({ registry: { relationships: [], resources: [
      { id: 1, signals: { state: 'current' } }, { id: 2, signals: { state: 'no_data' } }, { id: 3, signals: { state: 'gone' } },
      { id: 4, signals: { state: 'unsupported' } }, { id: 5, signals: { state: 'disabled' } },
    ] } })
    expect(card(wrapper, 'coverage').find('.kuapp-card-value').text()).toMatch(/^1\s*of 5 inventoried$/)
    expect(card(wrapper, 'coverage').text()).toContain('4 compatible · 2 enabled · 1 with recent data')
    expect(card(wrapper, 'coverage').classes()).toContain('attention')
    expect(wrapper.emitted('suggestions').at(-1)).toEqual([1])
    wrapper.unmount()
  })

  it('never reads an application without data as healthy', async () => {
    respond({ overview: { health: { status: 'unknown', signals: [] }, latestRun: null }, topology: { resources: [], analysis: null } })
    const wrapper = mount(KUAppSummary, { props: { application: legacy, provider: 'aws' } })
    await flushPromises()

    expect(card(wrapper, 'health').classes()).toContain('unknown')
    expect(card(wrapper, 'health').text()).toContain('No data')
    expect(card(wrapper, 'health').text()).toContain('unknown, not healthy')
    expect(wrapper.text()).toContain('Not collected')
    wrapper.unmount()
  })

  it('explains a multi-provider application without signals and makes no APM request', async () => {
    respond({ overview: {}, topology: {} })
    const wrapper = mount(KUAppSummary, { props: { application: { id: 'app-k', name: 'Checkout', provider: null, profileId: null }, provider: 'generic', scopeWarnings: [{ scopeKey: 's1' }], reviewCount: 1 } })
    await flushPromises()

    expect(global.fetch).not.toHaveBeenCalled()
    expect(card(wrapper, 'health').text()).toContain('No signals yet')
    expect(card(wrapper, 'review').text()).toContain('1 account(s)')
    expect(wrapper.get('[data-test="summary-collect"]').element.disabled).toBe(true)
    wrapper.unmount()
  })

  it('shows a running collection, refetches on range change and confirms collection in place', async () => {
    respond({ overview: { health: { status: 'healthy', signals: [] }, latestRun: { status: 'running', startedAt: Date.now() } }, topology: { resources: [
      { id: 'api', type: 'lambda', name: 'api' },
      { id: 'alb', type: 'elb', name: 'orders', arn: 'arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/app/orders/abcdef0123456789' },
    ], analysis: { score: 90, coveragePercent: 100, findings: [] } } })
    const wrapper = mount(KUAppSummary, {
      props: { application: legacy, provider: 'aws' },
      global: { stubs: { BaseModal: { props: ['show'], template: '<div v-if="show"><slot name="title"/><slot/><slot name="footer"/></div>' } } },
    })
    await flushPromises()

    expect(wrapper.text()).toContain('Last collection running')
    const calls = global.fetch.mock.calls.length
    await wrapper.findAll('.range-control button')[2].trigger('click')
    await flushPromises()
    // Overview, topology and the issues of the new range (#239).
    const rangeCalls = global.fetch.mock.calls.slice(calls).map(([url]) => String(url))
    expect(rangeCalls).toHaveLength(3)
    expect(rangeCalls.some(url => url.includes('/observability/issues?hours=168'))).toBe(true)
    const overviewUrl = rangeCalls.find(url => url.includes('/overview'))
    const [, from, to] = overviewUrl.match(/from=(\d+)&to=(\d+)/)
    expect(Number(to) - Number(from)).toBe(7 * 24 * 3600e3)

    await wrapper.get('[data-test="summary-collect"]').trigger('click')
    expect(wrapper.find('[data-test="summary-confirm-collect"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="summary-confirm-collect"]').element.disabled).toBe(false)
    expect(wrapper.get('[data-test="summary-cloudwatch-cost"]').text()).toContain('$0.07/month')
    expect(wrapper.text()).toContain('Log events already read are not downloaded again')
    expect(wrapper.emitted('collect')).toBeUndefined()
    await wrapper.get('[data-test="summary-confirm-collect"]').trigger('click')
    expect(wrapper.emitted('collect')).toHaveLength(1)
    await card(wrapper, 'structure').trigger('click')
    expect(wrapper.emitted('open-tab').at(-1)).toEqual(['review'])
    wrapper.unmount()
  })
})

describe('KUApp summary: one health for thresholds and open issues (#239)', () => {
  beforeEach(() => setActivePinia(createPinia()))

  function respondWithIssues(issues, { hold = false } = {}) {
    let release
    const gate = new Promise(resolve => { release = resolve })
    global.fetch = vi.fn(url => {
      const body = String(url).includes('/overview') ? { health: { status: 'healthy', signals: [] }, latestRun: { status: 'completed', finishedAt: Date.now() } }
        : String(url).includes('/observability/issues') ? issues
          : { resources: [{ id: 'api', type: 'lambda', name: 'api' }], analysis: null }
      const answer = { ok: true, status: 200, headers: { get: () => 'application/json' }, json: () => Promise.resolve(body) }
      return hold && String(url).includes('/observability/issues') ? gate.then(() => answer) : Promise.resolve(answer)
    })
    return () => release()
  }

  it('a critical issue open in the range is never "healthy", and the card waits for it before answering', async () => {
    const release = respondWithIssues({ counts: { critical: 1, warning: 0, info: 0 }, issues: [{ id: 'x', severity: 'critical', resourceName: 'payments-lambda', kind: 'threshold' }] }, { hold: true })
    const wrapper = mount(KUAppSummary, { props: { application: legacy, provider: 'aws', registry: { resources: [{ id: 1, signals: { state: 'current' } }], relationships: [] } } })
    await flushPromises()
    expect(card(wrapper, 'health').text()).toContain('Evaluating')
    expect(card(wrapper, 'health').attributes('disabled')).toBeDefined()
    await card(wrapper, 'health').trigger('click')
    expect(wrapper.emitted('open-signals')).toBeUndefined()

    release()
    await flushPromises()
    expect(card(wrapper, 'health').text()).toContain('Critical issues')
    expect(card(wrapper, 'health').text()).toContain('such as payments-lambda')
    expect(card(wrapper, 'health').classes()).toContain('bad')
    expect(wrapper.get('[data-test="summary-health-scope"]').text()).toMatch(/^Evaluated at .+ over 1 resource\(s\) with recent data$/)
    await card(wrapper, 'health').trigger('click')
    expect(wrapper.emitted('open-signals')[0][0]).toEqual({ hours: 24, filter: 'issues' })
    wrapper.unmount()
  })

  it('healthy thresholds with warnings say so', async () => {
    respondWithIssues({ counts: { critical: 0, warning: 2, info: 0 }, issues: [] })
    const wrapper = mount(KUAppSummary, { props: { application: legacy, provider: 'aws' } })
    await flushPromises()
    expect(card(wrapper, 'health').text()).toContain('Healthy · 2 warning(s)')
    expect(card(wrapper, 'health').classes()).toContain('attention')
    wrapper.unmount()
  })
})
