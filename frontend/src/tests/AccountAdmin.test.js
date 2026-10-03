import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))

const ANA = { user: { id: 'ana', email: 'ana@example.com', name: 'Ana' }, plan: 'free', source: 'default', subscription: null, grant: null }

function stub() {
  const calls = []
  vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
    const method = options.method || 'GET'
    const body = options.body ? JSON.parse(options.body) : undefined
    calls.push({ url, method, body })
    let answer = {}
    if (url.startsWith('/api/account/admin/accounts?') || url === '/api/account/admin/accounts') answer = { items: [ANA] }
    else if (method === 'PUT') answer = { ...ANA, plan: body.plan, source: 'grant', grant: { plan: body.plan, expiresAt: body.expiresAt, reason: body.reason, grantedBy: 'admin@kua.dev', active: true } }
    else if (method === 'DELETE') answer = ANA
    return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => answer }
  }))
  return calls
}

async function mountAdmin() {
  vi.resetModules()
  const { settings } = await import('../composables/useSettings')
  settings.lang = 'en'
  const AccountAdmin = (await import('../components/account/AccountAdmin.vue')).default
  return mount(AccountAdmin)
}

describe('AccountAdmin', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('finds an account by email, grants Team until a date and revokes it', async () => {
    const calls = stub()
    const wrapper = await mountAdmin()
    await wrapper.get('[data-test="admin-email"]').setValue('ana@example.com')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(calls[0].url).toBe('/api/account/admin/accounts?email=ana%40example.com')
    expect(wrapper.get('[data-test="admin-plan-ana"]').text()).toBe('Free · no plan')

    await wrapper.get('[data-test="admin-grant-open-ana"]').trigger('click')
    const form = wrapper.get('[data-test="admin-grant-form-ana"]')
    await form.get('select').setValue('team')
    await form.get('input[type="date"]').setValue('2026-12-31')
    await form.findAll('input').at(1).setValue('Beta tester')
    await form.trigger('submit')
    await flushPromises()
    expect(calls.at(-1)).toEqual({ url: '/api/account/admin/accounts/ana/grant', method: 'PUT', body: { plan: 'team', reason: 'Beta tester', expiresAt: '2026-12-31T23:59:59Z' } })
    expect(wrapper.get('[data-test="admin-plan-ana"]').text()).toBe('Team · granted')
    expect(wrapper.emitted('changed')).toHaveLength(1)

    await wrapper.get('[data-test="admin-revoke-ana"]').trigger('click')
    await flushPromises()
    expect(calls.at(-1).method).toBe('DELETE')
    expect(wrapper.get('[data-test="admin-plan-ana"]').text()).toBe('Free · no plan')
  })
})
