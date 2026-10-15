import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))

import ArchitectureGcpDiscoveryPanel from '../components/architecture/ArchitectureGcpDiscoveryPanel.vue'
import { useArchitectureStore } from '../stores/useArchitectureStore'
import { settings } from '../composables/useSettings'

const GROUPS = {
  projectId: 'p', infraManager: 'available', total: 3, failures: [],
  deployments: [{ id: 'projects/p/locations/us-central1/deployments/orders-stack', name: 'orders-stack', location: 'us-central1', state: 'ACTIVE' }],
  labels: [{ key: 'app', value: 'orders', count: 2 }],
}
const node = (id, name, resourceType, nativeId, extra = {}) => ({ id, name, resourceType, nativeId, region: 'us-central1', alreadyInGraph: false, ...extra })
const PREVIEW = {
  nodes: [
    node('n1', 'api', 'gcp-cloud-run', 'projects/p/locations/us-central1/services/api', { labels: { app: 'orders' } }),
    node('n2', 'invoices', 'gcp-bucket', 'projects/_/buckets/invoices'),
    node('n3', 'old', 'gcp-bucket', 'projects/_/buckets/old', { alreadyInGraph: true }),
  ],
  relationships: [], failures: [], groups: [{ type: 'deployment', name: 'orders-stack' }],
  unmapped: [{ deployment: 'orders-stack', address: 'google_service_account.api' }],
}

function stubApi() {
  const calls = []
  vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null })
    const body = String(url).includes('/groups') ? GROUPS : String(url).includes('/preview') ? PREVIEW : { revision: 2 }
    return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) }
  }))
  return calls
}

let store
beforeEach(() => {
  setActivePinia(createPinia())
  settings.lang = 'en'
  store = useArchitectureStore()
  store.selectedProjectId = 'proj-1'
  store.activeProfileId = 'local:ncaicloud'
  store.graph = { revision: 1 }
})

describe('ArchitectureGcpDiscoveryPanel', () => {
  it('lists deployments and labels, then previews only the chosen ones', async () => {
    const calls = stubApi()
    const wrapper = mount(ArchitectureGcpDiscoveryPanel)
    await flushPromises()
    expect(calls[0].url).toContain('/discovery/gcp/groups')
    expect(wrapper.text()).toContain('orders-stack')
    expect(wrapper.text()).toContain('app=orders')
    await wrapper.find('.gcp-row input').setValue(true)
    await wrapper.find('.gcp-chip input').setValue(true)
    await wrapper.find('[data-test="gcp-continue"]').trigger('click')
    await flushPromises()
    expect(calls.find(call => call.url.includes('/preview')).body).toEqual({ deployments: [GROUPS.deployments[0].id], labels: ['app=orders'] })
    expect(wrapper.text()).toContain('1 managed resources KUA does not map')
    expect(wrapper.text()).toContain('Cloud Run')
    expect(wrapper.text()).toContain('2 selected')
  })

  it('finds one resource by its full name, like Find ARN, and imports it', async () => {
    const calls = stubApi()
    const wrapper = mount(ArchitectureGcpDiscoveryPanel)
    await flushPromises()
    await wrapper.find('[data-test="gcp-full-name"]').setValue('//storage.googleapis.com/projects/_/buckets/invoices')
    await wrapper.find('[data-test="gcp-find-name"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('1 selected')
    await wrapper.find('[data-test="gcp-import"]').trigger('click')
    await flushPromises()
    expect(calls.find(call => call.url.includes('/import')).body.selectedNodeIds).toEqual(['n2'])
    expect(wrapper.emitted('imported')).toHaveLength(1)
  })

  it('says when Infrastructure Manager is not enabled and keeps labels usable', async () => {
    stubApi()
    GROUPS.infraManager = 'api_disabled'
    const wrapper = mount(ArchitectureGcpDiscoveryPanel)
    await flushPromises()
    expect(wrapper.find('[data-test="gcp-infra-status"]').text()).toContain('not enabled')
    GROUPS.infraManager = 'available'
  })
})
