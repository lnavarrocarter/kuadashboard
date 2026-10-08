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
