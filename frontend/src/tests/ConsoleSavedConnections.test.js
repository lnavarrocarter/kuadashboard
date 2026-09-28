import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { nextTick } from 'vue'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))

const streams = vi.hoisted(() => ({
  startLogStream: vi.fn(), startExecStream: vi.fn(), startLocalStream: vi.fn(), startSshStream: vi.fn(),
  startSsmStream: vi.fn(), startGcpLogsStream: vi.fn(), startVercelLogsStream: vi.fn(),
}))
vi.mock('../composables/useTerminalStreams', () => ({ useTerminalStreams: () => streams }))

import ConsoleWorkspaceView from '../components/ConsoleWorkspaceView.vue'
import { useTerminalStore } from '../stores/useTerminalStore'
import { useKubeStore } from '../stores/useKubeStore'
import { settings } from '../composables/useSettings'
import { middleTruncate, connectionFromTab, connectionTarget, providerMeta } from '../composables/consoleConnections'

describe('console connection helpers', () => {
  it('truncates long names in the middle, keeping start and end', () => {
    expect(middleTruncate('StartProcessCampaignFunction-v1-production', 24)).toBe('StartProcessC…production')
    expect(middleTruncate('short', 24)).toBe('short')
    expect(middleTruncate('StartProcessCampaignFunction-v1-production', 24)).toHaveLength(24)
  })

  it('derives reopen parameters from each kind of session, never credentials or output', () => {
    expect(connectionFromTab({ type: 'log', kubeContext: 'prod', ns: 'orders', pod: 'api', resourceType: 'deployments', lines: ['x'] }))
      .toEqual({ kind: 'log', params: { kubeContext: 'prod', namespace: 'orders', name: 'api', resourceType: 'deployments' } })
    expect(connectionFromTab({ type: 'ec2', target: { host: '10.0.0.1', user: 'ubuntu', port: 2222 }, profileId: 'p1', ws: {} }))
      .toEqual({ kind: 'ec2', params: { host: '10.0.0.1', user: 'ubuntu', port: 2222, profileId: 'p1' } })
    expect(connectionFromTab({ type: 'ssm', target: { instanceId: 'i-1' }, profileId: 'p1' })).toEqual({ kind: 'ssm', params: { instanceId: 'i-1', profileId: 'p1' } })
    expect(connectionFromTab({ type: 'unknown' })).toBeNull()
  })

  it('describes saved targets and gives each provider an icon and color', () => {
    expect(connectionTarget({ kind: 'exec', params: { kubeContext: 'prod', namespace: 'orders', name: 'api' } })).toBe('prod · orders/api · exec')
    expect(connectionTarget({ kind: 'ec2', params: { user: 'ubuntu', host: 'h', port: 2222 } })).toBe('ubuntu@h:2222 · ssh')
    expect(providerMeta('aws')).toMatchObject({ icon: 'cloud', label: 'AWS' })
    expect(providerMeta('kubernetes').label).toBe('Kubernetes')
  })
})

describe('terminal store: saved connections and renaming', () => {
  let store
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    store = useTerminalStore()
  })

  it('saves, renames, touches and deletes connections', () => {
    const tab = store.openLogsTab('orders', 'api-1', ['app'])
    const saved = store.saveConnection(tab, 'Orders API logs')
    expect(saved).toMatchObject({ name: 'Orders API logs', kind: 'log', params: { namespace: 'orders', name: 'api-1' } })
    expect(store.isSaved(tab)).toBe(true)
    expect(store.renameConnection(saved.id, '  Orders prod  ')).toBe(true)
    expect(store.savedConnections[0].name).toBe('Orders prod')
    store.touchConnection(saved.id)
    expect(store.savedConnections[0].lastUsed).toBeTypeOf('number')
    store.deleteConnection(saved.id)
    expect(store.savedConnections).toEqual([])
  })

  it('does not duplicate a saved target; saving again renames it', () => {
    const tab = store.openExecTab('orders', 'api-1', [])
    store.saveConnection(tab, 'First')
    store.saveConnection(tab, 'Second')
    expect(store.savedConnections.map(c => c.name)).toEqual(['Second'])
  })

  it('keeps saved connections and tab names across reloads', () => {
    const tab = store.openLocalTab()
    store.saveConnection(tab, 'My shell')
    store.renameTab(tab.id, 'Build box')
    setActivePinia(createPinia())
    const reloaded = useTerminalStore()
    expect(reloaded.savedConnections.map(c => c.name)).toEqual(['My shell'])
    expect(reloaded.tabs[0].label).toBe('Build box')
  })

  it('ignores empty names', () => {
    const tab = store.openLocalTab()
    expect(store.renameTab(tab.id, '   ')).toBe(false)
    expect(store.saveConnection({ ...tab, label: '' }, '')).toBeNull()
  })
})

describe('ConsoleWorkspaceView: saved connections', () => {
  let store
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    settings.lang = 'en'
    store = useTerminalStore()
    useKubeStore().contexts = [{ name: 'prod' }]
    Object.values(streams).forEach(fn => fn.mockClear())
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, headers: { get: () => 'application/json' }, json: async () => [{ id: 'session-manager-plugin', installed: true }] })))
  })

  it('saves a session from the list and reopens it later with its name', async () => {
    const tab = store.openLogsTab('orders', 'api-1', ['app'], 'pods', { kubeContext: 'prod' })
    const wrapper = mount(ConsoleWorkspaceView)
    await flushPromises()
    expect(wrapper.find('.console-saved-empty').exists()).toBe(true)

    await wrapper.find('.console-action-save').trigger('click')
    await nextTick()
    const input = wrapper.find('.console-saved-item .console-rename')
    await input.setValue('Orders prod')
    await input.trigger('keydown', { key: 'Enter' })
    expect(store.savedConnections[0].name).toBe('Orders prod')
    expect(wrapper.find('.console-saved-item').text()).toContain('prod · orders/api-1 · logs')

    store.closeTab(tab.id)
    streams.startLogStream.mockClear()
    await wrapper.find('.console-saved-open').trigger('click')
    expect(streams.startLogStream).toHaveBeenCalledTimes(1)
    expect(store.tabs[0]).toMatchObject({ ns: 'orders', pod: 'api-1', kubeContext: 'prod', label: 'Orders prod' })
  })

  it('opens saved SSM connections through the confirmation first', async () => {
    store.savedConnections = [{ id: 'c1', name: 'Bastion', kind: 'ssm', params: { instanceId: 'i-0abc', profileId: 'p1' } }]
    const wrapper = mount(ConsoleWorkspaceView)
    await flushPromises()
    await wrapper.find('.console-saved-open').trigger('click')
    expect(streams.startSsmStream).not.toHaveBeenCalled()
    wrapper.findComponent({ name: 'ConfirmModal' }).vm.$emit('confirm')
    await nextTick()
    expect(streams.startSsmStream).toHaveBeenCalledTimes(1)
    expect(store.tabs[0]).toMatchObject({ label: 'Bastion', target: { instanceId: 'i-0abc' }, profileId: 'p1' })
  })

  it('renames a saved connection and deletes it after confirming', async () => {
    store.savedConnections = [{ id: 'c1', name: 'Old', kind: 'local', params: {} }]
    const wrapper = mount(ConsoleWorkspaceView)
    await flushPromises()
    await wrapper.find('.console-saved-text strong').trigger('dblclick')
    const input = wrapper.find('.console-saved-item .console-rename')
    await input.setValue('New name')
    await input.trigger('blur')
    expect(store.savedConnections[0].name).toBe('New name')

    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await wrapper.find('.console-saved-delete').trigger('click')
    expect(store.savedConnections).toEqual([])
  })

  it('renames an active session inline', async () => {
    const tab = store.openExecTab('orders', 'api-1', [])
    const wrapper = mount(ConsoleWorkspaceView)
    await flushPromises()
    await wrapper.find('.console-action-rename').trigger('click')
    const input = wrapper.find('.console-name .console-rename')
    await input.setValue('Orders shell')
    await input.trigger('keydown', { key: 'Enter' })
    expect(store.tabs.find(t => t.id === tab.id).label).toBe('Orders shell')
    expect(wrapper.find('.console-name').text()).toContain('Orders shell')
  })

  it('still opens several sessions side by side', async () => {
    const wrapper = mount(ConsoleWorkspaceView)
    await flushPromises()
    store.openLogsTab('a', 'pod-a', [])
    store.openExecTab('b', 'pod-b', [])
    store.openLocalTab()
    await nextTick()
    expect(wrapper.findAll('.console-row')).toHaveLength(3)
    expect(wrapper.findAll('.console-provider-chip').map(c => c.text())).toEqual(['Kubernetes', 'Kubernetes', 'Local'])
  })
})
