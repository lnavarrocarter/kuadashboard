import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))

const ITEM = (id, overrides = {}) => ({
  id, name: id === 'i1' ? 'Orders' : 'Billing', applicationName: 'Orders', provider: 'aws', region: 'us-east-1', version: 2, updatedAt: '2026-10-04T10:00:00Z',
  owner: { id: 'ana', email: 'ana@example.com' }, ownerActive: true, shared: false, access: { mode: 'all', members: [] }, backup: { frequency: null }, backups: 0, ...overrides,
})
const MEMBERS = [
  { id: 'owner', email: 'owner@example.com', role: 'owner', canImport: true },
  { id: 'ana', email: 'ana@example.com', role: 'member', canImport: true },
  { id: 'bob', email: 'bob@example.com', role: 'member', canImport: true },
]

function stub(space) {
  const calls = []
  vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
    const method = options.method || 'GET'
    calls.push({ url, method, body: options.body ? JSON.parse(options.body) : undefined })
    let body = {}
    if (url === '/api/kua-apps/team') body = space
    else if (method === 'PATCH' && url.startsWith('/api/kua-apps/team/items/')) body = { ...space.items[0], ...JSON.parse(options.body) }
    else if (url.endsWith('/import')) body = { application: { id: 'local-1', name: 'Orders' } }
    else if (method === 'PATCH') body = { userId: 'bob', canImport: false }
    return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => body }
  }))
  return calls
}

async function mountModal() {
  vi.resetModules()
  const { settings } = await import('../composables/useSettings')
  settings.lang = 'en'
  const TeamSpaceModal = (await import('../components/architecture/TeamSpaceModal.vue')).default
  ;(await import('../stores/useArchitectureStore')).useArchitectureStore().setActiveProfile('local:p')
  const wrapper = mount(TeamSpaceModal, { props: { show: true, profileId: 'local:p' }, global: { stubs: { teleport: true } } })
  await flushPromises()
  return wrapper
}

describe('TeamSpaceModal', () => {
  beforeEach(() => setActivePinia(createPinia()))
  afterEach(() => vi.unstubAllGlobals())

  it('an admin sees the members\' applications and shares, schedules backups and sets who may import', async () => {
    const calls = stub({ team: { id: 't1', name: 'Jordan360' }, role: 'admin', canImport: true, items: [ITEM('i1'), ITEM('i2', { shared: true })], members: MEMBERS, imported: {} })
    const wrapper = await mountModal()
    expect(wrapper.text()).toContain('Your KUA Applications are published to the team space')
    expect(wrapper.get('[data-test="team-shared"]').text()).toContain('Billing')
    expect(wrapper.find('[data-test="team-item-i1"]').exists()).toBe(true)

    await wrapper.get('[data-test="team-share-i1"]').setValue(true)
    await flushPromises()
    expect(calls.find(c => c.method === 'PATCH' && c.url === '/api/kua-apps/team/items/i1').body).toEqual({ shared: true })

    await wrapper.get('[data-test="team-backup-i1"]').setValue('hourly')
    await flushPromises()
    expect(calls.filter(c => c.url === '/api/kua-apps/team/items/i1').at(-1).body).toEqual({ backup: { frequency: 'hourly' } })

    await wrapper.get('[data-test="team-can-import-bob"]').setValue(false)
    await flushPromises()
    expect(calls.find(c => c.url === '/api/kua-apps/team/members/bob').body).toEqual({ canImport: false })

    await wrapper.get('[data-test="team-load-i1"]').trigger('click')
    await flushPromises()
    expect(calls.some(c => c.method === 'POST' && c.url === '/api/kua-apps/team/items/i1/import')).toBe(true)
  })

  it('a member sees only what is shared with it, and imports it', async () => {
    const calls = stub({ team: { id: 't1', name: 'Jordan360' }, role: 'member', canImport: true, items: [ITEM('i2', { shared: true })], members: MEMBERS, imported: {} })
    const wrapper = await mountModal()
    expect(wrapper.find('[data-test="team-item-i2"]').exists()).toBe(false)
    await wrapper.get('[data-test="team-import-i2"]').trigger('click')
    await flushPromises()
    expect(calls.some(c => c.method === 'POST' && c.url === '/api/kua-apps/team/items/i2/import')).toBe(true)
  })
})
