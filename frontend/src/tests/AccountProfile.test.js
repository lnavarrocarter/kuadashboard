import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))

const PLANS = {
  free: { plan: 'free', features: { advisor: false, logAutoRefresh: false, teamSharing: false }, limits: { logCacheMaxMb: 256, logRefreshMinMinutes: null } },
  pro: { plan: 'pro', features: { advisor: true, logAutoRefresh: true, teamSharing: false }, limits: { logCacheMaxMb: 2048, logRefreshMinMinutes: 15 } },
  team: { plan: 'team', features: { advisor: true, logAutoRefresh: true, teamSharing: true }, limits: { logCacheMaxMb: 20480, logRefreshMinMinutes: 1 } },
}

let account = { linked: false, plan: 'free' }

function stub(plan = 'pro') {
  const calls = []
  vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
    calls.push({ url, method: options.method || 'GET', body: options.body })
    let body = {}
    if (url === '/api/system/plan') body = { ...PLANS[plan], source: 'env', plans: PLANS, refreshChoices: [1, 5, 15, 30, 60] }
    else if (url === '/api/system/ml') body = { enabled: false, state: 'disabled', downloaded: false, downloadBytes: 136314880, diskBytes: 0 }
    else if (url === '/api/system/ml/enable') body = { enabled: true, state: 'loading', downloaded: false, diskBytes: 0 }
    else if (url.startsWith('/api/system/usage')) body = { totals: { month: { usd: 0.0315, calls: 3 } } }
    else if (url === '/api/account') body = account
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
    expect(wrapper.get('[data-test="account-sign-in"]').attributes('disabled')).toBeUndefined()
    expect(wrapper.get('[data-test="account-usage"]').text()).toContain('USD 0.03 this month in 3 billed calls')
    expect(wrapper.find('[data-test="log-cache-budget"]').exists()).toBe(true)

    await wrapper.get('[data-test="account-ml-enable"]').trigger('click')
    await flushPromises()
    expect(calls.some(c => c.url === '/api/system/ml/enable' && c.method === 'POST')).toBe(true)
  })
})

describe('AccountProfile spend tracking', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('is optional: it can be turned off (deleting the history) and on again', async () => {
    let enabled = true
    const calls = []
    vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
      calls.push({ url, method: options.method || 'GET', body: options.body })
      let body = {}
      if (url === '/api/system/usage/disable') { enabled = false; body = { enabled } }
      else if (url === '/api/system/usage/enable') { enabled = true; body = { enabled } }
      else if (url.startsWith('/api/system/usage')) body = enabled ? { enabled, totals: { month: { usd: 0.0315, calls: 3 } } } : { enabled }
      else if (url === '/api/system/plan') body = { ...PLANS.free, source: 'default', plans: PLANS, refreshChoices: [] }
      return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => body }
    }))
    const AccountProfile = await load('../components/account/AccountProfile.vue')
    const wrapper = mount(AccountProfile)
    await flushPromises()
    expect(wrapper.get('[data-test="account-usage-text"]').text()).toContain('USD 0.03 this month')

    await wrapper.get('[data-test="account-usage-clear"]').trigger('click')
    await flushPromises()
    expect(calls.find(c => c.url === '/api/system/usage/disable').body).toBe(JSON.stringify({ clear: true }))
    expect(wrapper.get('[data-test="account-usage-text"]').text()).toContain('Off')

    await wrapper.get('[data-test="account-usage-enable"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-test="account-usage-text"]').text()).toContain('USD 0.03 this month')
  })
})

describe('AccountProfile sign-in', () => {
  afterEach(() => { vi.unstubAllGlobals(); account = { linked: false, plan: 'free' } })

  it('shows the linked account even after Lucide replaced the icons (as in the app)', async () => {
    stub('free')
    const AccountProfile = await load('../components/account/AccountProfile.vue')
    const lucide = await import('lucide')
    lucide.createIcons.mockImplementation(() => document.querySelectorAll('i[data-lucide]').forEach(el => el.replaceWith(document.createElementNS('http://www.w3.org/2000/svg', 'svg'))))
    const wrapper = mount(AccountProfile, { attachTo: document.body })
    await flushPromises()
    expect(wrapper.get('[data-test="account-card"]').text()).toContain('Not linked')

    // The sign-in finished in the browser; the user comes back to KUA.
    account = { linked: true, plan: 'free', user: { email: 'ana@example.com', name: 'Ana', picture: 'https://example.com/a.png' } }
    window.dispatchEvent(new Event('focus'))
    await flushPromises()
    const card = wrapper.get('[data-test="account-card"]')
    expect(card.get('[data-test="account-user"]').text()).toContain('ana@example.com')
    expect(card.find('img.acp-avatar').exists()).toBe(true)
    expect(card.find('[data-test="account-sign-out"]').exists()).toBe(true)
    wrapper.unmount()
    lucide.createIcons.mockReset()
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

describe('AccountProfile sign-in and billing', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

  function stubAccount() {
    const state = { linked: false, plan: null, calls: [] }
    const status = () => ({ linked: state.linked, user: state.linked ? { email: 'ana@example.com', name: 'Ana', picture: null } : null, plan: state.plan, stale: false })
    vi.stubGlobal('open', vi.fn())
    vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
      const method = options.method || 'GET'
      state.calls.push({ url, method, body: options.body })
      let body = {}
      if (url === '/api/system/plan') body = { ...PLANS[state.plan || 'free'], source: state.linked ? 'account' : 'default', plans: PLANS, refreshChoices: [1, 5, 15, 30, 60] }
      else if (url === '/api/account' || url === '/api/account/refresh' || url === '/api/account/logout') {
        if (url === '/api/account/logout') { state.linked = false; state.plan = null }
        body = status()
      } else if (url === '/api/account/login') body = { url: 'https://cp.example/auth/desktop/start?state=s' }
      else if (url === '/api/account/checkout') body = { url: 'https://polar.example/checkout' }
      else if (url === '/api/account/portal') body = { url: 'https://polar.example/portal' }
      else if (url === '/api/system/ml') body = { enabled: false, downloaded: false, downloadBytes: 1 }
      else if (url.startsWith('/api/system/usage')) body = { totals: { month: { usd: 0, calls: 0 } } }
      else if (url.startsWith('/api/system/log-cache-budget')) body = { mb: 256, bytes: 1, source: 'default', maxMb: 256, plan: 'free', choices: [], usage: { bytes: 0, budgetBytes: 1 } }
      return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => body }
    }))
    return state
  }

  it('signs in through the browser and shows the linked account', async () => {
    vi.useFakeTimers()
    const state = stubAccount()
    const AccountProfile = await load('../components/account/AccountProfile.vue')
    const wrapper = mount(AccountProfile)
    await flushPromises()
    await wrapper.get('[data-test="account-sign-in"]').trigger('click')
    await flushPromises()
    expect(window.open).toHaveBeenCalledWith('https://cp.example/auth/desktop/start?state=s', '_blank', 'noopener')
    expect(wrapper.find('[data-test="account-waiting"]').exists()).toBe(true)

    state.linked = true // the browser step finished
    state.plan = 'free'
    await vi.advanceTimersByTimeAsync(2100)
    await flushPromises()
    expect(wrapper.get('[data-test="account-user"]').text()).toContain('ana@example.com')
    expect(wrapper.find('[data-test="account-waiting"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="account-upgrade-pro"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="account-portal"]').exists()).toBe(false)
  })

  it('opens the checkout and waits for the payment before showing the new plan', async () => {
    vi.useFakeTimers()
    const state = stubAccount()
    state.linked = true
    state.plan = 'free'
    const AccountProfile = await load('../components/account/AccountProfile.vue')
    const wrapper = mount(AccountProfile)
    await flushPromises()
    await wrapper.findAll('.acp-interval button')[1].trigger('click') // yearly
    expect(wrapper.get('[data-test="account-upgrade-team"]').text()).toContain('USD 290/year')
    await wrapper.get('[data-test="account-upgrade-pro"]').trigger('click')
    await flushPromises()
    expect(JSON.parse(state.calls.find(c => c.url === '/api/account/checkout').body)).toEqual({ plan: 'pro', interval: 'year' })
    expect(window.open).toHaveBeenCalledWith('https://polar.example/checkout', '_blank', 'noopener')
    expect(wrapper.find('[data-test="account-waiting-payment"]').exists()).toBe(true)

    await vi.advanceTimersByTimeAsync(5100)
    await flushPromises()
    expect(wrapper.find('[data-test="account-waiting-payment"]').exists()).toBe(true) // not confirmed yet

    state.plan = 'pro' // the billing webhook confirmed it
    await vi.advanceTimersByTimeAsync(5100)
    await flushPromises()
    expect(wrapper.find('[data-test="account-waiting-payment"]').exists()).toBe(false)
    expect(wrapper.get('[data-test="account-plan-name"]').text()).toBe('Pro')
    expect(wrapper.find('[data-test="account-upgrade-pro"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="account-upgrade-team"]').exists()).toBe(true)

    await wrapper.get('[data-test="account-portal"]').trigger('click')
    await flushPromises()
    expect(window.open).toHaveBeenLastCalledWith('https://polar.example/portal', '_blank', 'noopener')

    await wrapper.get('[data-test="account-sign-out"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-test="account-sign-in"]').exists()).toBe(true)
  })
})

describe('AccountProfile when returning from the browser', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('reads the account and the plan again when KUA gets the focus back', async () => {
    let linked = false
    const calls = []
    vi.stubGlobal('fetch', vi.fn(async url => {
      calls.push(url)
      let body = {}
      if (url === '/api/system/plan') body = { ...PLANS[linked ? 'pro' : 'free'], source: linked ? 'account' : 'default', plans: PLANS, refreshChoices: [1, 5, 15, 30, 60] }
      else if (url === '/api/account') body = { linked, user: linked ? { email: 'ana@example.com', name: 'Ana' } : null, plan: linked ? 'pro' : null, stale: false }
      else if (url === '/api/system/ml') body = { enabled: false, downloaded: false, downloadBytes: 1 }
      else if (url.startsWith('/api/system/usage')) body = { totals: { month: { usd: 0, calls: 0 } } }
      else if (url.startsWith('/api/system/log-cache-budget')) body = { mb: 256, bytes: 1, source: 'default', maxMb: 256, plan: 'free', choices: [], usage: { bytes: 0, budgetBytes: 1 } }
      return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => body }
    }))
    const AccountProfile = await load('../components/account/AccountProfile.vue')
    const wrapper = mount(AccountProfile)
    await flushPromises()
    expect(wrapper.find('[data-test="account-sign-in"]').exists()).toBe(true)

    linked = true // signed in in the browser while no polling ran
    window.dispatchEvent(new Event('focus'))
    await flushPromises()
    expect(wrapper.get('[data-test="account-user"]').text()).toContain('ana@example.com')
    expect(wrapper.get('[data-test="account-plan-name"]').text()).toBe('Pro')
    expect(calls.filter(url => url === '/api/system/plan').length).toBeGreaterThan(1)
    wrapper.unmount()
  })
})
