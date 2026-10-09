import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))

import KUAppMissingResources from '../components/kuapps/KUAppMissingResources.vue'
import { settings } from '../composables/useSettings'

const GONE = {
  resourceId: 'r-old', registryId: 'kua-resource:old', name: 'attencion-3.9.1', type: 'kubernetes', kind: 'Deployment', namespace: 'backend360',
  goneSince: '2026-10-08T08:20:00.000Z',
  successors: [{ kind: 'Deployment', name: 'attencion-3.9.2', namespace: 'backend360', confidence: 'high', evidence: [{ type: 'same_label', label: 'app', value: 'attencion' }, { type: 'same_name_stem', stem: 'attencion' }] }],
}

function respond(handler) {
  global.fetch = vi.fn((url, options = {}) => {
    const { status = 200, body } = handler(String(url), options)
    return Promise.resolve({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: () => Promise.resolve(body), text: () => Promise.resolve('') })
  })
}

describe('KUApp missing resources', () => {
  beforeEach(() => { settings.lang = 'en' })

  it('lists what no longer exists with its likely successor, and replaces only when asked (#236)', async () => {
    let items = [GONE, { ...GONE, resourceId: 'r-sms', registryId: 'kua-resource:sms', name: 'sms-3.9.1', successors: [], error: 'The session of the cluster expired' }]
    respond((url, options) => {
      if (url.endsWith('/observer') && (options.method || 'GET') === 'GET') return { body: { resources: items } }
      if (url.endsWith('/observer/replace')) { items = items.filter(item => item.resourceId !== 'r-old'); return { body: { replaced: 'attencion-3.9.1', by: 'attencion-3.9.2' } } }
      return { body: {} }
    })
    const wrapper = mount(KUAppMissingResources, { props: { applicationId: 'app-1', revision: 7 } })
    await flushPromises()

    const old = wrapper.get('[data-test="missing-attencion-3.9.1"]').text()
    expect(old).toContain('Deployment · backend360 · missing since')
    expect(old).toContain('attencion-3.9.2')
    expect(old).toContain('Likely')
    expect(old).toContain('same app=attencion · same name without version (attencion)')
    expect(wrapper.get('[data-test="missing-sms-3.9.1"]').text()).toContain('The cluster could not be read to look for a successor')
    expect(global.fetch.mock.calls.some(([, request]) => request?.method === 'POST')).toBe(false)

    await wrapper.get('[data-test="missing-replace-attencion-3.9.1-attencion-3.9.2"]').trigger('click')
    await flushPromises()
    const [, request] = global.fetch.mock.calls.find(([url]) => String(url).endsWith('/observer/replace'))
    expect(JSON.parse(request.body)).toEqual({ resourceId: 'r-old', successor: 'attencion-3.9.2', expectedRevision: 7 })
    expect(wrapper.emitted('changed')).toHaveLength(1)
    expect(wrapper.find('[data-test="missing-attencion-3.9.1"]').exists()).toBe(false)
  })

  it('shows nothing when every resource still exists', async () => {
    respond(() => ({ body: { resources: [] } }))
    const wrapper = mount(KUAppMissingResources, { props: { applicationId: 'app-1' } })
    await flushPromises()
    expect(wrapper.find('[data-test="missing-resources"]').exists()).toBe(false)
  })
})
