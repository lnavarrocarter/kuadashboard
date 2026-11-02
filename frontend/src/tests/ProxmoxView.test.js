import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))

import ProxmoxView from '../components/cloud/ProxmoxView.vue'

const section = items => ({ available: true, items })
const INVENTORY = {
  scope: { provider: 'proxmox', scopeId: 'homelab', label: 'homelab' },
  cluster: { name: 'homelab', singleNode: false, quorate: true, available: true },
  summary: { nodes: 2, nodesOnline: 1, vms: 1, containers: 1, running: 1, storageFull: 0, backupJobs: null, guestsWithoutBackup: null, failedTasks24h: 0 },
  readAt: '2026-10-28T12:00:00Z',
  sections: {
    nodes: section([{ name: 'pve1', status: 'online', ip: '10.0.0.11', cpu: 0.1, maxcpu: 8, memPercent: 40, uptime: 90000, version: '8.2.4' }]),
    guests: section([
      { id: 'lxc/101', vmid: 101, type: 'lxc', name: 'dns', node: 'pve1', status: 'running', maxcpu: 1, mem: 1024, maxmem: 2048, tags: [], haState: null, backupJob: null, template: false },
      { id: 'qemu/100', vmid: 100, type: 'qemu', name: 'web', node: 'pve1', status: 'stopped', maxcpu: 2, mem: 0, maxmem: 4096, tags: ['prod'], haState: 'started', backupJob: null, template: false },
    ]),
    storage: section([]),
    backups: { available: false, reason: 'forbidden', error: 'no permission', items: [] },
    tasks: section([]),
  },
}

function respond(handler) {
  const calls = []
  global.fetch = vi.fn((url, options = {}) => {
    calls.push({ url: String(url), headers: options.headers || {} })
    const [status, body] = handler(String(url))
    return Promise.resolve({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: () => Promise.resolve(body), text: () => Promise.resolve('') })
  })
  return calls
}

describe('ProxmoxView (#195)', () => {
  it('asks for a connection when there is no profile', async () => {
    const calls = respond(() => [200, INVENTORY])
    const wrapper = mount(ProxmoxView, { props: { profileId: '' } })
    await flushPromises()
    expect(wrapper.find('[data-test="proxmox-no-profile"]').exists()).toBe(true)
    await wrapper.get('[data-test="proxmox-no-profile"] button').trigger('click')
    expect(wrapper.emitted('add-connection')).toHaveLength(1)
    expect(calls).toHaveLength(0)
  })

  it('reads the inventory of the profile and says which values were not read', async () => {
    const calls = respond(() => [200, INVENTORY])
    const wrapper = mount(ProxmoxView, { props: { profileId: 'p1', activeService: 'overview' } })
    await flushPromises()
    expect(calls[0].url).toBe('/api/cloud/proxmox/inventory')
    expect(calls[0].headers['X-Profile-Id']).toBe('p1')
    expect(wrapper.text()).toContain('homelab')
    expect(wrapper.get('[data-test="proxmox-card-nodes"]').classes()).toContain('warn')
    expect(wrapper.get('[data-test="proxmox-card-guestsWithoutBackup"]').text()).toContain('Not read')
    expect(wrapper.get('[data-test="proxmox-unavailable"]').text()).toContain('Backup jobs')
    await wrapper.setProps({ activeService: 'guests' })
    const rows = wrapper.findAll('[data-test="proxmox-guests"] tbody tr')
    expect(rows.map(row => row.find('td').text())).toEqual(['100', '101'])
  })

  it('shows why nothing was read, with the certificate the server presented', async () => {
    respond(() => [502, { error: 'The server certificate does not match the pinned fingerprint', code: 'tls', fingerprint: 'AB:CD' }])
    const wrapper = mount(ProxmoxView, { props: { profileId: 'p1' } })
    await flushPromises()
    const error = wrapper.get('[data-test="proxmox-error"]')
    expect(error.text()).toContain('could not be verified')
    expect(error.text()).toContain('AB:CD')
  })

  it('refresh reads again and a late answer of another profile is ignored', async () => {
    let resolveSlow
    const calls = []
    global.fetch = vi.fn((url, options = {}) => {
      calls.push(options.headers['X-Profile-Id'])
      const body = options.headers['X-Profile-Id'] === 'slow' ? new Promise(done => { resolveSlow = done }) : Promise.resolve(INVENTORY)
      return Promise.resolve({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: () => body, text: () => Promise.resolve('') })
    })
    const wrapper = mount(ProxmoxView, { props: { profileId: 'slow' } })
    await flushPromises()
    await wrapper.setProps({ profileId: 'p2' })
    await flushPromises()
    resolveSlow({ ...INVENTORY, cluster: { ...INVENTORY.cluster, name: 'other' } })
    await flushPromises()
    expect(wrapper.text()).toContain('homelab')
    expect(wrapper.text()).not.toContain('other')
    await wrapper.get('[data-test="proxmox-refresh"]').trigger('click')
    await flushPromises()
    expect(global.fetch.mock.calls.at(-1)[0]).toBe('/api/cloud/proxmox/inventory?refresh=1')
  })
})
