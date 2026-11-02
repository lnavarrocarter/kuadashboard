import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

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
describe('GCP gcloud project linking', () => {
  it('adds a project by ID, selects its config and emits it as the active profile', async () => {
    const requests = []
    let configs = []
    vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
      requests.push({ url, options })
      if (url.endsWith('/gcloud-accounts')) return { json: async () => [] }
      if (url.endsWith('/gcloud-configs') && options.method === 'POST') {
        const body = JSON.parse(options.body)
        configs = [{ name: body.name, project: body.project, account: body.account || null }]
        return { ok: true, json: async () => ({ success: true }) }
      }
      if (url.endsWith('/gcloud-configs')) return { json: async () => configs }
      throw new Error(`Unexpected request: ${url}`)
    }))
    const wrapper = mount(ProfileModal, {
      attachTo: document.body,
      props: { show: true, defaultProvider: 'gcp' },
    })

    document.querySelector('[data-test="gcloud-auth-mode"]').click()
    await flushPromises()
    const setInput = async (selector, value) => {
      const input = document.querySelector(selector)
      input.value = value
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await wrapper.vm.$nextTick()
    }
    await setInput('[data-test="gcloud-config-name"]', 'analytics-prod')
    await setInput('[data-test="gcloud-project-id"]', 'analytics-prod-123')
    document.querySelector('[data-test="add-gcloud-project"]').click()
    await flushPromises()

    const createRequest = requests.find(request => request.options.method === 'POST')
    expect(JSON.parse(createRequest.options.body)).toMatchObject({ name: 'analytics-prod', project: 'analytics-prod-123' })
    expect(document.body.textContent).toContain('Project "analytics-prod-123" added as configuration "analytics-prod"')
    document.querySelector('.modal-footer .btn.primary').click()
    await flushPromises()
    expect(wrapper.emitted('save')[0][0]).toMatchObject({ gcpAuthMode: 'gcloud', profileId: 'local:analytics-prod' })

    wrapper.unmount()
    vi.unstubAllGlobals()
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
