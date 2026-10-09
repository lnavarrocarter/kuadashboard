import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ArchitectureKubernetesDiscoveryPanel from '../components/architecture/ArchitectureKubernetesDiscoveryPanel.vue'
import { useArchitectureStore } from '../stores/useArchitectureStore'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))

describe('ArchitectureKubernetesDiscoveryPanel', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('previews one selected context and imports the confirmed Kubernetes nodes', async () => {
    const store = useArchitectureStore()
    store.loadKubernetesContexts = vi.fn(async () => {
      store.kubernetesContexts = [{ id: 'orders-eks', name: 'orders-eks' }]
      return store.kubernetesContexts
    })
    store.previewKubernetesResources = vi.fn(async input => {
      store.kubernetesPreview = {
        nodes: [
          { id: 'deployment', name: 'api', kind: 'Deployment', namespace: 'orders', health: { status: 'healthy' } },
          { id: 'pod', name: 'api-a', kind: 'Pod', namespace: 'orders', health: { status: 'healthy' } },
          { id: 'service', name: 'api', kind: 'Service', resourceType: 'service', namespace: 'orders', health: { status: 'healthy' } },
          { id: 'ingress', name: 'public', kind: 'Ingress', resourceType: 'ingress', namespace: 'orders', health: { status: 'healthy' } },
        ],
        relationships: [{ id: 'owns', sourceNodeId: 'deployment', targetNodeId: 'pod' }],
        health: [], failures: [],
      }
      return store.kubernetesPreview
    })
    store.importKubernetesResources = vi.fn().mockResolvedValue({ revision: 1 })

    const wrapper = mount(ArchitectureKubernetesDiscoveryPanel)
    await flushPromises()
    await wrapper.get('select').setValue('orders-eks')
    await wrapper.get('input[placeholder*="orders"]').setValue('orders, platform')
    await wrapper.findAll('button').find(button => button.text().includes('Preview resources')).trigger('click')
    await flushPromises()

    expect(store.previewKubernetesResources).toHaveBeenCalledWith({ contexts: ['orders-eks'], namespaces: ['orders', 'platform'] })
    expect(wrapper.text()).toContain('4 resources')
    expect(wrapper.text()).toContain('Services')
    expect(wrapper.text()).toContain('Ingress')
    const rows = wrapper.findAll('.kubernetes-resource-row')
    for (const row of rows.filter(row => !row.text().includes('Deployment'))) {
      await row.get('input').setValue(false)
    }
    await wrapper.findAll('button').find(button => button.text().includes('Add to diagram')).trigger('click')

    expect(store.importKubernetesResources).toHaveBeenCalledWith({ selectedNodeIds: ['deployment'] })
    expect(wrapper.emitted('imported')).toHaveLength(1)
  })

  it('preselects the context of the connection, and explains a context this computer lacks (#239)', async () => {
    const store = useArchitectureStore()
    store.loadKubernetesContexts = vi.fn(async () => { store.kubernetesContexts = [{ id: 'arn:aws:eks:us-east-1:1:cluster/dev', name: 'arn:aws:eks:us-east-1:1:cluster/dev' }] })
    const wrapper = mount(ArchitectureKubernetesDiscoveryPanel, { props: { preferredContext: 'arn:aws:eks:us-east-1:1:cluster/dev', repairable: true } })
    await flushPromises()
    expect(wrapper.get('select').element.value).toBe('arn:aws:eks:us-east-1:1:cluster/dev')
    expect(wrapper.find('[data-test="k8s-context-problem"]').exists()).toBe(false)

    const missing = mount(ArchitectureKubernetesDiscoveryPanel, { props: { preferredContext: 'prod-cluster', repairable: true } })
    await flushPromises()
    expect(missing.get('[data-test="k8s-context-problem"]').text()).toContain('The context prod-cluster of this connection is not in this computer')
    await missing.get('[data-test="k8s-repair-connection"]').trigger('click')
    expect(missing.emitted('repair-connection')).toHaveLength(1)

    // A failed read names its cause here, not as a failed write of the map.
    store.loadKubernetesContexts = vi.fn(async () => { store.kubernetesContexts = []; store.error = 'ENOENT: kubeconfig' })
    const failed = mount(ArchitectureKubernetesDiscoveryPanel)
    await flushPromises()
    expect(failed.get('[data-test="k8s-context-problem"]').text()).toContain('Could not read this computer')
    expect(failed.text()).toContain('ENOENT: kubeconfig')
    expect(store.error).toBe(null)
    expect(failed.find('[data-test="k8s-repair-connection"]').exists()).toBe(false)
  })

  it('shows the native identity and marks resources already in the application, which cannot be selected twice (#151)', async () => {
    const store = useArchitectureStore()
    store.linkedApplication = { id: 'app-a', name: 'Orders' }
    store.loadKubernetesContexts = vi.fn(async () => { store.kubernetesContexts = [{ id: 'orders-eks', name: 'orders-eks' }] })
    store.previewKubernetesResources = vi.fn(async () => {
      store.kubernetesPreview = {
        nodes: [
          { id: 'api', name: 'api', kind: 'Deployment', namespace: 'orders', discoveryKey: 'orders-eks/orders/deployment/api', alreadyInGraph: true },
          { id: 'worker', name: 'worker', kind: 'Deployment', namespace: 'orders', discoveryKey: 'orders-eks/orders/deployment/worker', health: { status: 'healthy' } },
        ],
        relationships: [], health: [], failures: [],
      }
    })
    const wrapper = mount(ArchitectureKubernetesDiscoveryPanel)
    await flushPromises()
    await wrapper.get('select').setValue('orders-eks')
    await wrapper.findAll('button').find(button => button.text().includes('Preview resources')).trigger('click')
    await flushPromises()

    const [existing, fresh] = wrapper.findAll('.kubernetes-resource-row')
    expect(existing.text()).toContain('Already in Orders')
    expect(existing.get('input').element.disabled).toBe(true)
    expect(existing.get('.native-identity').text()).toBe('orders-eks/orders/deployment/api')
    expect(fresh.get('input').element.disabled).toBe(false)
  })
})

describe('Kubernetes picker reliability (#239 N03)', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('keeps its contexts when another view of the application resets the shared store', async () => {
    const store = useArchitectureStore()
    store.loadKubernetesContexts = vi.fn(async () => [{ id: 'dev', name: 'dev' }, { id: 'prod', name: 'prod' }])
    const wrapper = mount(ArchitectureKubernetesDiscoveryPanel, { props: { preferredContext: 'dev', repairable: true } })
    await flushPromises()
    // The Map (another ArchitectureView with its own profile) selects its project: the shared list empties.
    store.kubernetesContexts = []
    await flushPromises()
    expect(wrapper.findAll('select option').map(option => option.text())).toEqual(['Select a Kubernetes context', 'dev', 'prod'])
    expect(wrapper.get('select').element.value).toBe('dev')
    expect(wrapper.find('[data-test="k8s-context-problem"]').exists()).toBe(false)
  })

  it('lists the contexts of the kubeconfig even before the picker has a project', async () => {
    global.fetch = vi.fn(url => Promise.resolve({ ok: true, status: 200, headers: { get: () => 'application/json' },
      json: () => Promise.resolve(String(url) === '/api/contexts' ? { contexts: [{ name: 'gke_dev', cluster: 'gke_dev' }] } : {}) }))
    const store = useArchitectureStore()
    const listed = await store.loadKubernetesContexts()
    expect(global.fetch.mock.calls[0][0]).toBe('/api/contexts')
    expect(listed).toEqual([{ id: 'gke_dev', name: 'gke_dev', cluster: 'gke_dev' }])
  })

  it('a picker that is not ready yet says so, offers a retry and never blames the connection', async () => {
    const store = useArchitectureStore()
    store.loadKubernetesContexts = vi.fn(async () => [{ id: 'dev', name: 'dev' }])
    store.previewKubernetesResources = vi.fn()
    let ready = false
    const wrapper = mount(ArchitectureKubernetesDiscoveryPanel, { props: { preferredContext: 'dev', repairable: true, ensureReady: async () => ready } })
    await flushPromises()
    await wrapper.findAll('button').find(button => button.text().includes('Preview resources')).trigger('click')
    await flushPromises()
    expect(store.previewKubernetesResources).not.toHaveBeenCalled()
    expect(wrapper.get('[data-test="k8s-context-problem"]').text()).toContain('still getting ready')
    expect(wrapper.find('[data-test="k8s-repair-connection"]').exists()).toBe(false)
    ready = true
    await wrapper.get('[data-test="k8s-retry"]').trigger('click')
    await flushPromises()
    expect(store.previewKubernetesResources).toHaveBeenCalledWith({ contexts: ['dev'], namespaces: [] })
  })
})
