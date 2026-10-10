import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))

import AwsView from '../components/cloud/AwsView.vue'
import { useAwsStore } from '../stores/useAwsStore'

const fn = (name, tags) => ({ name, runtime: 'nodejs20.x', memory: 128, timeout: 3, arn: `arn:aws:lambda:us-east-1:1:function:${name}`, tags })

describe('AwsView Lambda table (A05)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, headers: { get: () => 'application/json' }, json: async () => [] }))
  })
  afterEach(() => vi.unstubAllGlobals())

  it('has no State column (ListFunctions does not return it) and tells unread tags from no tags', async () => {
    const store = useAwsStore()
    store.activeProfileId = 'prof-1'
    const w = mount(AwsView, { props: { activeService: 'lambda' }, global: { stubs: { Teleport: true } } })
    await flushPromises()
    store.lambdas = [fn('tagged', { team: 'shop' }), fn('plain', {}), fn('unknown', null)]
    await flushPromises()

    const headers = w.findAll('.tab-panel table thead th').map(th => th.text())
    expect(headers.some(h => h.startsWith('State'))).toBe(false)
    expect(headers.some(h => h.startsWith('Log group'))).toBe(true)
    const row = w.find('tbody tr')
    expect(row.find('.row-actions').findAll(':scope > button').map(b => b.text())).toEqual(['Details', 'View logs'])
    await row.find('[aria-haspopup="menu"]').trigger('click')
    await flushPromises()
    expect(row.findAll('[role="menuitem"]').map(b => b.text())).toEqual(['Tags', 'Config', 'Configure logging', 'Invoke…'])

    const tags = Object.fromEntries(w.findAll('tbody tr').map(tr => [tr.find('td').text(), tr.find('[data-test="lambda-tags"]')]))
    expect(tags.tagged.text()).toBe('team=shop')
    expect(tags.plain.text()).toBe('—')
    expect(tags.unknown.text()).toBe('Not read')
    expect(tags.unknown.find('span').attributes('title')).toContain('tag:GetResources')
  })
})
