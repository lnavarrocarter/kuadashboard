import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { nextTick } from 'vue'
import ConsoleWorkspaceView from '../components/ConsoleWorkspaceView.vue'
import { useTerminalStore } from '../stores/useTerminalStore'
import { useKubeStore } from '../stores/useKubeStore'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))

const { startLogStream, startExecStream, startLocalStream, startSshStream } = vi.hoisted(() => ({
  startLogStream: vi.fn(),
  startExecStream: vi.fn(),
  startLocalStream: vi.fn(),
  startSshStream: vi.fn(),
}))
vi.mock('../composables/useTerminalStreams', () => ({
  useTerminalStreams: () => ({ startLogStream, startExecStream, startLocalStream, startSshStream }),
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

  // #39 migrated ec2-ssh into the shared store, so it now gets its own launcher card
  // (like Kubernetes) instead of an "available elsewhere" hint — only ec2-rdp still
  // isn't launchable generically (it stays in its own AwsView modal, out of scope for #39).
  it('shows planned capabilities as disabled and only ec2-rdp as available elsewhere', () => {
    wrapper = mount(ConsoleWorkspaceView)
    const text = wrapper.text()

    expect(wrapper.findAll('.console-planned-badge')).toHaveLength(3) // aws-ssm, gcp-shell, vercel-logs
    expect(text).toContain('aws-ssm')
    expect(text).toContain('gcp-shell')
    expect(text).toContain('vercel-logs')

    const hints = wrapper.findAll('.console-hint')
    expect(hints).toHaveLength(1) // ec2-rdp
    expect(text).toContain('ec2-rdp')
    expect(wrapper.find('.console-capability-row button').exists()).toBe(false)
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
})
