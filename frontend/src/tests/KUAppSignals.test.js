import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))

import KUAppSignals from '../components/kuapps/KUAppSignals.vue'
import { settings } from '../composables/useSettings'

const resource = (id, name, type, state, extra = {}) => ({
  id, name, type, provider: type === 'kubernetes' ? 'kubernetes' : 'aws', kind: null,
  capabilities: { metrics: ['lambda', 'kubernetes'].includes(type), logs: ['lambda'].includes(type) },
  signals: { state, lastDataAt: null }, access: { profileId: 'local:prod', region: 'us-east-1' }, ...extra,
})

const OBSERVABILITY = {
  application: { id: 'app-1', name: 'Checkout', revision: 3, pollingEnabled: true, collection: { provider: 'generic', profileId: 'local' }, latestRun: { status: 'partial', finishedAt: '2026-10-09T07:41:23Z' } },
  resources: [
    resource('r-api', 'AudienceApiFunction', 'lambda', 'current'),
    resource('r-answer', 'AnswerApiFunction', 'lambda', 'no_data', { access: { error: 'scope_unbound' } }),
    resource('r-queue', 'jobs', 'sqs', 'unsupported'),
  ],
}

function respond(handler) {
  global.fetch = vi.fn((url, options = {}) => {
    const { status = 200, body } = handler(String(url), options)
    return Promise.resolve({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: () => Promise.resolve(body), text: () => Promise.resolve('') })
  })
}

describe('KUApp signals', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    settings.lang = 'en'
  })

  it('opens on the whole application, lists observable resources by type and reads the metrics of the selected one', async () => {
    const now = Date.now()
    respond(url => {
      if (url.endsWith('/observability/resources')) return { body: OBSERVABILITY }
      if (url.includes('/observability/resources/r-api/metrics')) {
        return { body: { metrics: [
          { name: 'invocations_observed', unit: 'count', points: [{ t: now - 60000, sum: 4, count: 1, average: 4 }, { t: now, sum: 6, count: 1, average: 6 }] },
          { name: 'duration_ms', unit: 'ms', points: [{ t: now, sum: 240, count: 2, average: 120 }] },
        ] } }
      }
      return { body: [] }
    })
    const wrapper = mount(KUAppSignals, {
      props: { applicationId: 'app-1' },
      slots: { application: '<div class="app-overview">Application overview</div>' },
      global: { stubs: { CloudMetricChart: { props: ['label', 'points'], template: '<div class="chart-stub">{{ label }}:{{ points.length }}</div>' }, ApmApplicationLogs: true } },
    })
    await flushPromises()
    // The whole application first: the existing overview (aggregates, log history, traces).
    expect(wrapper.find('.app-overview').exists()).toBe(true)
    expect(wrapper.get('[data-test="observability-application-overview"]').classes()).toContain('active')
    await wrapper.get('[data-test="observability-resource-r-api"]').trigger('click')
    await flushPromises()

    // Observable resources first (the default filter hides inventory-only ones), sorted by the API.
    expect(wrapper.findAll('.obs-row').map(row => row.text())).toEqual(['Whole application', 'AudienceApiFunctionCurrent', 'AnswerApiFunctionNo data yet'])
    expect(wrapper.get('[data-test="observability-run"]').text()).toContain('Last collection partial')
    expect(wrapper.text()).toContain('Read with local:prod · us-east-1')
    expect(wrapper.findAll('.chart-stub').map(chart => chart.text())).toEqual(['Observed invocations:2', 'Lambda duration:1'])
    expect(global.fetch.mock.calls.some(([url]) => url.includes('/r-api/metrics?from='))).toBe(true)

    await wrapper.get('[data-test="observability-resource-r-answer"]').trigger('click')
    expect(wrapper.find('[data-test="observability-no-access"]').exists()).toBe(true)

    await wrapper.get('select[aria-label="Signal state"]').setValue('')
    await wrapper.get('[data-test="observability-resource-r-queue"]').trigger('click')
    expect(wrapper.get('[data-test="observability-metrics"]').text()).toContain('KUA does not collect metrics for this resource type')
    expect(wrapper.get('[data-test="observability-tab-logs"]').element.disabled).toBe(true)
  })

  it('collects through the application collection, never with another profile', async () => {
    respond((url, options) => {
      if (url.endsWith('/observability/resources')) return { body: OBSERVABILITY }
      if (options.method === 'POST') return { body: { skipped: false } }
      return { body: { metrics: [] } }
    })
    const wrapper = mount(KUAppSignals, { props: { applicationId: 'app-1' }, global: { stubs: { CloudMetricChart: true, ApmApplicationLogs: true } } })
    await flushPromises()
    await wrapper.get('[data-test="observability-collect"]').trigger('click')
    await flushPromises()
    const [url, options] = global.fetch.mock.calls.find(([, request]) => request?.method === 'POST')
    expect(url).toBe('/api/observability/generic/applications/app-1/collect-now')
    expect(options.headers['X-Profile-Id']).toBe('local')
  })
})
