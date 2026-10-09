import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))

import ArchitectureKubernetesDrift from '../components/architecture/ArchitectureKubernetesDrift.vue'
import ArchitectureCanvas from '../components/architecture/ArchitectureCanvas.vue'
import { useArchitectureStore } from '../stores/useArchitectureStore'
import { settings } from '../composables/useSettings'

const DRIFT = {
  checkedAt: '2026-10-09T12:00:00.000Z',
  present: 4,
  contexts: [
    { context: 'arn:aws:eks:us-east-1:1:cluster/dev', namespaces: ['auth'], status: 'checked' },
    { context: 'prod', namespaces: ['jobs'], status: 'unreachable', error: 'Unauthorized' },
  ],
  changes: [
    { nodeId: 'pod-old', name: 'auth-7d9f8c6b5d-x2k4p', resourceType: 'pod', kind: 'Pod', namespace: 'auth', context: 'dev', change: 'replaced', successors: [{ id: 'pod-new', name: 'auth-5c4b3a2f1e-q9w8e' }] },
    { nodeId: 'config', name: 'auth-config', resourceType: 'configmap', kind: 'ConfigMap', namespace: 'auth', context: 'dev', change: 'gone', successors: [] },
  ],
}

function respond(handler) {
  global.fetch = vi.fn((url, options = {}) => {
    const { status = 200, body } = handler(String(url), options)
    return Promise.resolve({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: () => Promise.resolve(body), text: () => Promise.resolve('') })
  })
}

describe('Kubernetes map check (#239)', () => {
  let store
  beforeEach(() => {
    setActivePinia(createPinia())
    settings.lang = 'en'
    store = useArchitectureStore()
    store.setActiveProfile('local:dev')
    store.selectedProjectId = 'project-a'
    store.graph = { revision: 3, document: { nodes: [{ id: 'pod-old', provider: 'kubernetes', kubeContext: 'dev', name: 'auth-7d9f8c6b5d-x2k4p' }], edges: [] } }
  })

  it('checks the map when it opens, proposes each change and applies only the chosen ones', async () => {
    const calls = []
    respond((url, options) => {
      calls.push([url, options.method, options.body])
      if (url.endsWith('/drift')) return { body: DRIFT }
      if (url.endsWith('/drift-apply')) return { body: { revision: 4, document: { nodes: [{ id: 'pod-new', provider: 'kubernetes', kubeContext: 'dev', name: 'auth-5c4b3a2f1e-q9w8e' }], edges: [] } } }
      return { body: [] }
    })
    const wrapper = mount(ArchitectureKubernetesDrift)
    await flushPromises()

    expect(calls[0][0]).toBe('/api/architecture/projects/project-a/discovery/kubernetes/drift')
    const text = wrapper.text()
    expect(text).toContain('2 resource(s) of the map changed in the cluster')
    expect(text).toContain('Checked in dev at')
    expect(text).toContain('Replaced by auth-5c4b3a2f1e-q9w8e')
    expect(text).toContain('No longer exists: leaves the map')
    expect(wrapper.get('[data-test="k8s-drift-unreachable"]').text()).toContain('Could not read prod: Unauthorized')

    // Leave the configmap out.
    await wrapper.findAll('.k8s-drift-list input')[1].setValue(false)
    expect(wrapper.get('[data-test="k8s-drift-apply"]').text()).toBe('Apply 1 change(s)')
    await wrapper.get('[data-test="k8s-drift-apply"]').trigger('click')
    await flushPromises()
    const apply = calls.find(([url]) => url.endsWith('/drift-apply'))
    expect(JSON.parse(apply[2])).toEqual({ expectedRevision: 3, nodeIds: ['pod-old'] })
    expect(store.graph.revision).toBe(4)
    // Checked again after applying.
    expect(calls.filter(([url]) => url.endsWith('/drift')).length).toBe(2)
  })

  it('does not read the cluster for a map without Kubernetes resources', async () => {
    store.graph = { revision: 1, document: { nodes: [{ id: 'fn', provider: 'aws', name: 'orders' }], edges: [] } }
    respond(() => ({ body: DRIFT }))
    const wrapper = mount(ArchitectureKubernetesDrift)
    await flushPromises()
    expect(global.fetch).not.toHaveBeenCalled()
    expect(wrapper.find('[data-test="k8s-drift"]').exists()).toBe(false)
  })

  it('marks changed resources on the canvas', () => {
    const graph = { revision: 1, document: { nodes: [{ id: 'config', name: 'auth-config', resourceType: 'configmap', provider: 'kubernetes' }], edges: [], layout: {} } }
    const wrapper = mount(ArchitectureCanvas, {
      props: { graph, drift: { config: DRIFT.changes[1] } },
      global: { stubs: { VueFlow: { props: ['nodes'], template: '<div><slot name="node-default" v-for="node in nodes" :data="node.data" /></div>' }, Background: true, Controls: true } },
    })
    expect(wrapper.get('[data-test="node-drift-gone"]').text()).toBe('No longer exists')
  })
})
