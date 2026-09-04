import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))

import KUAppsView from '../components/kuapps/KUAppsView.vue'

describe('KUApps navigation', () => {
  it('keeps Architecture and Observability together without provider navigation', async () => {
    const wrapper = mount(KUAppsView, {
      props: { activeView: 'architecture' },
      global: {
        stubs: {
          ArchitectureView: true,
          ApmObservabilityView: true,
        },
      },
    })

    expect(wrapper.findAll('.kuapps-tab')).toHaveLength(2)
    expect(wrapper.findComponent({ name: 'ArchitectureView' }).exists()).toBe(true)
    expect(wrapper.text()).not.toContain('AWS')
    expect(wrapper.text()).not.toContain('GCP')

    await wrapper.findAll('.kuapps-tab')[1].trigger('click')
    expect(wrapper.emitted('update-view')).toEqual([['observability']])
    wrapper.unmount()
  })
})
