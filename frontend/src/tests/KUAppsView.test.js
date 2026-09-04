import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))

import KUAppsView from '../components/kuapps/KUAppsView.vue'

describe('KUApps navigation', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    global.fetch = vi.fn(() => Promise.resolve({
      ok: true,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve([{ id: 'app-a', name: 'Orders', provider: 'generic' }]),
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
})
