import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import AwsLogsTab from '../components/cloud/logs/AwsLogsTab.vue'
import {
  backupSummary, cacheUsage, exportTaskPrefix, filterGroups, formatBytes, formatWindow, kindCounts, parentPrefix,
} from '../lib/awsLogs'

const HOUR = 60 * 60 * 1000
const groups = [
  { name: '/aws/lambda/orders', kind: 'aws', service: 'lambda', storedBytes: 2048, retentionInDays: 14, cache: null },
  { name: '/var/log/messages', kind: 'machine', service: 'ec2', storedBytes: 5 * 1024 * 1024, retentionInDays: null, cache: { windowMs: 168 * HOUR, bytes: 1024, events: 3 } },
  { name: 'my-app', kind: 'custom', service: null, storedBytes: 0, retentionInDays: 7, cache: null },
]

describe('awsLogs helpers', () => {
  it('formats sizes and cache windows', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB')
    expect(formatWindow(168 * HOUR)).toBe('7 d')
    expect(formatWindow(36 * HOUR)).toBe('36 h')
    expect(formatWindow(60 * HOUR)).toBe('2.5 d')
  })

  it('filters and counts log groups by kind', () => {
    expect(kindCounts(groups)).toEqual({ all: 3, aws: 1, machine: 1, custom: 1 })
    expect(filterGroups(groups, { kind: 'machine' }).map(g => g.name)).toEqual(['/var/log/messages'])
    expect(filterGroups(groups, { search: 'lambda' }).map(g => g.name)).toEqual(['/aws/lambda/orders'])
    expect(filterGroups(groups, { cachedOnly: true })).toHaveLength(1)
  })

  it('summarizes backup coverage and S3 paths', () => {
    const summary = backupSummary([
      { method: 'continuous', risk: null, storedBytes: 1 },
      { method: 'none', risk: 'expires', storedBytes: 10 },
      { method: 'export', risk: 'gap', storedBytes: 5 },
    ])
    expect(summary).toEqual({ continuous: 1, export: 1, none: 1, atRisk: 2, unprotectedBytes: 10 })
    expect(exportTaskPrefix({ bucket: 'b', prefix: 'logs/', taskId: 't1' })).toEqual({ bucket: 'b', prefix: 'logs/t1/' })
    expect(parentPrefix('a/b/c/')).toBe('a/b/')
    expect(parentPrefix('a/')).toBe('')
    expect(cacheUsage({ totalBytes: 50, budgetBytes: 200 })).toBe(25)
  })
})

describe('AwsLogsTab', () => {
  afterEach(() => vi.unstubAllGlobals())

  function stubApi(handlers) {
    const calls = []
    vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
      calls.push({ url, method: options.method || 'GET', headers: options.headers })
      const key = Object.keys(handlers).find(prefix => url.startsWith(prefix))
      const body = key ? handlers[key] : {}
      return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => (typeof body === 'function' ? body(url, options) : body) }
    }))
    return calls
  }

  it('lists log groups with their source and cache state, and caches a group', async () => {
    const calls = stubApi({
      '/api/cloud/aws/cloudwatch/log-groups': { region: 'us-east-1', truncated: false, groups: structuredClone(groups) },
      '/api/cloud/aws/cloudwatch/log-cache': (url, options) => (options.method === 'POST'
        ? { status: 'ok', inserted: 4, group: { logGroup: '/aws/lambda/orders', windowMs: 168 * HOUR, bytes: 300, events: 4 } }
        : { budgetBytes: 1000, totalBytes: 0, totalEvents: 0, maxWindowMs: 168 * HOUR, groups: [] }),
    })
    const wrapper = mount(AwsLogsTab, { props: { profileId: 'local:dev' } })
    await flushPromises()
    expect(calls[0].headers['X-Profile-Id']).toBe('local:dev')
    const rows = wrapper.findAll('tbody tr')
    expect(rows).toHaveLength(3)
    expect(wrapper.text()).toContain('/var/log/messages')
    expect(rows.find(r => r.text().includes('/var/log/messages')).text()).toContain('7 d')

    const cacheButton = rows.find(r => r.text().includes('/aws/lambda/orders')).findAll('button')[0]
    await cacheButton.trigger('click')
    await flushPromises()
    expect(calls.some(c => c.method === 'POST' && c.url.endsWith('/log-cache'))).toBe(true)
    expect(wrapper.findAll('tbody tr').find(r => r.text().includes('/aws/lambda/orders')).text()).toContain('300 B')
    wrapper.unmount()
  })

  it('shows backup coverage and opens an export in the archive browser', async () => {
    const calls = stubApi({
      '/api/cloud/aws/cloudwatch/log-groups': { groups: [] },
      '/api/cloud/aws/cloudwatch/log-cache': { budgetBytes: 1000, totalBytes: 0, totalEvents: 0, maxWindowMs: 168 * HOUR, groups: [] },
      '/api/cloud/aws/cloudwatch/log-backup': {
        subscriptionsChecked: 2, errors: [], s3Sources: [],
        coverage: [
          { name: '/a', kind: 'aws', storedBytes: 10, retentionInDays: 7, method: 'none', risk: 'expires', subscriptions: [], lastExport: null },
          { name: '/b', kind: 'custom', storedBytes: 5, retentionInDays: null, method: 'export', risk: null, subscriptions: [], lastExport: { taskId: 't1', bucket: 'archive', prefix: 'exp', to: 1 } },
        ],
        exportTasks: [{ taskId: 't1', logGroup: '/b', bucket: 'archive', prefix: 'exp', status: 'COMPLETED', from: 0, to: 1 }],
      },
      '/api/cloud/aws/s3/archive/browse': { folders: [], files: [{ key: 'exp/t1/s/000000.gz', name: '000000.gz', size: 20, lastModified: '2026-10-01' }] },
    })
    const wrapper = mount(AwsLogsTab, { props: { profileId: 'p' } })
    await flushPromises()
    await wrapper.findAll('[role="tab"]')[2].trigger('click')
    await flushPromises()
    expect(wrapper.find('.cwl-cards').text()).toContain('1')
    const link = wrapper.findAll('.cwl-link').find(b => b.text().startsWith('s3://archive'))
    await link.trigger('click')
    await flushPromises()
    expect(calls.some(c => c.url.includes('/s3/archive/browse?prefix=exp%2Ft1%2F'))).toBe(true)
    expect(wrapper.find('.cwl-archive').text()).toContain('000000.gz')
    wrapper.unmount()
  })
})

describe('AwsLogsTab group detail chart', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('charts cached groups by level (24 h), lists events of a zoomed window, and charts uncached groups by volume', async () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
    const calls = []
    vi.stubGlobal('fetch', vi.fn(async url => {
      calls.push(url)
      let body = {}
      if (url.startsWith('/api/cloud/aws/cloudwatch/log-groups/streams')) body = { streams: [], instances: [], more: false }
      else if (url.startsWith('/api/cloud/aws/cloudwatch/log-groups/volume')) body = { from: 0, to: 120000, binMs: 60000, source: 'metric', requests: 1, total: 5, buckets: [{ start: 0, events: 2 }, { start: 60000, events: 3 }] }
      else if (url.startsWith('/api/cloud/aws/cloudwatch/log-groups/events')) body = { source: 'cache', events: [{ timestamp: 1, message: 'x', logStreamName: 's' }] }
      else if (url.startsWith('/api/cloud/aws/cloudwatch/log-groups')) body = { groups: [
        { name: '/aws/containerinsights/eks/application', kind: 'aws', service: 'eks', storedBytes: 1, retentionInDays: 5, cache: { windowMs: 6 * 3600000, bytes: 1, events: 1 } },
        { name: '/plain', kind: 'custom', storedBytes: 1, cache: null },
      ] }
      else if (url.startsWith('/api/cloud/aws/cloudwatch/log-intelligence/histogram')) body = { from: 0, to: 60000, binMs: 30000, events: 0, buckets: [{ start: 0, error: 0, warn: 0, info: 1 }, { start: 30000, error: 1, warn: 0, info: 0 }], coverage: { oldest: 0, newest: 1 } }
      else if (url.startsWith('/api/cloud/aws/cloudwatch/log-cache')) body = { budgetBytes: 1, totalBytes: 0, totalEvents: 0, maxWindowMs: 1, groups: [] }
      return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => body }
    }))
    const wrapper = mount(AwsLogsTab, { props: { profileId: 'p' } })
    await flushPromises()
    const cachedRow = wrapper.findAll('tbody tr').find(r => r.text().includes('containerinsights'))
    await cachedRow.findAll('button').at(-1).trigger('click')
    await flushPromises()
    const histogramCall = calls.find(url => url.includes('/log-intelligence/histogram'))
    const params = new URLSearchParams(histogramCall.split('?')[1])
    expect(Number(params.get('to')) - Number(params.get('from'))).toBe(24 * 3600000)
    expect(wrapper.find('.lh').exists()).toBe(true)

    const chart = wrapper.findComponent({ name: 'LogActivityChart' })
    chart.vm.zoom({ from: 1000, to: 2000 })
    await flushPromises()
    const eventsCall = calls.filter(url => url.includes('/log-groups/events')).at(-1)
    expect(eventsCall).toContain('source=cache')
    expect(eventsCall).toContain('from=1000')
    expect(eventsCall).toContain('to=2000')
    expect(wrapper.find('.cwl-window').exists()).toBe(true)

    await wrapper.findAll('tbody tr').find(r => r.text().includes('containerinsights')).findAll('button').at(-1).trigger('click')
    const plainRow = wrapper.findAll('tbody tr').find(r => r.text().includes('/plain'))
    await plainRow.findAll('button').at(-1).trigger('click')
    await flushPromises()
    expect(wrapper.find('.cwl-chart-hint').exists()).toBe(true)
    expect(calls.some(url => url.includes('/log-groups/volume?group=%2Fplain'))).toBe(true)
    expect(wrapper.find('.lh').text()).toContain('5')
    wrapper.unmount()
  })
})
