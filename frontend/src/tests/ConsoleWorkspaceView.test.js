import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { nextTick } from 'vue'
import ConsoleWorkspaceView from '../components/ConsoleWorkspaceView.vue'
import { useTerminalStore } from '../stores/useTerminalStore'
import { useKubeStore } from '../stores/useKubeStore'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))

const { startLogStream, startExecStream, startLocalStream, startSshStream, startSsmStream, startGcpLogsStream, startVercelLogsStream } = vi.hoisted(() => ({
  startLogStream: vi.fn(),
  startExecStream: vi.fn(),
  startLocalStream: vi.fn(),
  startSshStream: vi.fn(),
  startSsmStream: vi.fn(),
  startGcpLogsStream: vi.fn(),
  startVercelLogsStream: vi.fn(),
}))
vi.mock('../composables/useTerminalStreams', () => ({
  useTerminalStreams: () => ({ startLogStream, startExecStream, startLocalStream, startSshStream, startSsmStream, startGcpLogsStream, startVercelLogsStream }),
}))

describe('ConsoleWorkspaceView', () => {
  let store, kubeStore, wrapper

  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    store = useTerminalStore()
    kubeStore = useKubeStore()
    kubeStore.contexts = [{ name: 'test-context' }]
    startLogStream.mockClear()
    startExecStream.mockClear()
    startLocalStream.mockClear()
    startSshStream.mockClear()
    startSsmStream.mockClear()
    startGcpLogsStream.mockClear()
    startVercelLogsStream.mockClear()
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => [{ id: 'session-manager-plugin', installed: true }],
    })))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  afterEach(() => {
    wrapper?.unmount()
  })

  it('renders one row per active session with provider/environment/target/status', async () => {
    store.openLogsTab('orders', 'api-1', ['app'])
    wrapper = mount(ConsoleWorkspaceView)
    await nextTick()

    const rows = wrapper.findAll('.console-row')
    expect(rows).toHaveLength(1)
    expect(rows[0].text()).toContain('kubernetes')
    expect(rows[0].text()).toContain('default')
    expect(rows[0].text()).toContain('orders/api-1')
    expect(rows[0].text()).toContain('idle')
  })

  it('shows both quick-panel and workspace sessions from the same store', async () => {
    wrapper = mount(ConsoleWorkspaceView)
    expect(wrapper.findAll('.console-row')).toHaveLength(0)

    store.openLocalTab()
    await nextTick()
    expect(store.tabs).toHaveLength(1)
    // The workspace reads store.tabs directly (no local copy), so it reflects
    // sessions opened from anywhere else in the app without a remount.
    expect(wrapper.findAll('.console-row')).toHaveLength(1)
  })

  // #43: contextual actions from Aws/Gcp/VercelView and App.vue all call the same
  // store functions a manual launcher would — this proves every transport, not just
  // local, converges on one shared list regardless of which surface opened it.
  it('shows a session opened via every open*Tab function in the same shared list, for every transport', async () => {
    wrapper = mount(ConsoleWorkspaceView)
    expect(wrapper.findAll('.console-row')).toHaveLength(0)

    store.openLogsTab('orders', 'api-1', ['app'])
    store.openExecTab('orders', 'api-2', ['app'])
    store.openLocalTab()
    store.openCloudTab('ec2', 'ec2-user@10.0.0.1', { profileId: 'p1', target: { host: '10.0.0.1', user: 'ec2-user', instanceId: 'i-1' } })
    store.openCloudTab('ssm', 'i-2', { profileId: 'p1', target: { instanceId: 'i-2' } })
    store.openCloudTab('gcp-logs', 'svc-1', { profileId: 'p1', region: 'us-central1', target: { name: 'svc-1' } })
    store.openCloudTab('vercel', 'dpl_1', { profileId: 'p1', target: { name: 'dpl_1' } })
    await nextTick()

    expect(store.tabs).toHaveLength(7)
    expect(wrapper.findAll('.console-row')).toHaveLength(7)
  })

  it('closes a session from the workspace', async () => {
    store.openLocalTab()
    wrapper = mount(ConsoleWorkspaceView)
    await wrapper.find('.console-action-close').trigger('click')
    expect(store.tabs).toHaveLength(0)
  })

  it('reconnects a session using the stream matching its type', async () => {
    const logTab = store.openLogsTab('orders', 'api-1', ['app'])
    const execTab = store.openExecTab('orders', 'api-1', ['app'])
    const localTab = store.openLocalTab()
    wrapper = mount(ConsoleWorkspaceView)

    const reconnectButtons = wrapper.findAll('.console-action-reconnect')
    expect(reconnectButtons).toHaveLength(3)
    for (const button of reconnectButtons) await button.trigger('click')

    expect(startLogStream).toHaveBeenCalledWith(expect.objectContaining({ id: logTab.id }), false, { reconnect: true })
    expect(startExecStream).toHaveBeenCalledWith(expect.objectContaining({ id: execTab.id }), { reconnect: true })
    expect(startLocalStream).toHaveBeenCalledWith(expect.objectContaining({ id: localTab.id }), { reconnect: true })
  })

  it('launches a local shell session from the launcher', async () => {
    wrapper = mount(ConsoleWorkspaceView)
    await wrapper.find('.console-launcher-card button.primary').trigger('click')
    expect(store.tabs).toHaveLength(1)
    expect(store.tabs[0].type).toBe('local')
    expect(startLocalStream).toHaveBeenCalledTimes(1)
  })

  it('disables Kubernetes connect actions until namespace and name are filled, then launches logs/exec', async () => {
    wrapper = mount(ConsoleWorkspaceView)
    const [logsButton, execButton] = wrapper.findAll('.console-launcher-actions button')
    expect(logsButton.attributes('disabled')).toBeDefined()
    expect(execButton.attributes('disabled')).toBeDefined()

    wrapper.vm.kubeForm.namespace = 'orders'
    wrapper.vm.kubeForm.name = 'api-1'
    await nextTick()
    expect(logsButton.attributes('disabled')).toBeUndefined()
    expect(execButton.attributes('disabled')).toBeUndefined()

    await logsButton.trigger('click')
    expect(store.tabs).toHaveLength(1)
    expect(store.tabs[0].type).toBe('log')
    expect(startLogStream).toHaveBeenCalledTimes(1)

    await execButton.trigger('click')
    expect(store.tabs).toHaveLength(2)
    expect(store.tabs[1].type).toBe('exec')
    expect(startExecStream).toHaveBeenCalledTimes(1)
  })

  // #39/#41/#42 migrated ec2-ssh/aws-ssm/gcp-logs/vercel-logs into the shared store, so
  // they all get their own launcher card instead of an "available elsewhere" hint or a
  // generic planned/unavailable row — only ec2-rdp (stays in its own AwsView modal) and
  // gcp-shell (genuinely unavailable, no service-account path to Cloud Shell) remain in
  // the generic capability list.
  it('shows ec2-rdp as available elsewhere and gcp-shell as unavailable with a reason, no planned capabilities left', async () => {
    wrapper = mount(ConsoleWorkspaceView)
    await flushPromises()
    const text = wrapper.text()

    expect(wrapper.findAll('.console-planned-badge')).toHaveLength(0)
    expect(text).not.toContain('vercel-logs')
    expect(text).not.toContain('aws-ssm')
    expect(text).not.toContain('gcp-logs')

    const hints = wrapper.findAll('.console-hint')
    expect(hints).toHaveLength(1) // ec2-rdp
    expect(text).toContain('ec2-rdp')

    const unavailable = wrapper.findAll('.console-unavailable-badge')
    expect(unavailable).toHaveLength(1) // gcp-shell
    expect(text).toContain('gcp-shell')
    expect(unavailable[0].attributes('title')).toMatch(/interactive per-user OAuth/)

    expect(wrapper.find('.console-capability-row button').exists()).toBe(false)
  })

  it('launches a GCP Cloud Run logs session with project/region/service/profile', async () => {
    wrapper = mount(ConsoleWorkspaceView)
    await flushPromises()
    const card = wrapper.findAll('.console-launcher-card').find(c => c.text().includes('GCP Logs'))
    const connectButton = card.find('button')
    expect(connectButton.attributes('disabled')).toBeDefined()

    wrapper.vm.gcpLogsForm.project = 'proj-1'
    wrapper.vm.gcpLogsForm.region = 'us-central1'
    wrapper.vm.gcpLogsForm.service = 'my-svc'
    wrapper.vm.gcpLogsForm.profileId = 'profile-1'
    await nextTick()
    expect(connectButton.attributes('disabled')).toBeUndefined()

    await connectButton.trigger('click')
    expect(store.tabs).toHaveLength(1)
    expect(store.tabs[0]).toMatchObject({ type: 'gcp-logs', provider: 'gcp', profileId: 'profile-1', project: 'proj-1', region: 'us-central1' })
    expect(store.tabs[0].target).toMatchObject({ name: 'my-svc' })
    expect(startGcpLogsStream).toHaveBeenCalledTimes(1)
  })

  // #43: the project id is resolved from the credential profile server-side
  // (lib/gcpLogsBroker.js), so requiring the user to type it here was pure friction.
  it('launches a GCP Cloud Run logs session without a project id, resolved from the profile', async () => {
    wrapper = mount(ConsoleWorkspaceView)
    await flushPromises()
    const card = wrapper.findAll('.console-launcher-card').find(c => c.text().includes('GCP Logs'))
    const connectButton = card.find('button')

    wrapper.vm.gcpLogsForm.region = 'us-central1'
    wrapper.vm.gcpLogsForm.service = 'my-svc'
    wrapper.vm.gcpLogsForm.profileId = 'profile-1'
    await nextTick()
    expect(connectButton.attributes('disabled')).toBeUndefined()

    await connectButton.trigger('click')
    expect(store.tabs).toHaveLength(1)
    expect(store.tabs[0].project).toBeFalsy()
  })

  it('launches a Vercel deployment logs session with deployment id/profile', async () => {
    wrapper = mount(ConsoleWorkspaceView)
    await flushPromises()
    const card = wrapper.findAll('.console-launcher-card').find(c => c.text().includes('Vercel'))
    const connectButton = card.find('button')
    expect(connectButton.attributes('disabled')).toBeDefined()

    wrapper.vm.vercelForm.deploymentId = 'dpl_123'
    wrapper.vm.vercelForm.profileId = 'profile-1'
    await nextTick()
    expect(connectButton.attributes('disabled')).toBeUndefined()

    await connectButton.trigger('click')
    expect(store.tabs).toHaveLength(1)
    expect(store.tabs[0]).toMatchObject({ type: 'vercel', provider: 'vercel', profileId: 'profile-1' })
    expect(store.tabs[0].target).toMatchObject({ name: 'dpl_123' })
    expect(startVercelLogsStream).toHaveBeenCalledTimes(1)
  })

  it('disables the EC2 SSH launcher until host and profile are filled, then launches a session', async () => {
    wrapper = mount(ConsoleWorkspaceView)
    const connectButton = wrapper.findAll('.console-launcher-card').find(card => card.text().includes('EC2 SSH')).find('button')
    expect(connectButton.attributes('disabled')).toBeDefined()

    wrapper.vm.ec2Form.host = '1.2.3.4'
    wrapper.vm.ec2Form.profileId = 'profile-1'
    await nextTick()
    expect(connectButton.attributes('disabled')).toBeUndefined()

    await connectButton.trigger('click')
    expect(store.tabs).toHaveLength(1)
    expect(store.tabs[0]).toMatchObject({ type: 'ec2', provider: 'aws', profileId: 'profile-1' })
    expect(store.tabs[0].target).toMatchObject({ host: '1.2.3.4', user: 'ec2-user' })
    expect(startSshStream).toHaveBeenCalledTimes(1)
  })

  it('disables the SSM launcher when session-manager-plugin is not installed, with an install hint', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => [{ id: 'session-manager-plugin', installed: false }],
    })))
    wrapper = mount(ConsoleWorkspaceView)
    await flushPromises()

    const card = wrapper.findAll('.console-launcher-card').find(c => c.text().includes('AWS SSM'))
    expect(card.find('.console-hint').exists()).toBe(true)
    wrapper.vm.ssmForm.instanceId = 'i-123'
    wrapper.vm.ssmForm.profileId = 'profile-1'
    await nextTick()
    expect(card.find('button').attributes('disabled')).toBeDefined()
  })

  it('requires the plugin, an instance id and a profile before enabling the SSM launcher, then confirms before connecting', async () => {
    wrapper = mount(ConsoleWorkspaceView)
    await flushPromises()

    const card = wrapper.findAll('.console-launcher-card').find(c => c.text().includes('AWS SSM'))
    const connectButton = card.find('button')
    expect(connectButton.attributes('disabled')).toBeDefined()

    wrapper.vm.ssmForm.instanceId = 'i-0123456789abcdef0'
    wrapper.vm.ssmForm.profileId = 'profile-1'
    await nextTick()
    expect(connectButton.attributes('disabled')).toBeUndefined()

    await connectButton.trigger('click')
    // Connecting requires confirming first — no tab/stream yet.
    expect(store.tabs).toHaveLength(0)
    expect(startSsmStream).not.toHaveBeenCalled()
    expect(wrapper.vm.showSsmConfirm).toBe(true)

    wrapper.vm.confirmSsmConnect()
    await nextTick()
    expect(store.tabs).toHaveLength(1)
    expect(store.tabs[0]).toMatchObject({ type: 'ssm', provider: 'aws', profileId: 'profile-1' })
    expect(store.tabs[0].target).toMatchObject({ instanceId: 'i-0123456789abcdef0' })
    expect(startSsmStream).toHaveBeenCalledTimes(1)
  })
})
