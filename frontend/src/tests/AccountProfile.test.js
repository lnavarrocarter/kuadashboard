import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))

const PLANS = {
  free: { plan: 'free', features: { advisor: false, logAutoRefresh: false, teamSharing: false }, limits: { logCacheMaxMb: 256, logRefreshMinMinutes: null } },
  pro: { plan: 'pro', features: { advisor: true, logAutoRefresh: true, teamSharing: false }, limits: { logCacheMaxMb: 2048, logRefreshMinMinutes: 15 } },
  team: { plan: 'team', features: { advisor: true, logAutoRefresh: true, teamSharing: true }, limits: { logCacheMaxMb: 20480, logRefreshMinMinutes: 1 } },
}

function stub(plan = 'pro') {
  const calls = []
  vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
    calls.push({ url, method: options.method || 'GET', body: options.body })
    let body = {}
    if (url === '/api/system/plan') body = { ...PLANS[plan], source: 'env', plans: PLANS, refreshChoices: [1, 5, 15, 30, 60] }
    else if (url === '/api/system/ml') body = { enabled: false, state: 'disabled', downloaded: false, downloadBytes: 136314880, diskBytes: 0 }
    else if (url === '/api/system/ml/enable') body = { enabled: true, state: 'loading', downloaded: false, diskBytes: 0 }
    else if (url.startsWith('/api/system/usage')) body = { totals: { month: { usd: 0.0315, calls: 3 } } }
    else if (url.startsWith('/api/system/log-cache-budget')) body = { mb: 256, bytes: 256 * 1048576, source: 'default', maxMb: 2048, plan, choices: [{ mb: 256, allowed: true, plan: 'free' }], usage: { bytes: 0, budgetBytes: 256 * 1048576 } }
    return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => body }
  }))
  return calls
}

async function load(path) {
  vi.resetModules()
  const { settings } = await import('../composables/useSettings')
  settings.lang = 'en'
  return (await import(path)).default
}

describe('AccountProfile', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('shows the plan, the plan comparison, local ML and the spend of the month', async () => {
    const calls = stub('pro')
    const AccountProfile = await load('../components/account/AccountProfile.vue')
    const wrapper = mount(AccountProfile)
    await flushPromises()
    expect(wrapper.get('[data-test="account-plan-name"]').text()).toBe('Pro')
    const table = wrapper.get('[data-test="account-plans"]')
    expect(table.findAll('th.current').map(th => th.text())).toEqual(['Pro'])
    const advisorRow = table.findAll('tr').find(row => row.text().startsWith('Advisor'))
    expect(advisorRow.findAll('td').slice(1).map(td => td.text())).toEqual(['—', '✓', '✓'])
    expect(table.text()).toContain('every 15 min')
    expect(wrapper.get('[data-test="account-sign-in"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-test="account-usage"]').text()).toContain('USD 0.03 this month in 3 billed calls')
    expect(wrapper.find('[data-test="log-cache-budget"]').exists()).toBe(true)

    await wrapper.get('[data-test="account-ml-enable"]').trigger('click')
    await flushPromises()
    expect(calls.some(c => c.url === '/api/system/ml/enable' && c.method === 'POST')).toBe(true)
  })
})

describe('AdvisorPanel on the Free plan', () => {
  beforeEach(() => { try { localStorage.clear() } catch { /* jsdom */ } })
  afterEach(() => vi.unstubAllGlobals())

  it('shows the counts behind a lock and opens the plans', async () => {
    stub('free')
    const AdvisorPanel = await load('../components/advisor/AdvisorPanel.vue')
    const report = {
      locked: true, required: 'pro', generatedAt: 'x', categories: ['security', 'infrastructure'],
      summary: { security: { high: 1, medium: 0, low: 0, findings: 1, passed: 3, checks: 4 }, infrastructure: { high: 0, medium: 1, low: 1, findings: 2, passed: 0, checks: 2 } },
      totals: { findings: 3, high: 1, medium: 1, low: 1 }, findings: [], unavailable: [],
    }
    const opened = vi.fn()
    window.addEventListener('kua:open-help', opened)
    const wrapper = mount(AdvisorPanel, { props: { report } })
    await flushPromises()
    const locked = wrapper.get('[data-test="advisor-locked"]')
    expect(locked.text()).toContain('The Advisor is part of the Pro plan')
    expect(locked.text()).toContain('3 recommendation(s): 1 high, 1 medium and 1 low')
    expect(wrapper.find('.adv-list').exists()).toBe(false)
    expect(wrapper.find('[data-test="agent-brief"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('3/6 checks pass')
    await wrapper.get('[data-test="advisor-see-plans"]').trigger('click')
    expect(opened).toHaveBeenCalledTimes(1)
    expect(opened.mock.calls[0][0].detail).toEqual({ tab: 'account' })
    window.removeEventListener('kua:open-help', opened)
  })
})

describe('HelpModal', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('opens on the Account tab when asked', async () => {
    stub('team')
    const HelpModal = await load('../components/modals/HelpModal.vue')
    const { createPinia } = await import('pinia')
    const wrapper = mount(HelpModal, { props: { show: false, initialTab: 'account' }, attachTo: document.body, global: { plugins: [createPinia()] } })
    await wrapper.setProps({ show: true })
    await flushPromises()
    expect(document.querySelector('[data-test="account-profile"]')).not.toBeNull()
    wrapper.unmount()
  })
})
