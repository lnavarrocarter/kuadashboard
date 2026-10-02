import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import LogScansPanel from '../components/cloud/logs/LogScansPanel.vue'
import { settings } from '../composables/useSettings'

const HOUR = 60 * 60 * 1000
const NOW = Date.UTC(2026, 9, 2, 12)
const BASE = '/api/cloud/aws/cloudwatch/log-scans'

function scan(overrides = {}) {
  return {
    id: 1, logGroup: '/aws/lambda/orders', from: NOW - 2 * 24 * HOUR, to: NOW, cursor: NOW - 24 * HOUR,
    status: 'running', progress: 0.5, pages: 40, fetched: 900, inserted: 880, error: null,
    createdAt: NOW - HOUR, startedAt: NOW - HOUR, ...overrides,
  }
}

function stubApi(routes) {
  const calls = []
  vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
    const method = options.method || 'GET'
    calls.push({ url, method, body: options.body, headers: options.headers })
    const handler = routes[`${method} ${url.split('?')[0]}`]
    const body = typeof handler === 'function' ? handler(url, options) : handler
    return { ok: true, status: body === undefined ? 204 : 200, headers: { get: () => 'application/json' }, json: async () => body ?? {}, text: async () => '' }
  }))
  return calls
}

describe('LogScansPanel', () => {
  beforeEach(() => { settings.lang = 'en'; vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] }); vi.setSystemTime(NOW) })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

  it('estimates a scan, shows the cost and starts it', async () => {
    let list = []
    const calls = stubApi({
      [`GET ${BASE}`]: () => ({ maxDays: 5, scans: list }),
      [`GET ${BASE}/estimate`]: { group: '/aws/lambda/orders', cached: false, days: 3, limitedBy: 'retention', estimatedBytes: 300 * 1024 * 1024, freeBytes: 100 * 1024 * 1024, budgetBytes: 256 * 1024 * 1024, fits: false },
      [`POST ${BASE}`]: () => { list = [scan({ status: 'queued', progress: 0 })]; return { scan: list[0] } },
    })
    const wrapper = mount(LogScansPanel, { props: { profileId: 'local:dev', groupNames: ['/aws/lambda/orders'] } })
    await flushPromises()
    expect(wrapper.text()).toContain('No scans yet.')

    await wrapper.find('input').setValue('/aws/lambda/orders')
    await wrapper.find('select').setValue('5')
    expect(wrapper.find('[data-test="scan-start"]').attributes('disabled')).toBeDefined()
    await wrapper.find('[data-test="scan-estimate"]').trigger('click')
    await flushPromises()
    const estimate = wrapper.find('[data-test="scan-estimate-result"]').text()
    expect(estimate).toContain('300 MB')
    expect(estimate).toContain('keeps only 3 day(s)')
    expect(estimate).toContain('may not fit')
    expect(estimate).toContain('will be added to the local cache')
    expect(estimate).toContain('100 GB/month free')

    await wrapper.find('[data-test="scan-start"]').trigger('click')
    await flushPromises()
    const post = calls.find(c => c.method === 'POST' && c.url === BASE)
    expect(JSON.parse(post.body)).toEqual({ group: '/aws/lambda/orders', days: 5 })
    expect(post.headers['X-Profile-Id']).toBe('local:dev')
    expect(wrapper.emitted('changed')).toHaveLength(1)
    expect(wrapper.find('[data-test="scan-1"]').text()).toContain('queued')
    wrapper.unmount()
  })

  it('shows progress with ETA, polls while scans run and announces the end', async () => {
    let current = scan()
    const calls = stubApi({ [`GET ${BASE}`]: () => ({ maxDays: 5, scans: [current] }) })
    const wrapper = mount(LogScansPanel, { props: { profileId: 'local:dev', pollMs: 1000 } })
    await flushPromises()
    const row = wrapper.find('[data-test="scan-1"]')
    expect(row.text()).toContain('50%')
    expect(row.text()).toContain('~1 h left')
    expect(row.text()).toContain('scanning')
    expect(wrapper.emitted('active').at(-1)).toEqual([1])

    current = scan({ status: 'done', progress: 1, cursor: NOW - 2 * 24 * HOUR })
    await vi.advanceTimersByTimeAsync(1000)
    await flushPromises()
    expect(wrapper.find('[data-test="scan-1"]').text()).toContain('done')
    expect(wrapper.emitted('changed')).toHaveLength(1)
    expect(wrapper.emitted('active').at(-1)).toEqual([0])

    const polls = calls.filter(c => c.url === BASE).length
    await vi.advanceTimersByTimeAsync(5000)
    expect(calls.filter(c => c.url === BASE)).toHaveLength(polls)
    wrapper.unmount()
  })

  it('offers the actions that fit each status and opens a scan in the cache', async () => {
    const scans = [
      scan({ id: 1, status: 'running' }),
      scan({ id: 2, status: 'paused', error: 'Credentials expired: token' }),
      scan({ id: 3, status: 'done', progress: 1 }),
      scan({ id: 4, status: 'budget', inserted: 0, error: 'The local cache reached its size budget' }),
    ]
    const calls = stubApi({ [`GET ${BASE}`]: { maxDays: 5, scans }, [`POST ${BASE}/2/resume`]: scans[1], [`DELETE ${BASE}/3`]: undefined })
    const wrapper = mount(LogScansPanel, { props: { profileId: 'local:dev' } })
    await flushPromises()
    const labels = id => wrapper.find(`[data-test="scan-${id}"]`).findAll('button').map(b => b.text())
    expect(labels(1)).toEqual(['Pause', 'View in cache', 'Cancel'])
    expect(labels(2)).toEqual(['Resume', 'View in cache', 'Cancel', 'Remove'])
    expect(labels(3)).toEqual(['View in cache', 'Remove'])
    expect(labels(4)).toEqual(['Resume', 'Cancel', 'Remove'])
    expect(wrapper.find('[data-test="scan-2"]').text()).toContain('Credentials expired')

    await wrapper.find('[data-test="scan-2"]').findAll('button')[0].trigger('click')
    await flushPromises()
    expect(calls.some(c => c.method === 'POST' && c.url === `${BASE}/2/resume`)).toBe(true)

    await wrapper.find('[data-test="scan-3"]').findAll('button')[0].trigger('click')
    expect(wrapper.emitted('open')[0][0]).toMatchObject({ id: 3, logGroup: '/aws/lambda/orders' })

    await wrapper.find('[data-test="scan-3"]').findAll('button')[1].trigger('click')
    await flushPromises()
    expect(calls.some(c => c.method === 'DELETE' && c.url === `${BASE}/3`)).toBe(true)
    wrapper.unmount()
  })

  it('prefills the group from a cached group row', async () => {
    stubApi({ [`GET ${BASE}`]: { maxDays: 5, scans: [] } })
    const wrapper = mount(LogScansPanel, { props: { profileId: 'local:dev', prefill: { group: '/var/log/messages', at: 1 } } })
    await flushPromises()
    expect(wrapper.find('input').element.value).toBe('/var/log/messages')
    wrapper.unmount()
  })
})
