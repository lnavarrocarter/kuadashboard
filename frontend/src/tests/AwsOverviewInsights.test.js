import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))
vi.mock('../components/cloud/CloudMetricChart.vue', () => ({
  default: { name: 'CloudMetricChart', props: ['label', 'unit', 'points', 'xTickLimit', 'color'], template: '<div class="chart-stub">{{ label }}|{{ points.length }}</div>' },
}))

import AwsOverviewInsights from '../components/cloud/AwsOverviewInsights.vue'
import AwsAccessRequestModal from '../components/cloud/AwsAccessRequestModal.vue'
import { useAwsStore } from '../stores/useAwsStore'
import { settings } from '../composables/useSettings'

const NOW = Date.parse('2026-09-28T12:00:00Z')
const HOUR = 3600000

function insights(overrides = {}) {
  return {
    costs: {
      status: 'ok', source: 'cost-explorer', currency: 'USD', estimated: true,
      monthToDate: 1819.49, lastMonth: 2310.93, forecast: { monthEnd: 2015.43 },
      fetchedAt: NOW - 3 * HOUR, cachedUntil: NOW + 9 * HOUR,
      byService: [
        { name: 'Amazon Elastic Compute Cloud - Compute', key: 'ec2', label: 'EC2', tab: 'ec2', monthToDate: 14.83 },
        { name: 'EC2 - Other', key: 'ec2', label: 'EC2', tab: 'ec2', monthToDate: 533.64 },
        { name: 'AmazonCloudWatch', key: 'cloudwatch', label: 'CloudWatch', tab: null, partial: true, monthToDate: 194.19 },
        { name: 'Amazon Elastic Load Balancing', key: 'elasticloadbalancing', label: 'Elastic Load Balancing', tab: null, monthToDate: 164.03 },
        { name: 'Tiny', key: 'x', label: 'Tiny', tab: null, monthToDate: 0 },
      ],
    },
    usage: {
      lambda: { present: true, invocations: 3129, errors: 6, throttles: 0, errorRate: 0.19, series: [{ t: 1, v: 10 }, { t: 2, v: 20 }] },
      ec2: { present: true, cpuAvg: 15.2, cpuPeak: 92.3, cpuNow: 11.6, series: [{ t: 1, v: 10 }, { t: 2, v: 20 }] },
      elb: { present: true, requests: 22, errors5xx: 1208, target5xx: 6, elbGenerated5xx: 1202, targetErrorRate: 27.27, latencyMs: 1, nlbBytes: null, series: [{ t: 1, v: 1 }, { t: 2, v: 0 }] },
      s3: { present: true, bytes: 463706964808, objects: 7665221, asOf: Date.parse('2026-09-27T00:00:00Z') },
      eks: { present: false },
      rds: { present: true, cpuAvg: 4.5, cpuPeak: 30, connections: 5, freeStorageMin: 3e9, series: [{ t: 1, v: 4 }, { t: 2, v: 5 }] },
      dynamodb: { present: true, readUnits: 5790, writeUnits: 43, throttled: 2, systemErrors: 0, latencyMs: 0.67, series: [{ t: 1, v: 1 }, { t: 2, v: 2 }] },
      stepfn: { present: true, started: 10, succeeded: 7, failed: 3, timedOut: 0, aborted: 0, avgDurationMs: 86177, series: [{ t: 1, v: 1 }, { t: 2, v: 2 }] },
      eventbridge: { present: true, invocations: 2639, failed: 0, matched: 2638, series: [{ t: 1, v: 1 }, { t: 2, v: 2 }] },
      cloudfront: { present: true, requests: 3, bytes: 463421, error4xxRate: 0, error5xxRate: 0, series: [{ t: 1, v: 3 }] },
      glue: { status: 'ok', present: true, jobs: 100, runs: 82, succeeded: 70, failed: 12, running: 0, executionSeconds: 5400, truncated: true, failedJobs: [{ job: 'etl-a', count: 8 }, { job: 'etl-b', count: 4 }] },
    },
    uncovered: {
      services: [
        { key: 'elasticloadbalancing', label: 'Elastic Load Balancing', cost: 164.03, lastMonthCost: 180.84, taggedResources: 61, recentChanges: 4, sources: ['cost', 'tags', 'cloudtrail'] },
        { key: 'ssm', label: 'Systems Manager', cost: 0, lastMonthCost: 0, taggedResources: 7, recentChanges: 21, sources: ['tags', 'cloudtrail'] },
        { key: 'cloudwatch', label: 'CloudWatch', partial: true, cost: 194.19, lastMonthCost: 256.92, taggedResources: 8, recentChanges: 0, sources: ['cost', 'tags'] },
      ],
      sources: {
        costs: { status: 'ok', source: 'cost-explorer' },
        tags: { status: 'ok', total: 1000, truncated: true },
        cloudtrail: { status: 'unavailable', error: { kind: 'denied', action: 'cloudtrail:LookupEvents', message: 'denied' }, access: { failedAction: 'cloudtrail:LookupEvents', actions: ['cloudtrail:LookupEvents'], policy: {}, source: 'error' } },
      },
    },
    ...overrides,
  }
}

// Renders both sections, as AwsOverview does, so tests can query either one.
function mountWith(data, props = {}) {
  return mount({
    components: { AwsOverviewInsights },
    setup: () => ({ data, props, NOW }),
    template: `<div>
      <AwsOverviewInsights section="summary" :insights="data" :now="NOW" v-bind="props" @open-tab="t => $emit('open-tab', t)" @refresh-costs="$emit('refresh-costs')" />
      <AwsOverviewInsights section="uncovered" :insights="data" :now="NOW" v-bind="props" />
    </div>`,
    emits: ['open-tab', 'refresh-costs'],
  }, { global: { stubs: { teleport: true } } })
}

describe('AwsOverviewInsights', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    settings.lang = 'en'
  })

  it('lists services with failures first and opens the affected resources (A08)', async () => {
    const w = mountWith(insights())
    const block = w.find('[data-test="incidents"]')
    expect(block.text()).toContain('Last 24 h')
    expect(block.find('[data-test="incident-lambda"]').text()).toContain('6 errors (0.19% of invocations)')
    expect(block.find('[data-test="incident-elb"]').text()).toContain('1,202 generated by the load balancer itself')
    expect(block.find('[data-test="incident-stepfn"]').text()).toContain('3 failed or timed-out executions')
    expect(block.find('[data-test="incident-glue"]').text()).toContain('12 failed job runs')
    expect(block.find('[data-test="incident-eventbridge"]').exists()).toBe(false)
    await block.find('[data-test="incident-lambda"] button').trigger('click')
    await block.find('[data-test="incident-glue"] button').trigger('click')
    expect(w.emitted('open-tab')).toEqual([[{ tab: 'lambda', incident: true }], [{ tab: 'glue', incident: false }]])
  })

  it('keeps Glue incidents when CloudWatch metrics are denied, and the load balancer card opens its tab', async () => {
    const denied = insights()
    denied.usage = { cloudwatch: { error: { kind: 'denied', message: 'no' } }, glue: denied.usage.glue }
    expect(mountWith(denied).findAll('[data-test="incidents"] li').map(li => li.attributes('data-test'))).toEqual(['incident-glue'])
    const w = mountWith(insights())
    const card = w.findAll('.aoi-kpi').find(c => c.text().includes('Load balancers'))
    expect(card.attributes('disabled')).toBeUndefined()
    await card.trigger('click')
    expect(w.emitted('open-tab')).toEqual([['elb']])
  })

  it('shows month-to-date, forecast and last month costs', () => {
    const figures = mountWith(insights()).findAll('.aoi-card')[0].findAll('.aoi-figures > div').map(d => d.text())
    expect(figures).toEqual(['This month$1,819', 'Month-end forecast$2,015', 'Last month$2,311'])
  })

  it('ranks services by cost, merging entries of the same service and flagging those outside KUA', () => {
    const rows = mountWith(insights()).findAll('.aoi-bar-row')
    expect(rows.map(r => r.find('.aoi-bar-label').text())).toEqual(['EC2', 'CloudWatch Partly in KUA', 'Elastic Load Balancing Not in KUA'])
    expect(rows[0].find('.aoi-bar-value').text()).toBe('$548.47')
    expect(rows[0].attributes('disabled')).toBeUndefined()
    expect(rows[2].attributes('disabled')).toBeDefined()
  })

  it('opens the KUA tab of a covered service from its cost bar', async () => {
    const wrapper = mountWith(insights())
    await wrapper.find('.aoi-bar-row').trigger('click')
    expect(wrapper.emitted('open-tab')).toEqual([['ec2']])
  })

  it('shows when costs were read and offers a billed refresh', async () => {
    const wrapper = mountWith(insights())
    const footer = wrapper.find('.aoi-cost-footer')
    expect(footer.text()).toContain('updated 3h ago')
    expect(footer.text()).toContain('next update in 9h')
    expect(footer.find('button').attributes('title')).toContain('USD 0.01')
    await footer.find('button').trigger('click')
    expect(wrapper.emitted('refresh-costs')).toHaveLength(1)
  })

  it('explains the CloudWatch billing fallback and offers Cost Explorer access', async () => {
    const data = insights()
    data.costs = { status: 'ok', source: 'cloudwatch-billing', currency: 'USD', estimated: true, monthToDate: 88.5, lastMonth: null, forecast: { monthEnd: null }, byService: [], explorer: { status: 'unavailable', error: { kind: 'denied', message: 'no ce' }, access: { failedAction: 'ce:GetCostAndUsage', actions: ['ce:GetCostAndUsage'], policy: {}, source: 'error' } } }
    const wrapper = mountWith(data)
    expect(wrapper.text()).toContain('CloudWatch billing metric')
    expect(wrapper.find('.aoi-cost-footer').exists()).toBe(false)
    await wrapper.findAll('.aoi-card')[0].find('.aoi-link').trigger('click')
    const modal = wrapper.findComponent(AwsAccessRequestModal)
    expect(modal.props('show')).toBe(true)
    expect(modal.props('access').failedAction).toBe('ce:GetCostAndUsage')
  })

  it('shows one activity card per service with data, in a fixed order', () => {
    const wrapper = mountWith(insights(), { resourceCounts: { eks: 1 } })
    expect(wrapper.findAll('.aoi-kpi-title').map(c => c.text())).toEqual([
      'Lambda', 'EC2', 'Load balancers', 'EKS', 'RDS', 'DynamoDB', 'Step Functions', 'EventBridge', 'Glue', 'CloudFront', 'S3',
    ])
  })

  it('summarizes each service with its main figure and facts', () => {
    const cards = mountWith(insights()).findAll('.aoi-kpi')
    const byTitle = Object.fromEntries(cards.map(c => [c.find('.aoi-kpi-title').text(), c]))
    expect(byTitle.Lambda.find('.aoi-kpi-main').text()).toBe('3,129Invocations')
    expect(byTitle.Lambda.find('.aoi-kpi-facts').text()).toContain('Errors 6 (0.19%)')
    expect(byTitle.EC2.find('.aoi-kpi-main').text()).toBe('15.2%average CPU')
    expect(byTitle.EC2.find('.aoi-kpi-facts .bad').text()).toContain('92.3%')
    expect(byTitle.Glue.find('.aoi-kpi-main').text()).toBe('82+job runs')
    expect(byTitle.Glue.find('.aoi-kpi-facts').text()).toContain('Failed 12')
    expect(byTitle.Glue.find('.aoi-kpi-note').text()).toBe('Failing: etl-a (8), etl-b (4)')
    expect(byTitle.S3.find('.aoi-kpi-main').text()).toBe('464 GBstored')
    expect(byTitle.RDS.classes()).toContain('warn')
    expect(byTitle.RDS.find('.aoi-kpi-note').text()).toContain('less than 5 GB')
    expect(byTitle.DynamoDB.find('.aoi-kpi-main').text()).toBe('5,790read units')
    expect(byTitle.DynamoDB.find('.aoi-kpi-facts .bad').text()).toContain('Throttled 2')
    expect(byTitle['Step Functions'].find('.aoi-kpi-facts').text()).toContain('Failed 3')
    expect(byTitle['Step Functions'].find('.aoi-kpi-facts').text()).toContain('Avg duration 1.4 min')
    expect(byTitle.EventBridge.find('.aoi-kpi-main').text()).toBe('2,639rule invocations')
    expect(byTitle.CloudFront.find('.aoi-kpi-facts').text()).toContain('Downloaded 463 KB')
  })

  it('never shows a combined 5xx rate, even when it would stay under 100% (R01)', () => {
    const data = insights()
    data.usage.elb = { present: true, requests: 10, errors5xx: 4, target5xx: 1, elbGenerated5xx: 3, targetErrorRate: 10, series: [] }
    const facts = mountWith(data).findAll('.aoi-kpi').find(c => c.text().includes('Load balancers')).find('.aoi-kpi-facts').text()
    expect(facts).toContain('Target 5xx 1 (10%)')
    expect(facts).toContain('LB 5xx 3')
    expect(facts).not.toContain('40%')
  })

  it('flags load balancers answering 5xx without claiming they are outside KUA', async () => {
    const wrapper = mountWith(insights())
    const elb = wrapper.findAll('.aoi-kpi').find(c => c.text().includes('Load balancers'))
    expect(elb.classes()).toContain('warn')
    expect(elb.find('.aoi-tag').exists()).toBe(false)
    expect(elb.find('.aoi-kpi-note').text()).toContain('1,202 5xx came from the load balancer itself')
    expect(elb.attributes('disabled')).toBeUndefined() // the Load Balancers tab exists (A03)
    // Rate only for target 5xx (same population as RequestCount); load balancer 5xx as a count (R01).
    expect(elb.find('.aoi-kpi-facts').text()).toContain('Target 5xx 6 (27.27%)')
    expect(elb.find('.aoi-kpi-facts').text()).toContain('LB 5xx 1,202')
    expect(elb.find('.aoi-kpi-facts').text()).not.toMatch(/1,208 \(|1,202 \(/)
  })

  it('draws a sparkline for hourly series and opens the service tab', async () => {
    const wrapper = mountWith(insights())
    const lambda = wrapper.findAll('.aoi-kpi')[0]
    expect(lambda.find('svg.aoi-spark title').text()).toBe('Invocations per hour: 10 – 20')
    expect(lambda.find('svg.aoi-spark polyline').attributes('stroke')).toBe('var(--accent)')
    await lambda.trigger('click')
    expect(wrapper.emitted('open-tab')).toEqual([['lambda']])
  })

  it('explains EKS without Container Insights when the account has clusters', () => {
    const eks = mountWith(insights(), { resourceCounts: { eks: 2 } }).findAll('.aoi-kpi').find(c => c.text().startsWith('EKS'))
    expect(eks.find('.aoi-kpi-main').text()).toBe('2clusters')
    expect(eks.find('.aoi-kpi-note').text()).toContain('Container Insights')
  })

  it('hides services without data and explains a CloudWatch failure', () => {
    const data = insights({ usage: { cloudwatch: { status: 'unavailable', error: { kind: 'denied', message: 'x' }, access: { failedAction: 'cloudwatch:GetMetricData', actions: ['cloudwatch:GetMetricData'], policy: {}, source: 'error' } }, glue: { status: 'ok', present: false } } })
    const wrapper = mountWith(data)
    expect(wrapper.findAll('.aoi-kpi')).toHaveLength(0)
    expect(wrapper.find('.aoi-activity .aoi-notice').text()).toContain('CloudWatch metrics are not available (No permission)')
  })

  it('lists services outside KUA with how each one was detected', () => {
    const wrapper = mountWith(insights())
    const rows = wrapper.findAll('.aoi-table tbody tr')
    expect(rows.map(r => r.find('td').text())).toEqual(['Elastic Load Balancing', 'Systems Manager', 'CloudWatch Partly in KUA'])
    expect(rows[0].findAll('td').map(td => td.text())).toEqual(['Elastic Load Balancing', '$164.03', '$180.84', '61', '4', 'CostTagsCloudTrail'])
    expect(rows[1].findAll('td')[1].text()).toBe('—')
  })

  it('explains each detection source and offers access for missing ones', async () => {
    const wrapper = mountWith(insights())
    const notes = wrapper.findAll('.aoi-sources li')
    expect(notes[1].text()).toContain('first 1000 tagged resources')
    expect(notes[2].classes()).toContain('warn')
    await notes[2].find('.aoi-link').trigger('click')
    expect(wrapper.findAllComponents(AwsAccessRequestModal).find(m => m.props('show')).props('access').failedAction).toBe('cloudtrail:LookupEvents')
  })

  it('renders in Spanish', () => {
    settings.lang = 'es'
    try {
      const wrapper = mountWith(insights())
      expect(wrapper.find('.aoi-card h3').text()).toBe('Costos')
      expect(wrapper.text()).toContain('Servicios fuera de KUA')
    } finally {
      settings.lang = 'en'
    }
  })
})

describe('useAwsStore.fetchOverviewInsights', () => {
  it('requests insights and forces Cost Explorer only on demand', async () => {
    setActivePinia(createPinia())
    const store = useAwsStore()
    store.activeProfileId = 'local:dev'
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, headers: { get: () => 'application/json' }, json: async () => insights() })
    await store.fetchOverviewInsights()
    await store.fetchOverviewInsights({ refreshCosts: true })
    expect(fetch.mock.calls.map(c => c[0])).toEqual(['/api/cloud/aws/overview/insights', '/api/cloud/aws/overview/insights?refreshCosts=1'])
    expect(store.overviewInsights.costs.monthToDate).toBe(1819.49)
    store.setActiveProfile('local:prod')
    expect(store.overviewInsights).toBeNull()
  })
})
