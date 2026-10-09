import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))
const api = vi.fn()
let currentPlan = 'team'
vi.mock('../composables/useApi', () => ({ api: (...args) => api(...args), useApi: () => ({ apiFetch: vi.fn() }) }))
vi.mock('../composables/usePlan', async () => {
  const { ref } = await import('vue')
  return { usePlan: () => ({ plan: ref({ plan: currentPlan, features: { advisor: currentPlan !== 'free', teamSharing: currentPlan === 'team' } }), reload: vi.fn() }) }
})

import AdvisorWebhooks from '../components/advisor/AdvisorWebhooks.vue'
import { settings } from '../composables/useSettings'

const HOOK = { id: 'w1', name: 'ops', kind: 'slack', url: 'https://hooks.slack.com/…mnop', minSeverity: 'high', lang: 'en', enabled: true, lastSentAt: null, lastError: null }

describe('AdvisorWebhooks', () => {
  beforeEach(() => {
    settings.lang = 'en'
    currentPlan = 'team'
    api.mockReset()
  })

  it('is locked on the Free plan: lists nothing to add', async () => {
    currentPlan = 'free'
    api.mockResolvedValue([])
    const wrapper = mount(AdvisorWebhooks)
    await flushPromises()
    expect(wrapper.find('[data-test="advisor-webhooks-locked"]').text()).toBe('Alert webhooks are part of the Pro and Team plans.')
    expect(wrapper.find('[data-test="advisor-webhook-form"]').exists()).toBe(false)
  })

  it('adds a webhook, shows it masked and sends a test', async () => {
    const hooks = []
    api.mockImplementation(async (method, path, body) => {
      if (method === 'GET') return hooks
      if (method === 'POST' && path === '/api/advisor/webhooks') { hooks.push({ ...HOOK, name: body.name }); return hooks[0] }
      if (path.endsWith('/test')) return { ok: true }
      return {}
    })
    const wrapper = mount(AdvisorWebhooks)
    await flushPromises()
    const form = wrapper.find('[data-test="advisor-webhook-form"]')
    await form.find('input[maxlength="80"]').setValue('ops')
    await wrapper.find('[data-test="advisor-webhook-url"]').setValue('https://hooks.slack.com/services/T0/B0/secret')
    await form.trigger('submit')
    await flushPromises()
    expect(api).toHaveBeenCalledWith('POST', '/api/advisor/webhooks', { name: 'ops', kind: 'slack', url: 'https://hooks.slack.com/services/T0/B0/secret', minSeverity: 'high', lang: 'en' })
    expect(wrapper.find('[data-test="advisor-webhook-w1"]').text()).toContain('https://hooks.slack.com/…mnop')
    expect(wrapper.find('[data-test="advisor-webhook-url"]').element.value).toBe('')

    await wrapper.find('[data-test="advisor-webhook-test-w1"]').trigger('click')
    await flushPromises()
    expect(api).toHaveBeenCalledWith('POST', '/api/advisor/webhooks/w1/test')
    expect(wrapper.find('[data-test="advisor-webhooks-message"]').text()).toBe('Test message sent.')
  })

  it('shows why a send failed', async () => {
    api.mockImplementation(async (method, path) => {
      if (method === 'GET') return [{ ...HOOK, lastError: 'Slack answered 404' }]
      if (path.endsWith('/test')) return { ok: false, error: 'Slack answered 404' }
      return {}
    })
    const wrapper = mount(AdvisorWebhooks)
    await flushPromises()
    expect(wrapper.text()).toContain('Last send failed: Slack answered 404')
    await wrapper.find('[data-test="advisor-webhook-test-w1"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-test="advisor-webhooks-message"]').text()).toBe('Last send failed: Slack answered 404')
  })
})
