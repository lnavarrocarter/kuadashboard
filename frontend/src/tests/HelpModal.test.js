import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import HelpModal from '../components/modals/HelpModal.vue'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))

const BaseModalStub = {
  props: ['show', 'size'],
  template: '<section v-if="show"><header><slot name="title" /></header><main><slot /></main><footer><slot name="footer" /></footer></section>',
}

describe('HelpModal release history', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('summarizes release history and expands details on demand', async () => {
    const wrapper = mount(HelpModal, {
      props: { show: true },
      global: { stubs: { BaseModal: BaseModalStub } },
    })

    await wrapper.findAll('.help-nav-item')[1].trigger('click')
    const releases = wrapper.findAll('.release-block')
    expect(releases[0].text()).toContain('Unreleased')
    expect(releases[0].text()).toContain('live elapsed runtime')
    const firstRelease = releases[1]

    expect(firstRelease.text()).toContain('1.17.0')
    expect(firstRelease.findAll('.release-summary-pill').length).toBeGreaterThan(1)
    expect(firstRelease.findAll('.change-item')).toHaveLength(8)
    expect(firstRelease.get('.release-toggle').text()).toContain('Show')

    await firstRelease.get('.release-toggle').trigger('click')

    expect(wrapper.findAll('.release-block')[1].findAll('.change-item').length).toBeGreaterThan(8)
    expect(wrapper.findAll('.release-block')[1].get('.release-toggle').text()).toContain('fewer')
  })
})