import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))

import GcpConfirmModal from '../components/cloud/GcpConfirmModal.vue'
import GcpCreateModal from '../components/cloud/GcpCreateModal.vue'
import GcpView from '../components/cloud/GcpView.vue'
import { gcpActionConfig, cloudRunScaling, formatCloudRunCpu, formatCloudRunMemory } from '../components/cloud/gcpActions'
import { useGcpStore } from '../stores/useGcpStore'
import { useTerminalStore } from '../stores/useTerminalStore'
import { settings } from '../composables/useSettings'

// These assertions read the Spanish texts; the English create modal is checked at the end.
beforeEach(() => { settings.lang = 'es' })
afterEach(() => { settings.lang = 'en' })

const LOW_ESTIMATE = { known: true, monthlyUsd: 12.5, highCost: false, items: [{ label: 'VM e2-small', monthlyUsd: 12.5 }], warnings: ['Billing starts…'], disclaimer: 'Approximate' }
const HIGH_ESTIMATE = { ...LOW_ESTIMATE, monthlyUsd: 480, highCost: true }

const PRESETS = {
  locations: [
    { region: 'us-central1', label: 'Iowa (us-central1)', zones: ['us-central1-a', 'us-central1-b'] },
    { region: 'us-east1', label: 'Carolina del Sur (us-east1)', zones: ['us-east1-b', 'us-east1-c'] },
  ],
  vm: [
    { value: 'e2-micro', label: 'Micro', specs: '2 vCPU compartidas · 1 GB', use: 'Pruebas', monthlyUsd: 6.11 },
    { value: 'e2-small', label: 'Pequeña', specs: '2 vCPU compartidas · 2 GB', use: 'Dev', monthlyUsd: 12.23 },
    { value: 'e2-standard-2', label: 'Estándar', specs: '2 vCPU · 8 GB', use: 'Prod', monthlyUsd: 48.91 },
  ],
  sql: [
    { value: 'db-f1-micro', label: 'Micro', specs: 'compartida · 0.6 GB', use: 'Dev', monthlyUsd: 7.67 },
    { value: 'db-custom-2-7680', label: 'Estándar', specs: '2 vCPU · 7.5 GB', use: 'Prod', monthlyUsd: 98.62 },
  ],
  vmImages: [{ key: 'debian-12', label: 'Debian 12', project: 'debian-cloud', family: 'debian-12' }, { key: 'ubuntu-2404', label: 'Ubuntu 24.04 LTS', project: 'ubuntu-os-cloud', family: 'ubuntu-2404-lts-amd64' }],
  sqlVersions: ['POSTGRES_16', 'MYSQL_8_0'],
  cloudRun: { cpu: ['1', '2'], memory: ['512Mi', '1Gi'] },
}

const CLOUD_RUN = [{ name: 'api', region: 'us-central1', status: 'ready', image: 'gcr.io/p/api:1', cpu: '1', memory: '512Mi', minInstances: 1, maxInstances: 5, ingress: 'all', latestRevision: 'api-00002', revisionPending: true, updatedAt: '2026-01-01T00:00:00Z' }]
const VMS = [
  { name: 'web-1', zone: 'us-central1-a', status: 'RUNNING', machineType: 'e2-small', internalIp: '10.0.0.2', externalIp: '34.1.2.3', network: 'default', subnetwork: 'default', diskCount: 2, diskSizeGb: 120, keptDiskCount: 1, provisioningModel: 'SPOT', deletionProtection: false },
  { name: 'locked', zone: 'us-central1-b', status: 'TERMINATED', machineType: 'n2-standard-2', internalIp: '10.0.0.3', externalIp: null, network: 'default', diskCount: 1, diskSizeGb: 10, keptDiskCount: 0, provisioningModel: 'STANDARD', deletionProtection: true },
]
const SQL = [{ name: 'db', database: 'POSTGRES_16', region: 'us-central1', zone: 'us-central1-c', state: 'RUNNABLE', status: 'STOPPED', activationPolicy: 'NEVER', tier: 'db-custom-2-7680', availabilityType: 'REGIONAL', storageGb: 50, storageType: 'PD_SSD', backupEnabled: true, publicIp: '34.9.9.9', privateIp: null, deletionProtection: false }]

function stubFetch(estimate = LOW_ESTIMATE, { presets = PRESETS } = {}) {
  const calls = []
  const fetchMock = vi.fn(async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : undefined })
    if (url.endsWith('/presets') && !presets) return { ok: false, status: 500, headers: { get: () => 'application/json' }, json: async () => ({ error: 'boom' }), text: async () => '' }
    const body = url.endsWith('/presets') ? presets : url.includes('/estimate/') ? estimate : url.includes('/cloudrun') && opts.method === 'POST' ? { success: true } : opts.method === 'DELETE' ? { success: true } : []
    return { ok: true, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) }
  })
  vi.stubGlobal('fetch', fetchMock)
  return calls
}

// ── gcpActions ───────────────────────────────────────────────────────────────

describe('Cloud Run scaling actions (G01)', () => {
  it('start/stop only change the minimum and say the endpoint stays', () => {
    const zero = { ...CLOUD_RUN[0], minInstances: 0 }
    expect(cloudRunScaling(zero)).toMatchObject({ canWarm: true, canScaleToZero: false })
    expect(cloudRunScaling(CLOUD_RUN[0])).toMatchObject({ canWarm: false, canScaleToZero: true })
    const warm = gcpActionConfig('cloudrun', 'start', zero)
    expect(warm.blocked).toBe('')
    expect(warm.lines.join(' ')).toMatch(/0 → 1/)
    const toZero = gcpActionConfig('cloudrun', 'stop', CLOUD_RUN[0])
    expect(toZero.blocked).toBe('')
    expect(toZero.lines.join(' ')).toMatch(/1 → 0/)
    expect(gcpActionConfig('cloudrun', 'stop', zero).blocked).toBeTruthy()
    expect(gcpActionConfig('cloudrun', 'start', { ...CLOUD_RUN[0], minInstances: 3 }).blocked).toBeTruthy()
  })
  it('normalizes CPU and memory', () => {
    expect(formatCloudRunCpu('1000m')).toBe('1 vCPU')
    expect(formatCloudRunCpu('2')).toBe('2 vCPU')
    expect(formatCloudRunMemory('512Mi')).toBe('512 MiB')
    expect(formatCloudRunMemory('1Gi')).toBe('1 GiB')
    expect(formatCloudRunMemory('weird')).toBe('weird')
  })
})

describe('gcpActionConfig (#74)', () => {
  it('start asks for a cost acknowledgement with an estimate spec', () => {
    const vm = gcpActionConfig('vm', 'start', VMS[0])
    expect(vm.costAck).toBe(true)
    expect(vm.estimateSpec).toEqual({ machineType: 'e2-small', diskSizeGb: 120, externalIp: true, spot: true })
    const run = gcpActionConfig('cloudrun', 'start', CLOUD_RUN[0])
    expect(run.estimateSpec.minInstances).toBe(1)
    expect(run.lines.join(' ')).toMatch(/24\/7/)
    const sql = gcpActionConfig('sql', 'start', SQL[0])
    expect(sql.estimateSpec).toEqual({ tier: 'db-custom-2-7680', storageGb: 50, storageType: 'PD_SSD', availabilityType: 'REGIONAL' })
  })

  it('stop is a plain confirmation that lists what keeps billing', () => {
    const cfg = gcpActionConfig('vm', 'stop', VMS[0])
    expect(cfg.costAck).toBeFalsy()
    expect(cfg.requireName).toBeFalsy()
    expect(cfg.lines.join(' ')).toMatch(/siguen facturando/)
  })

  it('delete requires the typed name and warns about kept disks', () => {
    const cfg = gcpActionConfig('vm', 'delete', VMS[0])
    expect(cfg.tone).toBe('danger')
    expect(cfg.requireName).toBe('web-1')
    expect(cfg.lines.join(' ')).toMatch(/1 disco\(s\) sin auto-delete/)
    expect(gcpActionConfig('sql', 'delete', SQL[0]).lines.join(' ')).toMatch(/backups/)
  })

  it('ssh explains the temporary key and picks the address', () => {
    const cfg = gcpActionConfig('vm', 'ssh', VMS[0])
    expect(cfg.addressType).toBe('external')
    expect(cfg.lines.join(' ')).toMatch(/llave SSH temporal/)
    expect(cfg.blocked).toBe('')
    const internal = gcpActionConfig('vm', 'ssh', { ...VMS[0], externalIp: null })
    expect(internal.addressType).toBe('internal')
    expect(internal.lines.join(' ')).toMatch(/IP interna/)
    expect(gcpActionConfig('vm', 'ssh', VMS[1]).blocked).toMatch(/TERMINATED/)
    expect(() => gcpActionConfig('sql', 'ssh', SQL[0])).toThrow(/only available for VMs/)
  })

  it('delete is blocked when the resource has deletion protection', () => {
    expect(gcpActionConfig('vm', 'delete', VMS[1]).blocked).toMatch(/protección contra eliminación/)
    expect(gcpActionConfig('sql', 'delete', { ...SQL[0], deletionProtection: true }).blocked).toBeTruthy()
    expect(gcpActionConfig('vm', 'delete', VMS[0]).blocked).toBe('')
  })
})

// ── GcpConfirmModal ──────────────────────────────────────────────────────────

describe('GcpConfirmModal (#74)', () => {
  const confirmBtn = w => w.find('[data-test="confirm"]')

  it('requires the exact typed name', async () => {
    const w = mount(GcpConfirmModal, { props: { open: true, title: 'Eliminar', requireName: 'prod-db', tone: 'danger' } })
    expect(confirmBtn(w).attributes('disabled')).toBeDefined()
    await w.find('[data-test="confirm-name"]').setValue('prod')
    expect(confirmBtn(w).attributes('disabled')).toBeDefined()
    await w.find('[data-test="confirm-name"]').setValue('prod-db')
    expect(confirmBtn(w).attributes('disabled')).toBeUndefined()
    await confirmBtn(w).trigger('click')
    expect(w.emitted('confirm')[0][0]).toMatchObject({ confirmName: 'prod-db' })
  })

  it('requires the cost checkbox, and a second one for high-cost estimates', async () => {
    const w = mount(GcpConfirmModal, { props: { open: true, title: 'Crear', costAck: true, estimate: HIGH_ESTIMATE } })
    expect(w.find('[data-test="estimate"]').text()).toContain('480.00')
    await w.find('[data-test="cost-ack"]').setValue(true)
    expect(confirmBtn(w).attributes('disabled')).toBeDefined()
    await w.find('[data-test="high-cost-ack"]').setValue(true)
    expect(confirmBtn(w).attributes('disabled')).toBeUndefined()
    await confirmBtn(w).trigger('click')
    expect(w.emitted('confirm')[0][0]).toMatchObject({ acknowledgeCost: true, acknowledgeHighCost: true })
  })

  it('cannot confirm while blocked', () => {
    const w = mount(GcpConfirmModal, { props: { open: true, title: 'Eliminar', requireName: 'x', blocked: 'Tiene protección' } })
    expect(w.find('[data-test="blocked"]').text()).toBe('Tiene protección')
    expect(w.find('[data-test="confirm-name"]').exists()).toBe(false)
    expect(confirmBtn(w).attributes('disabled')).toBeDefined()
  })

  it('resets acknowledgements when reopened', async () => {
    const w = mount(GcpConfirmModal, { props: { open: true, title: 'x', costAck: true, estimate: LOW_ESTIMATE } })
    await w.find('[data-test="cost-ack"]').setValue(true)
    await w.setProps({ open: false })
    await w.setProps({ open: true })
    expect(w.find('[data-test="cost-ack"]').element.checked).toBe(false)
  })
})

// ── GcpCreateModal ───────────────────────────────────────────────────────────

describe('GcpCreateModal (#74)', () => {
  let calls
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
    calls = stubFetch()
    useGcpStore().activeProfileId = 'gcp-1'
  })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

  async function settle() {
    await vi.advanceTimersByTimeAsync(350)
    await flushPromises()
  }

  it('shows a live estimate for the form without sending the password', async () => {
    const w = mount(GcpCreateModal, { props: { open: true, kind: 'sql' } })
    await w.find('[data-test="root-password"]').setValue('a-long-enough-password')
    await settle()
    const est = calls.filter(c => c.url === '/api/cloud/gcp/estimate/sql').at(-1)
    expect(est.body.tier).toBe('db-f1-micro')
    expect(est.body.rootPassword).toBeUndefined()
    expect(w.find('[data-test="live-estimate"]').text()).toContain('12.50')
  })

  it('creates only after typed name and cost acknowledgement, sending both to the backend', async () => {
    const w = mount(GcpCreateModal, { props: { open: true, kind: 'vm' } })
    await w.find('[data-test="name"]').setValue('web-2')
    await settle()
    await w.find('[data-test="review"]').trigger('click')
    await flushPromises()

    const confirm = w.findComponent(GcpConfirmModal)
    expect(confirm.props('open')).toBe(true)
    expect(confirm.props('lines').join(' ')).toMatch(/IP pública/)
    await confirm.find('[data-test="confirm-name"]').setValue('web-2')
    expect(confirm.find('[data-test="confirm"]').attributes('disabled')).toBeDefined()
    await confirm.find('[data-test="cost-ack"]').setValue(true)
    await confirm.find('[data-test="confirm"]').trigger('click')
    await flushPromises()

    const create = calls.find(c => c.url === '/api/cloud/gcp/compute/vms' && c.method === 'POST')
    expect(create.body).toMatchObject({ name: 'web-2', confirmName: 'web-2', acknowledgeCost: true, imageFamily: 'debian-12', imageProject: 'debian-cloud' })
    expect(create.body.imageKey).toBeUndefined()
    expect(w.emitted('created')[0][0]).toMatchObject({ kind: 'vm', name: 'web-2' })
  })

  it('flags a public Cloud Run service in the review', async () => {
    const w = mount(GcpCreateModal, { props: { open: true, kind: 'cloudrun' } })
    await w.find('[data-test="name"]').setValue('api')
    await w.find('input[type="checkbox"]').setValue(true)
    await settle()
    await w.find('[data-test="review"]').trigger('click')
    expect(w.findComponent(GcpConfirmModal).props('lines').join(' ')).toMatch(/PÚBLICO/)
  })

  it('shows machine presets as cards with specs and price, and sends the chosen one', async () => {
    const w = mount(GcpCreateModal, { props: { open: true, kind: 'vm' } })
    await settle()
    const cards = w.findAll('[data-test="machine-presets"] .gcpn-preset')
    expect(cards).toHaveLength(4) // 3 presets + "Otro…"
    expect(cards[0].text()).toContain('Micro')
    expect(cards[0].text()).toContain('~$6.11/mes')
    expect(w.find('[data-test="machine-presets"] .gcpn-preset.active').text()).toContain('e2-small')

    await cards[2].find('input').trigger('change')
    await w.find('[data-test="name"]').setValue('web-3')
    await settle()
    expect(calls.filter(c => c.url === '/api/cloud/gcp/estimate/vm').at(-1).body.machineType).toBe('e2-standard-2')
    expect(w.find('[data-test="machine-presets"] .gcpn-preset.active').text()).toContain('Estándar')
  })

  it('"Otro…" reveals a free-text machine type', async () => {
    const w = mount(GcpCreateModal, { props: { open: true, kind: 'vm' } })
    await settle()
    expect(w.find('[data-test="machine-type"]').exists()).toBe(false)
    await w.find('[data-test="machine-other"]').trigger('change')
    await w.find('[data-test="machine-type"]').setValue('n2-standard-8')
    await settle()
    expect(calls.filter(c => c.url === '/api/cloud/gcp/estimate/vm').at(-1).body.machineType).toBe('n2-standard-8')
  })

  it('offers only the real zones of the selected region', async () => {
    const w = mount(GcpCreateModal, { props: { open: true, kind: 'vm', defaultRegion: 'us-central1' } })
    await settle()
    expect(w.findAll('[data-test="zone"] option').map(o => o.element.value)).toEqual(['us-central1-a', 'us-central1-b'])
    await w.find('[data-test="region"]').setValue('us-east1')
    await flushPromises()
    expect(w.findAll('[data-test="zone"] option').map(o => o.element.value)).toEqual(['us-east1-b', 'us-east1-c'])
    expect(w.find('[data-test="zone"]').element.value).toBe('us-east1-b')
  })

  it('shows SQL tier presets with prices', async () => {
    const w = mount(GcpCreateModal, { props: { open: true, kind: 'sql' } })
    await settle()
    const text = w.find('[data-test="tier-presets"]').text()
    expect(text).toContain('db-custom-2-7680')
    expect(text).toContain('~$98.62/mes')
  })

  it('falls back to basic options when presets cannot be loaded', async () => {
    vi.unstubAllGlobals()
    calls = stubFetch(LOW_ESTIMATE, { presets: null })
    const w = mount(GcpCreateModal, { props: { open: true, kind: 'vm' } })
    await settle()
    expect(w.text()).toContain('No se pudieron cargar las opciones predefinidas')
    expect(w.findAll('[data-test="machine-presets"] .gcpn-preset').length).toBeGreaterThan(1)
  })

  it('blocks review with an invalid name', async () => {
    const w = mount(GcpCreateModal, { props: { open: true, kind: 'vm' } })
    await w.find('[data-test="name"]').setValue('Web_2')
    expect(w.find('[data-test="review"]').attributes('disabled')).toBeDefined()
  })

  it('follows the app language', async () => {
    settings.lang = 'en'
    vi.unstubAllGlobals()
    calls = stubFetch(LOW_ESTIMATE, { presets: null })
    const w = mount(GcpCreateModal, { props: { open: true, kind: 'vm' } })
    await settle()
    expect(w.text()).toContain('New Compute Engine VM')
    expect(w.text()).toContain('Could not load the preset options')
    expect(w.text()).toContain('Review and create…')
    expect(w.text()).not.toContain('Revisar y crear')
  })
})

// ── GcpView tables + inline actions ──────────────────────────────────────────

describe('GcpView — Cloud Run / VM / Cloud SQL tables (#74)', () => {
  let calls, store

  beforeEach(() => {
    setActivePinia(createPinia())
    calls = stubFetch()
    store = useGcpStore()
    store.activeProfileId = 'gcp-1'
  })
  afterEach(() => vi.unstubAllGlobals())

  // GcpCreateModal also contains a (closed) GcpConfirmModal: pick the open one
  const openConfirm = w => w.findAllComponents(GcpConfirmModal).find(c => c.props('open'))

  async function mountTab(service) {
    const w = mount(GcpView, { props: { activeService: service }, global: { stubs: { Teleport: true, GcpMetricsChart: true, GcsBrowser: true, ApmObservabilityView: true } } })
    await flushPromises()
    store.tabs.cloudrun.data = CLOUD_RUN
    store.tabs.vms.data = VMS
    store.tabs.sql.data = SQL
    await flushPromises()
    return w
  }

  it('Cloud Run table shows container, scaling and revision columns with inline actions', async () => {
    const w = await mountTab('cloudrun')
    const row = w.find('[data-test="cloudrun-table"] tbody tr')
    expect(row.text()).toContain('api:1')
    expect(row.text()).toContain('1 vCPU / 512 MiB')
    expect(row.text()).toContain('1–5')
    expect(row.text()).toContain('api-00002')
    // minimum is already 1: "keep warm" is off, "allow scale to zero" is on
    expect(row.find('[data-test="start"]').attributes('disabled')).toBeDefined()
    expect(row.find('[data-test="stop"]').attributes('disabled')).toBeUndefined()
    expect(row.find('[data-test="delete"]').attributes('aria-label')).toBeTruthy()
    expect(row.find('[data-test="delete"]').exists()).toBe(true)
  })

  it('a rejected request is named as such, without an enable-API link or a zero count (G04)', async () => {
    const w = await mountTab('artifact')
    Object.assign(store.tabs.artifact, {
      data: [], error: 'Invalid project name: projects/p/locations/-', enableUrl: null,
      errorInfo: { kind: 'invalid_request', code: 'INVALID_ARGUMENT', raw: '{"error":{"code":400}}' },
    })
    await flushPromises()
    const banner = w.find('[data-test="tab-error"]')
    expect(banner.find('[data-test="error-kind"]').text()).toBe('Petición rechazada')
    expect(banner.find('a').exists()).toBe(false)
    expect(w.text()).toContain('Sin leer')
  })

  it('Storage shows prevention and leaves exposure as not verified (G02)', async () => {
    const w = await mountTab('storage')
    store.tabs.storage.data = [
      { name: 'src', location: 'US', storageClass: 'STANDARD', publicAccessPrevention: 'inherited', uniformAccess: false, exposure: 'not_verified' },
      { name: 'locked', location: 'US', storageClass: 'STANDARD', publicAccessPrevention: 'enforced', uniformAccess: true, exposure: 'not_verified' },
    ]
    await flushPromises()
    const cells = w.findAll('[data-test="pap"]').map(c => c.text())
    expect(cells).toEqual(['Heredada', 'Forzada'])
    expect(w.findAll('[data-test="exposure"]').every(c => c.text() === 'No verificada')).toBe(true)
    expect(w.text()).not.toContain('Pública')
  })

  it('VM table shows network, disks, Spot and protection; buttons follow the status', async () => {
    const w = await mountTab('vms')
    const rows = w.findAll('[data-test="vm-table"] tbody tr')
    expect(rows[0].text()).toContain('Spot')
    expect(rows[0].text()).toContain('2 · 120 GB')
    expect(rows[0].find('[data-test="start"]').attributes('disabled')).toBeDefined()
    expect(rows[0].find('[data-test="stop"]').attributes('disabled')).toBeUndefined()
    expect(rows[1].text()).toContain('🔒')
    expect(rows[1].find('[data-test="start"]').attributes('disabled')).toBeUndefined()
  })

  it('Cloud SQL table shows the derived status (STOPPED) and HA/backups', async () => {
    const w = await mountTab('sql')
    const row = w.find('[data-test="sql-table"] tbody tr')
    expect(row.text()).toContain('STOPPED')
    expect(row.text()).toContain('HA')
    expect(row.text()).toContain('50 GB')
    expect(row.find('[data-test="start"]').attributes('disabled')).toBeUndefined()
    expect(row.find('[data-test="stop"]').attributes('disabled')).toBeDefined()
  })

  it('inline Start asks for cost confirmation with an estimate before calling the API', async () => {
    const w = await mountTab('sql')
    await w.find('[data-test="sql-table"] [data-test="start"]').trigger('click')
    await flushPromises()
    const modal = openConfirm(w)
    expect(modal.props('open')).toBe(true)
    expect(modal.props('costAck')).toBe(true)
    expect(calls.some(c => c.url === '/api/cloud/gcp/estimate/sql')).toBe(true)
    expect(calls.some(c => c.url.endsWith('/sql/db/start'))).toBe(false)

    await modal.find('[data-test="cost-ack"]').setValue(true)
    await modal.find('[data-test="confirm"]').trigger('click')
    await flushPromises()
    expect(calls.some(c => c.url === '/api/cloud/gcp/sql/db/start' && c.method === 'POST')).toBe(true)
  })

  it('inline Delete sends the typed name to the DELETE endpoint', async () => {
    const w = await mountTab('cloudrun')
    await w.find('[data-test="cloudrun-table"] [data-test="delete"]').trigger('click')
    const modal = openConfirm(w)
    expect(modal.props('tone')).toBe('danger')
    await modal.find('[data-test="confirm-name"]').setValue('api')
    await modal.find('[data-test="confirm"]').trigger('click')
    await flushPromises()
    const del = calls.find(c => c.method === 'DELETE')
    expect(del.url).toBe('/api/cloud/gcp/cloudrun/us-central1/api')
    expect(del.body).toEqual({ confirmName: 'api' })
  })

  it('SSH opens a gcp-ssh console tab for the VM after confirmation', async () => {
    const w = await mountTab('vms')
    const ssh = w.findAll('[data-test="vm-table"] tbody tr')[0].find('[data-test="ssh"]')
    expect(ssh.attributes('disabled')).toBeUndefined()
    await ssh.trigger('click')
    const modal = openConfirm(w)
    expect(modal.props('title')).toBe('SSH a web-1')
    await modal.find('[data-test="confirm"]').trigger('click')
    await flushPromises()

    const tab = useTerminalStore().tabs.find(t => t.type === 'gcp-ssh')
    expect(tab).toBeTruthy()
    expect(tab.provider).toBe('gcp')
    expect(tab.transport).toBe('ssh')
    expect(tab.profileId).toBe('gcp-1')
    expect(tab.target).toEqual({ name: 'web-1', zone: 'us-central1-a', addressType: 'external' })
    expect(calls.some(c => c.url === '/api/console/sessions' && c.method === 'POST')).toBe(true)
  })

  it('SSH is disabled for stopped VMs', async () => {
    const w = await mountTab('vms')
    expect(w.findAll('[data-test="vm-table"] tbody tr')[1].find('[data-test="ssh"]').attributes('disabled')).toBeDefined()
  })

  it('opens the create modal from the toolbar', async () => {
    const w = await mountTab('vms')
    await w.find('[data-test="create-vm"]').trigger('click')
    expect(w.findComponent(GcpCreateModal).props()).toMatchObject({ open: true, kind: 'vm' })
  })

  it('renders the enriched overview with health, attention signals and historical deltas', async () => {
    // Currency formatting follows the app language; this test reads the English format.
    settings.lang = 'en'
    const w = mount(GcpView, { props: { activeService: 'overview' }, global: { stubs: { Teleport: true, GcpMetricsChart: true, GcsBrowser: true, ApmObservabilityView: true } } })
    await flushPromises()
    store.overview = {
      projectId: 'demo-project',
      region: 'us-central1',
      identity: { account: 'operator@example.com' },
      summary: { total: 4, active: 2, empty: 0, unavailable: 1, critical: 1, warning: 1, attention: 3, health: 'critical', services: 4, availableServices: 3 },
      costs: {
        status: 'partial', source: 'resource-baseline-estimate', estimated: true, currency: 'USD',
        monthlyEstimate: 123.45, modeledResources: 3, unknownResources: 1,
        byService: [
          { id: 'vms', label: 'Compute VMs', tab: 'vms', count: 2, modeled: 1, unknown: 1, monthlyUsd: 80 },
          { id: 'sql', label: 'Cloud SQL', tab: 'sql', count: 1, modeled: 1, unknown: 0, monthlyUsd: 43.45 },
        ],
        unpricedResources: [{ service: 'Compute VMs', name: 'a3-megagpu-8g' }],
        unmodeledServices: ['BigQuery'],
        unavailableServices: ['Cloud Scheduler'],
        disclaimer: 'Approximate baseline only.',
      },
      services: [
        { id: 'vms', label: 'Compute VMs', tab: 'vms', group: 'compute', status: 'available', health: 'healthy', count: 2, active: 1, inactive: 1, issueCount: 0, critical: 0, warning: 0, signals: [] },
        { id: 'sql', label: 'Cloud SQL', tab: 'sql', group: 'data', status: 'unavailable', health: 'unavailable', count: 0, active: 0, inactive: 0, issueCount: 0, critical: 0, warning: 0, signals: [], error: { message: 'Permission denied' } },
        { id: 'scheduler', label: 'Cloud Scheduler', tab: 'scheduler', group: 'integration', status: 'available', health: 'warning', count: 2, active: 1, inactive: 1, issueCount: 1, critical: 0, warning: 1, signals: [{ level: 'warning', code: 'paused', name: 'nightly-job' }] },
        { id: 'storage', label: 'Storage', tab: 'storage', group: 'data', status: 'available', health: 'healthy', count: 0, active: 0, inactive: 0, issueCount: 0, critical: 0, warning: 0, signals: [] },
      ],
    }
    store.overviewHistory = [
      { capturedAt: 1700000000000, payload: { summary: { total: 3, active: 2, unavailable: 0 } } },
      { capturedAt: 1700003600000, payload: { summary: { total: 4, active: 2, unavailable: 1 } } },
    ]
    await flushPromises()

    expect(w.find('.gcp-overview-health-banner').text()).toContain('Critical')
    expect(w.find('.gcp-overview-health-detail').text()).toContain('3/4 services responding')
    expect(w.find('.gcp-overview-groups').text()).toContain('Compute')
    expect(w.find('.gcp-overview-attention-list').text()).toContain('nightly-job')
    expect(w.find('.gcp-overview-table').text()).toContain('API unavailable')
    expect(w.find('.gcp-overview-trend-summary').text()).toContain('+1')
    expect(w.findAll('.gcp-overview-attention')).toHaveLength(2)
    const costs = w.find('[data-test="overview-costs"]')
    expect(costs.text()).toContain('Estimated costs')
    expect(costs.text()).toContain('$123.45')
    expect(costs.text()).toContain('Partial')
    expect(costs.text()).toContain('a3-megagpu-8g')
    expect(costs.text()).toContain('BigQuery')
    expect(costs.text()).toContain('Cloud Scheduler')

    // The same overview in Spanish
    settings.lang = 'es'
    await flushPromises()
    expect(w.text()).toContain('Resumen del proyecto')
    expect(w.find('[data-test="overview-costs"]').text()).toContain('Costos estimados')
    expect(w.find('.gcp-overview-groups').text()).toContain('Cómputo')
    expect(w.text()).not.toContain('Estimated costs')
  })
})
