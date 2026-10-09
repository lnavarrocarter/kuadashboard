import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))

import KUAppsView from '../components/kuapps/KUAppsView.vue'
import KUAppPossibleDuplicates from '../components/kuapps/KUAppPossibleDuplicates.vue'
import { settings } from '../composables/useSettings'

const CONTEXT = 'arn:aws:eks:us-east-1:073746111526:cluster/EKS130-360-Dev'
const resource = (id, extra) => ({ id, provider: 'aws', resourceType: 'lambda', displayName: id, scopeId: '111111111111', location: 'us-east-1', nativeIdentifier: `arn:${id}`, sources: ['apm_resource'], signals: { state: 'current' }, ...extra })
const RESOURCES = [
  resource('orders-api'),
  resource('billing-api', { signals: { state: 'stale' } }),
  resource('worker', { provider: 'kubernetes', resourceType: 'deployment', scopeId: CONTEXT, location: '', kubeContext: CONTEXT, namespace: 'backend360', nativeIdentifier: `${CONTEXT}/backend360/Deployment/worker`, signals: { state: 'gone' } }),
  resource('assets', { resourceType: 's3', signals: { state: 'unsupported' } }),
]

function respond(handler) {
  global.fetch = vi.fn((url, options = {}) => {
    const body = handler(String(url), options)
    return Promise.resolve({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: () => Promise.resolve(body), text: () => Promise.resolve('') })
  })
}

describe('KUApps resources and review (#239)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    settings.lang = 'en'
  })

  it('finds a resource among many: search, filters by provider, connection, namespace and state, readable connection', async () => {
    const application = { id: 'app-1', name: 'Dev', provider: 'aws', profileId: 'local:prod' }
    respond(url => (url.includes('/catalog') ? [application]
      : url.includes('/registry') ? { resources: RESOURCES, relationships: [] }
        : url.includes('/api/kua-apps/applications/app-1') && !url.includes('/views') ? { id: 'app-1', scopes: [], local: { bindings: [], legacy: null } } : []))
    const wrapper = mount(KUAppsView, { props: { activeView: 'architecture', applicationId: 'app-1' }, global: { stubs: { ArchitectureView: true, ApmObservabilityView: true } } })
    await flushPromises()
    await wrapper.findAll('.kuapps-workspace-tab')[1].trigger('click')
    const names = () => wrapper.findAll('.kuapps-resource-list .kuapps-resource-row strong').map(item => item.text())
    expect(names()).toEqual(['orders-api', 'billing-api', 'worker', 'assets'])
    // The cluster of a kube context, not its whole ARN.
    expect(wrapper.findAll('.kuapps-resource-scope')[2].text()).toBe('EKS130-360-Dev')

    await wrapper.get('[data-test="resource-search"]').setValue('api')
    expect(names()).toEqual(['orders-api', 'billing-api'])
    expect(wrapper.get('[data-test="resource-count"]').text()).toBe('2 of 4 resources')
    await wrapper.get('[data-test="resource-search"]').setValue('')
    const filters = wrapper.findAll('[data-test="resource-filters"] select')
    await filters.find(select => select.attributes('aria-label') === 'Signals').setValue('stale')
    expect(names()).toEqual(['billing-api'])
    await filters.find(select => select.attributes('aria-label') === 'Signals').setValue('')
    await filters.find(select => select.attributes('aria-label') === 'Connection').setValue('EKS130-360-Dev')
    expect(names()).toEqual(['worker'])
    wrapper.unmount()
  })

  it('lists possible duplicates with their accounts and selects one', async () => {
    respond(() => [{ provider: 'aws', resourceType: 'ec2', nativeIdentifier: 'AWS::EC2::SecurityGroup:sg-1', resources: [
      { id: 'a1', displayName: 'sg-1', scopeId: '111111111111', location: 'us-east-1', sources: ['architecture_node'] },
      { id: 'a3', displayName: 'sg-1', scopeId: '', location: '', sources: ['architecture_node'] },
    ] }])
    const wrapper = mount(KUAppPossibleDuplicates, { props: { applicationId: 'app-1' } })
    await flushPromises()
    expect(wrapper.text()).toContain('Possible duplicates')
    expect(wrapper.text()).toContain('without account')
    await wrapper.findAll('.kpd-resource')[1].trigger('click')
    expect(wrapper.emitted('select-resource')[0]).toEqual(['a3'])
  })
})
