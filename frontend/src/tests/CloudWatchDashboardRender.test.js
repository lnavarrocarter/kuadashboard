import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))
vi.mock('../components/cloud/dashboard/DashboardChart.vue', () => ({
  default: {
    name: 'DashboardChart',
    props: ['type', 'datasets', 'labels', 'horizontal', 'stacked', 'yMin', 'yMax', 'showLegend', 'formatValue', 'formatTime', 'ariaLabel'],
    template: '<div class="chart-stub" :data-type="type || \'line\'">{{ (datasets || []).map(d => d.label).join(\'|\') }}</div>',
  },
}))

import MetricWidget from '../components/cloud/dashboard/MetricWidget.vue'
import LogWidget from '../components/cloud/dashboard/LogWidget.vue'
import TextWidget from '../components/cloud/dashboard/TextWidget.vue'
import CloudWatchDashboardView from '../components/cloud/dashboard/CloudWatchDashboardView.vue'
import { useAwsStore } from '../stores/useAwsStore'
import { settings } from '../composables/useSettings'
import { formatNumber, formatBytes, numericField, rangeLabel } from '../components/cloud/dashboard/dashboardFormat'

const RANGE = { start: 1000, end: 11000 }
const pts = (...values) => values.map((v, i) => ({ t: 1000 + i * 1000, v }))

describe('dashboard format helpers', () => {
  it('formats numbers, bytes, ranges and finds numeric columns', () => {
    expect(formatNumber(1234567)).toBe('1.2M')
    expect(formatNumber(15300)).toBe('15.3k')
    expect(formatNumber(3.14159)).toBe('3.14')
    expect(formatNumber(null)).toBe('—')
    expect(formatBytes(1177824)).toBe('1.1 MB')
    expect(rangeLabel(10800)).toBe('3h')
    expect(rangeLabel(604800)).toBe('1w')
    expect(numericField(['tabla', 'avg'], [{ tabla: 'x', avg: '1.5' }, { tabla: 'y', avg: '2' }])).toBe('avg')
  })
})

describe('MetricWidget', () => {
  let store
  beforeEach(() => {
    setActivePinia(createPinia())
    store = useAwsStore()
    store.activeProfileId = 'local:dev'
    settings.lang = 'en'
  })

  const mountMetric = widget => mount(MetricWidget, { props: { dashboard: 'D', index: 3, widget, range: RANGE } })

  it('requests the widget by dashboard and index and draws one chart per y axis', async () => {
    const spy = vi.spyOn(store, 'fetchCwWidgetMetrics').mockResolvedValue({
      period: 300, alarms: [], horizontal: [{ value: 10, label: 'SLO', yAxis: 'left' }],
      series: [
        { id: 'a', label: 'Invocations', yAxis: 'left', points: pts(1, 2) },
        { id: 'b', label: 'Duration', yAxis: 'right', color: '#2ca02c', points: pts(100, 200) },
      ],
    })
    const wrapper = mountMetric({ properties: { view: 'timeSeries' } })
    await flushPromises()
    expect(spy).toHaveBeenCalledWith('D', 3, RANGE)
    const charts = wrapper.findAll('.chart-stub')
    expect(charts.map(c => c.text())).toEqual(['Invocations|SLO', 'Duration'])
  })

  it('shows the latest value per series for singleValue widgets', async () => {
    vi.spyOn(store, 'fetchCwWidgetMetrics').mockResolvedValue({
      period: 2592000, alarms: [], horizontal: [],
      series: [{ id: 'a', label: 'Send', points: pts(12, 18) }, { id: 'b', label: 'Bounce', points: [] }],
    })
    const wrapper = mountMetric({ properties: { view: 'singleValue' } })
    await flushPromises()
    expect(wrapper.findAll('.mw-single-item').map(i => i.text())).toEqual(['Send18', 'Bounce—'])
  })

  it('draws one bar per series for bar widgets and shows alarm states', async () => {
    vi.spyOn(store, 'fetchCwWidgetMetrics').mockResolvedValue({
      period: 300, horizontal: [], alarms: [{ name: 'Queue age', state: 'ALARM' }],
      series: [{ id: 'a', label: 'Send', points: pts(18) }, { id: 'b', label: 'Delivery', points: pts(17) }],
    })
    const wrapper = mountMetric({ properties: { view: 'bar', title: 'Sends' } })
    await flushPromises()
    expect(wrapper.find('.chart-stub').attributes('data-type')).toBe('bar')
    expect(wrapper.find('.mw-alarm.alarm').text()).toBe('ALARM · Queue age')
  })

  it('explains empty ranges and offers an access request on denial', async () => {
    const spy = vi.spyOn(store, 'fetchCwWidgetMetrics').mockResolvedValue({ period: 300, alarms: [], horizontal: [], series: [{ id: 'a', label: 'x', points: [] }] })
    const wrapper = mountMetric({ properties: {} })
    await flushPromises()
    expect(wrapper.text()).toContain('No data in this range')

    spy.mockRejectedValue(Object.assign(new Error('denied'), { details: { access: { failedAction: 'cloudwatch:GetMetricData' } } }))
    await wrapper.vm.load()
    await flushPromises()
    await wrapper.find('.mw-link').trigger('click')
    expect(wrapper.emitted('request-access')[0][0].access.failedAction).toBe('cloudwatch:GetMetricData')
  })
})

describe('LogWidget', () => {
  let store
  beforeEach(() => {
    vi.useFakeTimers()
    setActivePinia(createPinia())
    store = useAwsStore()
    store.activeProfileId = 'local:dev'
    settings.lang = 'en'
  })
  afterEach(() => vi.useRealTimers())

  const mountLog = (view = 'table') => mount(LogWidget, { props: { dashboard: 'D', index: 1, widget: { properties: { view, title: 'Durations' } }, range: RANGE } })
  const complete = { status: 'Complete', fields: ['tabla', 'avg'], rows: [{ tabla: 'a', avg: '3' }, { tabla: 'b', avg: '1' }], statistics: { bytesScanned: 1177824, recordsMatched: 553 } }

  it('runs small queries automatically, polls until complete and shows bytes scanned', async () => {
    vi.spyOn(store, 'estimateCwWidgetLogs').mockResolvedValue({ estimatedBytes: 1000, estimatedCostUsd: 0, autoRun: true })
    const start = vi.spyOn(store, 'startCwWidgetLogs').mockResolvedValue({ queryId: 'q1', region: 'us-east-1' })
    const poll = vi.spyOn(store, 'fetchCwLogsQuery')
      .mockResolvedValueOnce({ status: 'Running' })
      .mockResolvedValueOnce(complete)
    const wrapper = mountLog()
    await flushPromises()
    expect(start).toHaveBeenCalledWith('D', 1, RANGE)
    await vi.advanceTimersByTimeAsync(1000)
    await vi.advanceTimersByTimeAsync(1000)
    await flushPromises()
    expect(poll).toHaveBeenCalledWith('q1', 'us-east-1')
    expect(wrapper.findAll('.lw-table tbody tr')).toHaveLength(2)
    expect(wrapper.find('.lw-foot').text()).toContain('Scanned 1.1 MB · 553 matching records')
  })

  it('asks before running a query estimated to be large', async () => {
    vi.spyOn(store, 'estimateCwWidgetLogs').mockResolvedValue({ estimatedBytes: 5 * 1024 ** 3, estimatedCostUsd: 0.025, autoRun: false })
    const start = vi.spyOn(store, 'startCwWidgetLogs').mockResolvedValue({ queryId: 'q2', region: 'us-east-1' })
    vi.spyOn(store, 'fetchCwLogsQuery').mockResolvedValue(complete)
    const wrapper = mountLog()
    await flushPromises()
    expect(start).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('This query would scan about 5.0 GB (~USD 0.03)')
    await wrapper.find('.lw-state .btn').trigger('click')
    await vi.advanceTimersByTimeAsync(1000)
    await flushPromises()
    expect(start).toHaveBeenCalled()
    expect(wrapper.find('.lw-table').exists()).toBe(true)
  })

  it('draws bar views from the text and numeric columns', async () => {
    vi.spyOn(store, 'estimateCwWidgetLogs').mockResolvedValue({ estimatedBytes: 1, autoRun: true })
    vi.spyOn(store, 'startCwWidgetLogs').mockResolvedValue({ queryId: 'q', region: 'us-east-1' })
    vi.spyOn(store, 'fetchCwLogsQuery').mockResolvedValue(complete)
    const wrapper = mountLog('bar')
    await flushPromises()
    await vi.advanceTimersByTimeAsync(1000)
    await flushPromises()
    expect(wrapper.find('.chart-stub').attributes('data-type')).toBe('bar')
    expect(wrapper.find('.chart-stub').text()).toBe('avg')
  })

  it('reports failed queries with a retry', async () => {
    vi.spyOn(store, 'estimateCwWidgetLogs').mockResolvedValue({ estimatedBytes: 1, autoRun: true })
    vi.spyOn(store, 'startCwWidgetLogs').mockResolvedValue({ queryId: 'q', region: 'us-east-1' })
    vi.spyOn(store, 'fetchCwLogsQuery').mockResolvedValue({ status: 'Failed' })
    const wrapper = mountLog()
    await flushPromises()
    await vi.advanceTimersByTimeAsync(1000)
    await flushPromises()
    expect(wrapper.find('.lw-state.error').text()).toContain('The query ended with status Failed.')
  })
})

describe('TextWidget', () => {
  it('renders markdown but never raw HTML or script links', () => {
    const wrapper = mount(TextWidget, { props: { markdown: '# Title\n\n<img src=x onerror=alert(1)>\n\n[ok](https://aws.amazon.com) [bad](javascript:alert(1)) <b>inline</b>' } })
    const html = wrapper.html()
    expect(wrapper.find('h1').text()).toBe('Title')
    expect(wrapper.find('img').exists()).toBe(false)
    expect(html).toContain('&lt;img')
    expect(wrapper.find('b').exists()).toBe(false)
    expect(wrapper.findAll('a').map(a => a.attributes('href'))).toEqual(['https://aws.amazon.com'])
    expect(wrapper.find('a').attributes('rel')).toContain('noopener')
  })
})

describe('CloudWatchDashboardView', () => {
  let store
  const DETAIL = {
    name: 'D', consoleUrl: 'https://console', defaultRangeSeconds: 604800, region: 'us-east-1',
    summary: { widgets: [{ index: 0, title: 'Invocations' }, { index: 1, title: 'Logs' }] },
    body: { widgets: [
      { type: 'metric', x: 12, y: 0, width: 12, height: 6, properties: { view: 'timeSeries', metrics: [['AWS/Lambda', 'Invocations']] } },
      { type: 'log', x: 0, y: 0, width: 12, height: 6, properties: { title: 'Logs', view: 'table', query: "SOURCE 'g' | fields @message" } },
      { type: 'gauge', x: 0, y: 6, width: 6, height: 3, properties: {} },
    ] },
  }

  beforeEach(() => {
    vi.useFakeTimers()
    setActivePinia(createPinia())
    store = useAwsStore()
    store.activeProfileId = 'local:dev'
    settings.lang = 'en'
    vi.spyOn(store, 'fetchCwDashboard').mockResolvedValue(DETAIL)
    vi.spyOn(store, 'fetchCwWidgetMetrics').mockResolvedValue({ period: 300, alarms: [], horizontal: [], series: [] })
    vi.spyOn(store, 'estimateCwWidgetLogs').mockResolvedValue({ estimatedBytes: 10 ** 12, estimatedCostUsd: 5, autoRun: false })
  })
  afterEach(() => vi.useRealTimers())

  it('lays widgets out on the 24-column grid in reading order, with fallback titles', async () => {
    const wrapper = mount(CloudWatchDashboardView, { props: { name: 'D' }, global: { stubs: { teleport: true } } })
    await flushPromises()
    const widgets = wrapper.findAll('.cwv-widget')
    expect(widgets.map(w => w.find('.cwv-widget-title').exists() ? w.find('.cwv-widget-title').text() : '')).toEqual(['Logs', 'Invocations', ''])
    expect(widgets[1].attributes('style')).toContain('grid-column: 13 / span 12')
    expect(widgets[2].text()).toContain('"gauge" widgets are shown in the AWS console.')
  })

  it('starts on the dashboard range and auto-refreshes metrics without re-running log queries', async () => {
    const wrapper = mount(CloudWatchDashboardView, { props: { name: 'D' }, global: { stubs: { teleport: true } } })
    await flushPromises()
    expect(wrapper.find('.cwv-range button.active').text()).toBe('1w')
    const metrics = store.fetchCwWidgetMetrics.mock.calls.length
    const estimates = store.estimateCwWidgetLogs.mock.calls.length
    await wrapper.find('.cwv-auto input').setValue(true)
    await vi.advanceTimersByTimeAsync(60 * 1000)
    await flushPromises()
    expect(store.fetchCwWidgetMetrics.mock.calls.length).toBe(metrics + 1)
    expect(store.estimateCwWidgetLogs.mock.calls.length).toBe(estimates)

    await wrapper.findAll('.cwv-toolbar .btn')[1].trigger('click')
    await flushPromises()
    expect(store.estimateCwWidgetLogs.mock.calls.length).toBe(estimates + 1)
  })
})
