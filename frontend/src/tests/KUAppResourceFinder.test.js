import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))

import KUAppResourceFinder from '../components/kuapps/KUAppResourceFinder.vue'
import { settings } from '../composables/useSettings'

const GLUE = { provider: 'aws', type: 'glue', key: 'arn:aws:glue:us-east-1:111111111111:job/nightly', arn: 'arn:aws:glue:us-east-1:111111111111:job/nightly', name: 'nightly', scopeId: '111111111111', location: 'us-east-1' }
const OLD_PV = { provider: 'kubernetes', type: 'kubernetes', kind: 'PersistentVolume', key: 'ctx//PersistentVolume/pv-old', name: 'pv-old', kubeContext: 'ctx' }

// Answers each request by the first route whose fragment the URL contains, and records it.
function stubApi(routes) {
  const calls = []
  vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null })
    const key = Object.keys(routes).find(fragment => String(url).includes(fragment))
    const body = typeof routes[key] === 'function' ? routes[key](String(url)) : (routes[key] ?? {})
    return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) }
  }))
  return calls
}

const BASE = {
  '/api/cloud/envs/profiles': [{ id: 'p-aws', name: 'prod', provider: 'aws' }],
  '/api/cloud/aws/local-profiles': [{ name: 'dev' }],
  '/api/cloud/gcp/gcloud-configs': [],
  '/api/architecture/kubernetes/contexts': { contexts: [{ id: 'ctx', name: 'ctx' }] },
  '/catalog/aws/types': { types: [{ type: 's3', label: 'S3 buckets' }] },
}

beforeEach(() => {
  setActivePinia(createPinia())
  settings.lang = 'en'
})

describe('KUAppResourceFinder', () => {
  it('lists recommendations with their evidence and attaches the chosen ones', async () => {
    const calls = stubApi({
      ...BASE,
      '/recommendations': { suggestions: [
        { identityKey: 'g', confidence: 0.98, resource: GLUE, evidence: [{ type: 'asl_reference', from: 'orders', statePath: 'Extract' }] },
        { identityKey: 'p', confidence: 0.5, note: 'released', resource: OLD_PV, evidence: [{ type: 'released_volume', from: 'db/data' }] },
      ], failures: [] },
      '/resources/attach': { items: [{ name: 'nightly', outcome: 'attached' }], scopesAdded: [{ provider: 'aws' }] },
    })
    const wrapper = mount(KUAppResourceFinder, { props: { applicationId: 'app-1', profileId: 'p-aws', profileProvider: 'aws' } })
    await flushPromises()
    const items = wrapper.findAll('[data-test="kuapps-find-suggestion"]')
    expect(items).toHaveLength(2)
    expect(items[0].text()).toContain('used by orders (Extract)')
    expect(items[1].text()).toContain('released')
    await items[0].find('input').setValue(true)
    await wrapper.find('[data-test="kuapps-find-attach"]').trigger('click')
    await flushPromises()
    const attach = calls.find(call => call.url.includes('/resources/attach'))
    expect(attach.body.resources).toEqual([GLUE])
    expect(wrapper.emitted('attached')).toHaveLength(1)
  })

  it('opens the search when there is nothing to suggest, and resolves a pasted ARN', async () => {
    const calls = stubApi({
      ...BASE,
      '/recommendations': { suggestions: [], failures: [] },
      '/catalog/aws?': { items: [{ type: 's3', name: 'invoices', arn: 'arn:aws:s3:::invoices', attach: { provider: 'aws', type: 's3', key: 'arn:aws:s3:::invoices', name: 'invoices' } }], total: 1, found: true, arn: 'arn:aws:s3:::invoices', nextCursor: null, failures: [] },
    })
    const wrapper = mount(KUAppResourceFinder, { props: { applicationId: 'app-1', profileId: 'p-aws', profileProvider: 'aws' } })
    await flushPromises()
    expect(wrapper.find('[data-test="kuapps-find-query"]').exists()).toBe(true)
    await wrapper.find('[data-test="kuapps-find-query"]').setValue('arn:aws:s3:::invoices')
    await wrapper.find('[data-test="kuapps-find-search"]').trigger('click')
    await flushPromises()
    const search = new URL(calls.find(call => call.url.includes('/catalog/aws?')).url, 'http://kua')
    expect([search.searchParams.get('profile'), search.searchParams.get('arn'), search.searchParams.get('search')]).toEqual(['p-aws', 'arn:aws:s3:::invoices', null])
    expect(wrapper.find('[data-test="kuapps-find-results"]').text()).toContain('invoices')
    expect(wrapper.text()).toContain('Found.')
  })

  it('dismisses a suggestion so it is not shown again', async () => {
    const calls = stubApi({
      ...BASE,
      '/recommendations/dismiss': { dismissed: true },
      '/recommendations': { suggestions: [{ identityKey: 'g', confidence: 0.98, resource: GLUE, evidence: [] }], failures: [] },
    })
    const wrapper = mount(KUAppResourceFinder, { props: { applicationId: 'app-1' } })
    await flushPromises()
    await wrapper.find('[data-test="kuapps-find-suggestion"] button').trigger('click')
    await flushPromises()
    expect(calls.find(call => call.url.includes('/recommendations/dismiss')).body).toEqual({ identityKey: 'g' })
    expect(wrapper.findAll('[data-test="kuapps-find-suggestion"]')).toHaveLength(0)
  })
})
