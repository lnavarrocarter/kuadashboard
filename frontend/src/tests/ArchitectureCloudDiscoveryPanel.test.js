import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ArchitectureCloudDiscoveryPanel from '../components/architecture/ArchitectureCloudDiscoveryPanel.vue'
import { useArchitectureStore } from '../stores/useArchitectureStore'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))

describe('ArchitectureCloudDiscoveryPanel', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('previews GCP inventory, selects new resources and imports explicit selection', async () => {
    const store = useArchitectureStore()
    store.previewCloudResources = vi.fn(async () => {
      store.gcpPreview = {
        nodes: [
          { id: 'run', name: 'orders-api', resourceType: 'gcp-cloud-run', region: 'us-central1', status: 'ready' },
          { id: 'function', name: 'orders-worker', resourceType: 'gcp-function', region: 'us-central1', runtime: 'nodejs22' },
        ],
        failures: [],
      }
      return store.gcpPreview
    })
    store.importCloudResources = vi.fn().mockResolvedValue({ revision: 1 })

    const wrapper = mount(ArchitectureCloudDiscoveryPanel, { props: { provider: 'gcp' } })
    await flushPromises()

    expect(wrapper.text()).toContain('2 resources')
    expect(wrapper.text()).toContain('Cloud Run')
    const rows = wrapper.findAll('.cloud-discovery-row')
    await rows.find(row => row.text().includes('orders-api')).get('input').setValue(false)
    await wrapper.find('footer button').trigger('click')

    expect(store.importCloudResources).toHaveBeenCalledWith({ provider: 'gcp', selectedNodeIds: ['function'] })
    expect(wrapper.emitted('imported')).toHaveLength(1)
  })

  it('shows Vercel deployment coverage in the preview', async () => {
    const store = useArchitectureStore()
    store.previewCloudResources = vi.fn(async () => {
      store.vercelPreview = { nodes: [{ id: 'project', name: 'web', resourceType: 'vercel-project', framework: 'nextjs', region: 'iad1', deployments: [{ id: 'deployment' }] }], failures: [] }
      return store.vercelPreview
    })
    const wrapper = mount(ArchitectureCloudDiscoveryPanel, { props: { provider: 'vercel' } })
    await flushPromises()

    expect(wrapper.text()).toContain('1 deployments')
    expect(wrapper.text()).toContain('nextjs')
  })
})
