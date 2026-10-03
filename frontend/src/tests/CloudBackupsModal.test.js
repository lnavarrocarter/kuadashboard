import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))

const ITEM = { id: 'b1', name: 'Orders 2026-10-03 10:00', applicationName: 'Orders', provider: 'aws', region: 'us-east-1', sizeBytes: 2048, createdAt: '2026-10-03T10:00:00Z' }

function stub(list) {
  const calls = []
  vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
    const method = options.method || 'GET'
    calls.push({ url, method, headers: options.headers || {} })
    let status = 200
    let body = {}
    if (url === '/api/account/backups') ({ status, body } = typeof list === 'function' ? list() : { status: 200, body: list })
    else if (url.endsWith('/cloud-backup')) { status = 201; body = { id: 'b2', name: 'Orders now' } }
    else if (method === 'DELETE') status = 204
    return {
      ok: status < 400, status,
      headers: { get: name => (name.toLowerCase() === 'content-type' && status !== 204 ? 'application/json' : '') },
      json: async () => body, text: async () => JSON.stringify(body),
    }
  }))
  return calls
}

async function mountModal(props = {}) {
  vi.resetModules()
  const { settings } = await import('../composables/useSettings')
  settings.lang = 'en'
  const CloudBackupsModal = (await import('../components/architecture/CloudBackupsModal.vue')).default
  // KUApps sets the profile of the store before the modal can open.
  ;(await import('../stores/useArchitectureStore')).useArchitectureStore().setActiveProfile('local:p')
  const wrapper = mount(CloudBackupsModal, { props: { show: true, profileId: 'local:p', applicationId: 'app-1', applicationName: 'Orders', ...props }, global: { stubs: { teleport: true } } })
  await flushPromises()
  return wrapper
}

describe('CloudBackupsModal', () => {
  beforeEach(() => setActivePinia(createPinia()))
  afterEach(() => vi.unstubAllGlobals())

  it('asks to sign in when there is no KUA account session', async () => {
    stub(() => ({ status: 401, body: { error: 'Sign in to your KUA account first.', code: 'SIGNED_OUT' } }))
    const wrapper = await mountModal()
    expect(wrapper.get('[data-test="cloud-backups-locked"]').text()).toContain('Sign in to your KUA account')
  })

  it('explains that the Free plan has no cloud backups', async () => {
    stub({ enabled: false, plan: 'free', usage: { count: 0, bytes: 0 }, limits: { count: 0, bytes: 0 }, items: [] })
    const wrapper = await mountModal()
    expect(wrapper.get('[data-test="cloud-backups-locked"]').text()).toContain('Pro and Team plans')
  })

  it('backs up the open application, lists the backups and deletes after confirming', async () => {
    const calls = stub({ enabled: true, plan: 'pro', usage: { count: 1, bytes: 2048 }, limits: { count: 100, bytes: 500 * 1048576 }, items: [ITEM] })
    const wrapper = await mountModal()
    expect(wrapper.get('[data-test="cloud-backups-usage"]').text()).toContain('1 of 100 backups')
    expect(wrapper.get('[data-test="cloud-backups-list"]').text()).toContain('Orders · aws · us-east-1')

    await wrapper.get('[data-test="cloud-backup-now"]').trigger('click')
    await flushPromises()
    const upload = calls.find(c => c.url === '/api/kua-apps/app-1/cloud-backup')
    expect(upload.method).toBe('POST')
    expect(upload.headers['X-Profile-Id']).toBe('local:p')

    await wrapper.get('[data-test="cloud-backup-delete-b1"]').trigger('click')
    expect(calls.some(c => c.method === 'DELETE')).toBe(false)
    await wrapper.get('[data-test="cloud-backup-confirm-b1"]').trigger('click')
    await flushPromises()
    expect(calls.some(c => c.method === 'DELETE' && c.url === '/api/account/backups/b1')).toBe(true)
  })

  it('after a downgrade the existing backups stay restorable but no new one is offered', async () => {
    stub({ enabled: false, plan: 'free', usage: { count: 1, bytes: 2048 }, limits: { count: 0, bytes: 0 }, items: [ITEM] })
    const wrapper = await mountModal()
    expect(wrapper.find('[data-test="cloud-backup-now"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="cloud-backup-restore-b1"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('no longer includes cloud backups')
  })

  it('says when a backup was changed after it was signed', async () => {
    stub({ enabled: true, plan: 'pro', usage: { count: 1, bytes: 2048 }, limits: { count: 100, bytes: 500 * 1048576 }, items: [ITEM] })
    const wrapper = await mountModal()
    const original = globalThis.fetch
    vi.stubGlobal('fetch', vi.fn(async (url, options) => url.includes('/restore')
      ? { ok: false, status: 400, headers: { get: () => 'application/json' }, json: async () => ({ error: 'The backup signature is not valid', code: 'BACKUP_TAMPERED' }) }
      : original(url, options)))
    await wrapper.get('[data-test="cloud-backup-restore-b1"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-test="cloud-backups-error"]').text()).toContain('changed after it was signed')
  })

  it('shows a sync conflict to resolve and the applications of the other computers', async () => {
    const calls = []
    const SYNC = {
      enabled: true,
      applications: [{ applicationId: 'app-1', syncId: 's1', version: 1, changedHere: true, conflict: { remote: { version: 2, signedBy: { device: 'ANA-PC' } } } }],
      available: [{ syncId: 's2', name: 'Billing', version: 4, signedBy: { device: 'ANA-PC' }, updatedAt: '2026-10-03T10:00:00Z' }],
    }
    vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
      calls.push({ url, method: options.method || 'GET', body: options.body })
      let body = {}
      if (url === '/api/account/backups') body = { enabled: true, plan: 'pro', usage: { count: 0, bytes: 0 }, limits: { count: 100, bytes: 1 }, items: [] }
      else if (url === '/api/kua-apps/sync/status' || url.endsWith('/sync/resolve')) body = SYNC
      return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => body }
    }))
    const wrapper = await mountModal()
    expect(wrapper.get('[data-test="cloud-sync-conflict"]').text()).toContain('Another computer (ANA-PC) saved version 2')
    expect(wrapper.get('[data-test="cloud-sync-available"]').text()).toContain('Billing')
    await wrapper.get('[data-test="cloud-sync-mine"]').trigger('click')
    await flushPromises()
    const resolve = calls.find(c => c.url === '/api/kua-apps/app-1/sync/resolve')
    expect(resolve.method).toBe('POST')
    expect(JSON.parse(resolve.body)).toEqual({ choice: 'mine' })
  })
})
