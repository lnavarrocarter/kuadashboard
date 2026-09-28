import { mount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import HelpModal from '../components/modals/HelpModal.vue'
import PlatformStorage from '../components/PlatformStorage.vue'
import { settings, SETTINGS_DEFAULTS } from '../composables/useSettings'
import { translate } from '../composables/useI18n'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))

const BaseModalStub = {
  props: ['show', 'size'],
  template: '<section v-if="show"><main><slot /></main><footer><slot name="footer" /></footer></section>',
}

const REPORT = {
  dir: '/home/me/.kuadashboard', exists: true, totalBytes: 300000, freeDiskBytes: 5e10,
  files: [
    { name: 'apm-observability.sqlite3', kind: 'sqlite', bytes: 200000, modifiedAt: 1, id: 'apm', label: 'APM observability' },
    { name: 'audit.log', kind: 'log', bytes: 100000, modifiedAt: 1, id: 'audit', label: 'Audit log' },
  ],
  databases: [{
    name: 'apm-observability.sqlite3', id: 'apm', label: 'APM observability', status: 'ok',
    bytes: 250000, mainBytes: 200000, walBytes: 40000, shmBytes: 10000, usedBytes: 180000, freeBytes: 20000,
    pageSize: 4096, pageCount: 49, freePages: 5, journalMode: 'wal', schemaVersion: 15,
    tables: [{ name: 'apm_metric_buckets', rows: 1200, bytes: 90000 }],
  }],
  awsCostCache: [{ profile: 'local:dev', fetchedAt: 1 }],
}

function stubFetch(body = REPORT, ok = true) {
  const fn = vi.fn(async () => ({ ok, status: ok ? 200 : 500, headers: { get: () => 'application/json' }, json: async () => body }))
  vi.stubGlobal('fetch', fn)
  return fn
}

function mountHelp() {
  return mount(HelpModal, { props: { show: true }, global: { stubs: { BaseModal: BaseModalStub } } })
}

describe('Options: cache & refresh', () => {
  beforeEach(() => { setActivePinia(createPinia()); settings.lang = 'en'; stubFetch() })
  afterEach(() => { Object.assign(settings, SETTINGS_DEFAULTS); vi.unstubAllGlobals() })

  it('shows one control per automatic re-read with its cost at the chosen value', async () => {
    const wrapper = mountHelp()
    await wrapper.findAll('.help-nav-item')[2].trigger('click')
    const rows = () => wrapper.findAll('.opts-row-stack')
    expect(rows()).toHaveLength(11)
    expect(wrapper.findAll('.opts-provider').map(p => p.text().split(/[.;]/)[0])).toEqual(expect.arrayContaining([expect.stringContaining('AWS'), expect.stringContaining('Kubernetes'), expect.stringContaining('Google Cloud'), expect.stringContaining('Vercel')]))
    expect(rows()[0].text()).toContain('Lambda & Step Functions activity')
    expect(rows()[0].text()).toContain('at most 4 times per hour')

    await rows()[0].find('select').setValue('60')
    expect(settings.awsActivityCacheMin).toBe(60)
    expect(rows()[0].text()).toContain('at most 1 times per hour')

    await rows()[3].find('select').setValue('24')
    expect(settings.awsCostCacheHours).toBe(24)
    expect(rows()[3].text()).toContain('at most 1 requests per day (USD 0.01)')
    // Resource counts are free: no cost marker.
    expect(rows()[2].find('.opts-note').classes()).not.toContain('billed')
    expect(rows()[0].find('.opts-note').classes()).toContain('billed')
  })

  it('reset keeps the language and restores cache defaults', async () => {
    settings.lang = 'es'
    settings.awsActivityCacheMin = 60
    const wrapper = mountHelp()
    await wrapper.findAll('.help-nav-item')[2].trigger('click')
    const label = translate('es', 'help.resetSettings')
    await wrapper.findAll('button').find(b => b.text() === label).trigger('click')
    expect(settings.lang).toBe('es')
    expect(settings.awsActivityCacheMin).toBe(15)
  })
})

describe('PlatformStorage', () => {
  beforeEach(() => { settings.lang = 'en'; localStorage.clear() })
  afterEach(() => vi.unstubAllGlobals())

  it('shows totals, database usage, tables on demand and browser storage', async () => {
    const fetchMock = stubFetch()
    localStorage.setItem('kua:settings', 'x'.repeat(100))
    localStorage.setItem('other', 'ignored')
    const wrapper = mount(PlatformStorage)
    await flushPromises()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/system/storage')
    const kpis = wrapper.findAll('.storage-kpi').map(k => k.text())
    expect(kpis[0]).toContain('293 KB')
    expect(kpis[1]).toContain('Databases (1)')
    expect(kpis[2]).toContain('224 B')
    expect(wrapper.find('.storage-legend').text()).toContain('Journal (WAL) 48.8 KB')
    expect(wrapper.find('.storage-detail').exists()).toBe(false)

    await wrapper.find('.storage-db-head').trigger('click')
    expect(wrapper.find('.storage-detail').text()).toContain('apm_metric_buckets')
    expect(wrapper.find('.storage-detail').text()).toContain('1,200')
    expect(wrapper.find('.storage-meta').text()).toContain('49 pages of 4.0 KB · journal wal · schema v15')
    expect(wrapper.find('.storage-note').text()).toContain('local:dev')
  })

  it('reports a failure without breaking the panel', async () => {
    stubFetch({ error: 'EACCES' }, false)
    const wrapper = mount(PlatformStorage)
    await flushPromises()
    expect(wrapper.find('.storage-error').text()).toContain('EACCES')
  })
})
