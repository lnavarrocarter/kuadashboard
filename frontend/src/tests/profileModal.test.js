import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
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
describe('Proxmox credential profile (#195)', () => {
  const type = async (wrapper, selector, value) => {
    const input = document.body.querySelector(selector)
    input.value = value
    input.dispatchEvent(new Event('input'))
    await wrapper.vm.$nextTick()
  }

  it('needs the token and a pinned certificate, read from the server without credentials', async () => {
    const calls = []
    global.fetch = vi.fn(url => {
      calls.push(String(url))
      return Promise.resolve({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: () => Promise.resolve({ fingerprint: 'AB:CD', subject: 'pve1', issuer: 'Proxmox Virtual Environment' }), text: () => Promise.resolve('') })
    })
    const wrapper = mount(ProfileModal, { attachTo: document.body, props: { show: true, defaultProvider: 'proxmox' } })
    await type(wrapper, 'input', 'homelab')
    await type(wrapper, '[data-test="proxmox-url"]', 'https://pve.lan:8006')
    await type(wrapper, '[data-test="proxmox-token-id"]', 'kua@pve!ro')
    await type(wrapper, '[data-test="proxmox-token-secret"]', 'secret-uuid')
    const saveButton = [...document.body.querySelectorAll('button')].find(button => button.textContent.includes('Save profile'))
    expect(saveButton.disabled, 'no certificate pinned yet').toBe(true)

    document.body.querySelector('[data-test="proxmox-read-certificate"]').click()
    await flushPromises()
    expect(calls).toEqual(['/api/cloud/proxmox/fingerprint?url=https%3A%2F%2Fpve.lan%3A8006'])
    expect(document.body.querySelector('[data-test="proxmox-certificate"]').textContent).toContain('AB:CD')
    document.body.querySelector('[data-test="proxmox-pin"]').click()
    await wrapper.vm.$nextTick()
    expect(saveButton.disabled).toBe(false)

    saveButton.click()
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('save')[0][0]).toMatchObject({
      provider: 'proxmox',
      keys: { PROXMOX_URL: 'https://pve.lan:8006', PROXMOX_TOKEN_ID: 'kua@pve!ro', PROXMOX_TOKEN_SECRET: 'secret-uuid', PROXMOX_TLS_FINGERPRINT: 'AB:CD' },
    })
    expect(wrapper.emitted('save')[0][0].keys.PROXMOX_CA_PEM).toBeUndefined()
    wrapper.unmount()
  })
})
