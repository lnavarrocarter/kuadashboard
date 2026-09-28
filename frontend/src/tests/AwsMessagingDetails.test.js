import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))
vi.mock('../components/cloud/CloudMetricChart.vue', () => ({
  default: { props: ['label', 'points', 'unit', 'color', 'showDate'], template: '<div class="chart-stub">{{ label }}|{{ points.length }}|{{ showDate }}</div>' },
}))

import AwsSqsTab from '../components/cloud/messaging/AwsSqsTab.vue'
import HealthBadge from '../components/cloud/messaging/HealthBadge.vue'
import AwsResourceMetrics from '../components/cloud/messaging/AwsResourceMetrics.vue'
import SnsTopicDetail from '../components/cloud/messaging/SnsTopicDetail.vue'
import SesConfigSetMetrics from '../components/cloud/messaging/SesConfigSetMetrics.vue'
import SesSuppression from '../components/cloud/messaging/SesSuppression.vue'
import { useAwsStore } from '../stores/useAwsStore'
import { settings } from '../composables/useSettings'

function stubRoutes(routes) {
  const fn = vi.fn(async url => {
    const key = Object.keys(routes).find(fragment => String(url).includes(fragment))
    const body = typeof routes[key] === 'function' ? routes[key](url) : routes[key]
    return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => body ?? {} }
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

let store
beforeEach(() => {
  setActivePinia(createPinia())
  settings.lang = 'en'
  store = useAwsStore()
  store.activeProfileId = 'p1'
})
afterEach(() => vi.unstubAllGlobals())

describe('health', () => {
  it('shows a badge with the translated reasons as its title, or the full list', () => {
    const health = { status: 'critical', reasons: [
      { level: 'critical', key: 'messagesExpiring', params: { age: 300000, retention: 345600 } },
      { level: 'info', key: 'noDlq' },
    ] }
    const badge = mount(HealthBadge, { props: { health } })
    expect(badge.text()).toBe('Critical')
    expect(badge.attributes('title')).toContain('3.5 d old, close to the 4 d retention')
    const list = mount(HealthBadge, { props: { health, list: true } })
    expect(list.findAll('.hb-reason').map(r => r.classes()[1])).toEqual(['critical', 'info'])
    expect(mount(HealthBadge, { props: { health: { status: 'ok', reasons: [] }, list: true } }).text()).toBe('No issues found')
  })

  it('the SQS table shows each queue health from the activity', () => {
    store.sqsQueues = [{ name: 'orders-dlq', url: 'u', arn: 'a', visible: 3, inFlight: 0, dlqFor: ['orders'], encryption: 'sqs', retentionSeconds: 60 }]
    store.sqsActivity = { queues: { 'orders-dlq': { sent: 0, received: 0, deleted: 0, health: { status: 'warning', reasons: [{ level: 'warning', key: 'dlqHasMessages', params: { n: 3 } }] } } } }
    const wrapper = mount(AwsSqsTab)
    expect(wrapper.find('.hb.warning').attributes('title')).toBe('Dead-letter queue holds 3 failed messages')
  })
})

describe('metrics panel', () => {
  it('changes range and says what came from history and what was requested', async () => {
    const fetcher = vi.fn(async hours => ({
      series: { sent: Array.from({ length: hours }, () => ({ t: 1, v: 1 })) },
      cache: hours === 24 ? { requested: 0, reused: 1 } : { requested: 1, reused: 0 },
    }))
    const wrapper = mount(AwsResourceMetrics, { props: { fetcher, charts: [{ key: 'sent', label: 'Sent', stat: 'sum' }] } })
    await flushPromises()
    expect(wrapper.find('.arm-cost').text()).toBe('All 1 metrics from local history: nothing requested from CloudWatch.')
    expect(wrapper.find('.chart-stub').text()).toBe('Sent · total 24|24|false')
    await wrapper.findAll('.arm-range button')[1].trigger('click')
    await flushPromises()
    expect(fetcher).toHaveBeenLastCalledWith(168)
    expect(wrapper.find('.chart-stub').text()).toBe('Sent · total 168|168|true')
    expect(wrapper.find('.arm-cost').text()).toContain('1 metrics requested from CloudWatch')
  })
})

describe('SNS detail', () => {
  const topic = {
    name: 'alerts', arn: 'arn:aws:sns:us-east-1:1:alerts', subscriptions: [],
    deliveryLogging: { enabled: true, protocols: [{ protocol: 'lambda', success: true, failure: true, sampleRate: 10 }] },
  }

  it('shows filters, raw delivery and DLQs, and loads delivery logs on demand', async () => {
    const fetchMock = stubRoutes({
      '/details': { policy: [], subscriptions: [
        { arn: 's1', protocol: 'sqs', endpoint: 'arn:q', pending: false, filterPolicy: { type: ['order'], region: ['cl'] }, filterScope: 'MessageBody', rawDelivery: true, dlqArn: 'arn:aws:sqs:us-east-1:1:dlq', detailLoaded: true },
        { arn: 's2', protocol: 'lambda', endpoint: 'arn:fn', pending: false, filterPolicy: null, rawDelivery: false, dlqArn: null, detailLoaded: true },
      ] },
      '/logs': url => ({
        groups: [{ name: 'sns/us-east-1/1/alerts', kind: 'success', exists: false, count: 0 }, { name: 'sns/us-east-1/1/alerts/Failure', kind: 'failure', exists: true, count: 1 }],
        events: [{ timestamp: 1, status: 'FAILURE', statusCode: 500, destination: 'arn:fn', providerResponse: 'Throttled', attempts: 3, dwellTimeMs: 90 }],
        counts: { success: 0, failure: 1 }, url,
      }),
      '/metrics': { series: {}, cache: { requested: 0, reused: 7 } },
    })
    const wrapper = mount(SnsTopicDetail, { props: { topic } })
    await flushPromises()
    const rows = wrapper.findAll('.msg-subtable tbody tr')
    expect(rows[0].text()).toContain('type, region (body)')
    expect(rows[0].text()).toContain('Yes')
    expect(rows[0].text()).toContain('dlq')
    expect(rows[1].find('.status-warn').text()).toBe('None')
    expect(wrapper.text()).toContain('lambda: success + failure')
    expect(fetchMock.mock.calls.some(c => c[0].includes('/logs'))).toBe(false)

    await wrapper.findAll('button').find(b => b.text() === 'Failures').trigger('click')
    await wrapper.findAll('button').find(b => b.text() === 'Load last 24h').trigger('click')
    await flushPromises()
    const logUrl = fetchMock.mock.calls.map(c => c[0]).find(u => u.includes('/logs'))
    expect(logUrl).toContain('status=failure')
    expect(wrapper.text()).toContain('log group does not exist yet')
    expect(wrapper.text()).toContain('Throttled')
  })

  it('explains how to turn logging on when it is off', async () => {
    stubRoutes({ '/details': { policy: [], subscriptions: [] }, '/metrics': { series: {}, cache: {} } })
    const wrapper = mount(SnsTopicDetail, { props: { topic: { ...topic, deliveryLogging: { enabled: false, protocols: [] } } } })
    await flushPromises()
    expect(wrapper.text()).toContain('Delivery status logging is off')
    expect(wrapper.findAll('button').some(b => b.text() === 'Load last 24h')).toBe(false)
  })
})

describe('SES', () => {
  it('configuration set metrics are counted first and read only on request', async () => {
    const fetchMock = stubRoutes({
      'estimate=1': { dimensionNames: ['campaign'], metrics: [{ key: 'send|campaign=welcome', event: 'send', dimension: 'campaign', value: 'welcome' }, { key: 'bounce|campaign=welcome', event: 'bounce', dimension: 'campaign', value: 'welcome' }], truncated: false },
      '/metrics': { totals: { 'send|campaign=welcome': 40, 'bounce|campaign=welcome': 2 }, cache: { requested: 2, reused: 0 } },
    })
    const wrapper = mount(SesConfigSetMetrics, { props: { name: 'tracking' } })
    await flushPromises()
    expect(wrapper.text()).toContain('2 metrics by campaign')
    const load = wrapper.findAll('button').find(b => b.text().startsWith('Load'))
    expect(load.text()).toBe('Load (≈ USD 0.00002)')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await load.trigger('click')
    await flushPromises()
    const row = wrapper.find('.msg-subtable tbody tr')
    expect(row.text()).toContain('campaign=welcome')
    expect(row.text()).toContain('40')
    expect(row.text()).toContain('2')
  })

  it('lists suppressed addresses with the reason and whether suppression is on', async () => {
    stubRoutes({ '/suppression': { total: 2, truncated: false, byReason: { BOUNCE: 1, COMPLAINT: 1 }, items: [{ email: 'a@x.com', reason: 'COMPLAINT', updatedAt: 1 }, { email: 'b@x.com', reason: 'BOUNCE', updatedAt: 1 }] } })
    const wrapper = mount(SesSuppression, { props: { reasons: ['BOUNCE', 'COMPLAINT'] } })
    await flushPromises()
    expect(wrapper.text()).toContain('2 suppressed addresses · 1 bounces · 1 complaints')
    expect(wrapper.find('.status-err').text()).toBe('Complaint')
    const off = mount(SesSuppression, { props: { reasons: [] } })
    await flushPromises()
    expect(off.text()).toContain('Automatic suppression is off')
  })
})
