import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))

import KUAppExplanation from '../components/kuapps/KUAppExplanation.vue'
import AgentBriefActions from '../components/advisor/AgentBriefActions.vue'

const explanation = {
  relationship: { relationType: 'depends_on', status: 'suggested', confidence: 0.62 },
  source: { id: 'api', name: 'checkout-api', type: 'lambda' },
  target: { id: 'db', name: 'orders-db', type: 'dynamodb' },
  summary: { key: 'kuapps.explain.summary.observed', params: { source: 'checkout-api', target: 'orders-db', relationType: 'depends_on' } },
  evidence: [{ type: 'observed_log_reference', class: 'observed', key: 'kuapps.explain.evidence.observed_log_reference', params: { group: '/aws/lambda/checkout-api', target: 'orders-db', count: 38 } }],
  confidence: { value: 0.62, byClass: { declared: 0, observed: 1, inferred: 0 } },
  signals: {
    target: { errorRatePercent: 4.17 }, source: { errorRatePercent: null },
    mentions: [{ signature: 'ProvisionedThroughputExceeded on table', occurrences: 7, match: 'semantic', score: 0.71 }],
    semantic: 'ready', syncedAt: null,
  },
  advice: [{ id: 'target_errors', severity: 'warning', key: 'kuapps.explain.advice.target_errors', params: { source: 'checkout-api', target: 'orders-db', rate: 4.2, threshold: 2 } }],
  decision: { accept: 'kuapps.explain.decision.accept', reject: 'kuapps.explain.decision.reject' },
  limits: ['semantic_disabled'],
}

describe('KUApp relationship explanation (#172)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: () => Promise.resolve(explanation) }))
  })

  it('asks the server with the relationship and shows why, signals, advice and limits', async () => {
    const request = { sourceResourceId: 'api', targetResourceId: 'db', sourceName: 'checkout-api', targetName: 'orders-db', relationType: 'depends_on', status: 'suggested', confidence: 0.62, evidence: [] }
    const wrapper = mount(KUAppExplanation, { props: { applicationId: 'app-a', request }, global: { stubs: { teleport: true } } })
    await flushPromises()

    const [url, options] = global.fetch.mock.calls[0]
    expect(url).toBe('/api/kua-apps/applications/app-a/relationships/explain')
    expect(JSON.parse(options.body)).toMatchObject({ sourceResourceId: 'api', relationType: 'depends_on' })
    const text = wrapper.text()
    expect(text).toContain('checkout-api → orders-db (depends on) was seen in traffic or logs')
    expect(text).toContain('orders-db appears 38 times in the logs of /aws/lambda/checkout-api')
    expect(text).toContain('similar meaning · 0.71')
    expect(text).toContain('4.2% errors in the last 24 h')
    expect(text).toContain('orders-db has 4.2% errors (threshold 2%)')
    expect(text).toContain('Local ML is off')
    expect(text).toContain('Reject: it leaves the map')

    const brief = wrapper.getComponent(AgentBriefActions).props('build')()
    expect(brief).toContain('# Why checkout-api → orders-db?')
    expect(brief).toContain('[observed] orders-db appears 38 times')
    expect(brief).toContain('Do not change production without asking')
    wrapper.unmount()
  })

  it('shows nothing and asks nothing without a request', async () => {
    const wrapper = mount(KUAppExplanation, { props: { applicationId: 'app-a', request: null }, global: { stubs: { teleport: true } } })
    await flushPromises()
    expect(global.fetch).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
