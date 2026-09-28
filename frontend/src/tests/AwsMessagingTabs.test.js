import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))
vi.mock('../components/cloud/CloudMetricChart.vue', () => ({
  default: { props: ['label', 'points', 'unit', 'color'], template: '<div class="chart-stub">{{ label }}|{{ points.length }}</div>' },
}))

import AwsSqsTab from '../components/cloud/messaging/AwsSqsTab.vue'
import AwsSnsTab from '../components/cloud/messaging/AwsSnsTab.vue'
import AwsSesTab from '../components/cloud/messaging/AwsSesTab.vue'
import { useAwsStore } from '../stores/useAwsStore'
import { settings } from '../composables/useSettings'
import { formatDuration } from '../components/cloud/messaging/messagingFormat'

const QUEUES = [
  { name: 'orders', url: 'https://sqs/1/orders', arn: 'arn:aws:sqs:us-east-1:1:orders', fifo: false, visible: 5, inFlight: 1, delayed: 0, retentionSeconds: 345600, visibilityTimeout: 30, createdAt: 1, dlqArn: 'arn:aws:sqs:us-east-1:1:orders-dlq', maxReceiveCount: 3, encryption: 'sqs', dlqFor: [] },
  { name: 'orders-dlq', url: 'https://sqs/1/orders-dlq', arn: 'arn:aws:sqs:us-east-1:1:orders-dlq', fifo: false, visible: 2, inFlight: 0, delayed: 0, retentionSeconds: 1209600, visibilityTimeout: 30, createdAt: 1, dlqArn: null, maxReceiveCount: null, encryption: 'none', dlqFor: ['orders'] },
]
const DENIED = { error: { kind: 'denied', message: 'not authorized to perform cloudwatch:GetMetricData' }, access: { actions: ['cloudwatch:GetMetricData'], policy: {} } }

// Routes each request by the first matching fragment of its URL.
function stubRoutes(routes) {
  const fn = vi.fn(async url => {
    const key = Object.keys(routes).find(fragment => String(url).includes(fragment))
    return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => routes[key] ?? {} }
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

function stubFetch(body) {
  const fn = vi.fn(async () => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => body }))
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

describe('SQS tab', () => {
  it('shows queues with backlog, 24h activity, DLQ links and the cost of listing', () => {
    store.sqsQueues = QUEUES
    store.sqsActivity = { windowHours: 24, queues: { orders: { sent: 1200, received: 1190, deleted: 1180 }, 'orders-dlq': { sent: 0, received: 0, deleted: 0 } } }
    const wrapper = mount(AwsSqsTab)
    expect(wrapper.find('.msg-hint').text()).toContain('USD 0.40 per million')
    const rows = wrapper.findAll('tbody tr')
    expect(rows).toHaveLength(2)
    expect(rows[0].text()).toContain('orders-dlq')
    expect(rows[0].text()).toContain('after 3 receives')
    expect(rows[0].text()).toContain('1,200')
    expect(rows[0].text()).toContain('SSE-SQS')
    // The DLQ is marked and its visible messages flagged as failures.
    expect(rows[1].find('.msg-chip.warn').text()).toBe('DLQ')
    expect(rows[1].find('.status-err').text()).toBe('2')
    expect(rows[1].text()).toContain('None')
  })

  it('warns when metrics are unavailable and offers to request access', async () => {
    store.sqsQueues = QUEUES
    store.sqsActivity = { windowHours: 24, queues: { orders: null, 'orders-dlq': null }, metricsError: DENIED }
    const wrapper = mount(AwsSqsTab)
    expect(wrapper.find('.activity-notice').text()).toContain('CloudWatch metrics are not available')
    await wrapper.find('.activity-notice button').trigger('click')
    expect(wrapper.emitted('request-access')[0][0].access.actions).toEqual(['cloudwatch:GetMetricData'])
    expect(wrapper.findAll('tbody tr')[0].text()).toContain('—')
  })

  it('opens a detail with consumers, policy, 24h charts and explains that SQS has no logs', async () => {
    store.sqsQueues = QUEUES
    const fetchMock = stubRoutes({
      '/metrics': { windowHours: 24, series: { sent: [{ t: 1, v: 0 }], received: [], deleted: [], emptyReceives: [], visible: [], inFlight: [], oldestAge: [] }, cache: { requested: 4, reused: 3 } },
      '/details': {
        arn: 'arn', config: { receiveWaitSeconds: 0, maxMessageBytes: 262144, delaySeconds: 0 }, redrive: null, redriveAllow: null,
        policy: [{ effect: 'Allow', principals: ['*'], actions: ['sqs:SendMessage'], conditions: [] }], tags: { team: 'orders' },
        consumers: [{ function: 'worker', functionArn: 'arn:fn', state: 'Enabled', batchSize: 10, lastResult: 'OK' }], producers: [],
      },
    })
    const wrapper = mount(AwsSqsTab, { props: { search: 'sqs/1/orders-dlq' } })
    expect(wrapper.findAll('tbody tr')).toHaveLength(1)
    await wrapper.find('tbody button').trigger('click')
    await flushPromises()
    const urls = fetchMock.mock.calls.map(c => c[0])
    expect(urls.some(u => u.startsWith('/api/cloud/aws/sqs/orders-dlq/metrics?hours=24&cacheMin=15'))).toBe(true)
    expect(urls.some(u => u.startsWith('/api/cloud/aws/sqs/orders-dlq/details?url='))).toBe(true)
    const detail = wrapper.find('.msg-detail')
    expect(detail.text()).toContain('SQS writes no logs of its own')
    expect(detail.text()).toContain('short polling')
    expect(detail.text()).toContain('worker')
    expect(detail.text()).toContain('team=orders')
    expect(detail.find('.arm-cost').text()).toContain('4 metrics requested from CloudWatch')
    expect(wrapper.findAll('.chart-stub')).toHaveLength(7)
    expect(wrapper.find('.arm-quiet').text()).toContain('the queue has been idle')
  })
})

describe('SNS tab', () => {
  const TOPICS = [
    { name: 'alerts', arn: 'arn:aws:sns:us-east-1:1:alerts', fifo: false, displayName: '', subscriptionsConfirmed: 1, subscriptionsPending: 1, protocols: ['email', 'lambda'], encrypted: false,
      subscriptions: [{ arn: 'a:1', protocol: 'lambda', endpoint: 'arn:fn', pending: false }, { arn: 'PendingConfirmation', protocol: 'email', endpoint: 'ops@example.com', pending: true }],
      deliveryLogging: { enabled: true, protocols: [{ protocol: 'lambda', success: false, failure: true, sampleRate: null }] } },
    { name: 'plain', arn: 'arn:aws:sns:us-east-1:1:plain', fifo: false, subscriptionsConfirmed: 0, subscriptionsPending: 0, protocols: [], encrypted: false, subscriptions: [], deliveryLogging: { enabled: false, protocols: [] } },
  ]

  it('shows subscriptions, 24h messages and delivery log status', () => {
    store.snsTopics = TOPICS
    store.snsActivity = { topics: {
      alerts: { messages: { published: 10, delivered: 8, failed: 2 }, logStatus: 'ok', logGroups: ['sns/us-east-1/1/alerts/Failure'] },
      plain: { messages: { published: 0, delivered: 0, failed: 0 }, logStatus: 'off', logGroups: [] },
    } }
    const wrapper = mount(AwsSnsTab)
    const [alerts, plain] = wrapper.findAll('tbody tr')
    expect(alerts.text()).toContain('1 pending')
    expect(alerts.find('.status-err').text()).toBe('2')
    expect(alerts.find('.log-badge').text()).toBe('Active')
    expect(plain.find('.log-badge').text()).toBe('Off')
  })

  it('knows logging is off before activity loads, and reports log group errors', () => {
    store.snsTopics = TOPICS
    store.snsActivity = { topics: {}, metricsError: null, logsError: { error: { message: 'denied logs' }, access: null } }
    const wrapper = mount(AwsSnsTab)
    expect(wrapper.text()).toContain('Log groups could not be read: denied logs')
    expect(wrapper.findAll('.log-badge').map(b => b.text())).toEqual(['Unknown', 'Off'])
  })

  it('lists subscriptions in the detail, including pending confirmations', async () => {
    store.snsTopics = TOPICS
    stubFetch({ windowHours: 24, series: { published: [], delivered: [], failed: [] } })
    const wrapper = mount(AwsSnsTab)
    await wrapper.find('tbody button').trigger('click')
    await flushPromises()
    const detail = wrapper.find('.msg-detail')
    expect(detail.text()).toContain('ops@example.com')
    expect(detail.text()).toContain('Pending confirmation')
    expect(detail.text()).toContain('lambda: failure')
  })
})

describe('SES tab', () => {
  const SES = {
    region: 'us-east-1',
    account: { sendingEnabled: true, productionAccess: false, enforcementStatus: 'HEALTHY', max24HourSend: 200, maxSendRate: 1, sentLast24Hours: 170 },
    accountError: null,
    identities: [
      { name: 'example.com', type: 'domain', verification: 'SUCCESS', sendingEnabled: true, dkim: 'SUCCESS', mailFrom: null, configurationSet: 'tracking', detailLoaded: true },
      { name: 'me@example.org', type: 'email', verification: 'PENDING', sendingEnabled: false, dkim: 'DISABLED', mailFrom: null, configurationSet: null, detailLoaded: true },
    ],
    identitiesTruncated: false,
    configurationSets: [{ name: 'tracking', destinations: [] }],
    eventLogging: false,
  }

  it('shows sandbox, quota, identities and warns that events are not logged', () => {
    store.sesData = SES
    store.sesMetrics = { series: { bounceRate: [{ t: 1, v: 0.012 }] }, totals: { send: 170, delivery: 160, bounce: 4, complaint: 0, reject: 0 } }
    const wrapper = mount(AwsSesTab)
    const cards = wrapper.findAll('.ses-card').map(c => c.text())
    expect(cards[0]).toContain('Sandbox')
    expect(cards[1]).toContain('170 / 200')
    expect(wrapper.find('.ses-bar span').classes()).toContain('warn')
    expect(cards.find(c => c.startsWith('Bounces'))).toContain('rate 1.20%')
    expect(wrapper.text()).toContain('No configuration set sends events')
    const rows = wrapper.findAll('tbody tr')
    expect(rows[0].text()).toContain('Verified')
    expect(rows[0].text()).toContain('amazonses.com')
    expect(rows[1].text()).toContain('sending off')
    expect(wrapper.text()).toContain('None: events are not logged')
  })

  it('keeps identities visible when the account or metrics are denied', async () => {
    store.sesData = { ...SES, account: null, accountError: DENIED }
    store.sesMetrics = { failed: 'AccessDenied', access: DENIED.access }
    const wrapper = mount(AwsSesTab)
    const notices = wrapper.findAll('.activity-notice')
    expect(notices[0].text()).toContain('The SES account could not be read')
    expect(notices[1].text()).toContain('CloudWatch metrics are not available')
    await notices[0].find('button').trigger('click')
    expect(wrapper.emitted('request-access')).toHaveLength(1)
    expect(wrapper.findAll('tbody tr').length).toBeGreaterThan(1)
  })
})

describe('store: SQS/SNS/SES activity cache', () => {
  it('reuses SQS activity until forced', async () => {
    const fetchMock = stubFetch({ queues: {} })
    store.sqsQueues = QUEUES
    await store.fetchSqsActivity()
    await store.fetchSqsActivity()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await store.fetchSqsActivity({ force: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ queues: [
      { name: 'orders', isDlq: false, hasDlq: true, visible: 5, retentionSeconds: 345600 },
      { name: 'orders-dlq', isDlq: true, hasDlq: false, visible: 2, retentionSeconds: 1209600 },
    ] })
  })

  it('sends each topic with whether delivery logging is on', async () => {
    const fetchMock = stubFetch({ topics: {} })
    store.snsTopics = [{ name: 'a', deliveryLogging: { enabled: true } }, { name: 'b', deliveryLogging: { enabled: false } }]
    await store.fetchSnsActivity()
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).topics.map(t => [t.name, t.logging])).toEqual([['a', true], ['b', false]])
  })

  it('formats durations for retention and timeouts', () => {
    expect(formatDuration(345600)).toBe('4 d')
    expect(formatDuration(5400)).toBe('1.5 h')
    expect(formatDuration(30)).toBe('30 s')
    expect(formatDuration(null)).toBe('—')
  })
})
