import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))

import KubeOverview from '../components/KubeOverview.vue'
import * as ApiModule from '../composables/useApi'
import { useKubeStore } from '../stores/useKubeStore'
import { RESOURCES } from '../config/resources'

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

describe('KubeOverview', () => {
  let store, apiSpy

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useKubeStore()
    store.namespace = 'default'
    vi.restoreAllMocks()
    apiSpy = vi.spyOn(ApiModule, 'api').mockResolvedValue(overview())
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
    expect(wrapper.find('.kov-tile.bad').text()).toContain('Pods con problemas')
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
    expect(wrapper.find('.kov-prom').text()).toContain('No se detectó Prometheus')
  })

  it('degrades with clear notices when metrics or a section are unavailable', async () => {
    apiSpy.mockResolvedValue(overview({
      nodes: { error: 'Forbidden: nodes is forbidden' },
      metrics: { available: false, error: 'the server could not find the requested resource' },
      prometheus: { available: true, service: 'monitoring/prometheus-server' },
    }))
    const wrapper = mount(KubeOverview)
    await flushPromises()
    expect(wrapper.find('.kov-meter').exists()).toBe(false)
    expect(wrapper.text()).toContain('La Metrics API (metrics-server) no está disponible')
    expect(wrapper.text()).toContain('Forbidden: nodes is forbidden')
    expect(wrapper.find('.kov-prom').text()).toContain('monitoring/prometheus-server')
    // Other sections still render.
    expect(wrapper.find('.kov-table').text()).toContain('api-7d9')
  })

  it('shows an error with retry when the overview cannot load', async () => {
    apiSpy.mockRejectedValue(new Error('connection refused'))
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
    expect(apiSpy).toHaveBeenLastCalledWith('GET', '/api/overview?namespace=kube-system')
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
