import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))

import KUAppsView from '../components/kuapps/KUAppsView.vue'
import KUAppPossibleDuplicates from '../components/kuapps/KUAppPossibleDuplicates.vue'
import KUAppScopes from '../components/kuapps/KUAppScopes.vue'
import KUAppSync from '../components/kuapps/KUAppSync.vue'
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
    // Folded: a count and a sentence first; per group the name and how the copies differ (#239).
    expect(wrapper.get('[data-test="possible-duplicates"]').element.open).toBe(false)
    expect(wrapper.get('.kpd-group summary').text()).toContain('sg-1')
    expect(wrapper.get('.kpd-group summary').text()).toContain('2 copies · 1 account(s) known, 1 without account')
    await wrapper.findAll('.kpd-resource')[1].trigger('click')
    expect(wrapper.emitted('select-resource')[0]).toEqual(['a3'])
  })
})

describe('KUApps connections and the join (#239)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    settings.lang = 'en'
  })

  it('"Verified" says which profile of this computer reaches the connection', async () => {
    const scope = { key: 'kua-scope:aws', provider: 'aws', scopeId: '111111111111', location: 'us-east-1', label: 'Orders account' }
    respond(url => (url.startsWith('/api/kua-apps/') ? { id: 'app-1', revision: 1, scopes: [scope], warnings: [], local: { bindings: [{ scopeKey: scope.key, profileId: 'local:prod', status: 'verified' }], legacy: null } }
      : url === '/api/cloud/aws/local-profiles' ? [{ name: 'prod' }] : []))
    const wrapper = mount(KUAppScopes, { props: { applicationId: 'app-1' } })
    await flushPromises()
    expect(wrapper.get('[data-test="scope-bound-profile"]').text()).toBe('Verified with prod (~/.aws) on this computer')
    wrapper.unmount()
  })

  it('names the resources on one side only, with the next step, and selects one', async () => {
    const one = (id, sources) => ({ id, displayName: id, provider: 'aws', resourceType: 'lambda', sources, divergent: true })
    respond(() => ({ projectId: ['p'], resources: [one('orders-api', ['apm_resource']), one('sg-1', ['architecture_node']), { ...one('both', ['apm_resource', 'architecture_node']), divergent: false }], syncStatus: { divergentResourceCount: 2, divergentRelationshipCount: 0 } }))
    const wrapper = mount(KUAppSync, { props: { application: { id: 'app-1', name: 'Dev', profileId: 'local:prod' }, provider: 'aws' } })
    await flushPromises()
    expect(wrapper.get('[data-test="sync-one-sided-observedOnly"]').text()).toContain('Observed but not on the map (1)')
    expect(wrapper.get('[data-test="sync-one-sided-observedOnly"]').text()).toContain('Add resources')
    expect(wrapper.get('[data-test="sync-one-sided-mapOnly"]').text()).toContain('sg-1')
    expect(wrapper.text()).not.toContain('both')
    await wrapper.get('[data-test="sync-one-sided-mapOnly"] button').trigger('click')
    expect(wrapper.emitted('select-resource')[0]).toEqual(['sg-1'])
  })
})

describe('KUApps keyboard and narrow windows (#239)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    settings.lang = 'en'
  })

  it('moves between workspace tabs with the arrow keys and folds the list in a narrow window', async () => {
    const matchMedia = window.matchMedia
    window.matchMedia = vi.fn(() => ({ matches: true, addEventListener() {}, removeEventListener() {} }))
    const application = { id: 'app-1', name: 'Dev', provider: 'aws', profileId: 'local:prod' }
    respond(url => (url.includes('/catalog') ? [application]
      : url.includes('/registry') ? { resources: [], relationships: [] }
        : url.includes('/api/kua-apps/applications/app-1') && !url.includes('/views') ? { id: 'app-1', scopes: [], local: { bindings: [], legacy: null } } : []))
    const wrapper = mount(KUAppsView, { props: { activeView: 'architecture', applicationId: 'app-1' }, global: { stubs: { ArchitectureView: true, ApmObservabilityView: true } }, attachTo: document.body })
    await flushPromises()
    try {
      expect(wrapper.get('.kuapps-application-shell').classes()).toContain('collapsed')
      expect(wrapper.get('.kuapps-application-row').attributes('title')).toBe('Dev')
      await wrapper.get('[data-test="kuapps-sidebar-toggle"]').trigger('click')
      expect(wrapper.get('.kuapps-application-shell').classes()).not.toContain('collapsed')
      await wrapper.get('.kuapps-application-row').trigger('click')
      expect(wrapper.get('.kuapps-application-shell').classes()).toContain('collapsed')

      const tabs = () => wrapper.findAll('.kuapps-workspace-tab')
      expect(tabs()[0].attributes('tabindex')).toBe('0')
      expect(tabs()[1].attributes('tabindex')).toBe('-1')
      await tabs()[0].trigger('keydown', { key: 'ArrowRight' })
      await flushPromises()
      expect(tabs()[1].attributes('aria-selected')).toBe('true')
      expect(document.activeElement).toBe(tabs()[1].element)
      await tabs()[1].trigger('keydown', { key: 'End' })
      expect(tabs().at(-1).attributes('aria-selected')).toBe('true')
      await tabs().at(-1).trigger('keydown', { key: 'ArrowRight' })
      expect(tabs()[0].attributes('aria-selected')).toBe('true')
    } finally {
      window.matchMedia = matchMedia
      wrapper.unmount()
    }
  })
})

describe('tablists follow the arrow keys (#239)', () => {
  it('moves and selects with the arrows, skipping disabled tabs', async () => {
    const { moveTab } = await import('../lib/tablistKeys')
    document.body.innerHTML = '<div role="tablist"><button role="tab" id="a">A</button><button role="tab" id="b" disabled>B</button><button role="tab" id="c">C</button></div>'
    const clicked = []
    for (const tab of document.querySelectorAll('[role="tab"]')) {
      tab.addEventListener('click', () => clicked.push(tab.id))
      tab.addEventListener('keydown', moveTab)
    }
    document.getElementById('a').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    expect(clicked).toEqual(['c'])
    expect(document.activeElement.id).toBe('c')
    document.getElementById('c').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    expect(clicked).toEqual(['c', 'a'])
    document.getElementById('a').dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
    expect(clicked.at(-1)).toBe('c')
    document.body.innerHTML = ''
  })
})

describe('KUApps recheck (#239)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    settings.lang = 'en'
  })

  it('the inspector knows where it is (Resources), and the Advisor explains a 404 instead of showing it raw', async () => {
    const application = { id: 'app-1', name: 'Dev', provider: 'aws', profileId: 'local:prod' }
    global.fetch = vi.fn(url => {
      const text = String(url)
      const ok = body => Promise.resolve({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: () => Promise.resolve(body), text: () => Promise.resolve('') })
      if (text.includes('/advisor')) return Promise.resolve({ ok: false, status: 404, headers: { get: () => 'application/json' }, json: () => Promise.resolve({ error: 'KUA Application not found' }), text: () => Promise.resolve('') })
      if (text.includes('/catalog')) return ok([application])
      if (text.includes('/registry')) return ok({ resources: RESOURCES, relationships: [] })
      if (text.includes('/api/kua-apps/applications/app-1') && !text.includes('/views')) return ok({ id: 'app-1', scopes: [], local: { bindings: [], legacy: null } })
      return ok([])
    })
    const wrapper = mount(KUAppsView, { props: { activeView: 'architecture', applicationId: 'app-1' }, global: { stubs: { ArchitectureView: true, ApmObservabilityView: true } } })
    await flushPromises()
    expect(wrapper.text()).toContain('The Advisor could not read this application with the profile local:prod of this computer')
    expect(wrapper.text()).not.toContain('KUA Application not found')

    await wrapper.findAll('.kuapps-workspace-tab')[1].trigger('click')
    await wrapper.findAll('.kuapps-resource-list .kuapps-resource-row')[0].trigger('click')
    await flushPromises()
    expect(wrapper.findComponent({ name: 'KUAppResourceInspector' }).props('context')).toBe('resources')
    wrapper.unmount()
  })
})

describe('KUApps follows the window width (#239 N04)', () => {
  it('folds the application list when the window becomes narrow, and unfolds it when it widens', async () => {
    setActivePinia(createPinia())
    settings.lang = 'en'
    const listeners = []
    const matchMedia = window.matchMedia
    window.matchMedia = vi.fn(() => ({ matches: false, addEventListener: (_type, listener) => listeners.push(listener), removeEventListener() {} }))
    const application = { id: 'app-1', name: 'Dev', provider: 'aws', profileId: 'local:prod' }
    respond(url => (url.includes('/catalog') ? [application] : url.includes('/registry') ? { resources: [], relationships: [] } : []))
    const wrapper = mount(KUAppsView, { props: { activeView: 'architecture', applicationId: 'app-1' }, global: { stubs: { ArchitectureView: true, ApmObservabilityView: true } } })
    await flushPromises()
    try {
      expect(wrapper.get('.kuapps-application-shell').classes()).not.toContain('collapsed')
      listeners.forEach(listener => listener({ matches: true }))
      await flushPromises()
      expect(wrapper.get('.kuapps-application-shell').classes()).toContain('collapsed')
      listeners.forEach(listener => listener({ matches: false }))
      await flushPromises()
      expect(wrapper.get('.kuapps-application-shell').classes()).not.toContain('collapsed')
      // Tabs keep their name as tooltip for when only the icon fits.
      expect(wrapper.findAll('.kuapps-workspace-tab')[1].attributes('title')).toBe('Resources')
    } finally {
      window.matchMedia = matchMedia
      wrapper.unmount()
    }
  })
})
