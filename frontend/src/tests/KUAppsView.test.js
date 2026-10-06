import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

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

  it('keeps Architecture and Observability together without provider navigation', async () => {
    const wrapper = mount(KUAppsView, {
      props: { activeView: 'architecture', applicationId: 'app-a' },
      global: {
        stubs: {
          ArchitectureView: true,
          ApmObservabilityView: true,
        },
      },
    })
    await flushPromises()

    expect(wrapper.findAll('.kuapps-tab')).toHaveLength(2)
    expect(wrapper.text()).toContain('Applications')
    expect(wrapper.findComponent({ name: 'ArchitectureView' }).exists()).toBe(true)
    expect(wrapper.text()).not.toContain('AWS')
    expect(wrapper.text()).not.toContain('GCP')

    await wrapper.findAll('.kuapps-tab')[1].trigger('click')
    expect(wrapper.emitted('update-view')).toEqual([['observability']])
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
    expect(wrapper.text()).toContain('Accounts and scopes')
    expect(wrapper.find('.kuapp-scopes-warning').exists()).toBe(true)
    expect(wrapper.findComponent({ name: 'ArchitectureView' }).exists()).toBe(false)
    expect(global.fetch.mock.calls.some(([url]) => url.includes('/advisor'))).toBe(false)
    wrapper.unmount()
  })

  it('shows architecture projects as a sublevel of the selected application', async () => {
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
      global: {
        plugins: [pinia],
        stubs: {
          ArchitectureView: true,
          ApmObservabilityView: true,
        },
      },
    })
    await flushPromises()

    expect(wrapper.find('.kuapps-project-sublist').exists()).toBe(true)
    expect(wrapper.get('.kuapps-project-sublist').text()).toContain('Orders map')
    expect(wrapper.findComponent({ name: 'ArchitectureView' }).props('hideApplicationList')).toBe(true)
    wrapper.unmount()
  })

  it('uses the global KUApps sidebar as navigation in compact mode', async () => {
    const wrapper = mount(KUAppsView, {
      props: { activeView: 'observability', applicationId: 'app-a', compactNavigation: true },
      global: {
        stubs: {
          ArchitectureView: true,
          ApmObservabilityView: true,
        },
      },
    })
    await flushPromises()

    expect(wrapper.find('.kuapps-tabs').exists()).toBe(false)
    expect(wrapper.findComponent({ name: 'ApmObservabilityView' }).props('hideApplicationList')).toBe(true)
    wrapper.unmount()
  })
})
