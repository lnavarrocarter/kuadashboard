import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))

import PluginsView from '../components/PluginsView.vue'

describe('PluginsView (#193)', () => {
  it('lists what a plugin reads and costs, and turns it on', async () => {
    let active = false
    const calls = []
    global.fetch = vi.fn((url, options = {}) => {
      calls.push([String(url), options.method || 'GET'])
      if (options.method === 'PUT') active = JSON.parse(options.body).active
      const body = options.method === 'PUT' ? {} : { plugins: [{ active, status: active ? { state: 'connected', detail: 'octocat' } : null, manifest: { id: 'github.cicd', name: 'GitHub CI/CD', version: '1.0.0', description: 'Explains changes.', capabilities: { historicalSearch: true, discovery: false }, reads: ['GitHub Actions runs'], credentialFields: [], cost: { level: 'free', summary: 'Read-only.' } } }] }
      return Promise.resolve({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: () => Promise.resolve(body), text: () => Promise.resolve('') })
    })
    const wrapper = mount(PluginsView)
    await flushPromises()
    const card = wrapper.get('[data-test="plugin-github.cicd"]')
    expect(card.text()).toContain('GitHub Actions runs')
    expect(card.text()).toContain('Read-only.')
    expect(wrapper.find('[data-test="plugin-status"]').exists()).toBe(false)
    await wrapper.get('[data-test="plugin-toggle-github.cicd"]').setValue(true)
    await flushPromises()
    expect(calls).toContainEqual(['/api/plugins/github.cicd', 'PUT'])
    expect(wrapper.get('[data-test="plugin-status"]').text()).toContain('octocat')
  })
})
