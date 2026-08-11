import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import ProfileModal from '../components/modals/ProfileModal.vue'
import { settings } from '../composables/useSettings'

beforeEach(() => {
  settings.lang = 'en'
  document.body.innerHTML = ''
})

describe('Vercel credential profile', () => {
  it('requires and emits the API token when creating a profile', async () => {
    const wrapper = mount(ProfileModal, {
      attachTo: document.body,
      props: { show: true, defaultProvider: 'vercel' },
    })

    const nameInput = document.body.querySelector('input')
    nameInput.value = 'production-vercel'
    nameInput.dispatchEvent(new Event('input'))
    await wrapper.vm.$nextTick()

    const saveButton = [...document.body.querySelectorAll('button')]
      .find(button => button.textContent.includes('Save profile'))
    expect(saveButton.disabled).toBe(true)

    const tokenInput = document.body.querySelector('input[type="password"]')
    tokenInput.value = 'vercel-token'
    tokenInput.dispatchEvent(new Event('input'))
    await wrapper.vm.$nextTick()
    expect(saveButton.disabled).toBe(false)

    saveButton.click()
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('save')[0][0]).toMatchObject({
      name: 'production-vercel',
      provider: 'vercel',
      keys: { VERCEL_API_TOKEN: 'vercel-token' },
    })

    wrapper.unmount()
  })
})