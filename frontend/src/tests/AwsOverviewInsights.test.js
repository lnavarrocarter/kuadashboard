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
    usage: { lambda: { status: 'ok', invocations: 3129, errors: 6, throttles: 0, errorRate: 0.19, series: { invocations: [{ t: 1, v: 10 }, { t: 2, v: 20 }], errors: [] } } },
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

  it('shows Lambda activity for the last 24h with an hourly chart', () => {
    const card = mountWith(insights()).findAll('.aoi-card')[1]
    expect(card.findAll('.aoi-figures > div').map(d => d.text())).toEqual(['Invocations3,129', 'Errors6 (0.19%)', 'Throttles0'])
    expect(card.find('.chart-stub').text()).toBe('Invocations per hour|2')
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
