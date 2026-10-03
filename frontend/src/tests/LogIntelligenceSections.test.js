import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))

import LogIntelligencePanel from '../components/cloud/logs/LogIntelligencePanel.vue'
import { settings } from '../composables/useSettings'

function intelligence(overrides = {}) {
  return {
    last24h: { events: 10, errors: 2, warnings: 0, errorRatePercent: 20 }, last7d: { events: 10, errors: 2, errorRatePercent: 20 },
    keywords24h: {}, categories7d: { timeout: 2 }, sensitive7d: {}, references: [], apm: [], eventsAnalyzed: 10,
    signatures: [{ signature: 'Task timed out', occurrences: 2, level: 'error', category: 'timeout', lastSeen: 1 }],
    recommendations: [{ id: 'fix_timeout', kind: 'fix', severity: 'high', confidence: 0.8, params: { count: 2 }, evidence: {}, actions: [] }],
    anomalies: { status: 'ok', evaluatedAt: 1, anomalies: [] },
    ml: null,
    ...overrides,
  }
}

function stub(body = intelligence()) {
  const calls = []
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('fetch', vi.fn(async url => {
    calls.push(url)
    const response = url.includes('/log-intelligence/histogram')
      ? { from: 0, to: 1, binMs: 60000, events: 0, buckets: [], coverage: {} }
      : url.startsWith('/api/system/ml') ? { enabled: false, state: 'disabled', downloaded: false, downloadBytes: 1 }
      : body
    return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => response }
  }))
  return calls
}

describe('LogIntelligencePanel sections', () => {
  beforeEach(() => {
    settings.lang = 'en'
    try { localStorage.clear() } catch { /* jsdom */ }
  })
  afterEach(() => vi.unstubAllGlobals())

  it('collapses a section, keeps its count visible and remembers it', async () => {
    stub()
    const wrapper = mount(LogIntelligencePanel, { props: { group: '/g', profileId: 'p' } })
    await flushPromises()
    const section = () => wrapper.get('[data-test="log-recommendations"]')
    expect(section().find('.cs-body').isVisible()).toBe(true)
    expect(section().get('.cs-badge').text()).toBe('1')
    expect(section().get('.cs-badge').classes()).toContain('err')

    await wrapper.get('[data-test="section-toggle-logIntel.recommendations"]').trigger('click')
    expect(section().find('.cs-body').attributes('style')).toContain('display: none')
    expect(section().get('[data-test="section-toggle-logIntel.recommendations"]').attributes('aria-expanded')).toBe('false')
    expect(section().find('[data-test="agent-brief"]').exists()).toBe(false)
    wrapper.unmount()

    // Another group (or a reload) opens with the section still closed.
    const other = mount(LogIntelligencePanel, { props: { group: '/other', profileId: 'p' } })
    await flushPromises()
    expect(other.get('[data-test="log-recommendations"] .cs-body').attributes('style')).toContain('display: none')
    expect(other.get('[data-test="log-signatures"] .cs-body').isVisible()).toBe(true)
    other.unmount()
  })

  it('offers to refresh when new events were cached after the analysis, without reloading by itself', async () => {
    const calls = stub()
    const wrapper = mount(LogIntelligencePanel, { props: { group: '/g', profileId: 'p', revision: '10|100|1' } })
    await flushPromises()
    const analyses = () => calls.filter(url => url.startsWith('/api/cloud/aws/cloudwatch/log-intelligence?')).length
    expect(analyses()).toBe(1)
    expect(wrapper.find('[data-test="log-intel-stale"]').exists()).toBe(false)

    await wrapper.setProps({ revision: '25|200|2' })
    expect(wrapper.find('[data-test="log-intel-stale"]').exists()).toBe(true)
    expect(analyses()).toBe(1)
    expect(wrapper.find('[data-test="log-recommendations"]').exists()).toBe(true)

    await wrapper.get('[data-test="log-intel-refresh"]').trigger('click')
    await flushPromises()
    expect(analyses()).toBe(2)
    expect(wrapper.find('[data-test="log-intel-stale"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('says when a scan of the group is running', async () => {
    stub()
    const wrapper = mount(LogIntelligencePanel, { props: { group: '/g', profileId: 'p', revision: '1', scanning: true } })
    await flushPromises()
    expect(wrapper.get('[data-test="log-intel-scanning"]').text()).toContain('A scan of this group is running')
    await wrapper.setProps({ scanning: false, revision: '2' })
    expect(wrapper.find('[data-test="log-intel-scanning"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="log-intel-stale"]').exists()).toBe(true)
    wrapper.unmount()
  })
})
