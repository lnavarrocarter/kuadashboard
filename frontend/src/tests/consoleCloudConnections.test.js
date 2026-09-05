import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import Ec2Shell from '../components/cloud/Ec2Shell.vue'
import Ec2Rdp from '../components/cloud/Ec2Rdp.vue'
import { capabilityRegistry } from '../shared/consoleSession.mjs'

describe.each([
  ['SSH', Ec2Shell, 'ssh'],
  ['RDP', Ec2Rdp, 'rdp'],
])('%s console boundary', (_label, component, transport) => {
  let wrapper
  beforeEach(() => {
    global.WebSocket.reset()
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
      const session = JSON.parse(options.body)
      return { ok: true, json: async () => ({
        session, ticket: 'test-ticket', path: capabilityRegistry.find(c => c.transport === transport).path,
      }) }
    }))
    wrapper = mount(component, { props: { open: true, instance: { id: 'i-123', publicIp: '127.0.0.1' } }, global: { stubs: { Teleport: true } } })
  })
  afterEach(() => {
    wrapper.unmount()
    vi.unstubAllGlobals()
  })

  it('uses only a profile ID and sends no credentials in connection frames', async () => {
    wrapper.vm.form.profileId = 'profile-1'
    wrapper.vm.form.password = 'injected-secret'
    wrapper.vm.form.privateKey = 'injected-key'
    expect(wrapper.find('input[type=password]').exists()).toBe(false)
    await wrapper.vm.connect()
    const ws = global.WebSocket.instances.at(-1)
    expect(ws).toBeDefined()
    ws._emit('open', {})
    expect(JSON.parse(ws._lastSent)).toEqual({ action: 'connect' })
    const body = fetch.mock.calls[0][1].body
    expect(body).not.toMatch(/injected-secret|injected-key/)
    expect(JSON.parse(body).profileId).toBe('profile-1')
    expect(JSON.parse(body).target.instanceId).toBe('i-123')
  })

  it('does not open a WebSocket when backend context resolution fails', async () => {
    wrapper.vm.form.profileId = 'missing'
    fetch.mockResolvedValueOnce({ ok: false })
    await wrapper.vm.connect()
    expect(global.WebSocket.instances).toHaveLength(0)
    expect(wrapper.find('[role=alert]').exists()).toBe(true)
  })
})
