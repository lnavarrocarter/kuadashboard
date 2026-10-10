import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))

import AwsView from '../components/cloud/AwsView.vue'
import { useAwsStore } from '../stores/useAwsStore'

const AwsOverview = { name: 'AwsOverview', template: '<div />', methods: { load() {} } }
const fn = (name, runtime) => ({ name, runtime, memory: 128, timeout: 3, arn: `arn:aws:lambda:us-east-1:1:function:${name}`, tags: {} })

describe('AWS filters next to the search (A11)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, headers: { get: () => 'application/json' }, json: async () => [] }))
  })
  afterEach(() => vi.unstubAllGlobals())

  async function lambdaView() {
    const store = useAwsStore()
    store.activeProfileId = 'prof-1'
    const w = mount(AwsView, { props: { activeService: 'lambda' }, global: { stubs: { Teleport: true, AwsOverview } } })
    await flushPromises()
    store.lambdas = [fn('a', 'nodejs20.x'), fn('b', 'nodejs20.x'), fn('c', 'python3.12'), fn('d', 'python3.12')]
    store.lambdaActivity = { functions: {
      a: { invocations: 10, errors: 2, logStatus: 'ok' },
      b: { invocations: 5, errors: 0, logStatus: 'ok' },
      c: { invocations: 0, errors: 0, logStatus: 'ok' },
      // d: activity unknown, never matches an activity filter
    } }
    await flushPromises()
    return w
  }
  const names = w => w.findAll('tbody tr').map(tr => tr.find('td div').text())
  const options = select => select.findAll('option').map(o => o.text())

  it('offers runtime and 24 h activity filters with counts', async () => {
    const w = await lambdaView()
    expect(options(w.find('[data-test="facet-runtime"]'))).toEqual(['Runtime: all', 'nodejs20.x (2)', 'python3.12 (2)'])
    expect(options(w.find('[data-test="facet-activity"]'))).toEqual(['Activity (24 h): all', 'With errors (1)', 'Active, no errors (1)', 'No activity (1)'])
    expect(w.find('[data-test="facet-runtime"]').attributes('aria-label')).toBe('Runtime')
  })

  it('combines filters with the search, counts "n of total" and clears everything', async () => {
    const w = await lambdaView()
    await w.find('[data-test="facet-runtime"]').setValue('python3.12')
    expect(names(w)).toEqual(['c', 'd'])
    expect(w.find('[data-test="row-count"]').text()).toBe('2 of 4')
    await w.find('[data-test="facet-activity"]').setValue('idle')
    expect(names(w)).toEqual(['c'])
    await w.find('.aws-search').setValue('zzz')
    expect(w.find('[data-test="empty-lambda"]').text()).toContain('No matches')

    await w.find('[data-test="empty-lambda"] button').trigger('click')
    expect(names(w)).toEqual(['a', 'b', 'c', 'd'])
    expect(w.find('.aws-search').element.value).toBe('')
    expect(w.find('[data-test="clear-filters"]').exists()).toBe(false)
    expect(w.find('[data-test="row-count"]').text()).toBe('4 result(s)')
  })

  it('filters EC2 by state and S3 by region; other tabs have no filters', async () => {
    const store = useAwsStore()
    store.activeProfileId = 'prof-1'
    const w = mount(AwsView, { props: { activeService: 'ec2' }, global: { stubs: { Teleport: true, AwsOverview } } })
    await flushPromises()
    store.ec2Instances = [
      { id: 'i-1', name: 'web', state: 'running', tags: [] },
      { id: 'i-2', name: 'batch', state: 'stopped', tags: [] },
    ]
    await flushPromises()
    await w.find('[data-test="facet-state"]').setValue('stopped')
    expect(w.findAll('tbody tr')).toHaveLength(1)
    expect(w.find('tbody tr').text()).toContain('batch')

    await w.setProps({ activeService: 'vpc' })
    await flushPromises()
    expect(w.findAll('.aws-facet')).toHaveLength(0)
  })
})
