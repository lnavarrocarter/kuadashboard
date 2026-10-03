import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))
const apiFetch = vi.fn()
vi.mock('../composables/useApi', () => ({ useApi: () => ({ apiFetch }) }))

import { claudeCommand, codexCommand, codexToml, jsonConfig } from '../lib/mcpSetup'
import { settings } from '../composables/useSettings'
import AgentConnectModal from '../components/advisor/AgentConnectModal.vue'

const PACKAGED = {
  packaged: true,
  command: 'C:\\Program Files\\KuaDashboard\\KuaDashboard.exe',
  args: ['C:\\Program Files\\KuaDashboard\\resources\\app.asar.unpacked\\mcp\\server.mjs'],
  env: { ELECTRON_RUN_AS_NODE: '1' },
}
const REPO = { packaged: false, command: 'node', args: ['/home/me/kuadashboard/mcp/server.mjs'], env: {} }

describe('mcpSetup', () => {
  it('builds the Claude Code command with env flags after the name and quoted paths', () => {
    expect(claudeCommand(PACKAGED)).toBe('claude mcp add kua --scope user -e ELECTRON_RUN_AS_NODE=1 -- "C:\\Program Files\\KuaDashboard\\KuaDashboard.exe" "C:\\Program Files\\KuaDashboard\\resources\\app.asar.unpacked\\mcp\\server.mjs"')
    expect(claudeCommand(REPO)).toBe('claude mcp add kua --scope user -- node /home/me/kuadashboard/mcp/server.mjs')
  })

  it('builds the Codex command', () => {
    expect(codexCommand({ ...REPO, env: { KUA_URL: 'http://localhost:7192' } })).toBe('codex mcp add kua --env KUA_URL=http://localhost:7192 -- node /home/me/kuadashboard/mcp/server.mjs')
  })

  it('builds JSON and TOML configs that parse back to the same launch', () => {
    expect(JSON.parse(jsonConfig(PACKAGED))).toEqual({ mcpServers: { kua: { command: PACKAGED.command, args: PACKAGED.args, env: PACKAGED.env } } })
    expect(JSON.parse(jsonConfig(REPO)).mcpServers.kua).not.toHaveProperty('env')

    const toml = codexToml(PACKAGED)
    expect(toml).toContain('[mcp_servers.kua]')
    expect(toml).toContain('command = "C:\\\\Program Files\\\\KuaDashboard\\\\KuaDashboard.exe"')
    expect(toml).toContain('env = { ELECTRON_RUN_AS_NODE = "1" }')
    expect(codexToml(REPO)).not.toContain('env =')
  })
})

describe('AgentConnectModal', () => {
  beforeEach(() => {
    settings.lang = 'en'
    apiFetch.mockReset()
    document.body.innerHTML = ''
  })

  it('loads the launch from the backend and switches between clients', async () => {
    apiFetch.mockResolvedValue(PACKAGED)
    const wrapper = mount(AgentConnectModal, { props: { show: true }, attachTo: document.body })
    await flushPromises()
    expect(apiFetch).toHaveBeenCalledWith('/api/system/mcp')
    const snippet = () => document.querySelector('[data-test="agent-connect-snippet"]').textContent
    expect(snippet()).toBe(claudeCommand(PACKAGED))
    expect(document.body.textContent).toContain('Node.js is not needed')

    document.querySelector('[data-test="agent-connect-toml"]').click()
    await flushPromises()
    expect(snippet()).toBe(codexToml(PACKAGED))
    wrapper.unmount()
  })

  it('does not call the backend until it is shown', async () => {
    const wrapper = mount(AgentConnectModal, { props: { show: false }, attachTo: document.body })
    await flushPromises()
    expect(apiFetch).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
