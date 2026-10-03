import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))

import LogMlSection from '../components/cloud/logs/LogMlSection.vue'
import { logsBrief } from '../shared/agentBrief.mjs'
import { translate } from '../composables/useI18n'
import { settings } from '../composables/useSettings'

const OFF = { enabled: false, state: 'disabled', downloaded: false, diskBytes: 0, downloadBytes: 136314880, progress: null, error: null }
const READY = { ...OFF, enabled: true, state: 'ready', downloaded: true, diskBytes: 135392208 }

function stubFetch(routes) {
  const calls = []
  vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
    calls.push({ url, method: options.method || 'GET', body: options.body })
    const key = Object.keys(routes).find(prefix => url.startsWith(prefix))
    const value = typeof routes[key] === 'function' ? routes[key](url, options) : routes[key]
    return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => value }
  }))
  return calls
}

describe('LogMlSection', () => {
  beforeEach(() => { settings.lang = 'en' })
  afterEach(() => vi.unstubAllGlobals())

  it('offers to enable local ML with the download size and enables it', async () => {
    let state = OFF
    const calls = stubFetch({
      '/api/system/ml/enable': () => (state = READY),
      '/api/system/ml': () => state,
    })
    const wrapper = mount(LogMlSection, { props: { group: '/g', profileId: 'p', ml: null } })
    await flushPromises()
    expect(wrapper.get('[data-test="log-ml-enable"]').text()).toContain('downloads 130 MB once')
    await wrapper.get('[data-test="log-ml-enable"]').trigger('click')
    await flushPromises()
    expect(calls.some(call => call.url === '/api/system/ml/enable' && call.method === 'POST')).toBe(true)
    expect(wrapper.find('[data-test="log-ml-query"]').exists()).toBe(true)
  })

  it('searches by meaning, filters by a result of this group and shows similar errors', async () => {
    const calls = stubFetch({
      '/api/system/ml': READY,
      '/api/cloud/aws/cloudwatch/log-intelligence/search': {
        results: [
          { logGroup: '/g', signature: 'AccessDeniedException', occurrences: 3, score: 0.53 },
          { logGroup: '/other', signature: 'Forbidden', occurrences: 1, score: 0.42 },
        ],
      },
    })
    const ml = { state: 'ready', clusters: [{ occurrences: 9, signatures: [{ signature: 'ECONNREFUSED', occurrences: 6 }, { signature: 'ETIMEDOUT db', occurrences: 3 }] }], suggestions: [] }
    const wrapper = mount(LogMlSection, { props: { group: '/g', profileId: 'p', ml } })
    await flushPromises()
    await wrapper.get('[data-test="log-ml-query"]').setValue('permisos denegados')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    const search = calls.find(call => call.url.includes('/log-intelligence/search'))
    expect(search.url).toContain('q=permisos+denegados')
    expect(search.url).not.toContain('group=')
    const results = wrapper.get('[data-test="log-ml-results"]')
    expect(results.text()).toContain('53%')
    expect(results.text()).toContain('/other')
    await results.get('button').trigger('click')
    expect(wrapper.emitted('filter')[0]).toEqual([{ signature: 'AccessDeniedException', category: '' }])
    expect(wrapper.get('[data-test="log-ml-cluster"]').text()).toContain('× 9')
  })

  it('turns local ML off and can delete the model', async () => {
    const calls = stubFetch({ '/api/system/ml/disable': OFF, '/api/system/ml': READY })
    const wrapper = mount(LogMlSection, { props: { group: '/g', profileId: 'p', ml: null } })
    await flushPromises()
    await wrapper.get('[data-test="log-ml-remove"]').trigger('click')
    await flushPromises()
    const call = calls.find(item => item.url === '/api/system/ml/disable')
    expect(JSON.parse(call.body)).toEqual({ remove: true })
    expect(wrapper.find('[data-test="log-ml-enable"]').exists()).toBe(true)
  })
})

describe('logs brief with local ML', () => {
  it('lists similar errors and marks suggested categories', () => {
    const en = (key, params) => translate('en', key, params)
    const md = logsBrief({
      signatures: [{ signature: 'payment gateway says no', occurrences: 4, category: 'other_error' }],
      ml: {
        state: 'ready',
        clusters: [{ occurrences: 9, signatures: [{ signature: 'ECONNREFUSED', occurrences: 6 }, { signature: 'ETIMEDOUT db', occurrences: 3 }] }],
        suggestions: [{ signature: 'payment gateway says no', category: 'validation', score: 0.45 }],
      },
    }, { t: en, group: 'g', now: Date.parse('2026-10-03T00:00:00Z') })
    expect(md).toContain('## Similar errors (local ML)')
    expect(md).toContain('1. × 9\n   - `ECONNREFUSED` × 6\n   - `ETIMEDOUT db` × 3')
    expect(md).toContain('- [Other errors (likely Validation / bad request)] `payment gateway says no` × 4')
  })
})
