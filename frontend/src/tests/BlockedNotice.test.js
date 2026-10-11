import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))

import BlockedNotice from '../components/BlockedNotice.vue'
import { api } from '../composables/useApi'
import { blockedNotice } from '../composables/useBlockedNotice'
import { readOnlyState } from '../composables/useReadOnly'
import { prepareConsoleConnection } from '../composables/consoleConnection'
import { settings } from '../composables/useSettings'

function refuse(body) {
  const calls = []
  global.fetch = vi.fn(async (url, options = {}) => {
    calls.push({ url, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null })
    if (url === '/api/system/read-only') {
      return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ enabled: false, forced: false }) }
    }
    return { ok: false, status: 403, headers: { get: () => 'application/json' }, json: async () => body }
  })
  return calls
}

describe('blocked notice: read-only mode and plan', () => {
  beforeEach(() => {
    settings.lang = 'en'
    Object.assign(blockedNotice, { open: false })
    Object.assign(readOnlyState, { enabled: false, forced: false })
  })
  afterEach(() => vi.restoreAllMocks())

  it('a change refused by read-only mode offers to turn it off', async () => {
    const calls = refuse({ error: 'Read-only mode is on', code: 'READ_ONLY', area: 'aws' })
    const wrapper = mount(BlockedNotice, { global: { stubs: { Teleport: true } } })
    await expect(api('POST', '/api/cloud/aws/ec2/i-1/stop')).rejects.toThrow()
    await flushPromises()
    const notice = wrapper.get('[data-test="blocked-notice"]')
    expect(notice.attributes('data-kind')).toBe('readOnly')
    expect(notice.text()).toContain('KUA did not send this change to AWS because read-only mode is on.')
    await wrapper.get('[data-test="blocked-disable-read-only"]').trigger('click')
    await flushPromises()
    expect(calls.at(-1)).toMatchObject({ url: '/api/system/read-only', method: 'PUT', body: { enabled: false } })
    expect(blockedNotice.open).toBe(false)
  })

  it('a refused terminal explains why, through the console session request', async () => {
    refuse({ error: 'terminals stay closed', code: 'READ_ONLY', area: 'console' })
    const wrapper = mount(BlockedNotice, { global: { stubs: { Teleport: true } } })
    await expect(prepareConsoleConnection({ provider: 'local', transport: 'shell', target: {} })).rejects.toThrow()
    await flushPromises()
    expect(wrapper.get('[data-test="blocked-notice"]').text()).toContain('terminals stay closed because KUA cannot check')
  })

  it('a feature outside the plan explains it and leads to the plans', async () => {
    refuse({ error: 'The free plan includes up to 3 KUA Applications', code: 'PLAN_REQUIRED', required: 'pro', feature: 'kuaApps', limit: 3, current: 3 })
    const wrapper = mount(BlockedNotice, { global: { stubs: { Teleport: true } } })
    const opened = vi.fn()
    window.addEventListener('kua:open-help', opened)
    await expect(api('POST', '/api/kua-apps/applications', { name: 'Fourth' })).rejects.toThrow()
    await flushPromises()
    const notice = wrapper.get('[data-test="blocked-notice"]')
    expect(notice.attributes('data-kind')).toBe('plan')
    expect(notice.text()).toContain('The Free plan includes up to 3 KUA Applications')
    expect(notice.text()).toContain('It is available in the Pro plan')
    await wrapper.get('[data-test="blocked-see-plans"]').trigger('click')
    expect(opened).toHaveBeenCalledTimes(1)
    expect(opened.mock.calls[0][0].detail).toEqual({ tab: 'account' })
    window.removeEventListener('kua:open-help', opened)
  })
})

describe('plan note in place', () => {
  it('shows on a plan without the feature and leads to the plans; hidden on Pro', async () => {
    const { usePlan } = await import('../composables/usePlan')
    const PlanNote = (await import('../components/PlanNote.vue')).default
    settings.lang = 'en'
    const answer = { value: { plan: 'free', features: { agents: false }, limits: {} } }
    global.fetch = vi.fn(async () => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => answer.value }))
    await usePlan().reload()
    const wrapper = mount(PlanNote, { props: { feature: 'agents' } })
    expect(wrapper.get('[data-test="plan-note"]').text()).toContain('Using KUA from AI agents (MCP) is part of the Pro and Team plans.')
    const opened = vi.fn()
    window.addEventListener('kua:open-help', opened)
    await wrapper.get('[data-test="plan-note-see-plans"]').trigger('click')
    expect(opened.mock.calls[0][0].detail).toEqual({ tab: 'account' })
    window.removeEventListener('kua:open-help', opened)

    answer.value = { plan: 'pro', features: { agents: true }, limits: {} }
    await usePlan().reload()
    await flushPromises()
    expect(wrapper.find('[data-test="plan-note"]').exists()).toBe(false)
  })
})
