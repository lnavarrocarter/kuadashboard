import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h } from 'vue'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))

import KUAppsView from '../components/kuapps/KUAppsView.vue'
import { useArchitectureStore } from '../stores/useArchitectureStore'

// The setup file replaces window.location with a plain object: a small fake that follows replaceState.
function fakeUrl(search) {
  const previous = { location: window.location, replaceState: window.history.replaceState }
  const set = href => {
    const url = new URL(href)
    window.location = { ...previous.location, href: url.href, search: url.search }
  }
  set(`http://localhost:7190/${search}`)
  window.history.replaceState = (_state, _title, href) => set(href)
  return {
    params: () => new URLSearchParams(window.location.search),
    restore() { window.location = previous.location; window.history.replaceState = previous.replaceState },
  }
}

describe('KUApps navigation', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    global.fetch = vi.fn(() => Promise.resolve({
      ok: true,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve([{ id: 'app-a', name: 'Orders', provider: 'generic', profileId: 'local' }]),
    }))
  })

  it('opens on Overview and keeps Map, Signals and Review in one workspace', async () => {
    const wrapper = mount(KUAppsView, {
      props: { activeView: 'architecture', applicationId: 'app-a' },
      global: { stubs: { ArchitectureView: true, ApmObservabilityView: true } },
    })
    await flushPromises()

    const tabs = wrapper.findAll('.kuapps-workspace-tab')
    expect(tabs.map(tab => tab.text().replace(/\d+$/, '').trim())).toEqual(['Overview', 'Resources', 'Map', 'Signals', 'Review', 'Settings'])
    expect(wrapper.find('.kuapps-overview-content').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('AWS')

    await tabs[2].trigger('click')
    expect(wrapper.find('.kuapps-complementary-grid').exists()).toBe(true)
    wrapper.findComponent({ name: 'ArchitectureView' }).vm.$emit('open-observability', { id: 'app-a' }, { view: 'metrics' })
    expect(wrapper.emitted('update-view')).toEqual([['observability']])
    await flushPromises()
    expect(wrapper.findComponent({ name: 'ApmObservabilityView' }).props('section')).toBe('signals')
    expect(wrapper.find('.kuapps-complementary-grid').exists()).toBe(true)

    await tabs[4].trigger('click')
    await flushPromises()
    expect(wrapper.findComponent({ name: 'ApmObservabilityView' }).props('section')).toBe('review')
    wrapper.unmount()
  })

  it('offers a way to create the first application when none exist yet', async () => {
    global.fetch = vi.fn(() => Promise.resolve({
      ok: true,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve([]),
    }))

    const wrapper = mount(KUAppsView, {
      props: { activeView: 'architecture' },
      global: {
        stubs: {
          ArchitectureView: true,
          ApmObservabilityView: true,
        },
      },
    })
    await flushPromises()

    expect(wrapper.findComponent({ name: 'ApmObservabilityView' }).exists()).toBe(false)
    const createButtons = wrapper.findAll('button').filter(b => b.text().includes('Create application'))
    expect(createButtons.length).toBeGreaterThan(0)

    // Creating an application no longer goes through the APM setup (#149).
    await createButtons[0].trigger('click')
    expect(wrapper.emitted('update-view')).toBeUndefined()
    expect(wrapper.find('.kuapps-create-form').exists()).toBe(true)

    global.fetch = vi.fn((url, options = {}) => Promise.resolve({
      ok: true,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve(options.method === 'POST'
        ? { id: 'app-new', name: 'Checkout', scopes: [], warnings: [], local: { bindings: [], legacy: null } }
        : url.includes('/catalog') ? [{ id: 'app-new', name: 'Checkout', provider: null, profileId: null }]
          : { id: 'app-new', name: 'Checkout', revision: 0, scopes: [], warnings: [], local: { bindings: [], legacy: null } }),
    }))
    await wrapper.find('.kuapps-create-form input').setValue('Checkout')
    await wrapper.find('.kuapps-create-form').trigger('submit')
    await flushPromises()

    const post = global.fetch.mock.calls.find(([, options]) => options?.method === 'POST')
    expect(post[0]).toBe('/api/kua-apps/applications')
    expect(JSON.parse(post[1].body)).toMatchObject({ name: 'Checkout' })
    expect(wrapper.emitted('application-context').at(-1)[0]).toMatchObject({ id: 'app-new' })
    wrapper.unmount()
  })

  it('marks only applications with an active synchronization in the application menu', async () => {
    const architectureStore = useArchitectureStore()
    architectureStore.beginApplicationSync('app-a', 'cloudformation:project-a')
    const wrapper = mount(KUAppsView, {
      props: { activeView: 'architecture', applicationId: 'app-a' },
      global: { stubs: { ArchitectureView: true, ApmObservabilityView: true, TeamSpaceModal: true, CloudBackupsModal: true } },
    })
    await flushPromises()

    expect(wrapper.get('.kuapps-application-row').get('.kuapps-app-sync-state').text()).toContain('Syncing')
    expect(wrapper.get('.kuapps-app-sync-state').attributes('role')).toBe('status')
    architectureStore.endApplicationSync('app-a', 'cloudformation:project-a')
    wrapper.unmount()
  })

  it('shows an application without provider with its scopes instead of the profile-bound views', async () => {
    global.fetch = vi.fn(url => Promise.resolve({
      ok: true,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve(url.includes('/catalog')
        ? [{ id: 'app-k', name: 'Checkout', provider: null, profileId: null }]
        : !url.startsWith('/api/kua-apps/') ? []
        : { id: 'app-k', name: 'Checkout', revision: 1, scopes: [{ key: 'kua-scope:1', provider: 'aws', scopeId: '', location: 'us-east-1', label: '' }], warnings: [{ kind: 'scope_unbound', scopeKey: 'kua-scope:1' }], local: { bindings: [], legacy: null } }),
    }))
    const wrapper = mount(KUAppsView, {
      props: { activeView: 'architecture', applicationId: 'app-k' },
      global: { stubs: { ArchitectureView: true, ApmObservabilityView: true } },
    })
    await flushPromises()

    expect(wrapper.text()).toContain('Multi-provider')
    expect(wrapper.find('.kuapp-scopes').exists()).toBe(false)
    await wrapper.findAll('.kuapps-workspace-tab')[5].trigger('click')
    await wrapper.findAll('.kuapps-settings-nav button')[1].trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Accounts and scopes')
    expect(wrapper.find('.kuapp-scopes-warning').exists()).toBe(true)
    wrapper.unmount()
  })

  it('opens Architecture for a providerless application with a verified local scope binding', async () => {
    global.fetch = vi.fn(url => Promise.resolve({
      ok: true,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve(url.includes('/catalog')
        ? [{ id: 'app-k', name: 'Checkout', provider: null, profileId: null }]
        : url.includes('/api/kua-apps/applications/app-k')
          ? { id: 'app-k', name: 'Checkout', scopes: [], local: { bindings: [{ scopeKey: 'aws-scope', profileId: 'local:dev', status: 'verified' }] } }
          : []),
    }))
    const wrapper = mount(KUAppsView, {
      props: { activeView: 'architecture', applicationId: 'app-k', profileId: 'local:dev' },
      global: { stubs: { ArchitectureView: true, ApmObservabilityView: true } },
    })
    await flushPromises()
    await wrapper.findAll('.kuapps-workspace-tab')[2].trigger('click')

    const architecture = wrapper.findComponent({ name: 'ArchitectureView' })
    expect(architecture.exists()).toBe(true)
    expect(architecture.props('profileId')).toBe('local:dev')
    expect(wrapper.text()).not.toContain('Add the accounts of this application')
    wrapper.unmount()
  })

  it('requires an explicit verified scope before adding resources to a multi-scope application', async () => {
    const application = { id: 'app-multi', name: 'Multi', provider: null, profileId: null }
    const detail = {
      ...application,
      scopes: [
        { key: 'scope-aws', provider: 'aws', scopeId: '111111111111', location: 'us-east-1', label: 'Production' },
        { key: 'scope-kube', provider: 'kubernetes', scopeId: 'prod-cluster', location: '', label: 'Prod cluster' },
      ],
      local: { bindings: [
        { scopeKey: 'scope-aws', profileId: 'local:aws-prod', status: 'verified' },
        { scopeKey: 'scope-kube', profileId: 'local:kube-prod', status: 'verified' },
      ] },
    }
    const openResourcePicker = vi.fn()
    const ArchitectureStub = defineComponent({
      props: ['profileId'],
      setup(_, { expose }) {
        expose({ openResourcePicker })
        return () => h('div')
      },
    })
    global.fetch = vi.fn(url => {
      const body = String(url).includes('/catalog') ? [application]
        : String(url).includes('/api/kua-apps/applications/app-multi') ? detail
          : []
      return Promise.resolve({ ok: true, headers: { get: () => 'application/json' }, json: () => Promise.resolve(body) })
    })
    const wrapper = mount(KUAppsView, {
      props: { activeView: 'architecture', applicationId: application.id, profileId: 'global:wrong-scope' },
      global: { stubs: { ArchitectureView: ArchitectureStub, ApmObservabilityView: true, KUAppScopes: true } },
    })
    await flushPromises()

    // The panel opens from the header without changing tab and asks for the account first.
    const addResources = wrapper.get('[data-test="kuapps-add-resources"]')
    expect(addResources.element.disabled).toBe(false)
    await addResources.trigger('click')
    await flushPromises()
    expect(wrapper.find('.kuapps-add-panel').exists()).toBe(true)
    expect(wrapper.find('.kuapps-overview-content').exists()).toBe(true)
    expect(wrapper.find('.kuapps-add-providers').exists()).toBe(false)

    await wrapper.get('.kuapps-scope-selector').setValue('scope-kube')
    const providers = wrapper.findAll('.kuapps-add-providers button')
    expect(providers.map(button => button.text())).toEqual(['Kubernetes', 'Manual resource'])
    await providers[0].trigger('click')
    await flushPromises()

    expect(openResourcePicker).toHaveBeenCalledWith('kubernetes')
    expect(wrapper.findComponent(ArchitectureStub).props('profileId')).toBe('local:kube-prod')
    wrapper.unmount()
  })

  it('after a reload, opens the Map of a multi-account application with the profile that owns its view (#239)', async () => {
    const application = { id: 'app-multi', name: 'Multi', provider: null, profileId: null, architectureProjectIds: ['project-a'] }
    const detail = {
      ...application, revision: 4,
      scopes: [
        { key: 'scope-aws', provider: 'aws', scopeId: '111111111111', location: 'us-east-1' },
        { key: 'scope-kube', provider: 'kubernetes', scopeId: 'prod-cluster', location: '' },
      ],
      local: { bindings: [
        { scopeKey: 'scope-aws', profileId: 'local:aws-prod', status: 'verified' },
        { scopeKey: 'scope-kube', profileId: 'local:kube-prod', status: 'verified' },
      ], legacy: null },
    }
    const calls = []
    global.fetch = vi.fn(url => {
      const text = String(url)
      calls.push(text)
      // The observability settings answer 404 (as the AWS route did): the application must not disappear.
      if (text.startsWith('/api/observability/')) return Promise.resolve({ ok: false, status: 404, headers: { get: () => 'application/json' }, json: () => Promise.resolve({ error: 'Application not found' }) })
      const body = text.includes('/catalog') ? [application]
        : text.endsWith('/views') ? [{ projectId: 'project-a', name: 'Multi map', profileId: 'local:kube-prod', revision: 3 }]
          : text.includes('/registry') ? { resources: [], relationships: [] }
            : text.includes('/api/kua-apps/applications/app-multi') ? detail : []
      return Promise.resolve({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: () => Promise.resolve(body) })
    })
    const wrapper = mount(KUAppsView, {
      props: { activeView: 'architecture', applicationId: application.id, observabilityProvider: 'aws' },
      global: { stubs: { ArchitectureView: true, ApmObservabilityView: true, KUAppScopes: true } },
    })
    await flushPromises()
    await wrapper.findAll('.kuapps-workspace-tab')[2].trigger('click')
    await flushPromises()

    // No "add the accounts" prompt: the view's owner is one of the verified scopes.
    const map = wrapper.findAllComponents({ name: 'ArchitectureView' }).find(view => view.props('workspaceSection') === 'canvas')
    expect(map.props('profileId')).toBe('local:kube-prod')
    // The settings were asked where the application lives (generic), never on the global AWS provider.
    expect(calls.some(url => url.startsWith('/api/observability/aws/'))).toBe(false)
    expect(calls).toContain('/api/observability/generic/applications/app-multi')
    wrapper.unmount()
  })

  it('keeps a legacy application on its own profile after migration gave it unverified scopes', async () => {
    const application = { id: 'app-legacy', name: 'cobranza-ia', provider: 'aws', profileId: 'local:prod', region: 'us-east-1' }
    const detail = {
      id: application.id, name: application.name, revision: 2,
      scopes: [{ key: 'scope-aws', provider: 'aws', scopeId: '', location: 'us-east-1', label: '' }],
      warnings: [{ kind: 'scope_unverified', scopeKey: 'scope-aws' }],
      local: { bindings: [{ scopeKey: 'scope-aws', profileId: 'local:prod', status: 'migrated' }], legacy: { provider: 'aws', profileId: 'local:prod', region: 'us-east-1' } },
    }
    global.fetch = vi.fn(url => {
      const body = String(url).includes('/catalog') ? [application]
        : String(url).includes('/api/kua-apps/applications/app-legacy') && !String(url).includes('/registry') ? detail
          : String(url).includes('/registry') ? { resources: [], relationships: [] } : []
      return Promise.resolve({ ok: true, headers: { get: () => 'application/json' }, json: () => Promise.resolve(body) })
    })
    const wrapper = mount(KUAppsView, {
      props: { activeView: 'architecture', applicationId: application.id },
      global: { stubs: { ArchitectureView: true, ApmObservabilityView: true, KUAppScopes: true } },
    })
    await flushPromises()

    expect(wrapper.get('[data-test="kuapps-add-resources"]').element.disabled).toBe(false)
    await wrapper.findAll('.kuapps-workspace-tab')[2].trigger('click')
    expect(wrapper.findComponent({ name: 'ArchitectureView' }).props('profileId')).toBe('local:prod')
    wrapper.unmount()
  })

  it('keeps every application in the sidebar when a hosted Architecture view loads one profile', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const apps = [
      { id: 'app-a', name: 'cobranza-ia', provider: 'aws', profileId: 'local:prod' },
      { id: 'app-b', name: 'J360-kubernetes', provider: 'generic', profileId: 'local' },
    ]
    global.fetch = vi.fn(url => Promise.resolve({ ok: true, headers: { get: () => 'application/json' }, json: () => Promise.resolve(String(url).includes('/catalog') ? apps : []) }))
    const wrapper = mount(KUAppsView, {
      props: { activeView: 'architecture', applicationId: 'app-a' },
      global: { plugins: [pinia], stubs: { ArchitectureView: true, ApmObservabilityView: true, KUAppScopes: true } },
    })
    await flushPromises()
    useArchitectureStore().applications = [apps[0]]
    await flushPromises()
    expect(wrapper.findAll('.kuapps-application-row')).toHaveLength(2)
    wrapper.unmount()
  })

  it('starts collection from the Overview without navigating to Signals', async () => {
    const requestCollect = vi.fn()
    const SignalsStub = defineComponent({
      props: ['section'],
      setup(_, { expose }) {
        expose({ requestCollect })
        return () => h('div', { class: 'signals-stub' })
      },
    })
    const application = { id: 'app-a', name: 'orders', provider: 'aws', profileId: 'local:prod' }
    global.fetch = vi.fn(url => {
      const text = String(url)
      const body = text.includes('/catalog') ? [application]
        : text.includes('/topology') ? { resources: [{ id: 'api', type: 'lambda', name: 'api' }], analysis: null }
          : text.includes('/overview') ? { health: { status: 'unknown', signals: [] }, latestRun: null }
            : text.includes('/registry') ? { resources: [], relationships: [] } : []
      return Promise.resolve({ ok: true, headers: { get: () => 'application/json' }, json: () => Promise.resolve(body) })
    })
    const wrapper = mount(KUAppsView, {
      props: { activeView: 'architecture', applicationId: application.id },
      global: { stubs: { ArchitectureView: true, ApmObservabilityView: SignalsStub, KUAppScopes: true, AdvisorPanel: true } },
    })
    await flushPromises()
    await wrapper.get('[data-test="summary-collect"]').trigger('click')
    await flushPromises()
    document.body.querySelector('[data-test="summary-confirm-collect"]').click()
    await flushPromises()

    expect(wrapper.find('.kuapps-overview-content').exists()).toBe(true)
    expect(wrapper.find('.kuapps-observability-workspace').exists()).toBe(false)
    expect(requestCollect).not.toHaveBeenCalled()
    expect(global.fetch.mock.calls.some(([url, options]) => String(url).includes('/collect-now') && options?.method === 'POST')).toBe(true)
    wrapper.unmount()
  })

  it('deletes an application only after typing its name, with the revision it read', async () => {
    const application = { id: 'app-del', name: 'Orders', provider: 'aws', profileId: 'local:prod' }
    const detail = { ...application, revision: 7, scopes: [], local: { bindings: [], legacy: null } }
    global.fetch = vi.fn((url, options = {}) => {
      const text = String(url)
      let body = []
      if (options.method === 'DELETE') body = { id: application.id, deleted: true }
      else if (text.includes('/catalog')) body = global.fetch.mock.calls.some(([, o]) => o?.method === 'DELETE') ? [] : [application]
      else if (text.includes('/registry')) body = { resources: [], relationships: [] }
      else if (text.includes('/api/kua-apps/applications/app-del')) body = detail
      return Promise.resolve({ ok: true, headers: { get: () => 'application/json' }, json: () => Promise.resolve(body) })
    })
    const wrapper = mount(KUAppsView, {
      props: { activeView: 'architecture' },
      global: { stubs: { ArchitectureView: true, ApmObservabilityView: true, KUAppScopes: true, AdvisorPanel: true } },
    })
    await flushPromises()
    await wrapper.get('.kuapps-application-row').trigger('click')
    await flushPromises()
    await wrapper.findAll('.kuapps-workspace-tab')[5].trigger('click')
    await wrapper.findAll('.kuapps-settings-nav button')[4].trigger('click')

    const remove = wrapper.get('[data-test="delete-application"]')
    expect(remove.element.disabled).toBe(true)
    expect(wrapper.text()).toContain('infrastructure in the cloud are not deleted')
    await wrapper.get('[data-test="delete-confirmation"]').setValue('Orders')
    expect(remove.element.disabled).toBe(false)
    await remove.trigger('click')
    await flushPromises()

    const call = global.fetch.mock.calls.find(([, options]) => options?.method === 'DELETE')
    expect(call[0]).toBe('/api/kua-apps/applications/app-del?expectedRevision=7')
    expect(wrapper.findAll('.kuapps-application-row')).toHaveLength(0)
    wrapper.unmount()
  })

  it('does not use the global profile for an unverified application scope', async () => {
    const application = { id: 'app-unverified', name: 'Unverified', provider: null, profileId: null }
    const detail = {
      ...application,
      scopes: [{ key: 'scope-aws', provider: 'aws', scopeId: '', location: 'us-east-1', label: '' }],
      local: { bindings: [] },
    }
    global.fetch = vi.fn(url => {
      const body = String(url).includes('/catalog') ? [application]
        : String(url).includes('/api/kua-apps/applications/app-unverified') ? detail
          : []
      return Promise.resolve({ ok: true, headers: { get: () => 'application/json' }, json: () => Promise.resolve(body) })
    })
    const wrapper = mount(KUAppsView, {
      props: { activeView: 'architecture', applicationId: application.id, profileId: 'global:wrong-scope' },
      global: { stubs: { ArchitectureView: true, ApmObservabilityView: true, KUAppScopes: true } },
    })
    await flushPromises()

    expect(wrapper.get('[data-test="kuapps-add-resources"]').element.disabled).toBe(true)
    expect(wrapper.findComponent({ name: 'ArchitectureView' }).exists()).toBe(false)
    wrapper.unmount()
  })

  it('keeps only applications in navigation and moves architecture actions into the app workspace', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const architectureStore = useArchitectureStore()
    architectureStore.projects = [{ id: 'project-a', name: 'Orders map', description: 'Runtime architecture' }]
    architectureStore.selectedProjectId = 'project-a'
    global.fetch = vi.fn(() => Promise.resolve({
      ok: true,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve([{ id: 'app-a', name: 'Orders', provider: 'generic', profileId: 'local', architectureProjectIds: ['project-a'] }]),
    }))

    const wrapper = mount(KUAppsView, {
      props: { activeView: 'architecture', applicationId: 'app-a' },
      global: { plugins: [pinia], stubs: { ArchitectureView: true, ApmObservabilityView: true } },
    })
    await flushPromises()
    const tabs = () => wrapper.findAll('.kuapps-workspace-tab')

    expect(wrapper.find('.kuapps-project-sublist').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Projects')
    await tabs()[2].trigger('click')
    const map = () => wrapper.findComponent({ name: 'ArchitectureView' })
    expect(map().props('hideApplicationList')).toBe(true)
    expect(map().props('workspaceMode')).toBe(true)
    expect(map().props('workspaceSection')).toBe('canvas')
    await wrapper.findAll('.kuapps-map-toggle button')[1].trigger('click')
    expect(map().props('workspaceSection')).toBe('routes')

    await tabs()[5].trigger('click')
    const sections = () => wrapper.findAll('.kuapps-settings-nav button')
    expect(sections().map(button => button.text())).toEqual(['Application details', 'Accounts and scopes', 'Sources and sync', 'Backups and collaboration', 'Delete application'])
    await sections()[1].trigger('click')
    expect(wrapper.find('.kuapp-scopes').exists()).toBe(true)
    await sections()[2].trigger('click')
    expect(map().props('settingsOnly')).toBe(true)
    expect(wrapper.get('.kuapps-settings-workspace').text()).toContain('compares the resources of Observability with the nodes of the map')
    expect(wrapper.get('.kuapps-settings-workspace').text()).toContain('CloudFormation reads have no charge')
    await sections()[3].trigger('click')
    const settings = wrapper.get('.kuapps-settings-workspace').text()
    expect(settings).toContain('Import backup')
    expect(settings).toContain('Export backup')
    expect(settings).toContain('Cloud backups')
    expect(settings).not.toContain('Add resources')

    await tabs()[1].trigger('click')
    expect(map().props('workspaceSection')).toBe('resources')
    await wrapper.get('[data-test="kuapps-resources-add"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('.kuapps-registry-workspace').exists()).toBe(true)
    const picker = wrapper.findAllComponents({ name: 'ArchitectureView' }).find(view => view.props('resourcePickerOnly'))
    expect(picker.props('profileId')).toBe('local')
    expect(wrapper.get('.kuapps-add-explain').text()).toContain('metric collection stays off')

    // The Map opens the same panel (#151): one picker, whichever entry point asked for it.
    await wrapper.get('.kuapps-add-panel header button').trigger('click')
    expect(wrapper.find('.kuapps-add-panel').exists()).toBe(false)
    await tabs()[2].trigger('click')
    map().vm.$emit('request-resource-picker')
    await flushPromises()
    expect(wrapper.findAll('.kuapps-add-panel')).toHaveLength(1)
    expect(wrapper.findAllComponents({ name: 'ArchitectureView' }).filter(view => view.props('resourcePickerOnly'))).toHaveLength(1)
    expect(wrapper.findAll('.kuapps-workspace-tab.active').map(tab => tab.text())[0]).toContain('Map')
    wrapper.unmount()
  })

  it('saves editable application details from Settings using its current revision', async () => {
    const application = { id: 'app-settings', name: 'Orders', provider: 'aws', profileId: 'local:prod', pollingEnabled: false }
    const detail = { ...application, environment: 'staging', team: 'platform', revision: 4, scopes: [], local: { bindings: [], legacy: null } }
    let localPollingEnabled = false
    global.fetch = vi.fn((url, options = {}) => {
      const text = String(url)
      let body
      if (text.includes('/api/observability/') && options.method === 'PATCH') {
        localPollingEnabled = JSON.parse(options.body).pollingEnabled
        body = { ...application, pollingEnabled: localPollingEnabled }
      } else if (options.method === 'PATCH') body = { ...detail, ...JSON.parse(options.body), revision: 5 }
      else if (text.includes('/catalog')) body = [application]
      else if (text.includes('/topology')) body = { resources: [{ id: 'alb', type: 'elb', name: 'orders', arn: 'arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/app/orders/abcdef0123456789' }], analysis: null }
      else if (text.includes('/overview')) body = { health: { status: 'unknown', signals: [] }, latestRun: null }
      else if (text.includes('/registry')) body = { resources: [], relationships: [] }
      else if (text.includes('/api/observability/')) body = { ...application, pollingEnabled: localPollingEnabled }
      else if (text.includes('/api/kua-apps/applications/app-settings')) body = detail
      else if (text.includes('/api/account')) body = { entitlements: { team: { name: 'Platform' } } }
      else body = []
      return Promise.resolve({ ok: true, headers: { get: () => 'application/json' }, json: () => Promise.resolve(body) })
    })
    const wrapper = mount(KUAppsView, {
      props: { activeView: 'architecture', applicationId: application.id },
      global: { stubs: { ArchitectureView: true, ApmObservabilityView: true, TeamSpaceModal: true, CloudBackupsModal: true } },
    })
    await flushPromises()
    await wrapper.findAll('.kuapps-workspace-tab')[5].trigger('click')
    const schedule = wrapper.get('[data-test="kuapps-collection-schedule"]')
    await schedule.setValue(true)
    expect(wrapper.get('[data-test="kuapps-collection-estimate"]').text()).toContain('$0.07/month')
    expect(wrapper.get('[data-test="kuapps-collection-cost-ack"]').exists()).toBe(true)
    expect(wrapper.get('form.kuapps-settings-section button[type="submit"]').element.disabled).toBe(true)
    await wrapper.get('[data-test="kuapps-collection-cost-ack"]').setValue(true)
    await wrapper.get('.kuapps-settings-fields input:not([type="checkbox"])').setValue('Orders Production')
    await wrapper.get('form.kuapps-settings-section').trigger('submit')
    await flushPromises()

    const patches = global.fetch.mock.calls.filter(([, options]) => options?.method === 'PATCH')
    const portablePatch = patches.find(([url]) => String(url).includes('/api/kua-apps/'))
    const localPatch = patches.find(([url]) => String(url).includes('/api/observability/'))
    expect(JSON.parse(portablePatch[1].body)).toMatchObject({ name: 'Orders Production', environment: 'staging', team: 'platform', expectedRevision: 4 })
    expect(JSON.parse(portablePatch[1].body)).not.toHaveProperty('pollingEnabled')
    expect(JSON.parse(localPatch[1].body)).toEqual({ pollingEnabled: true })
    expect(localPatch[1].headers['X-Profile-Id']).toBe('local:prod')
    expect(wrapper.text()).toContain('Changes saved.')
    await wrapper.findAll('.kuapps-settings-nav button')[1].trigger('click')
    expect(wrapper.find('.kuapp-scopes').exists()).toBe(true)
    await wrapper.findAll('.kuapps-settings-nav button')[3].trigger('click')
    expect(wrapper.get('.kuapps-settings-workspace').text()).toContain('Platform')
    wrapper.unmount()
  })

  it('keeps a selected registry resource in the map signals inspector', async () => {
    const application = { id: 'app-a', name: 'Orders', provider: 'aws', profileId: 'local:prod', architectureProjectIds: ['project-a'] }
    const resource = {
      id: 'registry:orders-api', provider: 'aws', scopeId: '123456789012', location: 'us-east-1',
      nativeIdentifier: 'arn:aws:lambda:us-east-1:123456789012:function:orders-api', resourceType: 'lambda',
      displayName: 'orders-api', sources: ['apm'],
    }
    const incompatibleResource = {
      id: 'registry:orders-pods', provider: 'kubernetes', scopeId: 'cluster-a', resourceType: 'deployment',
      displayName: 'orders-pods', sources: ['kubernetes'],
    }
    global.fetch = vi.fn(url => Promise.resolve({
      ok: true,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve(url.includes('/catalog') ? [application]
        : url.includes('/registry') ? { resources: [resource, incompatibleResource], relationships: [] }
          : url.includes('/api/kua-apps/applications/app-a') ? { id: 'app-a', scopes: [], local: { bindings: [], legacy: null } }
            : []),
    }))
    const wrapper = mount(KUAppsView, {
      props: { activeView: 'architecture', applicationId: 'app-a' },
      global: { stubs: { ArchitectureView: true, ApmObservabilityView: true } },
    })
    await flushPromises()
    await wrapper.findAll('.kuapps-workspace-tab')[2].trigger('click')
    expect(wrapper.get('.kuapps-complementary-grid').classes()).not.toContain('has-resource-inspector')
    expect(wrapper.find('.kuapps-signals-inspector').exists()).toBe(false)
    await wrapper.findAll('.kuapps-workspace-tab')[1].trigger('click')
    await wrapper.get('.kuapps-resource-row').trigger('click')
    await wrapper.findAll('.kuapps-workspace-tab')[2].trigger('click')
    expect(wrapper.get('.kuapps-signals-inspector dl').text()).toContain('lambda')
    // Browsers do not render the content of a native <template> (jsdom does): the inspector looked empty (#239).
    expect(wrapper.find('.kuapps-signals-inspector template').exists()).toBe(false)
    expect(wrapper.get('[data-test="map-inspector-body"]').text()).toContain('arn:aws:lambda:us-east-1:123456789012:function:orders-api')
    await wrapper.findAll('.kuapps-inspector-tabs button')[1].trigger('click')

    const signals = wrapper.findComponent({ name: 'ApmObservabilityView' })
    expect(signals.exists()).toBe(true)
    expect(signals.props('section')).toBe('signals')
    expect(signals.props('focusResource').node).toMatchObject({ registryResourceId: resource.id, name: resource.displayName })
    expect(signals.props('profileId')).toBe('local:prod')

    wrapper.findComponent({ name: 'ArchitectureView' }).vm.$emit('resource-selected', {
      id: 'graph:checkout-handler', provider: 'aws', resourceType: 'lambda', name: 'checkout-handler',
      nativeId: 'arn:aws:lambda:us-east-1:123456789012:function:checkout-handler',
    })
    await flushPromises()
    expect(wrapper.get('.kuapps-signals-inspector h3').text()).toBe('checkout-handler')
    expect(wrapper.findComponent({ name: 'ApmObservabilityView' }).props('focusResource').node).toMatchObject({
      name: 'checkout-handler', nativeId: 'arn:aws:lambda:us-east-1:123456789012:function:checkout-handler',
    })

    await wrapper.findAll('.kuapps-workspace-tab')[1].trigger('click')
    await wrapper.findAll('.kuapps-resource-row')[1].trigger('click')
    await wrapper.findAll('.kuapps-workspace-tab')[2].trigger('click')
    await wrapper.findAll('.kuapps-inspector-tabs button')[1].trigger('click')
    // A Kubernetes workload of an AWS application has signals too (collected through its kube context).
    const workload = wrapper.findComponent({ name: 'ApmObservabilityView' })
    expect(workload.exists()).toBe(true)
    expect(workload.props('focusResource').node).toMatchObject({ provider: 'kubernetes', name: 'orders-pods' })
    wrapper.unmount()
  })

  it('lists every resource with an explicit signal state, never empty or healthy by default (#152)', async () => {
    const application = { id: 'app-s', name: 'Checkout', provider: null, profileId: null }
    const resource = (id, provider, state) => ({
      id, provider, scopeId: 'scope', location: '', nativeIdentifier: id, resourceType: provider === 'zabbix' ? 'host' : 'lambda',
      displayName: id, sources: ['apm_resource'], ...(state ? { signals: { state, lastDataAt: null } } : {}),
    })
    const resources = [
      resource('fresh', 'aws', 'current'), resource('waiting', 'aws', 'no_data'), resource('old', 'aws', 'stale'),
      resource('unbound', 'aws', 'no_connection'), resource('host', 'zabbix', 'unsupported'), resource('older-backend', 'aws', null),
    ]
    global.fetch = vi.fn(url => Promise.resolve({
      ok: true,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve(url.includes('/catalog') ? [application]
        : url.includes('/registry') ? { resources, relationships: [] }
          : { ...application, revision: 1, scopes: [], local: { bindings: [], legacy: null } }),
    }))
    const wrapper = mount(KUAppsView, {
      props: { activeView: 'architecture', applicationId: application.id },
      global: { stubs: { ArchitectureView: true, ApmObservabilityView: true } },
    })
    await flushPromises()
    await wrapper.findAll('.kuapps-workspace-tab')[1].trigger('click')
    await flushPromises()

    expect(wrapper.findAll('[data-test="resource-signal-state"]').map(badge => badge.text()))
      .toEqual(['Current', 'No data yet', 'Stale', 'No connection', 'Not supported', 'Unknown'])
    await wrapper.findAll('.kuapps-resource-row')[3].trigger('click')
    expect(wrapper.get('[data-test="inspector-signal-state"]').text()).toContain('No verified profile of this computer reaches its scope')
    wrapper.unmount()
  })

  it('keeps the workspace tab in the URL next to ?app= and restores it on reload (#152)', async () => {
    const url = fakeUrl('?app=app-a&tab=resources')
    try {
      const wrapper = mount(KUAppsView, {
        props: { activeView: 'architecture', applicationId: 'app-a' },
        global: { stubs: { ArchitectureView: true, ApmObservabilityView: true } },
      })
      await flushPromises()
      expect(wrapper.get('.kuapps-workspace-tab.active').text()).toContain('Resources')

      await wrapper.findAll('.kuapps-workspace-tab')[4].trigger('click')
      expect(url.params().get('tab')).toBe('review')
      expect(url.params().get('app')).toBe('app-a')
      await wrapper.findAll('.kuapps-workspace-tab')[0].trigger('click')
      expect(url.params().has('tab')).toBe(false)
      wrapper.unmount()
    } finally {
      url.restore()
    }
  })

  it('a link to an application that no longer exists, or to an unknown tab, opens nothing stale (#152)', async () => {
    const url = fakeUrl('?app=deleted-app&tab=nonsense')
    try {
      const wrapper = mount(KUAppsView, {
        props: { activeView: 'architecture', applicationId: 'deleted-app' },
        global: { stubs: { ArchitectureView: true, ApmObservabilityView: true } },
      })
      await flushPromises()
      // The catalog only has app-a: nothing of the deleted application is shown as if it existed.
      expect(wrapper.text()).not.toContain('deleted-app')
      expect(wrapper.find('.kuapps-workspace-tab.active').exists() ? wrapper.get('.kuapps-workspace-tab.active').text() : 'Overview').toContain('Overview')
      wrapper.unmount()
    } finally {
      url.restore()
    }
  })

  it('shows one removable sync definition per registry resource when Architecture is unavailable', async () => {
    const application = { id: 'app-k', name: 'Development', provider: null, profileId: null }
    const resource = {
      id: 'registry:api', provider: 'aws', scopeId: '123456789012', location: 'us-east-1',
      nativeIdentifier: 'arn:aws:lambda:us-east-1:123456789012:function:api', resourceType: 'lambda',
      displayName: 'api', sources: ['apm_resource'],
    }
    global.fetch = vi.fn((url, options = {}) => {
      const removed = global.fetch.mock.calls.some(([, request]) => request?.method === 'DELETE')
      const body = url.includes('/catalog') ? [application]
        : url.includes('/registry') ? { resources: removed ? [] : [resource], relationships: [] }
          : { ...application, revision: 3, scopes: [], local: { bindings: [], legacy: null } }
      return Promise.resolve({
        ok: true,
        status: options.method === 'DELETE' ? 204 : 200,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve(body),
      })
    })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const wrapper = mount(KUAppsView, {
      props: { activeView: 'architecture', applicationId: application.id },
      global: { stubs: { ArchitectureView: true, ApmObservabilityView: true } },
    })
    await flushPromises()
    await wrapper.findAll('.kuapps-workspace-tab')[5].trigger('click')
    await wrapper.findAll('.kuapps-settings-nav button')[2].trigger('click')

    expect(wrapper.findAll('.kuapps-sync-resource-row')).toHaveLength(1)
    expect(wrapper.get('.kuapps-sync-resource-row').text()).toContain(resource.nativeIdentifier)
    await wrapper.get('[data-test="stop-resource-sync-registry:api"]').trigger('click')
    await flushPromises()

    const deletion = global.fetch.mock.calls.find(([, request]) => request?.method === 'DELETE')
    expect(deletion[0]).toContain(`/registry/resources/${encodeURIComponent(resource.id)}?expectedRevision=3`)
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining(resource.displayName))
    expect(wrapper.findAll('.kuapps-sync-resource-row')).toHaveLength(0)
    confirm.mockRestore()
    wrapper.unmount()
  })

  it('groups Kubernetes sync entries by context and namespace and shows full registry details', async () => {
    const application = { id: 'app-k8s', name: 'Development', provider: null, profileId: null }
    const resources = [
      {
        id: 'registry:orders-api', provider: 'kubernetes', scopeId: 'dev-eks', kubeContext: 'dev-eks', namespace: 'orders',
        nativeIdentifier: 'dev-eks/orders/Deployment/api', resourceType: 'deployment', displayName: 'api',
        sources: ['apm_resource'], updatedAt: '2026-10-08T08:00:00.000Z',
      },
      {
        id: 'registry:orders-service', provider: 'kubernetes', scopeId: 'dev-eks', kubeContext: 'dev-eks', namespace: 'orders',
        nativeIdentifier: 'dev-eks/orders/Service/api', resourceType: 'service', displayName: 'api',
        sources: ['architecture_node'],
      },
      {
        id: 'registry:payments-api', provider: 'kubernetes', scopeId: 'dev-eks', kubeContext: 'dev-eks', namespace: 'payments',
        nativeIdentifier: 'dev-eks/payments/Deployment/api', resourceType: 'deployment', displayName: 'api', sources: ['apm_resource'],
      },
    ]
    global.fetch = vi.fn(url => Promise.resolve({
      ok: true,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve(String(url).includes('/catalog') ? [application]
        : String(url).includes('/registry') ? { resources, relationships: [] }
          : { ...application, revision: 1, scopes: [], local: { bindings: [], legacy: null } }),
    }))
    const wrapper = mount(KUAppsView, {
      props: { activeView: 'architecture', applicationId: application.id },
      global: { stubs: { ArchitectureView: true, ApmObservabilityView: true } },
    })
    await flushPromises()
    await wrapper.findAll('.kuapps-workspace-tab')[5].trigger('click')
    await wrapper.findAll('.kuapps-settings-nav button')[2].trigger('click')

    const namespaceGroups = wrapper.findAll('.kuapps-sync-source-group[data-source-type="kubernetes"]')
    expect(namespaceGroups).toHaveLength(2)
    expect(namespaceGroups[0].text()).toContain('orders')
    expect(namespaceGroups[0].findAll('.kuapps-sync-resource-row')).toHaveLength(2)
    expect(namespaceGroups[1].text()).toContain('payments')

    await wrapper.findAll('.kuapps-workspace-tab')[1].trigger('click')
    await wrapper.findAll('.kuapps-resource-row')[0].trigger('click')
    const inspector = wrapper.get('.kuapps-resource-inspector')
    expect(inspector.text()).toContain('dev-eks')
    expect(inspector.text()).toContain('orders')
    expect(inspector.get('.kuapps-resource-source-list').text()).toContain('Observability')
    expect(inspector.get('.kuapps-resource-identity').text()).toContain(resources[0].nativeIdentifier)
    wrapper.unmount()
  })

  it('keeps workspace navigation visible in compact mode and opens Signals from Observability', async () => {
    const wrapper = mount(KUAppsView, {
      props: { activeView: 'observability', applicationId: 'app-a', compactNavigation: true },
      global: { stubs: { ArchitectureView: true, ApmObservabilityView: true } },
    })
    await flushPromises()

    expect(wrapper.findAll('.kuapps-workspace-tab')).toHaveLength(6)
    await wrapper.setProps({ activeView: 'architecture' })
    await wrapper.setProps({ activeView: 'observability' })
    expect(wrapper.find('.kuapps-observability-workspace').exists()).toBe(true)
    wrapper.unmount()
  })

  it('shows accounts that need a profile in Review and counts them on the tab', async () => {
    global.fetch = vi.fn(url => Promise.resolve({
      ok: true,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve(url.includes('/catalog')
        ? [{ id: 'app-k', name: 'Checkout', provider: null, profileId: null }]
        : url.includes('/registry') ? { resources: [], relationships: [{ id: 'r1', sourceResourceId: 'a', targetResourceId: 'b', sourceName: 'api', targetName: 'queue', relationType: 'publishes_to', status: 'suggested' }] }
          : url.includes('/api/kua-apps/applications/app-k')
            ? { id: 'app-k', name: 'Checkout', revision: 1, scopes: [{ key: 'kua-scope:1', provider: 'aws', scopeId: '111111111111', location: 'us-east-1', label: 'Orders' }], warnings: [{ kind: 'scope_mismatch', scopeKey: 'kua-scope:1' }], local: { bindings: [], legacy: null } }
            : []),
    }))
    const wrapper = mount(KUAppsView, {
      props: { activeView: 'architecture', applicationId: 'app-k' },
      global: { stubs: { ArchitectureView: true, ApmObservabilityView: true, KUAppExplanation: true } },
    })
    await flushPromises()

    const review = wrapper.findAll('.kuapps-workspace-tab')[4]
    expect(review.get('b').text()).toBe('2')
    await review.trigger('click')
    expect(wrapper.get('.kuapps-review-group').text()).toContain('AWS · Orders · us-east-1')
    expect(wrapper.get('.kuapps-review-group').text()).toContain('reaches another account')
    // Without a provider, Review is served by the generic Observability routes (#166).
    const reviewView = wrapper.findComponent({ name: 'ApmObservabilityView' })
    expect(reviewView.props('section')).toBe('review')
    expect(reviewView.props('provider')).toBe('generic')
    expect(reviewView.props('profileId')).toBe('local')
    reviewView.vm.$emit('explain-relationship', { sourceResourceId: 'a', targetResourceId: 'b', relationType: 'publishes_to', status: 'suggested' })
    await flushPromises()
    expect(wrapper.findComponent({ name: 'KUAppExplanation' }).props('request')).toMatchObject({ sourceResourceId: 'a', targetResourceId: 'b', relationType: 'publishes_to', status: 'suggested' })
    wrapper.unmount()
  })
})
