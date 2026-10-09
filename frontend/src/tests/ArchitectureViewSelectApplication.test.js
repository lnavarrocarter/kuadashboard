import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))

import ArchitectureView from '../components/architecture/ArchitectureView.vue'
import { useArchitectureStore } from '../stores/useArchitectureStore'

const APPLICATIONS = [
  { id: 'app-a', name: 'Orders', provider: 'aws', environment: 'prod' },
  { id: 'app-b', name: 'Billing', provider: 'gcp', environment: 'dev' },
]

// #106: choosing an application read `profileId` instead of `props.profileId`
// in the script, so the click threw and nothing happened.
describe('ArchitectureView: choosing an application', () => {
  let store

  beforeEach(() => {
    setActivePinia(createPinia())
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, headers: { get: () => 'application/json' }, json: () => Promise.resolve([]) }))
    store = useArchitectureStore()
    vi.spyOn(store, 'loadApplicationCatalog').mockImplementation(async () => { store.applications = APPLICATIONS })
    vi.spyOn(store, 'loadApplications').mockImplementation(async () => { store.applications = APPLICATIONS; return APPLICATIONS })
    vi.spyOn(store, 'selectApplication').mockResolvedValue()
  })

  it('opening the picker while the profile still loads keeps it open with the connection context (#239)', async () => {
    // The mount and the picker load the same profile once; a second load used to close the picker.
    store.selectApplication.mockImplementation(async id => {
      await new Promise(resolve => setTimeout(resolve, 5))
      store.selectedApplicationId = id
      store.selectedProjectId = 'project-a'
    })
    const wrapper = mount(ArchitectureView, { props: { profileId: 'aws-dev', applicationId: 'app-a', workspaceMode: true, resourcePickerOnly: true }, shallow: true })
    await wrapper.vm.openResourcePicker('kubernetes', { kubeContext: 'arn:aws:eks:us-east-1:1:cluster/dev' })
    await flushPromises()

    expect(store.loadApplications).toHaveBeenCalledTimes(1)
    const panel = wrapper.findComponent({ name: 'ArchitectureKubernetesDiscoveryPanel' })
    expect(panel.exists()).toBe(true)
    expect(panel.props('preferredContext')).toBe('arn:aws:eks:us-east-1:1:cluster/dev')
    wrapper.unmount()
  })

  it('without a profile, opens the chosen application', async () => {
    const wrapper = mount(ArchitectureView, { props: { profileId: '' }, shallow: true })
    await flushPromises()

    const rows = wrapper.findAll('.architecture-first-access-row')
    expect(rows).toHaveLength(2)
    await rows[1].trigger('click')
    await flushPromises()

    expect(wrapper.emitted('application-context')).toEqual([[APPLICATIONS[1]]])
    expect(store.selectApplication).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('with a profile, selects the application from the side list', async () => {
    const wrapper = mount(ArchitectureView, { props: { profileId: 'aws-dev' }, shallow: true })
    await flushPromises()
    store.selectApplication.mockClear()

    const rows = wrapper.findAll('.architecture-application-row')
    expect(rows).toHaveLength(2)
    await rows[1].trigger('click')
    await flushPromises()

    expect(store.selectApplication).toHaveBeenCalledWith('app-b')
    expect(wrapper.emitted('application-context')).toBeUndefined()
    wrapper.unmount()
  })

  it('hides Architecture summary chrome when embedded in the KUApps map', async () => {
    store.applications = APPLICATIONS
    store.selectedApplicationId = 'app-a'
    store.projects = [{ id: 'project-a', name: 'Orders map' }]
    store.selectedProjectId = 'project-a'
    store.graph = { revision: 1, document: { nodes: [], edges: [], sources: [], scopes: [], layout: {}, view: {} } }
    store.loading = false

    const wrapper = mount(ArchitectureView, {
      props: {
        profileId: 'aws-dev', applicationId: 'app-a', workspaceMode: true,
        workspaceSection: 'canvas', hideApplicationList: true,
      },
      shallow: true,
    })
    await flushPromises()

    expect(wrapper.find('.architecture-project-header').exists()).toBe(false)
    expect(wrapper.find('.architecture-application-context').exists()).toBe(false)
    expect(wrapper.find('.architecture-stats').exists()).toBe(false)
    wrapper.unmount()
  })
})
