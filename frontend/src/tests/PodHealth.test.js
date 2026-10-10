import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import yaml from 'js-yaml'
import { podHealth } from '../lib/podHealth'
import KubeResourceDetailPanel from '../components/KubeResourceDetailPanel.vue'
import * as ApiModule from '../composables/useApi'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))

function crashingPod() {
  return {
    metadata: { name: 'sot360-abc', namespace: 'backend360' },
    spec: { containers: [{ name: 'app' }] },
    status: {
      phase: 'Running',
      containerStatuses: [{
        name: 'app', ready: false, restartCount: 246,
        state: { waiting: { reason: 'CrashLoopBackOff', message: 'back-off 5m0s restarting failed container' } },
        lastState: { terminated: { reason: 'Error', exitCode: 1, finishedAt: '2026-10-09T10:00:00Z' } },
      }],
    },
  }
}

describe('podHealth', () => {
  it('reads a Running pod with a crashing container as failing, keeping the phase apart', () => {
    const health = podHealth(crashingPod())
    expect(health.level).toBe('failing')
    expect(health.phase).toBe('Running')
    expect(health).toMatchObject({ ready: 0, total: 1, restarts: 246 })
    expect(health.problems.map(c => c.reason)).toEqual(['CrashLoopBackOff'])
    expect(health.lastTermination).toEqual({ container: 'app', reason: 'Error', exitCode: 1, finishedAt: '2026-10-09T10:00:00Z' })
  })

  it('separates not ready from failing and ready', () => {
    const pod = crashingPod()
    pod.status.containerStatuses[0].state = { running: {} }
    expect(podHealth(pod).level).toBe('not-ready')
    pod.status.containerStatuses[0].ready = true
    expect(podHealth(pod).level).toBe('ok')
  })

  it('does not treat normal start-up or a completed init container as a problem', () => {
    const pod = crashingPod()
    pod.status.phase = 'Pending'
    pod.status.containerStatuses[0].state = { waiting: { reason: 'ContainerCreating' } }
    pod.status.initContainerStatuses = [{ name: 'migrate', ready: false, state: { terminated: { reason: 'Completed', exitCode: 0 } } }]
    const health = podHealth(pod)
    expect(health.level).toBe('pending')
    expect(health.problems).toEqual([])
  })

  it('flags a failed init container and a completed pod', () => {
    const pod = crashingPod()
    pod.status.phase = 'Pending'
    pod.status.containerStatuses[0].state = { waiting: { reason: 'PodInitializing' } }
    pod.status.initContainerStatuses = [{ name: 'migrate', state: { terminated: { reason: 'Error', exitCode: 2 } } }]
    expect(podHealth(pod).problems.map(c => [c.name, c.init])).toEqual([['migrate', true]])
    expect(podHealth({ status: { phase: 'Succeeded' } }).level).toBe('completed')
  })
})

describe('KubeResourceDetailPanel pod health and metrics', () => {
  let metricsResponse, backendsResponse

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.restoreAllMocks()
    metricsResponse = {
      source: 'Prometheus (monitoring/prometheus)',
      coverage: { pods: 1, cpu: 0, memory: 0 },
      items: [{ name: 'sot360-abc', cpu: null, memory: null }],
      cpu: { available: false, nano: null, display: null, percent: null, reference: null },
      memory: { available: false, bytes: null, display: null, percent: null, reference: null },
    }
    vi.spyOn(ApiModule, 'api').mockImplementation(async (_method, path) => {
      if (path.endsWith('/yaml')) return yaml.dump(crashingPod())
      if (path.endsWith('/metrics')) return metricsResponse
      if (path.endsWith('/relations')) {
        return {
          owners: [{ kind: 'ReplicaSet', name: 'sot360-6f9' }, { kind: 'Deployment', name: 'sot360' }],
          node: 'ip-10-0-1-5.ec2.internal',
          services: [{ name: 'sot', readyEndpoint: false }],
        }
      }
      if (path.endsWith('/backends')) return backendsResponse
      if (path.startsWith('/api/monitoring/prometheus/status')) return { available: true, services: [{ namespace: 'monitoring', name: 'prometheus' }] }
      if (path.startsWith('/api/events/related')) return { total: 0, warnings: 0, events: [] }
      return {}
    })
  })

  function mountPanel(resourceType = 'pods', name = 'sot360-abc') {
    return mount(KubeResourceDetailPanel, {
      props: { resourceType, resource: { name, namespace: 'backend360' } },
    })
  }

  it('opens the logs of the previous instance of the container that ended', async () => {
    const wrapper = mountPanel()
    await flushPromises()
    await wrapper.get('[data-test="pod-previous-logs"]').trigger('click')
    expect(wrapper.emitted('open-logs')[0][0]).toEqual({
      namespace: 'backend360', name: 'sot360-abc', containers: ['app'], container: 'app', previous: true,
    })
  })

  it('links the owner chain, node and Services, saying whether the pod gets traffic', async () => {
    const wrapper = mountPanel()
    await flushPromises()
    const relations = wrapper.get('[data-test="pod-relations"]')
    expect(relations.text()).toContain('ReplicaSet')
    expect(relations.get('[data-test="pod-relation-service"]').text()).toContain('not a ready endpoint')
    const links = relations.findAll('.kdp-link')
    await links[1].trigger('click')
    await links[2].trigger('click')
    expect(wrapper.emitted('open-resource')).toEqual([
      [{ kind: 'Deployment', name: 'sot360', namespace: 'backend360' }],
      [{ kind: 'Node', name: 'ip-10-0-1-5.ec2.internal', namespace: 'backend360' }],
    ])
  })

  it('explains a Service without backends with the label that no longer matches', async () => {
    backendsResponse = {
      state: 'no-matching-pods', type: 'ClusterIP', selector: { app: 'sot360-3.9.1' }, externalName: null,
      matchingPods: [], matchingCount: 0, readyPods: 0, endpoints: { ready: 0, notReady: 0 },
      nearMisses: [{ pod: 'sot360-abc', key: 'app', expected: 'sot360-3.9.1', actual: 'sot360-3.9.2' }],
    }
    const wrapper = mountPanel('services', 'sot')
    await flushPromises()
    expect(wrapper.get('[data-test="service-backends-state"]').text()).toBe('No pod matches the selector')
    expect(wrapper.get('[data-test="service-near-misses"]').text()).toBe('Pod sot360-abc has app=sot360-3.9.2; the selector asks for app=sot360-3.9.1')
    expect(wrapper.get('[data-test="service-backends-matching"]').text()).toBe('0')
  })

  it('leads with health and labels the phase as phase', async () => {
    const wrapper = mountPanel()
    await flushPromises()
    expect(wrapper.get('[data-test="pod-health-level"]').text()).toBe('Failing')
    expect(wrapper.get('[data-test="pod-health-problems"]').text()).toContain('Container app: CrashLoopBackOff')
    expect(wrapper.get('[data-test="pod-health-ready"]').text()).toBe('0/1')
    expect(wrapper.get('[data-test="pod-health-phase"]').text()).toBe('Running')
    expect(wrapper.get('[data-test="pod-health-last-termination"]').text()).toContain('app · Error · exit code 1')
    const properties = wrapper.findAll('.kdp-section').find(section => section.find('h3').text() === 'Properties').text()
    expect(properties).toContain('Pod phase')
    expect(properties).not.toContain('Status')
  })

  it('shows "No recent sample" and no bar when a pod has no samples', async () => {
    const wrapper = mountPanel()
    await flushPromises()
    await wrapper.findAll('.kdp-tab').find(tab => tab.text().includes('Metrics')).trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-test="metric-cpu"]').text()).toContain('No recent sample')
    expect(wrapper.find('.kdp-bar').exists()).toBe(false)
    expect(wrapper.get('[data-test="metric-coverage"]').text()).toContain('only 0 of 1 pods')
  })

  it('gives CPU and memory coverage apart when they were sampled on different pods', async () => {
    metricsResponse = { ...metricsResponse, coverage: { pods: 2, cpu: 1, memory: 2 } }
    const wrapper = mountPanel()
    await flushPromises()
    await wrapper.findAll('.kdp-tab').find(tab => tab.text().includes('Metrics')).trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-test="metric-coverage"]').text()).toBe('CPU samples for 1 of 2 pods, memory for 2 of 2; each percent counts only its sampled pods')
  })

  it('draws the bar against its real reference and keeps values above it', async () => {
    metricsResponse = {
      ...metricsResponse,
      coverage: { pods: 1, cpu: 1, memory: 1 },
      cpu: { available: true, nano: 1.5e8, display: '150m', percent: 150, reference: { kind: 'limit', nano: 1e8, display: '100m' } },
      memory: { available: true, bytes: 1024, display: '1 KiB', percent: null, reference: null },
    }
    const wrapper = mountPanel()
    await flushPromises()
    await wrapper.findAll('.kdp-tab').find(tab => tab.text().includes('Metrics')).trigger('click')
    await flushPromises()
    const cpu = wrapper.get('[data-test="metric-cpu"]')
    expect(cpu.get('.kdp-bar').classes()).toContain('over')
    expect(cpu.get('.kdp-bar span').attributes('style')).toContain('width: 100%')
    expect(cpu.get('[data-test="metric-reference"]').text()).toBe('150% of limit (100m)')
    expect(wrapper.get('[data-test="metric-memory"]').text()).toContain('No percent')
    expect(wrapper.get('[data-test="metric-coverage"]').text()).toBe('Samples for 1 of 1 pods')
  })
})
