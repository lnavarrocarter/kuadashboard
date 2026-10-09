import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))

import KubeLogsView from '../components/cloud/logs/KubeLogsView.vue'
import LogsQueryEditor from '../components/cloud/logs/LogsQueryEditor.vue'
import { useKubeStore } from '../stores/useKubeStore'
import { settings } from '../composables/useSettings'

const WORKLOADS = {
  context: 'dev', namespace: 'shop',
  workloads: [
    { group: 'shop/deployments/api', kind: 'deployments', name: 'api', namespace: 'shop', pods: 2, ready: 1, cached: false },
    { group: 'shop/pods/debug', kind: 'pods', name: 'debug', namespace: 'shop', pods: 1, ready: 1, cached: false },
  ],
}
const INTEL = {
  provider: 'kubernetes', last24h: { events: 5, errors: 3, warnings: 0, errorRatePercent: 60 }, last7d: { events: 5, errors: 3, errorRatePercent: 60 },
  keywords24h: {}, categories7d: { database: 3 }, sensitive7d: {}, signatures: [], references: [], apm: [], eventsAnalyzed: 5,
  recommendations: [], anomalies: { status: 'insufficient_history', evaluatedAt: 1, anomalies: [] }, ml: null,
}

function stubApi({ initialCache = [] } = {}) {
  const calls = []
  let cached = initialCache
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
    calls.push({ url, method: options.method || 'GET', headers: options.headers || {}, body: options.body })
    let body = {}
    if (url.startsWith('/api/kube-logs/workloads')) body = WORKLOADS
    else if (url === '/api/kube-logs/log-cache' && options.method === 'POST') {
      cached = [{ logGroup: JSON.parse(options.body).group, region: 'shop', events: 5, bytes: 900, lastSyncAt: 1, newest: 1 }]
      body = { status: 'ok', inserted: 5 }
    } else if (url.startsWith('/api/kube-logs/log-cache')) body = { context: 'dev', groups: cached, totalBytes: 900, budgetBytes: 268435456, totalEvents: 5 }
    else if (url.startsWith('/api/kube-logs/log-scans')) body = { maxDays: 5, scans: [], active: 0 }
    else if (url.startsWith('/api/kube-logs/log-intelligence/histogram')) body = { from: 0, to: 1, binMs: 60000, events: 0, buckets: [], coverage: {} }
    else if (url.startsWith('/api/kube-logs/log-intelligence')) body = INTEL
    else if (url.startsWith('/api/system/ml')) body = { enabled: false, state: 'disabled', downloaded: false, downloadBytes: 1 }
    return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => body }
  }))
  return calls
}

describe('KubeLogsView', () => {
  beforeEach(() => {
    settings.lang = 'en'
    setActivePinia(createPinia())
    const store = useKubeStore()
    store.currentContext = 'dev'
    store.namespace = 'shop'
  })
  afterEach(() => vi.unstubAllGlobals())

  it('lists workloads, caches one and opens its intelligence through /api/kube-logs', async () => {
    const calls = stubApi()
    const wrapper = mount(KubeLogsView)
    await flushPromises()
    expect(calls.some(c => c.url === '/api/kube-logs/workloads?namespace=shop' && c.headers['X-Profile-Id'] === 'k8s:dev')).toBe(true)
    const table = wrapper.get('[data-test="kube-logs-workloads"]')
    expect(table.text()).toContain('api')
    expect(table.text()).toContain('1/2')

    await wrapper.get('[data-test="kube-logs-cache-api"]').trigger('click')
    await flushPromises()
    const post = calls.find(c => c.method === 'POST' && c.url === '/api/kube-logs/log-cache')
    expect(JSON.parse(post.body)).toEqual({ group: 'shop/deployments/api', historyHours: 24 })

    // Cached: the row offers Intelligence, which opens the shared panel on the Kubernetes API.
    const intelligence = wrapper.findAll('button').find(b => b.text() === 'Intelligence')
    await intelligence.trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-test="kube-logs-cache"]').exists()).toBe(true)
    expect(calls.some(c => c.url === '/api/kube-logs/log-intelligence?group=shop%2Fdeployments%2Fapi')).toBe(true)
    expect(calls.some(c => c.url.startsWith('/api/kube-logs/log-scans'))).toBe(true)
    expect(calls.some(c => c.url.includes('/api/cloud/aws/'))).toBe(false)
    // No CloudWatch volume metric for Kubernetes.
    expect(wrapper.text()).not.toContain('Total volume')
    wrapper.unmount()
  })

  it('queries a workload without offering Logs Insights', async () => {
    stubApi()
    const wrapper = mount(KubeLogsView)
    await flushPromises()
    const query = wrapper.findAll('button').find(b => b.text() === 'Query')
    await query.trigger('click')
    await flushPromises()
    const editor = wrapper.findComponent(LogsQueryEditor)
    expect(editor.exists()).toBe(true)
    const sources = editor.findAll('option').map(o => o.attributes('value'))
    expect(sources).toContain('live')
    expect(sources).not.toContain('insights')
    wrapper.unmount()
  })
})

describe('LogsQueryEditor outside Kubernetes', () => {
  it('keeps Logs Insights for CloudWatch', () => {
    settings.lang = 'en'
    const wrapper = mount(LogsQueryEditor, { props: { group: { name: '/aws/lambda/x', cache: null }, profileId: 'p' } })
    expect(wrapper.findAll('option').map(o => o.attributes('value'))).toContain('insights')
    wrapper.unmount()
  })

  it('says the cache is local and marks workloads that left the cluster as historical', async () => {
    stubApi({ initialCache: [
      { logGroup: 'shop/deployments/api', events: 5, bytes: 900, lastSyncAt: 1, newest: 1 },
      { logGroup: 'shop/deployments/api-3-9-1', events: 0, bytes: 0, lastSyncAt: 1, newest: null },
      { logGroup: 'other/deployments/web', events: 1, bytes: 10, lastSyncAt: 1, newest: 1 },
    ] })
    const wrapper = mount(KubeLogsView)
    await flushPromises()
    expect(wrapper.get('[data-test="kube-logs-source"]').text()).toContain('Query reads Kubernetes live')
    await wrapper.get('[data-test="kube-logs-view-cache"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-test="kube-logs-source"]').text()).toContain('Local cache on this computer')
    const historical = wrapper.findAll('[data-test="kube-logs-historical"]')
    // Only the workload of the namespace in view that the cluster no longer lists.
    expect(historical).toHaveLength(1)
    expect(historical[0].element.closest('td').textContent).toContain('api-3-9-1')
    expect(wrapper.findAll('[data-test="kube-logs-zero"]')).toHaveLength(1)
  })
})

