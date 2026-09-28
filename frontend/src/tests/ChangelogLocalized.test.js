import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import HelpModal from '../components/modals/HelpModal.vue'
import { CHANGELOG, CHANGELOG_VERSION, localized } from '../composables/useChangelog.js'
import { settings } from '../composables/useSettings.js'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))

const BaseModalStub = { props: ['show', 'size'], template: '<section v-if="show"><main><slot /></main></section>' }

describe('bilingual changelog', () => {
  beforeEach(() => setActivePinia(createPinia()))
  afterEach(() => { settings.lang = 'en' })

  it('reads { en, es } fields in the chosen language and keeps older plain strings', () => {
    expect(localized({ en: 'Hello', es: 'Hola' }, 'es')).toBe('Hola')
    expect(localized({ en: 'Hello' }, 'es')).toBe('Hello')
    expect(localized('Texto antiguo', 'en')).toBe('Texto antiguo')
    expect(CHANGELOG[0].version).toBe(CHANGELOG_VERSION)
    expect(CHANGELOG[0].items.every(item => item.text.en && item.text.es)).toBe(true)
  })

  it('the release history follows the interface language', async () => {
    settings.lang = 'en'
    const wrapper = mount(HelpModal, { props: { show: true }, global: { stubs: { BaseModal: BaseModalStub } } })
    await wrapper.findAll('.help-nav-item')[1].trigger('click')
    const first = wrapper.get('.release-block')
    expect(first.text()).toContain('September 2026')
    expect(first.text()).toContain('AWS Overview: active account')
    settings.lang = 'es'
    await wrapper.vm.$nextTick()
    expect(wrapper.get('.release-block').text()).toContain('Resumen de AWS: cuenta activa')
  })
})
