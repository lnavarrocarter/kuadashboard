import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import * as ApiModule from '../composables/useApi'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))

import VercelView from '../components/cloud/VercelView.vue'
import { useVercelStore } from '../stores/useVercelStore'
import { settings } from '../composables/useSettings'

const row = (id, name, extra = {}) => ({ id, name, framework: null, nodeVersion: null, paused: false, git: 'acme/x', production: { state: 'READY' }, lastDeployAt: 1, inactive: false, recent: { finished: 1, failed: 0 }, domains: 0, unverifiedDomains: 0, ...extra })

const OVERVIEW = {
  health: 'degraded',
  projects: { total: 2, paused: 0, withGit: 2, frameworks: [] },
  production: { healthy: 1, failed: 0, failedInactive: 1, building: 0, none: 0 },
  deployments: {
    total: 12, ready: 8, error: 4, building: 0, canceled: 0, lastAt: 1, failureRate: 33,
    windows: { '24h': { finished: 1, failed: 0, failureRate: 0 }, '7d': { finished: 3, failed: 1, failureRate: 33 }, '30d': { finished: 5, failed: 1, failureRate: 20 } },
  },
  domains: { total: 0, unverified: 0 },
  env: { total: 0, byType: {} },
  rows: [row('a', 'shop'), row('b', 'legacy', { inactive: true, production: { state: 'ERROR' }, recent: { finished: 4, failed: 4 } })],
}

describe('Vercel overview: activity windows and inactive projects', () => {
  beforeEach(() => {
    settings.lang = 'en'
    setActivePinia(createPinia())
    localStorage.clear()
    const apiFetch = vi.fn(async path => (path.includes('/overview') ? { ...OVERVIEW } : []))
    vi.spyOn(ApiModule, 'useApi').mockReturnValue({ apiFetch })
    useVercelStore().setActiveProfile('profile-1')
  })
  afterEach(() => vi.restoreAllMocks())

  async function mountOverview() {
    const store = useVercelStore()
    const view = mount(VercelView, { props: { activeService: 'overview' }, global: { stubs: { Teleport: true, AdvisorPanel: true, ApmObservabilityView: true } } })
    await flushPromises()
    store.overview = { ...OVERVIEW }
    await flushPromises()
    return view
  }

  it('rates failures over the last 30 days and shows 24 h and 7 days', async () => {
    const view = await mountOverview()
    const metric = view.find('[data-test="vercel-failure-rate"]')
    expect(metric.text()).toContain('Failure rate · 30 days')
    expect(metric.text()).toContain('20%')
    expect(metric.text()).toContain('24 h: 0 of 1 · 7 days: 1 of 3')
    expect(view.find('[data-test="vercel-failed-inactive"]').text()).toContain('1 more failed')
  })

  it('tags inactive projects and can hide them', async () => {
    const view = await mountOverview()
    expect(view.findAll('[data-test="vercel-inactive"]')).toHaveLength(1)
    expect(view.text()).toContain('legacy')
    await view.find('[data-test="vercel-hide-inactive"]').setValue(true)
    expect(view.text()).not.toContain('legacy')
    expect(view.text()).toContain('shop')
  })
})

describe('Vercel deployment actions show their destination', () => {
  beforeEach(() => {
    settings.lang = 'en'
    setActivePinia(createPinia())
    localStorage.clear()
    vi.spyOn(ApiModule, 'useApi').mockReturnValue({ apiFetch: vi.fn(async () => []) })
  })
  afterEach(() => vi.restoreAllMocks())

  it('promote names profile, project, deployment and warns that production changes', async () => {
    const store = useVercelStore()
    store.setActiveProfile('profile-1')
    const view = mount(VercelView, { props: { activeService: 'deployments' }, global: { stubs: { Teleport: true, AdvisorPanel: true, ApmObservabilityView: true } } })
    await flushPromises()
    store.selectedProject = { id: 'prj_1', name: 'shop' }
    await flushPromises()   // the project change reloads its deployments (mocked empty)
    store.loading = false
    store.deployments = [{ id: 'dpl_1', uid: 'dpl_1', url: 'shop-abc.vercel.app', state: 'READY', target: null, createdAt: 1 }]
    await flushPromises()
    await view.findAll('button').find(b => b.text() === 'Promote to Prod').trigger('click')
    const destination = view.get('[data-test="vercel-destination"]').text()
    expect(destination).toContain('Projectshop')
    expect(destination).toContain('Deploymentshop-abc.vercel.app')
    expect(destination).toContain('Targetproduction')
    expect(view.text()).toContain('This changes what production serves')

    store.setActiveProfile('profile-2')
    await flushPromises()
    expect(view.find('[data-test="vercel-destination"]').exists()).toBe(false)
  })
})
