import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))

import AwsView from '../components/cloud/AwsView.vue'
import { useAwsStore } from '../stores/useAwsStore'

// Overview itself is covered elsewhere; here it only emits open-tab.
const AwsOverview = { name: 'AwsOverview', template: '<div />', emits: ['open-tab'], methods: { load() {} } }
const fn = name => ({ name, runtime: 'nodejs20.x', memory: 128, timeout: 3, arn: `arn:aws:lambda:us-east-1:1:function:${name}`, tags: {} })
const activity = (invocations, errors) => ({ invocations, errors, logStatus: 'active' })

describe('Overview incidents open the affected resources (A08)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, headers: { get: () => 'application/json' }, json: async () => [] }))
  })
  afterEach(() => vi.unstubAllGlobals())

  async function openFromOverview(target) {
    const store = useAwsStore()
    store.activeProfileId = 'prof-1'
    const w = mount(AwsView, { props: { activeService: 'overview' }, global: { stubs: { Teleport: true, AwsOverview } } })
    await flushPromises()
    w.findComponent(AwsOverview).vm.$emit('open-tab', target)
    await flushPromises()
    store.lambdas = [fn('quiet'), fn('noisy'), fn('broken')]
    store.lambdaActivity = { functions: { quiet: activity(50, 0), noisy: activity(90, 3), broken: activity(10, 9) } }
    await flushPromises()
    return { w, store }
  }
  const names = w => w.findAll('tbody tr').map(tr => tr.find('td div').text())

  it('shows only functions with errors, worst first, until "Show all"', async () => {
    const { w } = await openFromOverview({ tab: 'lambda', incident: true })
    expect(w.emitted('navigate-tab')).toEqual([['lambda']])
    expect(w.find('[data-test="incident-filter"]').text()).toContain('functions with errors in the last 24 h: 2')
    expect(names(w)).toEqual(['broken', 'noisy'])
    await w.find('[data-test="incident-filter"] button').trigger('click')
    expect(w.find('[data-test="incident-filter"]').exists()).toBe(false)
    expect(names(w)).toHaveLength(3)
  })

  it('load balancers: the focus is current health, and the counter matches the rows (R03)', async () => {
    const store = useAwsStore()
    store.activeProfileId = 'prof-1'
    const w = mount(AwsView, { props: { activeService: 'overview' }, global: { stubs: { Teleport: true, AwsOverview } } })
    await flushPromises()
    w.findComponent(AwsOverview).vm.$emit('open-tab', { tab: 'elb', incident: true })
    await flushPromises()
    const lb = (name, status) => ({ id: name, arn: `arn:${name}`, name, type: 'application', public: false, dnsName: `${name}.elb`, listeners: [], targetGroups: [], health: { status } })
    store.loadBalancers = [lb('api', 'critical'), lb('web', 'warning'), lb('quiet', 'ok')]
    await flushPromises()
    expect(w.find('[data-test="incident-filter"]').text()).toContain('does not say which one returned the 5xx')
    expect(w.findAll('tbody tr').filter(tr => tr.text().includes('.elb'))).toHaveLength(2)
    expect(w.find('[data-test="row-count"]').text()).toBe('2 of 3')
  })

  it('a plain tab link and later navigation do not keep the filter', async () => {
    const { w } = await openFromOverview('lambda')
    expect(w.find('[data-test="incident-filter"]').exists()).toBe(false)
    expect(names(w)).toHaveLength(3)

    // Reopen focused from Overview, then navigate away from the sidebar.
    await w.setProps({ activeService: 'overview' })
    await flushPromises()
    w.findComponent(AwsOverview).vm.$emit('open-tab', { tab: 'lambda', incident: true })
    await flushPromises()
    expect(w.find('[data-test="incident-filter"]').exists()).toBe(true)
    await w.setProps({ activeService: 'ec2' })
    await flushPromises()
    expect(w.find('[data-test="incident-filter"]').exists()).toBe(false)
  })
})
