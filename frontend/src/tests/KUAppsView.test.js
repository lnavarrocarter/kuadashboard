import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h } from 'vue'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))

import KUAppsView from '../components/kuapps/KUAppsView.vue'
import { useArchitectureStore } from '../stores/useArchitectureStore'

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

  it('sends Collect now from the Overview to the Signals confirmation', async () => {
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

    expect(wrapper.find('.kuapps-observability-workspace').exists()).toBe(true)
    expect(requestCollect).toHaveBeenCalledTimes(1)
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
    wrapper.unmount()
  })

  it('saves editable application details from Settings using its current revision', async () => {
    const application = { id: 'app-settings', name: 'Orders', provider: 'aws', profileId: 'local:prod' }
    const detail = { ...application, environment: 'staging', team: 'platform', revision: 4, scopes: [], local: { bindings: [], legacy: null } }
    global.fetch = vi.fn((url, options = {}) => {
      let body
      if (options.method === 'PATCH') body = { ...detail, ...JSON.parse(options.body), revision: 5 }
      else if (String(url).includes('/catalog')) body = [application]
      else if (String(url).includes('/registry')) body = { resources: [], relationships: [] }
      else if (String(url).includes('/api/kua-apps/applications/app-settings')) body = detail
      else if (String(url).includes('/api/account')) body = { entitlements: { team: { name: 'Platform' } } }
      else body = []
      return Promise.resolve({ ok: true, headers: { get: () => 'application/json' }, json: () => Promise.resolve(body) })
    })
    const wrapper = mount(KUAppsView, {
      props: { activeView: 'architecture', applicationId: application.id },
      global: { stubs: { ArchitectureView: true, ApmObservabilityView: true, TeamSpaceModal: true, CloudBackupsModal: true } },
    })
    await flushPromises()
    await wrapper.findAll('.kuapps-workspace-tab')[5].trigger('click')
    await wrapper.get('.kuapps-settings-fields input').setValue('Orders Production')
    await wrapper.get('form.kuapps-settings-section').trigger('submit')
    await flushPromises()

    const patch = global.fetch.mock.calls.find(([, options]) => options?.method === 'PATCH')
    expect(JSON.parse(patch[1].body)).toMatchObject({ name: 'Orders Production', environment: 'staging', team: 'platform', expectedRevision: 4 })
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
    await wrapper.findAll('.kuapps-workspace-tab')[1].trigger('click')
    await wrapper.get('.kuapps-resource-row').trigger('click')
    await wrapper.findAll('.kuapps-workspace-tab')[2].trigger('click')
    expect(wrapper.get('.kuapps-signals-inspector dl').text()).toContain('lambda')
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
    expect(wrapper.findComponent({ name: 'ApmObservabilityView' }).exists()).toBe(false)
    expect(wrapper.find('.kuapps-signals-unavailable').text()).toContain('No collectors were started.')
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
      global: { stubs: { ArchitectureView: true, ApmObservabilityView: true } },
    })
    await flushPromises()

    const review = wrapper.findAll('.kuapps-workspace-tab')[4]
    expect(review.get('b').text()).toBe('2')
    await review.trigger('click')
    expect(wrapper.get('.kuapps-review-group').text()).toContain('AWS · Orders · us-east-1')
    expect(wrapper.get('.kuapps-review-group').text()).toContain('reaches another account')
    expect(wrapper.find('.kuapps-relationship-row').exists()).toBe(true)
    expect(wrapper.findComponent({ name: 'ApmObservabilityView' }).exists()).toBe(false)
    await wrapper.get('[data-test="explain-registry-relationship"]').trigger('click')
    expect(wrapper.findComponent({ name: 'KUAppExplanation' }).props('request')).toMatchObject({ sourceResourceId: 'a', targetResourceId: 'b', relationType: 'publishes_to', status: 'suggested' })
    wrapper.unmount()
  })
})
