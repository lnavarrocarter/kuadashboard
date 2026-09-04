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

  it('summarizes long prerelease history and expands details on demand', async () => {
    const wrapper = mount(HelpModal, {
      props: { show: true },
      global: { stubs: { BaseModal: BaseModalStub } },
    })

    await wrapper.findAll('.help-nav-item')[1].trigger('click')
    const firstRelease = wrapper.get('.release-block')

    expect(firstRelease.findAll('.release-summary-pill').length).toBeGreaterThan(1)
    expect(firstRelease.findAll('.change-item')).toHaveLength(8)
    expect(firstRelease.get('.release-toggle').text()).toContain('Mostrar')

    await firstRelease.get('.release-toggle').trigger('click')

    expect(wrapper.get('.release-block').findAll('.change-item').length).toBeGreaterThan(8)
    expect(wrapper.get('.release-block .release-toggle').text()).toContain('menos')
  })
})