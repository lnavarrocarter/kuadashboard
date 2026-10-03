import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))

import UsageCostPanel from '../components/cloud/UsageCostPanel.vue'
import { settings } from '../composables/useSettings'

const SUMMARY = {
  days: 30,
  totals: { today: { usd: 0.0115, potentialUsd: 0, calls: 1 }, month: { usd: 0.0315, potentialUsd: 0.0002, calls: 3 }, window: { usd: 0.0315, potentialUsd: 0.0002, calls: 3 } },
  byOperation: [
    { service: 'CloudWatch Logs', operation: 'Logs Insights query', kind: 'logsInsights', unit: 'GB scanned', unitPrice: 0.005, calls: 2, quantity: 6.3, usd: 0.0315, potentialUsd: 0, freeTier: null },
    { service: 'CloudWatch', operation: 'GetMetricData', kind: 'getMetricData', unit: 'metric', unitPrice: 0.00001, calls: 4, quantity: 120, usd: 0.0012, potentialUsd: 0, freeTier: null },
    { service: 'CloudWatch Logs', operation: 'FilterLogEvents (download)', kind: 'filterLogEvents', unit: 'GB', unitPrice: 0.09, calls: 10, quantity: 0.002, usd: 0, potentialUsd: 0.00018, freeTier: 'no request charge; data transfer out: first 100 GB per month free (whole account)' },
  ],
  byFeature: [{ feature: 'logs-insights', calls: 2, usd: 0.0315, potentialUsd: 0 }],
  byDay: [],
  recent: [{ at: Date.parse('2026-10-03T10:00:00Z'), service: 'CloudWatch Logs', operation: 'Logs Insights query', kind: 'logsInsights', quantity: 2.3, unit: 'GB scanned', unitPrice: 0.005, usd: 0.0115, potentialUsd: 0, ref: 'q-1' }],
}

function stub(body) {
  const calls = []
  vi.stubGlobal('fetch', vi.fn(async url => {
    calls.push(url)
    return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => body }
  }))
  return calls
}

describe('UsageCostPanel', () => {
  beforeEach(() => { settings.lang = 'en' })
  afterEach(() => vi.unstubAllGlobals())

  it('shows totals and the calculation of each billed operation', async () => {
    const calls = stub(SUMMARY)
    const wrapper = mount(UsageCostPanel, { props: { profileId: 'p1' } })
    await flushPromises()
    await wrapper.get('[data-test="usage-toggle"]').trigger('click')
    expect(calls[0]).toBe('/api/system/usage?days=30&profile=p1')
    expect(wrapper.get('[data-test="usage-today"]').text()).toContain('USD 0.0115')
    expect(wrapper.get('[data-test="usage-month"]').text()).toContain('USD 0.0315')
    const table = wrapper.get('[data-test="usage-operations"]').text()
    expect(table).toContain('6.3 GB × USD 0.005/GB = USD 0.0315')
    expect(table).toContain('120 metrics × USD 0.00001 = USD 0.0012')
    expect(table).toContain('2.05 MB × USD 0.09/GB = USD 0.00018')
    expect(table).toContain('Free tier: no request charge')
    expect(wrapper.text()).toContain('beyond free tiers')
    expect(wrapper.text()).toContain('Logs Insights · USD 0.0315')
  })

  it('switches to every profile and the period, and filters by service', async () => {
    const calls = stub(SUMMARY)
    const wrapper = mount(UsageCostPanel, { props: { profileId: 'p1', service: 'CloudWatch Logs', compact: true } })
    await flushPromises()
    await wrapper.get('[data-test="usage-toggle"]').trigger('click')
    expect(calls[0]).toBe('/api/system/usage?days=30&profile=p1&service=CloudWatch+Logs')
    const [period, scope] = wrapper.findAll('select')
    await scope.setValue('all')
    await flushPromises()
    expect(calls.at(-1)).toBe('/api/system/usage?days=30&service=CloudWatch+Logs')
    await period.setValue(7)
    await flushPromises()
    expect(calls.at(-1)).toBe('/api/system/usage?days=7&service=CloudWatch+Logs')
    expect(wrapper.text()).not.toContain('By feature')
  })

  it('says when nothing was billed', async () => {
    stub({ ...SUMMARY, totals: { today: { usd: 0, calls: 0 }, month: { usd: 0, calls: 0 }, window: { usd: 0, potentialUsd: 0, calls: 0 } }, byOperation: [], byFeature: [], recent: [] })
    const wrapper = mount(UsageCostPanel, { props: {} })
    await flushPromises()
    await wrapper.get('[data-test="usage-toggle"]').trigger('click')
    expect(wrapper.get('[data-test="usage-empty"]').text()).toContain('everything KUA read was free')
    expect(wrapper.get('[data-test="usage-today"]').text()).toContain('USD 0')
  })
})

describe('UsageCostPanel closed', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('starts closed with the month total and opens on demand', async () => {
    settings.lang = 'en'
    stub(SUMMARY)
    const wrapper = mount(UsageCostPanel, { props: { profileId: 'p1' } })
    await flushPromises()
    expect(wrapper.get('[data-test="usage-summary"]').text()).toContain('USD 0.0315 this month')
    expect(wrapper.find('[data-test="usage-operations"]').exists()).toBe(false)
    expect(wrapper.find('select').exists()).toBe(false)
    const toggle = wrapper.get('[data-test="usage-toggle"]')
    expect(toggle.attributes('aria-expanded')).toBe('false')
    await toggle.trigger('click')
    expect(wrapper.find('[data-test="usage-operations"]').exists()).toBe(true)
    expect(wrapper.get('[data-test="usage-toggle"]').text()).toBe('Hide details')
  })
})

describe('UsageCostPanel with an unexpected answer', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('shows a notice instead of breaking', async () => {
    settings.lang = 'en'
    stub({ something: 'else' })
    const wrapper = mount(UsageCostPanel, { props: {} })
    await flushPromises()
    await wrapper.get('[data-test="usage-toggle"]').trigger('click')
    expect(wrapper.text()).toContain('The spend summary is not available.')
  })
})
