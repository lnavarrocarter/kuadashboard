import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))

import KUAppScopes from '../components/kuapps/KUAppScopes.vue'

const scope = { key: 'kua-scope:aws', provider: 'aws', scopeId: '111111111111', location: 'us-east-1', label: 'Orders account' }

function view(overrides = {}) {
  return {
    id: 'app-1', name: 'Orders', revision: 3, scopes: [scope],
    warnings: [{ kind: 'scope_unbound', scopeKey: scope.key }],
    local: { bindings: [], legacy: null },
    ...overrides,
  }
}

function respond(handler) {
  global.fetch = vi.fn((url, options = {}) => {
    const { status = 200, body } = handler(url, options)
    return Promise.resolve({
      ok: status < 400,
      status,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve(body),
    })
  })
}

describe('KUApp scopes', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('warns about unbound scopes and offers this computer profiles for the provider', async () => {
    respond(url => {
      if (url.startsWith('/api/kua-apps/')) return { body: view() }
      if (url === '/api/cloud/envs/profiles') return { body: [{ id: 'stored-1', name: 'Team SSO', provider: 'aws' }, { id: 'gcp-1', name: 'Data', provider: 'gcp' }] }
      if (url === '/api/cloud/aws/local-profiles') return { body: [{ name: 'prod' }] }
      return { body: [] }
    })
    const wrapper = mount(KUAppScopes, { props: { applicationId: 'app-1' } })
    await flushPromises()

    expect(wrapper.find('.kuapp-scopes-warning').text()).toContain('1 scope(s)')
    expect(wrapper.find('.kuapp-scope-status').text()).toBe('No profile')
    const options = wrapper.findAll('.kuapp-scope-binding option').map(option => option.text())
    expect(options).toContain('prod (~/.aws)')
    expect(options).not.toContain('Data')
    wrapper.unmount()
  })

  it('binds the chosen profile and shows the verification result', async () => {
    respond((url, options) => {
      if (options.method === 'PUT') {
        expect(JSON.parse(options.body)).toEqual({ profileId: 'local:prod' })
        return { body: { status: 'mismatch', application: view({ warnings: [{ kind: 'scope_mismatch', scopeKey: scope.key }], local: { bindings: [{ scopeKey: scope.key, profileId: 'local:prod', status: 'mismatch', lastError: 'The profile reaches 222222222222, not 111111111111' }], legacy: null } }) } }
      }
      if (url.startsWith('/api/kua-apps/')) return { body: view() }
      if (url === '/api/cloud/aws/local-profiles') return { body: [{ name: 'prod' }] }
      return { body: [] }
    })
    const wrapper = mount(KUAppScopes, { props: { applicationId: 'app-1' } })
    await flushPromises()

    await wrapper.find('.kuapp-scope-binding select').setValue('local:prod')
    await wrapper.findAll('.kuapp-scope-binding button')[0].trigger('click')
    await flushPromises()

    const status = wrapper.find('.kuapp-scope-status')
    expect(status.text()).toBe('Does not match')
    expect(status.attributes('title')).toContain('222222222222')
    expect(wrapper.emitted('changed')).toHaveLength(1)
    wrapper.unmount()
  })

  it('sends the revision it read and reloads on a conflict', async () => {
    let reads = 0
    respond((url, options) => {
      if (options.method === 'POST') {
        expect(JSON.parse(options.body)).toMatchObject({ provider: 'kubernetes', scopeId: 'eks-prod', location: '', expectedRevision: 3 })
        return { status: 409, body: { error: 'The application changed since it was read', code: 'REVISION_CONFLICT', revision: 4 } }
      }
      if (url.startsWith('/api/kua-apps/')) { reads += 1; return { body: view({ revision: 3 + reads - 1 }) } }
      return { body: [] }
    })
    const wrapper = mount(KUAppScopes, { props: { applicationId: 'app-1' } })
    await flushPromises()

    await wrapper.find('.kuapp-scopes-heading button').trigger('click')
    await wrapper.find('.kuapp-scope-form select').setValue('kubernetes')
    await wrapper.findAll('.kuapp-scope-form input')[0].setValue('eks-prod')
    await wrapper.find('.kuapp-scope-form').trigger('submit')
    await flushPromises()

    expect(wrapper.find('.kuapp-scopes-error').text()).toContain('changed in the meantime')
    expect(reads).toBe(2)
    wrapper.unmount()
  })
})
