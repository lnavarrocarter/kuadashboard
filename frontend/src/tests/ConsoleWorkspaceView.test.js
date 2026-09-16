import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { nextTick } from 'vue'
import ConsoleWorkspaceView from '../components/ConsoleWorkspaceView.vue'
import { useTerminalStore } from '../stores/useTerminalStore'
import { useKubeStore } from '../stores/useKubeStore'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))

const { startLogStream, startExecStream, startLocalStream } = vi.hoisted(() => ({
  startLogStream: vi.fn(),
  startExecStream: vi.fn(),
  startLocalStream: vi.fn(),
}))
vi.mock('../composables/useTerminalStreams', () => ({
  useTerminalStreams: () => ({ startLogStream, startExecStream, startLocalStream }),
}))

describe('ConsoleWorkspaceView', () => {
  let store, kubeStore, wrapper

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useTerminalStore()
    kubeStore = useKubeStore()
    kubeStore.contexts = [{ name: 'test-context' }]
    startLogStream.mockClear()
    startExecStream.mockClear()
    startLocalStream.mockClear()
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

    expect(startLogStream).toHaveBeenCalledWith(expect.objectContaining({ id: logTab.id }))
    expect(startExecStream).toHaveBeenCalledWith(expect.objectContaining({ id: execTab.id }))
    expect(startLocalStream).toHaveBeenCalledWith(expect.objectContaining({ id: localTab.id }))
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

  it('shows planned capabilities as disabled and EC2 as available elsewhere, never as a launchable button', () => {
    wrapper = mount(ConsoleWorkspaceView)
    const text = wrapper.text()

    expect(wrapper.findAll('.console-planned-badge')).toHaveLength(3) // aws-ssm, gcp-shell, vercel-logs
    expect(text).toContain('aws-ssm')
    expect(text).toContain('gcp-shell')
    expect(text).toContain('vercel-logs')

    const hints = wrapper.findAll('.console-hint')
    expect(hints).toHaveLength(2) // ec2-ssh, ec2-rdp
    expect(text).toContain('ec2-ssh')
    expect(text).toContain('ec2-rdp')
    expect(wrapper.find('.console-capability-row button').exists()).toBe(false)
  })
})
