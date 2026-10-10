import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))
const openExternal = vi.fn()
vi.mock('../lib/openExternal', () => ({ openExternal: (...args) => openExternal(...args) }))

import PlanChangeNotice from '../components/PlanChangeNotice.vue'
import { usePlan } from '../composables/usePlan'
import { settings } from '../composables/useSettings'

function servePlan(value) {
  global.fetch = vi.fn(async () => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => value }))
  return usePlan().reload()
}

const TRANSITION = { effectiveAt: '2026-11-10T00:00:00.000Z', features: ['agents', 'scheduledTasks'], limits: { kuaApps: 3 } }

describe('plan change notice', () => {
  beforeEach(() => { settings.lang = 'en'; localStorage.clear(); openExternal.mockReset() })

  it('tells a Free user what changes and when, links the terms and stays dismissed', async () => {
    await servePlan({ plan: 'free', features: { agents: true }, limits: { kuaApps: null }, transition: TRANSITION })
    const wrapper = mount(PlanChangeNotice)
    await flushPromises()
    const notice = wrapper.get('[data-test="plan-change-notice"]')
    expect(notice.text()).toContain('From November 10, 2026 the Free plan includes up to 3 KUA Applications')
    await wrapper.get('[data-test="plan-change-terms"]').trigger('click')
    expect(openExternal).toHaveBeenCalledWith('https://kuadashboard.navarrocarter.com/terms.html')
    await wrapper.get('[data-test="plan-change-dismiss"]').trigger('click')
    expect(wrapper.find('[data-test="plan-change-notice"]').exists()).toBe(false)
    expect(mount(PlanChangeNotice).find('[data-test="plan-change-notice"]').exists()).toBe(false)
  })

  it('says nothing to Pro or after the date', async () => {
    await servePlan({ plan: 'pro', features: { agents: true }, limits: { kuaApps: null } })
    expect(mount(PlanChangeNotice).find('[data-test="plan-change-notice"]').exists()).toBe(false)
  })
})
