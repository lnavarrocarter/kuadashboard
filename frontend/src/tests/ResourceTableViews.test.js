import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))

import ResourceTable from '../components/ResourceTable.vue'
import { useKubeStore } from '../stores/useKubeStore'
import { RESOURCES } from '../config/resources'
import { settings } from '../composables/useSettings'
import {
  RECENT_LIMIT, loadTableView, loadFilterHistory,
  rememberFilter, toggleSavedFilter, forgetFilter,
} from '../composables/useTableViews'

const pod = (name, status = 'Running', ready = '1/1', restarts = 0) => ({ name, namespace: 'default', status, ready, restarts })
const PODS = [pod('api-1'), pod('api-2', 'Pending', '0/1'), pod('web-1', 'Running', '1/2', 3)]
const DEPLOYMENTS = [
  { name: 'api', namespace: 'default', ready: '2/2', replicas: 2 },
  { name: 'worker', namespace: 'default', ready: '0/0', replicas: 0 },
]

const names = wrapper => wrapper.findAll('tbody tr').map(tr => tr.find('td:not(.col-select)').text())

describe('filter history helpers', () => {
  const empty = { saved: [], recent: [] }

  it('keeps the most recent filters first, deduplicated and bounded', () => {
    let history = empty
    for (let i = 0; i < RECENT_LIMIT + 2; i++) history = rememberFilter(history, `q${i}`)
    history = rememberFilter(history, 'q5')
    expect(history.recent[0]).toBe('q5')
    expect(history.recent).toHaveLength(RECENT_LIMIT)
    expect(new Set(history.recent).size).toBe(RECENT_LIMIT)
  })

  it('ignores blank filters and filters already saved', () => {
    expect(rememberFilter(empty, '   ')).toBe(empty)
    const saved = { saved: ['api'], recent: [] }
    expect(rememberFilter(saved, 'api')).toBe(saved)
  })

  it('moves a filter between recents and saved', () => {
    const saved = toggleSavedFilter({ saved: [], recent: ['api', 'web'] }, 'api')
    expect(saved).toEqual({ saved: ['api'], recent: ['web'] })
    expect(toggleSavedFilter(saved, 'api')).toEqual({ saved: [], recent: ['api', 'web'] })
  })

  it('forgets a filter everywhere', () => {
    expect(forgetFilter({ saved: ['api'], recent: ['api', 'web'] }, 'api')).toEqual({ saved: [], recent: ['web'] })
  })
})

describe('ResourceTable — per-resource view, quick filters and history', () => {
  let store

  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    store = useKubeStore()
    store.resource = 'pods'
    store.rows = PODS
  })

  async function switchTo(resource, rows) {
    store.resource = resource
    store.rows = rows
    await nextTick()
  }

  it('restores filter and sort when coming back to a resource', async () => {
    const wrapper = mount(ResourceTable)
    await wrapper.find('.search-input').setValue('api')
    await wrapper.findAll('th.sortable-th')[0].trigger('click')
    await wrapper.findAll('th.sortable-th')[0].trigger('click')
    expect(names(wrapper)).toEqual(['api-2', 'api-1'])

    await switchTo('deployments', DEPLOYMENTS)
    expect(wrapper.find('.search-input').element.value).toBe('')
    expect(names(wrapper)).toEqual(['api', 'worker'])

    await switchTo('pods', PODS)
    expect(wrapper.find('.search-input').element.value).toBe('api')
    expect(names(wrapper)).toEqual(['api-2', 'api-1'])
  })

  it('persists the view so a remounted table looks the same', async () => {
    const first = mount(ResourceTable)
    await first.find('.search-input').setValue('web')
    await first.findAll('th.sortable-th')[4].trigger('click')
    first.unmount()

    expect(loadTableView('pods')).toMatchObject({ filter: 'web', sortCol: 'Restarts', sortDir: 'asc' })
    const second = mount(ResourceTable)
    expect(second.find('.search-input').element.value).toBe('web')
    expect(second.find('th.th-sorted').text()).toContain('Restarts')
  })

  it('narrows rows with quick filters and shows their counts', async () => {
    const wrapper = mount(ResourceTable)
    const chips = wrapper.findAll('.quick-chip')
    expect(chips.map(c => c.text())).toEqual(['With problems 0', 'Not Running 1', 'Not ready 1', 'Restarted in the last hour 0', 'Restarted ever 1'])

    await chips[1].trigger('click')
    expect(names(wrapper)).toEqual(['api-2'])
    await chips[1].trigger('click')
    await chips[2].trigger('click')
    expect(names(wrapper)).toEqual(['web-1'])

    await switchTo('deployments', DEPLOYMENTS)
    await wrapper.findAll('.quick-chip')[1].trigger('click')
    expect(names(wrapper)).toEqual(['worker'])

    await switchTo('pods', PODS)
    expect(wrapper.find('.quick-chip.active').text()).toContain('Not ready')
    expect(names(wrapper)).toEqual(['web-1'])
  })

  it('records filters in the history on Enter and when leaving the resource', async () => {
    const wrapper = mount(ResourceTable)
    const input = wrapper.find('.search-input')
    await input.setValue('api')
    await input.trigger('keydown', { key: 'Enter' })
    await input.setValue('web')
    await switchTo('deployments', DEPLOYMENTS)

    expect(loadFilterHistory('pods').recent).toEqual(['web', 'api'])
    expect(loadFilterHistory('deployments').recent).toEqual([])
  })

  it('applies, saves and forgets filters from the history dropdown', async () => {
    localStorage.setItem('kua.kubeFilterHistory', JSON.stringify({ pods: { saved: [], recent: ['web', 'api'] } }))
    const wrapper = mount(ResourceTable)
    const input = wrapper.find('.search-input')
    await input.trigger('focus')
    const items = () => wrapper.findAll('.filter-history-item')
    expect(items().map(i => i.find('.filter-history-text').text())).toEqual(['web', 'api'])

    await items()[1].findAll('.filter-history-btn')[0].trigger('mousedown')
    expect(loadFilterHistory('pods')).toEqual({ saved: ['api'], recent: ['web'] })
    expect(wrapper.find('.filter-history-label').text()).toBe('Saved')

    await items()[1].findAll('.filter-history-btn')[1].trigger('mousedown')
    expect(loadFilterHistory('pods')).toEqual({ saved: ['api'], recent: [] })

    await items()[0].trigger('mousedown')
    expect(input.element.value).toBe('api')
    expect(names(wrapper)).toEqual(['api-1', 'api-2'])
    expect(wrapper.find('.filter-save').classes()).toContain('saved')
  })

  it('lets external navigation seed the filter over the saved view', async () => {
    localStorage.setItem('kua.kubeTableViews', JSON.stringify({ pods: { filter: 'api' } }))
    const wrapper = mount(ResourceTable, { props: { initialFilter: 'web' } })
    expect(wrapper.find('.search-input').element.value).toBe('web')
    expect(names(wrapper)).toEqual(['web-1'])
  })
})

describe('quick filter definitions', () => {
  const matches = (resource, id, rows) => {
    const qf = RESOURCES[resource].quickFilters.find(f => f.id === id)
    return rows.filter(qf.test).map(r => r.name)
  }

  it('gives every quick filter a unique id per resource', () => {
    for (const [name, cfg] of Object.entries(RESOURCES)) {
      const ids = (cfg.quickFilters || []).map(f => f.id)
      expect(new Set(ids).size, name).toBe(ids.length)
    }
  })

  it('matches the intended rows', () => {
    expect(matches('replicasets', 'inactive', [{ name: 'old', desired: 0 }, { name: 'live', desired: 2 }])).toEqual(['old'])
    expect(matches('secrets', 'tls', [{ name: 'cert', type: 'kubernetes.io/tls' }, { name: 'app', type: 'Opaque' }])).toEqual(['cert'])
    expect(matches('secrets', 'registry', [{ name: 'pull', type: 'kubernetes.io/dockerconfigjson' }, { name: 'app', type: 'Opaque' }])).toEqual(['pull'])
    expect(matches('hpas', 'at-max', [{ name: 'busy', current: 5, max: 5 }, { name: 'calm', current: 2, max: 5 }, { name: 'unset', current: 0, max: '-' }])).toEqual(['busy'])
    expect(matches('pdbs', 'blocking', [{ name: 'strict', allowed: 0 }, { name: 'loose', allowed: 1 }])).toEqual(['strict'])
    expect(matches('networkpolicies', 'deny-ingress', [
      { name: 'deny', types: 'Ingress', ingress: 0 },
      { name: 'allow', types: 'Ingress', ingress: 1 },
      { name: 'egress-only', types: 'Egress', ingress: 0 },
    ])).toEqual(['deny'])
    expect(matches('jobs', 'complete', [{ name: 'done', active: 0, completions: '1/1' }, { name: 'running', active: 1, completions: '0/1' }])).toEqual(['done'])
    expect(matches('ingresses', 'no-address', [{ name: 'pending', address: '-' }, { name: 'live', address: '1.2.3.4' }])).toEqual(['pending'])
  })
})

describe('ResourceTable — language', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    const store = useKubeStore()
    store.resource = 'pods'
    store.rows = PODS
  })

  it('translates quick filter chips and the filter box', async () => {
    settings.lang = 'es'
    try {
      const wrapper = mount(ResourceTable)
      expect(wrapper.findAll('.quick-chip').map(c => c.text())).toEqual(['Con problemas 0', 'No Running 1', 'No listos 1', 'Reinicio en la última hora 0', 'Con reinicios (histórico) 1'])
      expect(wrapper.find('.search-input').attributes('placeholder')).toBe('Filtrar...')
      settings.lang = 'en'
      await nextTick()
      expect(wrapper.find('.quick-chip').text()).toBe('With problems 0')
      expect(wrapper.find('.search-input').attributes('placeholder')).toBe('Filter...')
    } finally {
      settings.lang = 'en'
    }
  })

  it('uses an existing i18n key for every quick filter label', async () => {
    const { default: en } = await import('../locales/en')
    const { default: es } = await import('../locales/es')
    for (const [name, cfg] of Object.entries(RESOURCES)) {
      for (const qf of cfg.quickFilters || []) {
        expect(en[qf.label], `${name}.${qf.id}`).toBeTruthy()
        expect(es[qf.label], `${name}.${qf.id}`).toBeTruthy()
      }
    }
  })
})
