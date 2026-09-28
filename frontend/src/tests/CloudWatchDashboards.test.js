import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))

import CloudWatchDashboardDetail from '../components/cloud/CloudWatchDashboardDetail.vue'
import { useAwsStore } from '../stores/useAwsStore'
import { settings } from '../composables/useSettings'

const DETAIL = {
  name: 'AutoAtencion',
  arn: 'arn:aws:cloudwatch::1:dashboard/AutoAtencion',
  consoleUrl: 'https://us-east-1.console.aws.amazon.com/cloudwatch/home?region=us-east-1#dashboards/dashboard/AutoAtencion',
  body: { widgets: [{ type: 'metric' }] },
  rawBody: null,
  summary: {
    valid: true,
    counts: { metric: 1, log: 1, alarm: 1 },
    regions: ['us-east-1'],
    metricCount: 3,
    widgets: [
      { type: 'metric', title: 'Invocations', view: 'timeSeries', region: 'us-east-1', metrics: 3, namespaces: ['AWS/Lambda'], expressions: 1 },
      { type: 'log', title: 'Errors', view: 'table', region: 'us-east-1', logGroups: ['/aws/lambda/a', '/aws/lambda/b'] },
      { type: 'alarm', title: null, view: null, region: 'us-east-1', alarms: 2 },
    ],
  },
}

function mountDetail(props = {}) {
  return mount(CloudWatchDashboardDetail, { props: { show: true, name: 'AutoAtencion', ...props }, global: { stubs: { teleport: true } } })
}

describe('CloudWatchDashboardDetail', () => {
  let store

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useAwsStore()
    store.activeProfileId = 'local:dev'
    settings.lang = 'en'
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue() } })
  })

  it('loads the dashboard when opened and summarizes its widgets', async () => {
    const spy = vi.spyOn(store, 'fetchCwDashboard').mockResolvedValue(DETAIL)
    const wrapper = mountDetail()
    await flushPromises()
    expect(spy).toHaveBeenCalledWith('AutoAtencion')
    expect(wrapper.find('.cwd-stats').text()).toContain('3 widgets')
    expect(wrapper.findAll('.cwd-chip').map(c => c.text())).toEqual(['Metrics · 1', 'Logs · 1', 'Alarms · 1', 'us-east-1'])
    const rows = wrapper.findAll('.cwd-table tbody tr')
    expect(rows[0].text()).toContain('3 metric(s) AWS/Lambda · 1 expression(s)')
    expect(rows[1].find('.cwd-shows').text()).toBe('/aws/lambda/a, /aws/lambda/b')
    expect(rows[2].find('.cwd-shows').text()).toBe('2 alarm(s)')
  })

  it('links to the dashboard in the AWS console', async () => {
    vi.spyOn(store, 'fetchCwDashboard').mockResolvedValue(DETAIL)
    const wrapper = mountDetail()
    await flushPromises()
    const link = wrapper.find('a.cwd-open')
    expect(link.attributes('href')).toBe(DETAIL.consoleUrl)
    expect(link.attributes('target')).toBe('_blank')
    expect(link.attributes('rel')).toContain('noopener')
  })

  it('shows and copies the JSON definition on demand', async () => {
    vi.spyOn(store, 'fetchCwDashboard').mockResolvedValue(DETAIL)
    const wrapper = mountDetail()
    await flushPromises()
    expect(wrapper.find('.cwd-pre').exists()).toBe(false)
    await wrapper.find('.cwd-link').trigger('click')
    expect(JSON.parse(wrapper.find('.cwd-pre').text())).toEqual(DETAIL.body)
    await wrapper.find('.cwd-json-head .btn').trigger('click')
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(JSON.stringify(DETAIL.body, null, 2))
  })

  it('shows the error when the dashboard cannot be read', async () => {
    vi.spyOn(store, 'fetchCwDashboard').mockRejectedValue(new Error('not authorized to perform: cloudwatch:GetDashboard'))
    const wrapper = mountDetail()
    await flushPromises()
    expect(wrapper.find('.cwd-error').text()).toContain('cloudwatch:GetDashboard')
  })

  it('does not load while closed and reloads for another dashboard', async () => {
    const spy = vi.spyOn(store, 'fetchCwDashboard').mockResolvedValue(DETAIL)
    const wrapper = mountDetail({ show: false })
    await flushPromises()
    expect(spy).not.toHaveBeenCalled()
    await wrapper.setProps({ show: true })
    await wrapper.setProps({ name: 'Other' })
    await flushPromises()
    expect(spy.mock.calls.map(c => c[0])).toEqual(['AutoAtencion', 'Other'])
  })

  it('renders in Spanish', async () => {
    settings.lang = 'es'
    try {
      vi.spyOn(store, 'fetchCwDashboard').mockResolvedValue(DETAIL)
      const wrapper = mountDetail()
      await flushPromises()
      expect(wrapper.find('a.cwd-open').text()).toBe('Abrir en la consola de AWS')
      expect(wrapper.find('.cwd-table th').text()).toBe('Tipo')
    } finally {
      settings.lang = 'en'
    }
  })
})

describe('useAwsStore CloudWatch dashboards', () => {
  it('lists dashboards and fetches one by encoded name', async () => {
    setActivePinia(createPinia())
    const store = useAwsStore()
    store.activeProfileId = 'local:dev'
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, headers: { get: () => 'application/json' }, json: async () => [{ name: 'A' }] })
    await store.fetchCwDashboards()
    await store.fetchCwDashboard('Ops Board')
    expect(fetch.mock.calls.map(c => c[0])).toEqual(['/api/cloud/aws/cloudwatch/dashboards', '/api/cloud/aws/cloudwatch/dashboards/Ops%20Board'])
    expect(store.cwDashboards).toEqual([{ name: 'A' }])
    store.setActiveProfile('local:prod')
    expect(store.cwDashboards).toEqual([])
  })
})
