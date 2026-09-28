import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))

import AwsAccessRequestModal from '../components/cloud/AwsAccessRequestModal.vue'
import AwsOverview from '../components/cloud/AwsOverview.vue'
import { useAwsStore } from '../stores/useAwsStore'
import { api, useApi } from '../composables/useApi'
import { settings } from '../composables/useSettings'
import { translate } from '../composables/useI18n'

const ACCESS = {
  failedAction: 'lambda:GetFunction',
  actions: ['lambda:GetFunction', 'lambda:GetPolicy'],
  resource: 'arn:aws:lambda:us-east-1:123456789012:function:api',
  principal: 'arn:aws:iam::123456789012:user/dev',
  account: '123456789012',
  source: 'error',
  policy: {
    Version: '2012-10-17',
    Statement: [
      { Sid: 'KuaFailedAction', Effect: 'Allow', Action: ['lambda:GetFunction'], Resource: 'arn:aws:lambda:us-east-1:123456789012:function:api' },
      { Sid: 'KuaScreenActions', Effect: 'Allow', Action: ['lambda:GetPolicy'], Resource: '*' },
    ],
  },
}

function mountModal(props = {}) {
  return mount(AwsAccessRequestModal, {
    props: { show: true, access: ACCESS, message: 'denied', ...props },
    global: { stubs: { teleport: true } },
  })
}

describe('AwsAccessRequestModal', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    settings.lang = 'en'
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue() } })
  })

  it('names the denied action and lists every action the screen needs', () => {
    const wrapper = mountModal()
    expect(wrapper.find('.aar-lead').text()).toContain('lambda:GetFunction')
    expect(wrapper.findAll('.aar-action').map(a => a.text())).toEqual(['lambda:GetFunction· failed', 'lambda:GetPolicy'])
  })

  it('builds a message for the administrator with the principal, account, resource and policy', () => {
    const text = mountModal().find('.aar-text').element.value
    expect(text).toContain('arn:aws:iam::123456789012:user/dev (account 123456789012)')
    expect(text).toContain('- lambda:GetFunction (the denied call)')
    expect(text).toContain('- lambda:GetPolicy')
    expect(text).toContain('Resource: arn:aws:lambda:us-east-1:123456789012:function:api')
    expect(text).toContain('"Sid": "KuaScreenActions"')
  })

  it('writes the message in the chosen language, independent of the UI language', async () => {
    const wrapper = mountModal()
    await wrapper.findAll('.aar-lang button').find(b => b.text() === 'ES').trigger('click')
    const text = wrapper.find('.aar-text').element.value
    expect(text).toContain('Hola,')
    expect(text).toContain('(la llamada rechazada)')
    expect(wrapper.find('.aar-lead').text()).toContain('This profile is not allowed')
  })

  it('falls back to the known identity when AWS did not name the principal', () => {
    const wrapper = mountModal({ access: { ...ACCESS, principal: null, account: null }, identity: { arn: 'arn:aws:sts::1:assumed-role/Dev/me', account: '1' } })
    expect(wrapper.find('.aar-text').element.value).toContain('arn:aws:sts::1:assumed-role/Dev/me (account 1)')
  })

  it('copies the message and the policy', async () => {
    const wrapper = mountModal()
    const buttons = wrapper.findAll('.aar-block-head .btn')
    await buttons[0].trigger('click')
    await buttons[1].trigger('click')
    expect(navigator.clipboard.writeText).toHaveBeenNthCalledWith(1, wrapper.find('.aar-text').element.value)
    expect(JSON.parse(navigator.clipboard.writeText.mock.calls[1][0])).toEqual(ACCESS.policy)
  })

  it('shows the raw AWS answer when no action is known', () => {
    const wrapper = mountModal({ access: { ...ACCESS, actions: [], failedAction: null, policy: null, source: 'unknown' }, message: 'Access Denied' })
    expect(wrapper.find('.aar-policy').exists()).toBe(false)
    expect(wrapper.find('.aar-unknown').text()).toContain('Access Denied')
  })
})

describe('structured API errors', () => {
  it('keeps status and JSON body on thrown errors', async () => {
    const body = { error: 'not authorized', code: 'AccessDenied', access: ACCESS }
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 403, headers: { get: () => 'application/json' }, json: async () => body })
    const err = await api('GET', '/x').catch(e => e)
    expect(err.message).toBe('not authorized')
    expect(err.status).toBe(403)
    expect(err.details).toEqual(body)
    const err2 = await useApi().apiFetch('/y').catch(e => e)
    expect(err2.details.access.failedAction).toBe('lambda:GetFunction')
  })

  it('the AWS store keeps the access request until the error clears', async () => {
    setActivePinia(createPinia())
    const store = useAwsStore()
    store.activeProfileId = 'local:dev'
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 403, headers: { get: () => 'application/json' }, json: async () => ({ error: 'denied', access: ACCESS }) })
    await store.fetchLambdas()
    expect(store.error).toBe('denied')
    expect(store.accessRequest).toEqual(ACCESS)

    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, headers: { get: () => 'application/json' }, json: async () => [] })
    await store.fetchLambdas()
    await flushPromises()
    expect(store.error).toBeNull()
    expect(store.accessRequest).toBeNull()
  })
})

describe('overview denied cards', () => {
  it('open the access request for that service', async () => {
    setActivePinia(createPinia())
    settings.lang = 'en'
    const store = useAwsStore()
    store.overview = {
      generatedAt: new Date().toISOString(),
      identity: { account: '123456789012', arn: 'arn:aws:iam::123456789012:user/dev', type: 'user', name: 'dev' },
      region: 'us-east-1',
      regions: { available: true, items: ['us-east-1'] },
      summary: { active: 0, empty: 0, unavailable: 1, total: 1 },
      services: [{ id: 'eks', tab: 'eks', label: 'EKS', scope: 'regional', status: 'unavailable', count: null, error: { kind: 'denied', action: 'eks:ListClusters', message: 'denied' }, access: { ...ACCESS, failedAction: 'eks:ListClusters', actions: ['eks:ListClusters'] } }],
    }
    const wrapper = mount(AwsOverview, { global: { stubs: { teleport: true } } })
    await wrapper.find('.aov-request').trigger('click')
    expect(wrapper.emitted('open-tab')).toBeUndefined()
    const modal = wrapper.findAllComponents(AwsAccessRequestModal).find(m => m.props('show'))
    expect(modal.props('show')).toBe(true)
    expect(modal.props('access').failedAction).toBe('eks:ListClusters')
  })
})

describe('translate()', () => {
  it('translates into a given language', () => {
    expect(translate('es', 'awsAccess.textGreeting')).toBe('Hola,')
    expect(translate('en', 'awsAccess.textResource', { resource: 'x' })).toBe('Resource: x')
    expect(translate('fr', 'awsAccess.textGreeting')).toBe('Hello,')
  })
})
