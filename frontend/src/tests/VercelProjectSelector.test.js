import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import * as ApiModule from '../composables/useApi'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))

import VercelProjectSelector from '../components/cloud/VercelProjectSelector.vue'
import VercelView from '../components/cloud/VercelView.vue'
import { useVercelStore } from '../stores/useVercelStore'

const PROJECTS = {
  'profile-1': [{ id: 'p-b', name: 'beta' }, { id: 'p-a', name: 'alpha' }],
  'profile-2': [{ id: 'p-z', name: 'zeta' }],
}

// Routes API calls by path; `hold` lets a test control when a response arrives.
function mockApi({ hold = false } = {}) {
  const calls = []
  const pending = []
  const apiFetch = vi.fn((path, opts = {}) => {
    const profile = opts.headers?.['X-Profile-Id']
    calls.push({ path, profile })
    let body = []
    if (path === '/api/cloud/vercel/projects') body = PROJECTS[profile] || []
    else if (path.includes('/deployments')) body = [{ uid: `dep-${path.split('/')[5]}`, url: 'x.vercel.app', state: 'READY' }]
    if (!hold) return Promise.resolve(body)
    return new Promise(resolve => pending.push({ path, profile, resolve: () => resolve(body) }))
  })
  vi.spyOn(ApiModule, 'useApi').mockReturnValue({ apiFetch })
  return { calls, pending, apiFetch }
}

describe('useVercelStore — Profile → Project cascade (#76)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('changing profile clears the project and reloads that profile\'s projects', async () => {
    const api = mockApi()
    const store = useVercelStore()
    store.setActiveProfile('profile-1')
    await store.fetchProjects()
    store.selectProjectById('p-a')
    expect(store.selectedProject.name).toBe('alpha')

    store.setActiveProfile('profile-2')
    expect(store.selectedProject).toBeNull()
    expect(store.projects).toEqual([])
    await store.fetchProjects()
    expect(store.projects.map(p => p.id)).toEqual(['p-z'])
    expect(api.calls.at(-1)).toEqual({ path: '/api/cloud/vercel/projects', profile: 'profile-2' })
  })

  it('ignores a project list that arrives after the profile changed', async () => {
    const api = mockApi({ hold: true })
    const store = useVercelStore()
    store.setActiveProfile('profile-1')
    const first = store.fetchProjects()
    store.setActiveProfile('profile-2')
    const second = store.fetchProjects()

    api.pending.find(p => p.profile === 'profile-2').resolve()
    await second
    api.pending.find(p => p.profile === 'profile-1').resolve()
    await first

    expect(store.projects.map(p => p.id)).toEqual(['p-z'])
    expect(store.projectsLoading).toBe(false)
  })

  it('dedupes concurrent project loads for the same profile (header + view)', async () => {
    const api = mockApi()
    const store = useVercelStore()
    store.setActiveProfile('profile-1')
    await Promise.all([store.fetchProjects(), store.fetchProjects()])
    expect(api.calls.filter(c => c.path === '/api/cloud/vercel/projects')).toHaveLength(1)
  })

  it('remembers the last project per profile and restores it after reloading', async () => {
    mockApi()
    const store = useVercelStore()
    store.setActiveProfile('profile-1')
    await store.fetchProjects()
    store.selectProjectById('p-b')

    store.setActiveProfile('profile-2')
    await store.fetchProjects()
    expect(store.selectedProject).toBeNull()

    store.setActiveProfile('profile-1')
    await store.fetchProjects()
    expect(store.selectedProject?.id).toBe('p-b')
  })

  it('drops the selection when the project no longer exists', async () => {
    mockApi()
    const store = useVercelStore()
    store.setActiveProfile('profile-1')
    store.selectProject({ id: 'gone', name: 'deleted' })
    await store.fetchProjects()
    expect(store.selectedProject).toBeNull()
  })

  it('selectProjectById("") clears the project context', async () => {
    mockApi()
    const store = useVercelStore()
    store.setActiveProfile('profile-1')
    await store.fetchProjects()
    store.selectProjectById('p-a')
    store.selectProjectById('')
    expect(store.selectedProject).toBeNull()
  })
})

describe('VercelProjectSelector + VercelView (#76)', () => {
  let store, api

  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    vi.restoreAllMocks()
    api = mockApi()
    store = useVercelStore()
  })
  afterEach(() => vi.restoreAllMocks())

  function mountBoth(activeService = 'projects') {
    const header = mount(VercelProjectSelector)
    const view = mount(VercelView, { props: { activeService }, global: { stubs: { Teleport: true } } })
    return { header, view }
  }

  it('loads projects for the header as soon as a profile is active, on any tab', async () => {
    store.setActiveProfile('profile-1')
    const header = mount(VercelProjectSelector)
    await flushPromises()
    const options = header.findAll('option').map(o => o.text())
    expect(options).toEqual(['— Project —', 'alpha', 'beta'])
  })

  it('is disabled without a profile', () => {
    const header = mount(VercelProjectSelector)
    expect(header.find('select').attributes('disabled')).toBeDefined()
  })

  it('choosing a project in the header reloads the active view (Deployments)', async () => {
    store.setActiveProfile('profile-1')
    const { header } = mountBoth('deployments')
    await flushPromises()
    api.calls.length = 0

    await header.find('select').setValue('p-a')
    await flushPromises()

    expect(store.selectedProject.id).toBe('p-a')
    expect(api.calls.some(c => c.path.startsWith('/api/cloud/vercel/projects/p-a/deployments'))).toBe(true)
  })

  it('selecting a row in the Projects table updates the header selector', async () => {
    store.setActiveProfile('profile-1')
    const { header, view } = mountBoth('projects')
    await flushPromises()

    const betaRow = view.findAll('tbody tr').find(tr => tr.text().includes('beta'))
    api.calls.length = 0
    await betaRow.trigger('click')
    await flushPromises()

    expect(header.find('select').element.value).toBe('p-b')
    expect(betaRow.classes()).toContain('row-selected')
    // Picking a project does not refetch (and flash) the project list itself
    expect(api.calls).toEqual([])
  })

  it('choosing a project in the header highlights it in the Projects table', async () => {
    store.setActiveProfile('profile-1')
    const { header, view } = mountBoth('projects')
    await flushPromises()

    await header.find('select').setValue('p-a')
    const alphaRow = view.findAll('tbody tr').find(tr => tr.text().includes('alpha'))
    expect(alphaRow.classes()).toContain('row-selected')
  })

  it('switching profile resets the header selector and lists the new projects', async () => {
    store.setActiveProfile('profile-1')
    const { header } = mountBoth('deployments')
    await flushPromises()
    await header.find('select').setValue('p-a')

    store.setActiveProfile('profile-2')
    await flushPromises()

    expect(header.find('select').element.value).toBe('')
    expect(header.findAll('option').map(o => o.text())).toEqual(['— Project —', 'zeta'])
  })
})
