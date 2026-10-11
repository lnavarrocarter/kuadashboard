import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))

import ReadOnlyToggle from '../components/ReadOnlyToggle.vue'
import ConfirmModal from '../components/ConfirmModal.vue'
import { readOnlyState } from '../composables/useReadOnly'
import { api } from '../composables/useApi'
import { settings } from '../composables/useSettings'

function serve(state) {
  const calls = []
  global.fetch = vi.fn(async (url, options = {}) => {
    calls.push({ url, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null })
    if (url === '/api/system/read-only') {
      if (options.method === 'PUT') state = { ...state, enabled: JSON.parse(options.body).enabled }
      return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => state }
    }
    return { ok: false, status: 403, headers: { get: () => 'application/json' }, json: async () => ({ error: 'Read-only mode is on', code: 'READ_ONLY', area: 'aws' }) }
  })
  return calls
}

describe('read-only mode in the header', () => {
  beforeEach(() => { settings.lang = 'en'; Object.assign(readOnlyState, { enabled: false, forced: false, loaded: false }) })
  afterEach(() => vi.restoreAllMocks())

  it('turns on at once and asks before turning off', async () => {
    const calls = serve({ enabled: false, forced: false })
    const wrapper = mount(ReadOnlyToggle, { global: { stubs: { Teleport: true } } })
    await flushPromises()
    const toggle = wrapper.get('[data-test="read-only-toggle"]')
    expect(toggle.attributes('aria-pressed')).toBe('false')

    await toggle.trigger('click')
    await flushPromises()
    expect(calls.at(-1)).toMatchObject({ method: 'PUT', body: { enabled: true } })
    expect(toggle.text()).toBe('Read-only')

    await toggle.trigger('click')
    expect(calls.at(-1).method).toBe('PUT')       // nothing sent yet
    expect(calls.filter(call => call.method === 'PUT')).toHaveLength(1)
    wrapper.getComponent(ConfirmModal).vm.$emit('confirm')
    await flushPromises()
    expect(calls.at(-1)).toMatchObject({ method: 'PUT', body: { enabled: false } })
    expect(readOnlyState.enabled).toBe(false)
  })

  it('cannot be turned off when KUA_READ_ONLY forces it', async () => {
    serve({ enabled: true, forced: true })
    const wrapper = mount(ReadOnlyToggle, { global: { stubs: { Teleport: true } } })
    await flushPromises()
    expect(wrapper.get('[data-test="read-only-toggle"]').attributes('disabled')).toBeDefined()
  })

  it('a refused change is explained in the UI language and marks the mode on', async () => {
    serve({ enabled: false, forced: false })
    settings.lang = 'es'
    await expect(api('POST', '/api/cloud/aws/ec2/i-1/stop')).rejects.toThrow('El modo solo lectura está activo: KUA no modifica recursos de AWS.')
    expect(readOnlyState.enabled).toBe(true)
  })
})
