import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))
const api = vi.fn()
vi.mock('../composables/useApi', () => ({ api: (...args) => api(...args), useApi: () => ({ apiFetch: vi.fn() }) }))

import { parseScope, scopeLabel, alertTitle } from '../lib/advisorAlerts'
import { useAdvisorAlerts } from '../composables/useAdvisorAlerts'
import { useI18n } from '../composables/useI18n'
import { settings } from '../composables/useSettings'
import AlertsBell from '../components/advisor/AlertsBell.vue'

const { t } = useI18n()
const EKS = 'arn:aws:eks:us-east-1:111:cluster/shop'
const alert = (id, overrides = {}) => ({ id, scope: `kubernetes:${EKS}:default`, type: 'new_finding', ruleId: 'k8s.privileged', severity: 'high', data: { count: 2, params: {} }, createdAt: new Date().toISOString(), read: false, ...overrides })

describe('advisor alert texts', () => {
  beforeEach(() => { settings.lang = 'en' })

  it('splits scopes whose ids contain colons and names them', () => {
    expect(parseScope(`kubernetes:${EKS}:default`)).toEqual({ provider: 'kubernetes', context: EKS, namespace: 'default' })
    expect(parseScope('aws:local:prod:us-east-1')).toEqual({ provider: 'aws', profileId: 'local:prod', region: 'us-east-1' })
    expect(scopeLabel(alert(1), { t })).toBe('Kubernetes · shop · default')
    expect(scopeLabel({ scope: 'aws:local:prod:us-east-1' }, { t })).toBe('AWS · prod · us-east-1')
    expect(scopeLabel({ scope: 'aws:p-1:eu-west-1' }, { t, profileName: () => 'billing' })).toBe('AWS · billing · eu-west-1')
    expect(scopeLabel({ scope: 'product:app-1', data: { scopeLabel: 'Orders' } }, { t })).toBe('KUApps · Orders')
    expect(parseScope('vercel:p-2:team_abc')).toEqual({ provider: 'vercel', profileId: 'p-2', teamId: 'team_abc' })
    expect(scopeLabel({ scope: 'vercel:p-2:personal' }, { t, profileName: () => 'web' })).toBe('Vercel · web · personal')
    expect(scopeLabel({ scope: `kubernetes:${EKS}:all` }, { t })).toBe('Kubernetes · shop · all namespaces')
  })

  it('says what happened to which rule', () => {
    expect(alertTitle(alert(1), { t })).toMatch(/^New finding: /)
    expect(alertTitle(alert(2, { type: 'fixed', severity: 'info' }), { t })).toMatch(/^Fixed: /)
    expect(alertTitle(alert(3, { type: 'acceptance_expiring', data: { expiresAt: '2026-12-01T12:00:00Z', count: 1 } }), { t })).toMatch(/^Acceptance expires on Dec 1, 2026: /)
  })
})

describe('posture alerts: bell and system notifications', () => {
  const { state, start, stop } = useAdvisorAlerts()
  let notifications

  beforeEach(() => {
    settings.lang = 'en'
    settings.advisorNotifications = true
    api.mockReset()
    localStorage.clear()
    notifications = []
    globalThis.Notification = class { constructor(title, options) { notifications.push({ title, ...options }) } }
    globalThis.Notification.permission = 'granted'
  })
  afterEach(() => { stop(); state.alerts = []; state.unread = 0; delete globalThis.Notification })

  it('does not notify old alerts on the first run, then notifies new high ones once', async () => {
    api.mockResolvedValueOnce({ unread: 1, alerts: [alert(5)] })
    await start({ t })
    expect(notifications).toEqual([])
    expect(state.unread).toBe(1)

    api.mockResolvedValueOnce({ unread: 3, alerts: [alert(7), alert(6, { type: 'fixed', severity: 'info' }), alert(5)] })
    await useAdvisorAlerts().refresh()
    expect(notifications.map(n => n.title)).toEqual([alertTitle(alert(7), { t })])
    expect(notifications[0].body).toBe('Kubernetes · shop · default')

    api.mockResolvedValueOnce({ unread: 3, alerts: [alert(7), alert(6), alert(5)] })
    await useAdvisorAlerts().refresh()
    expect(notifications).toHaveLength(1)
  })

  it('stays quiet when notifications are off, and stops on Free (403)', async () => {
    localStorage.setItem('kua.advisorAlerts.notified', '4')
    settings.advisorNotifications = false
    api.mockResolvedValueOnce({ unread: 1, alerts: [alert(5)] })
    await start({ t })
    expect(notifications).toEqual([])

    api.mockRejectedValueOnce(Object.assign(new Error('plan'), { status: 403 }))
    await useAdvisorAlerts().refresh()
    expect(state.enabled).toBe(false)
  })

  it('the bell shows the unread count, opens an alert and marks everything read', async () => {
    const onOpen = vi.fn()
    api.mockImplementation(async (method, path, body) => {
      if (method === 'GET') return { unread: 2, alerts: [alert(9), alert(8, { type: 'fixed', severity: 'info' })] }
      return { changed: 1, unread: body.all ? 0 : 1 }
    })
    await start({ t, onOpen })
    const wrapper = mount(AlertsBell, { attachTo: document.body })
    await flushPromises()
    expect(wrapper.find('[data-test="alerts-bell-unread"]').text()).toBe('2')

    await wrapper.find('[data-test="alerts-bell-button"]').trigger('click')
    expect(wrapper.text()).toContain('Kubernetes · shop · default')
    await wrapper.find('[data-test="alert-9"]').trigger('click')
    await flushPromises()
    expect(api).toHaveBeenCalledWith('POST', '/api/advisor/alerts/read', { ids: [9] })
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 9 }))
    expect(state.unread).toBe(1)

    await wrapper.find('[data-test="alerts-bell-button"]').trigger('click')
    await wrapper.find('[data-test="alerts-read-all"]').trigger('click')
    await flushPromises()
    expect(api).toHaveBeenCalledWith('POST', '/api/advisor/alerts/read', { all: true })
    expect(wrapper.find('[data-test="alerts-bell-unread"]').exists()).toBe(false)
    wrapper.unmount()
  })
})
