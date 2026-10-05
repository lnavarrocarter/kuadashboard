import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))
// __esModule: KubeOverview imports the chart lazily, and defineAsyncComponent takes `default` from ES modules only.
vi.mock('../components/cloud/CloudMetricChart.vue', () => ({
  __esModule: true,
  default: { name: 'CloudMetricChart', props: ['label', 'unit', 'points', 'showDate', 'xTickLimit', 'color'], template: '<div class="chart-stub">{{ label }}|{{ unit }}|{{ points.length }}|{{ showDate }}</div>' },
}))

import KubeOverview from '../components/KubeOverview.vue'
import * as ApiModule from '../composables/useApi'
import { useKubeStore } from '../stores/useKubeStore'
import { RESOURCES } from '../config/resources'
import { settings } from '../composables/useSettings'

// CloudMetricChart is an async component: it renders once its import resolves.
async function settled() {
  await flushPromises()
  await new Promise(resolve => setTimeout(resolve))
  await flushPromises()
}

function overview(overrides = {}) {
  return {
    namespace: 'default',
    generatedAt: new Date().toISOString(),
    pods: {
      total: 4, ready: 2, restarts: 7,
      phases: { Running: 3, Pending: 1, Succeeded: 0, Failed: 0, Unknown: 0 },
      reasons: { CrashLoopBackOff: 1 },
      problemCount: 1,
      problems: [{ name: 'api-7d9', namespace: 'default', reason: 'CrashLoopBackOff', restarts: 7 }],
    },
    nodes: {
      total: 2, ready: 1, notReady: 1, cordoned: 0,
      pressure: { MemoryPressure: 0 },
      usage: {
        cpu: { usedNano: 2e9, allocatableNano: 8e9, percent: 25 },
        memory: { usedBytes: 4 * 1024 ** 3, allocatableBytes: 16 * 1024 ** 3, percent: 25 },
      },
      items: [
        { name: 'node-b', ready: false, cordoned: false, roles: 'worker', pressures: [], cpu: null, memory: null },
        { name: 'node-a', ready: true, cordoned: false, roles: 'worker', pressures: [], cpu: { percent: 50 }, memory: { percent: 40 } },
      ],
    },
    workloads: {
      deployments: { total: 3, notReady: 1, scaledToZero: 0, items: [{ name: 'web', namespace: 'default', ready: 0, desired: 2 }] },
      statefulsets: { total: 1, notReady: 0, scaledToZero: 0, items: [] },
      daemonsets: { total: 0, notReady: 0, scaledToZero: 0, items: [] },
    },
    events: { windowMinutes: 60, warnings: 2, reasons: { BackOff: 2 }, recent: [{ reason: 'BackOff', object: 'Pod/api-7d9', message: 'Back-off restarting', count: 4 }] },
    metrics: { available: true, source: 'metrics.k8s.io' },
    prometheus: { available: false },
    ...overrides,
  }
}

function timeseries(overrides = {}) {
  const points = [{ t: 1, v: 1 }, { t: 2, v: 2 }]
  return {
    available: true, service: 'kube-system/prometheus', namespace: 'default', range: '1h', step: 30,
    series: {
      cpu: { unit: 'cores', points },
      memory: { unit: 'bytes', points },
      restarts: { unit: 'count', windowSeconds: 300, points },
      notReady: { unit: 'count', points: [], error: 'no kube-state-metrics' },
    },
    ...overrides,
  }
}

describe('KubeOverview', () => {
  let store, apiSpy, overviewResponse, timeseriesResponse

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useKubeStore()
    store.namespace = 'default'
    localStorage.clear()
    vi.restoreAllMocks()
    overviewResponse = overview()
    timeseriesResponse = timeseries()
    apiSpy = vi.spyOn(ApiModule, 'api').mockImplementation(async (_method, path) => {
      const response = path.startsWith('/api/overview/timeseries') ? timeseriesResponse : overviewResponse
      if (response instanceof Error) throw response
      return response
    })
  })

  it('requests the overview for the selected namespace', async () => {
    mount(KubeOverview)
    await flushPromises()
    expect(apiSpy).toHaveBeenCalledWith('GET', '/api/overview?namespace=default')
  })

  it('renders pod, node, workload and warning headline tiles', async () => {
    const wrapper = mount(KubeOverview)
    await flushPromises()
    const values = wrapper.findAll('.kov-tile-value').map(v => v.text())
    expect(values).toEqual(['4', '1', '1/2', '1', '2'])
    expect(wrapper.find('.kov-tile.bad').text()).toContain('Pods with problems')
  })

  it('shows pods by phase and problem pods', async () => {
    const wrapper = mount(KubeOverview)
    await flushPromises()
    expect(wrapper.findAll('.kov-stack-seg')).toHaveLength(2)
    expect(wrapper.find('.kov-legend').text()).toContain('Running')
    expect(wrapper.find('.kov-table').text()).toContain('api-7d9')
    expect(wrapper.find('.kov-table').text()).toContain('CrashLoopBackOff')
  })

  it('shows cluster usage from metrics-server', async () => {
    const wrapper = mount(KubeOverview)
    await flushPromises()
    const meters = wrapper.findAll('.kov-meter')
    expect(meters).toHaveLength(2)
    expect(meters[0].text()).toContain('25%')
    expect(wrapper.find('.kov-prom').text()).toContain('No Prometheus found')
  })

  it('degrades with clear notices when metrics or a section are unavailable', async () => {
    overviewResponse = overview({
      nodes: { error: 'Forbidden: nodes is forbidden' },
      metrics: { available: false, error: 'the server could not find the requested resource' },
      prometheus: { available: true, service: 'monitoring/prometheus-server' },
    })
    const wrapper = mount(KubeOverview)
    await flushPromises()
    expect(wrapper.find('.kov-meter').exists()).toBe(false)
    expect(wrapper.text()).toContain('the Metrics API (metrics-server) is not available')
    expect(wrapper.text()).toContain('Forbidden: nodes is forbidden')
    expect(wrapper.find('.kov-prom').text()).toContain('monitoring/prometheus-server')
    // Other sections still render.
    expect(wrapper.find('.kov-table').text()).toContain('api-7d9')
  })

  it('shows an error with retry when the overview cannot load', async () => {
    overviewResponse = new Error('connection refused')
    const wrapper = mount(KubeOverview)
    await flushPromises()
    expect(wrapper.find('.error-state').text()).toContain('connection refused')
  })

  it('drills down into the resource tables with matching filters', async () => {
    const wrapper = mount(KubeOverview)
    await flushPromises()
    await wrapper.findAll('.kov-tile')[1].trigger('click')
    await wrapper.find('.kov-reason').trigger('click')
    await wrapper.find('.kov-table tbody tr').trigger('click')
    await wrapper.find('.kov-list li').trigger('click')
    expect(wrapper.emitted('navigate').map(([e]) => e)).toEqual([
      { resource: 'pods', quick: ['problems'] },
      { resource: 'pods', filter: 'CrashLoopBackOff' },
      { resource: 'pods', filter: 'api-7d9' },
      { resource: 'deployments', filter: 'web', quick: ['not-ready'] },
    ])
  })

  it('reloads when the namespace changes', async () => {
    mount(KubeOverview)
    await flushPromises()
    store.namespace = 'kube-system'
    await flushPromises()
    expect(apiSpy).toHaveBeenCalledWith('GET', '/api/overview?namespace=kube-system')
    expect(apiSpy).toHaveBeenCalledWith('GET', '/api/overview/timeseries?namespace=kube-system&range=1h')
  })

  it('names the usage source when it comes from Prometheus', async () => {
    overviewResponse = overview({ metrics: { available: true, source: 'prometheus' } })
    const wrapper = mount(KubeOverview)
    await flushPromises()
    expect(wrapper.find('.kov-note').text()).toContain('Prometheus (node-exporter)')
  })

  it('renders one Prometheus trend chart per series and names empty ones', async () => {
    const wrapper = mount(KubeOverview)
    await settled()
    expect(apiSpy).toHaveBeenCalledWith('GET', '/api/overview/timeseries?namespace=default&range=1h')
    expect(wrapper.findAll('.chart-stub').map(c => c.text())).toEqual([
      'CPU|cores|2|false', 'Memory|bytes|2|false', 'Restarts (5 min window)|count|2|false', 'Pods not ready|count|0|false',
    ])
    expect(wrapper.text()).toContain('kube-system/prometheus')
    expect(wrapper.text()).toContain('No data: Pods not ready')
  })

  it('switches and remembers the trend range', async () => {
    const wrapper = mount(KubeOverview)
    await flushPromises()
    const btn7d = wrapper.findAll('.kov-range-btn').find(b => b.text() === '7d')
    await btn7d.trigger('click')
    await settled()
    expect(apiSpy).toHaveBeenLastCalledWith('GET', '/api/overview/timeseries?namespace=default&range=7d')
    expect(localStorage.getItem('kua.kubeOverviewRange')).toBe('7d')
    expect(wrapper.find('.chart-stub').text()).toContain('|true')

    wrapper.unmount()
    const again = mount(KubeOverview)
    await flushPromises()
    expect(again.find('.kov-range-btn.active').text()).toBe('7d')
  })

  it('explains that trends need Prometheus when none is detected', async () => {
    timeseriesResponse = timeseries({ available: false, series: undefined })
    const wrapper = mount(KubeOverview)
    await flushPromises()
    expect(wrapper.find('.chart-stub').exists()).toBe(false)
    expect(wrapper.text()).toContain('Trends need Prometheus')
    // The rest of the Overview still renders.
    expect(wrapper.findAll('.kov-tile')).toHaveLength(5)
  })

  it('renders in Spanish when the app language is Spanish', async () => {
    settings.lang = 'es'
    try {
      const wrapper = mount(KubeOverview)
      await settled()
      expect(wrapper.find('.kov-tile.bad').text()).toContain('Pods con problemas')
      expect(wrapper.text()).toContain('Uso del clúster')
      expect(wrapper.findAll('.chart-stub').map(c => c.text())).toContain('Reinicios (ventana 5 min)|count|2|false')
    } finally {
      settings.lang = 'en'
    }
  })

  it('links to quick filters that exist in the resource tables', () => {
    const ids = resource => RESOURCES[resource].quickFilters.map(f => f.id)
    expect(ids('pods')).toContain('problems')
    expect(ids('nodes')).toContain('not-ready')
    expect(ids('deployments')).toContain('not-ready')
    expect(RESOURCES.events.facet.options.map(o => o.value)).toEqual(expect.arrayContaining(['critical', 'warning']))
  })
})

describe('pods table problem reason', () => {
  it('shows the problem reason in the status column and filters problem pods', () => {
    const crash = { name: 'a', namespace: 'd', status: 'Running', reason: 'CrashLoopBackOff', ready: '0/1', restarts: 5 }
    const healthy = { name: 'b', namespace: 'd', status: 'Running', reason: null, ready: '1/1', restarts: 0 }
    expect(RESOURCES.pods.row(crash)[2]).toEqual({ badge: 'CrashLoopBackOff' })
    expect(RESOURCES.pods.row(healthy)[2]).toEqual({ badge: 'Running' })
    const problems = RESOURCES.pods.quickFilters.find(f => f.id === 'problems')
    expect([crash, healthy].filter(problems.test).map(r => r.name)).toEqual(['a'])
  })
})
