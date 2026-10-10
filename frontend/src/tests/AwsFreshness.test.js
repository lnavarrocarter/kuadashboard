import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))

import AwsView from '../components/cloud/AwsView.vue'
import AwsOverviewInsights from '../components/cloud/AwsOverviewInsights.vue'
import AdvisorPanel from '../components/advisor/AdvisorPanel.vue'
import { useAwsStore } from '../stores/useAwsStore'
import { settings } from '../composables/useSettings'

const AwsOverview = { name: 'AwsOverview', template: '<div />', methods: { load() {} } }

describe('freshness of each block (A13)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    settings.lang = 'en'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, headers: { get: () => 'application/json' }, json: async () => [] }))
  })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

  it('service tabs say when their list was read, and keep counting', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'Date'] })
    const store = useAwsStore()
    store.activeProfileId = 'prof-1'
    const w = mount(AwsView, { props: { activeService: 'ec2' }, global: { stubs: { Teleport: true, AwsOverview } } })
    await flushPromises()
    expect(w.find('[data-test="read-at"]').text()).toBe('· read just now')
    expect(w.find('[data-test="read-at"]').attributes('title')).toContain('refresh button reads AWS again')
    vi.advanceTimersByTime(5 * 60 * 1000)
    await flushPromises()
    expect(w.find('[data-test="read-at"]').text()).toBe('· read 5 min ago')
  })

  it('activity states its window and when it was read', () => {
    const now = Date.parse('2026-10-10T12:00:00Z')
    const w = mount(AwsOverviewInsights, {
      props: { section: 'summary', now, insights: { generatedAt: new Date(now - 3 * 3600000).toISOString(), costs: { status: 'unavailable' }, usage: {} } },
      global: { stubs: { teleport: true } },
    })
    expect(w.find('[data-test="activity-freshness"]').text()).toBe('· last 24 h · read 3h ago')
  })

  it('the Advisor says when it analysed', () => {
    const w = mount(AdvisorPanel, { props: { report: { generatedAt: '2026-10-10T12:00:00Z', categories: [], summary: {}, findings: [] } } })
    expect(w.find('.adv-foot.adv-dim').text()).toMatch(/^Analysed \d{1,2}\/\d{1,2}\/\d{2}/)
  })

  it('the Overview refresh says what it reads again, what bills and that costs keep their cache', () => {
    const source = readFileSync(resolve(__dirname, '../components/cloud/AwsOverview.vue'), 'utf8')
    expect(source).toContain(":title=\"t('awsFresh.overviewRefreshHint')\"")
  })
})
