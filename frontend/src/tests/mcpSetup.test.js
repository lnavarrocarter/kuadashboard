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

  // #133: install and verify from the modal instead of pasting commands.
  const open = async () => {
    const wrapper = mount(AgentConnectModal, { props: { show: true }, attachTo: document.body })
    await flushPromises()
    return wrapper
  }
  const click = async selector => { document.querySelector(selector).click(); await flushPromises() }
  const outcome = () => document.querySelector('[data-test="agent-connect-outcome"]')?.textContent.trim()

  it('installs in Claude Code, and explains a missing CLI', async () => {
    apiFetch.mockImplementation(async (path, options) => {
      if (path === '/api/system/mcp') return REPO
      if (path === '/api/system/mcp/install' && JSON.parse(options.body).client === 'claude') return { client: 'claude', name: 'kua' }
      throw Object.assign(new Error('codex is not installed or not in PATH.'), { details: { code: 'CLI_NOT_FOUND' } })
    })
    const wrapper = await open()
    await click('[data-test="agent-connect-install"]')
    expect(apiFetch).toHaveBeenCalledWith('/api/system/mcp/install', expect.objectContaining({ method: 'POST', body: JSON.stringify({ client: 'claude' }) }))
    expect(outcome()).toBe('Added to Claude Code. Start a new agent session to load it.')

    await click('[data-test="agent-connect-codex"]')
    expect(outcome()).toBeUndefined()
    await click('[data-test="agent-connect-install"]')
    expect(outcome()).toBe('Codex CLI is not installed or not in PATH here: run the command above in the terminal where you use it.')

    await click('[data-test="agent-connect-json"]')
    expect(document.querySelector('[data-test="agent-connect-install"]')).toBeNull()
    wrapper.unmount()
  })

  it('verifies the connection and names what fails', async () => {
    const answers = [
      { ok: true, tools: 11, profiles: 3, kua: { url: 'http://localhost:7192', version: '1.17.0', reachable: true }, thisKua: 'http://localhost:7192' },
      { ok: true, tools: 11, profiles: 0, kua: { url: 'http://localhost:7190', version: '1.16.0', reachable: true }, thisKua: 'http://localhost:7192' },
      { ok: false, error: 'KUA is not reachable at http://localhost:7190 (ECONNREFUSED).', thisKua: 'http://localhost:7192' },
    ]
    apiFetch.mockImplementation(async path => (path === '/api/system/mcp' ? REPO : path === '/api/kua-apps/agent-access' ? { writes: false } : answers.shift()))
    const wrapper = await open()
    await click('[data-test="agent-connect-verify"]')
    expect(outcome()).toBe('It works: 11 tools, reading KUA 1.17.0 · http://localhost:7192 (3 cloud profiles).')
    await click('[data-test="agent-connect-verify"]')
    expect(outcome()).toBe('Another KUA is running at http://localhost:7190, and the agent will read that one. Close it, or set KUA_URL to http://localhost:7192.')
    await click('[data-test="agent-connect-verify"]')
    expect(outcome()).toBe('It does not work yet: KUA is not reachable at http://localhost:7190 (ECONNREFUSED).')
    wrapper.unmount()
  })

  it('shows agent writes off by default and turns them on in KUA (#155)', async () => {
    let writes = false
    apiFetch.mockImplementation(async (path, options = {}) => {
      if (path === '/api/system/mcp') return PACKAGED
      if (path === '/api/kua-apps/agent-access' && options.method === 'PUT') { writes = JSON.parse(options.body).writes; return { writes } }
      if (path === '/api/kua-apps/agent-access') return { writes }
      throw new Error(`unexpected ${path}`)
    })
    const wrapper = mount(AgentConnectModal, { props: { show: true }, attachTo: document.body })
    await flushPromises()
    const toggle = () => document.querySelector('[data-test="agent-writes"]')
    expect(toggle().querySelector('input').checked).toBe(false)
    expect(toggle().textContent).toContain('but not apply them')

    toggle().querySelector('input').click()
    await flushPromises()
    expect(apiFetch).toHaveBeenCalledWith('/api/kua-apps/agent-access', expect.objectContaining({ method: 'PUT', body: JSON.stringify({ writes: true }) }))
    expect(toggle().textContent).toContain('after you approve it')
    wrapper.unmount()
  })
})
