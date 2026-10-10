import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))

import GcpVmInfo from '../components/cloud/GcpVmInfo.vue'
import GcpCloudRunInfo from '../components/cloud/GcpCloudRunInfo.vue'
import GcpSqlInfo from '../components/cloud/GcpSqlInfo.vue'
import GcpLabelsEditor from '../components/cloud/GcpLabelsEditor.vue'
import GcpStateTimeline from '../components/cloud/GcpStateTimeline.vue'
import GcpPollingSettings from '../components/cloud/GcpPollingSettings.vue'
import { useGcpStore } from '../stores/useGcpStore'
import { settings } from '../composables/useSettings'

// The assertions below read the Spanish texts; the last block checks English.
beforeEach(() => { settings.lang = 'es' })
afterEach(() => { settings.lang = 'en' })

const VM = {
  name: 'web', instanceId: '123', zone: 'us-central1-a', status: 'RUNNING',
  created: '2026-09-01T00:00:00Z', lastStart: '2026-09-27T21:03:12Z', lastStop: null,
  labels: { env: 'prod', 'goog-ops-agent-policy': 'v2' }, tags: ['http-server'],
  machine: { type: 'e2-micro', os: 'rocky linux 9', cpuPlatform: 'Intel', gpus: [] },
  scheduling: { provisioningModel: 'SPOT', automaticRestart: false, onHostMaintenance: 'TERMINATE', terminationAction: 'STOP' },
  security: { deletionProtection: false, secureBoot: false, vtpm: true, integrityMonitoring: true, confidentialCompute: false, canIpForward: false, osLogin: null, serialPortEnabled: false,
    serviceAccounts: [{ email: 'sa@p.iam.gserviceaccount.com', scopes: [{ name: 'cloud-platform', access: 'full' }] }] },
  networks: [{ name: 'nic0', network: 'default', subnetwork: 'default', internalIp: '10.0.0.2', externalIp: '34.1.2.3', networkTier: 'PREMIUM' }],
  disks: [{ name: 'web', deviceName: 'd0', boot: true, type: 'pd-balanced', sizeGb: 20, interface: 'SCSI', mode: 'READ_WRITE', sourceImage: 'rocky-9', encryption: 'Google-managed', autoDelete: false }],
  metadata: [{ key: 'ssh-keys', sensitive: true, value: null, size: 540 }, { key: 'enable-oslogin', sensitive: false, value: 'FALSE', size: 5 }],
}

describe('GcpVmInfo (#81)', () => {
  it('overview shows structured cards and security observations', () => {
    const w = mount(GcpVmInfo, { props: { detail: VM, section: 'overview' } })
    const text = w.text()
    expect(text).toContain('rocky linux 9')
    expect(text).toContain('SPOT')
    expect(text).toContain('sa@p.iam.gserviceaccount.com')
    const notes = w.find('[data-test="notes"]').text()
    expect(notes).toMatch(/IP pública/)
    expect(notes).toMatch(/cloud-platform/)
    expect(notes).toMatch(/Secure Boot desactivado/)
    expect(notes).toMatch(/sin auto-delete/)
  })

  it('never shows sensitive metadata values', () => {
    const w = mount(GcpVmInfo, { props: { detail: VM, section: 'overview' } })
    expect(w.text()).toContain('ssh-keys · valor oculto (540 caracteres)')
    expect(w.text()).toContain('enable-oslogin = FALSE')
  })

  it('disks and network sections', () => {
    const disks = mount(GcpVmInfo, { props: { detail: VM, section: 'disks' } })
    expect(disks.find('[data-test="disks"]').text()).toContain('pd-balanced')
    expect(disks.text()).toContain('1 · 20 GB')
    const net = mount(GcpVmInfo, { props: { detail: VM, section: 'network' } })
    expect(net.text()).toContain('34.1.2.3')
    expect(net.text()).toContain('PREMIUM')
  })
})

const RUN = {
  name: 'api', region: 'us-central1', uri: 'https://api.run.app', status: 'ready', ingress: 'all', publicAccess: true,
  serviceAccount: null, labels: {},
  container: { image: 'gcr.io/p/api@sha256:abcdef1234567890abcdef', port: 8080, cpu: '1', memory: '512Mi', startupProbe: { kind: 'TCP 8080', periodSeconds: 240, failureThreshold: 1 } },
  scaling: { minInstances: 1, maxInstances: 5, concurrency: 80, timeoutSeconds: 300 },
  networking: { vpcConnector: null, directVpc: [] }, cloudSqlInstances: [],
  envVars: [{ name: 'MODE', value: 'prod' }, { name: 'TOKEN', secret: 'token:3' }, { name: 'API_KEY', value: 'sk_live_1234567890' }],
  revisions: [{ name: 'api-2', created: '2026-09-01T00:00:00Z', traffic: 100, ready: true, image: 'gcr.io/p/api:2' }],
  traffic: [{ latest: true, percent: 100, revision: null }],
}

describe('GcpCloudRunInfo scaling and units (R03)', () => {
  it('uses the scaling label and normalized CPU/memory like the table', () => {
    const w = mount(GcpCloudRunInfo, { props: { detail: RUN, section: 'overview' } })
    expect(w.find('[data-test="scaling"]').text()).toContain('1 – 5')
    expect(w.text()).toContain('1 vCPU / 512 MiB')
  })
})

describe('GcpCloudRunInfo (#81)', () => {
  it('flags public access, 24/7 min instances, default service account and plaintext secrets', () => {
    const notes = mount(GcpCloudRunInfo, { props: { detail: RUN, section: 'overview' } }).find('[data-test="notes"]').text()
    expect(notes).toMatch(/allUsers/)
    expect(notes).toMatch(/24\/7/)
    expect(notes).toMatch(/cuenta de servicio por defecto/)
    expect(notes).toMatch(/API_KEY/)
  })

  it('variables show secret references and mark likely plaintext secrets', () => {
    const env = mount(GcpCloudRunInfo, { props: { detail: RUN, section: 'variables' } }).find('[data-test="env"]').text()
    expect(env).toContain('🔐 token:3')
    expect(env).toContain('posible secreto')
  })

  it('revisions show traffic split', () => {
    const w = mount(GcpCloudRunInfo, { props: { detail: RUN, section: 'revisions' } })
    expect(w.find('[data-test="traffic"]').text()).toContain('Última (api-2)')
    expect(w.text()).toContain('100%')
  })
})

const SQL = {
  name: 'db', database: 'POSTGRES_16', status: 'STOPPED', edition: 'ENTERPRISE', tier: 'db-f1-micro', availabilityType: 'ZONAL', region: 'us-central1',
  storage: { type: 'PD_SSD', sizeGb: 10, autoResize: true }, backups: { enabled: false }, maintenance: null,
  network: { publicIp: '35.1.1.1', ipv4Enabled: true, sslMode: 'ALLOW_UNENCRYPTED_AND_ENCRYPTED', authorizedNetworks: [{ name: null, cidr: '0.0.0.0/0' }] },
  security: { deletionProtection: false }, replication: { primary: null, replicas: [] }, flags: [], labels: {},
}

describe('GcpSqlInfo (#81)', () => {
  it('flags disabled backups, unencrypted connections and open authorized networks', () => {
    const notes = mount(GcpSqlInfo, { props: { detail: SQL, section: 'overview' } }).find('[data-test="notes"]').text()
    expect(notes).toMatch(/backups automáticos están desactivados/)
    expect(notes).toMatch(/sin cifrar/)
    expect(notes).toMatch(/0\.0\.0\.0\/0/)
    expect(notes).toMatch(/siguen facturando/)
  })

  it('connection section shows SSL mode and marks 0.0.0.0/0', () => {
    const w = mount(GcpSqlInfo, { props: { detail: SQL, section: 'connection' } })
    expect(w.text()).toContain('Permite conexiones sin cifrar')
    expect(w.find('[data-test="authorized"]').text()).toContain('todo Internet')
  })
})

describe('GcpLabelsEditor (#81)', () => {
  it('shows system labels read-only and only edits user labels', () => {
    const w = mount(GcpLabelsEditor, { props: { labels: { env: 'prod', 'goog-ops-agent-policy': 'v2' } } })
    expect(w.findAll('[data-test="label-key"]')).toHaveLength(1)
    expect(w.text()).toContain('goog-ops-agent-policy=v2')
    expect(w.find('[data-test="label-save"]').attributes('disabled')).toBeDefined()
  })

  it('validates keys/values and duplicates before saving', async () => {
    const w = mount(GcpLabelsEditor, { props: { labels: { env: 'prod' } } })
    await w.find('[data-test="label-add"]').trigger('click')
    const keys = w.findAll('[data-test="label-key"]')
    await keys[1].setValue('Team')
    expect(w.text()).toContain('Formato inválido')
    expect(w.find('[data-test="label-save"]').attributes('disabled')).toBeDefined()
    await keys[1].setValue('env')
    expect(w.text()).toContain('Clave duplicada')
    await keys[1].setValue('goog-x')
    expect(w.text()).toContain('Clave reservada')
  })

  it('shows a diff and emits the desired user labels', async () => {
    const w = mount(GcpLabelsEditor, { props: { labels: { env: 'dev', old: 'x', 'goog-a': '1' } } })
    const values = w.findAll('[data-test="label-value"]')
    await values[0].setValue('prod')
    await w.findAll('[data-test="label-remove"]')[1].trigger('click')
    await w.find('[data-test="label-add"]').trigger('click')
    const keys = w.findAll('[data-test="label-key"]')
    await keys[1].setValue('team')
    await w.findAll('[data-test="label-value"]')[1].setValue('core')
    const diff = w.find('[data-test="label-diff"]').text()
    expect(diff).toContain('＋ team=core')
    expect(diff).toContain('env: dev → prod')
    expect(diff).toContain('－ old')
    await w.find('[data-test="label-save"]').trigger('click')
    expect(w.emitted('save')[0][0]).toEqual({ env: 'prod', team: 'core' })
  })
})

// ── Components that talk to the store ────────────────────────────────────────

function stubFetch(routes) {
  const calls = []
  vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : undefined })
    const handler = Object.entries(routes).find(([prefix]) => url.startsWith(prefix))?.[1]
    const body = typeof handler === 'function' ? handler(url, opts) : (handler ?? [])
    return { ok: true, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) }
  }))
  return calls
}

const POLL = { enabled: false, intervalMinutes: 15, resourceTypes: ['gcp-vm', 'gcp-cloud-run', 'gcp-sql'], retentionDays: 90, lastRunAt: null, lastError: null, callsPerDay: 0 }

describe('GcpStateTimeline (#81)', () => {
  beforeEach(() => { setActivePinia(createPinia()); useGcpStore().activeProfileId = 'gcp-1' })
  afterEach(() => vi.unstubAllGlobals())

  it('renders state changes and actions with their source', async () => {
    const calls = stubFetch({
      '/api/cloud/gcp/history/polling': POLL,
      '/api/cloud/gcp/history': [
        { id: 3, kind: 'action', source: 'user', action: 'labels', details: { added: { team: 'core' }, changed: {}, removed: ['old'] }, observedAt: '2026-09-28T12:02:00Z' },
        { id: 2, kind: 'state', source: 'poll', state: 'TERMINATED', previousState: 'RUNNING', details: {}, observedAt: '2026-09-28T12:01:00Z' },
        { id: 1, kind: 'state', source: 'observed', state: 'RUNNING', previousState: null, details: {}, observedAt: '2026-09-28T12:00:00Z' },
      ],
    })
    const w = mount(GcpStateTimeline, { props: { resourceType: 'gcp-vm', resourceKey: 'us-central1-a/web' } })
    await flushPromises()
    const items = w.findAll('[data-test="timeline"] li')
    expect(items).toHaveLength(3)
    expect(items[0].text()).toContain('Etiquetas modificadas')
    expect(items[0].text()).toContain('+team=core, -old')
    expect(items[1].text()).toContain('RUNNING')
    expect(items[1].text()).toContain('TERMINATED')
    expect(items[1].text()).toContain('sondeo')
    expect(w.text()).toContain('desactivado')
    expect(calls[0].url).toContain('type=gcp-vm')
    expect(calls[0].url).toContain('key=us-central1-a%2Fweb')
  })

  it('Cloud Run start/stop read as minimum changes in the history (R03)', async () => {
    stubFetch({
      '/api/cloud/gcp/history/polling': POLL,
      '/api/cloud/gcp/history': [
        { id: 1, kind: 'action', source: 'user', action: 'start', details: { minInstances: 1 }, observedAt: '2026-09-28T12:00:00Z' },
      ],
    })
    const w = mount(GcpStateTimeline, { props: { resourceType: 'gcp-cloud-run', resourceKey: 'us-central1/api' } })
    await flushPromises()
    const item = w.find('[data-test="timeline"] li').text()
    expect(item).toContain('Mínimo fijado en 1')
    expect(item).toContain('instancias mínimas: 1')
    expect(item).not.toContain('Iniciado')
  })

  it('shows an explanatory empty state and loads only when active', async () => {
    const calls = stubFetch({ '/api/cloud/gcp/history/polling': POLL, '/api/cloud/gcp/history': [] })
    const w = mount(GcpStateTimeline, { props: { resourceType: 'gcp-sql', resourceKey: 'db', active: false } })
    await flushPromises()
    expect(calls).toHaveLength(0)
    await w.setProps({ active: true })
    await flushPromises()
    expect(w.find('[data-test="timeline-empty"]').exists()).toBe(true)
  })
})

describe('GcpPollingSettings (#81)', () => {
  beforeEach(() => { setActivePinia(createPinia()); useGcpStore().activeProfileId = 'gcp-1' })
  afterEach(() => vi.unstubAllGlobals())

  it('loads settings, shows API reads per day and saves the changes', async () => {
    const calls = stubFetch({
      '/api/cloud/gcp/history/polling/run': { types: [{ type: 'gcp-vm', count: 2 }], error: null, settings: POLL },
      '/api/cloud/gcp/history/polling': (url, opts) => (opts.method === 'PUT' ? { ...POLL, ...JSON.parse(opts.body) } : POLL),
    })
    const w = mount(GcpPollingSettings, { props: { open: true, profileId: 'gcp-1' } })
    await flushPromises()
    expect(w.find('[data-test="poll-cost"]').text()).toContain('0')

    await w.find('[data-test="poll-enabled"]').setValue(true)
    await w.find('[data-test="poll-interval"]').setValue(30)
    expect(w.find('[data-test="poll-cost"]').text()).toContain('144')   // 48 runs × 3 types

    await w.find('[data-test="poll-run"]').trigger('click')
    await flushPromises()
    expect(w.find('[data-test="poll-run-result"]').text()).toContain('gcp-vm: 2')

    await w.find('[data-test="poll-save"]').trigger('click')
    await flushPromises()
    const put = calls.find(c => c.method === 'PUT')
    expect(put.body).toEqual({ enabled: true, intervalMinutes: 30, resourceTypes: ['gcp-vm', 'gcp-cloud-run', 'gcp-sql'], retentionDays: 90 })
    expect(w.emitted('saved')[0][0].enabled).toBe(true)
  })
})

describe('GCP info panels in English', () => {
  beforeEach(() => { settings.lang = 'en' })

  it('render labels and observations in English', () => {
    const vm = mount(GcpVmInfo, { props: { detail: VM, section: 'overview' } })
    expect(vm.text()).toContain('Observations')
    expect(vm.text()).toContain('It has a public IP')
    expect(vm.text()).toContain('ssh-keys · hidden value (540 characters)')
    expect(vm.text()).toContain('Deletion protection')
    expect(vm.text()).not.toContain('Observaciones')
  })

  it('translates the scope access and maintenance day codes sent by the server', () => {
    expect(mount(GcpVmInfo, { props: { detail: VM, section: 'overview' } }).text()).toContain('cloud-platform (full access)')
    const sql = { ...SQL, maintenance: { day: 7, hour: 4, track: 'stable' } }
    expect(mount(GcpSqlInfo, { props: { detail: sql, section: 'overview' } }).text()).toContain('Sunday 4:00 UTC')
    settings.lang = 'es'
    expect(mount(GcpVmInfo, { props: { detail: VM, section: 'overview' } }).text()).toContain('cloud-platform (acceso completo)')
    expect(mount(GcpSqlInfo, { props: { detail: sql, section: 'overview' } }).text()).toContain('Domingo 4:00 UTC')
  })
})
