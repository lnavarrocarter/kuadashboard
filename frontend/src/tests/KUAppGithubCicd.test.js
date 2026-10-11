import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))

import KUAppGithubCicd from '../components/kuapps/KUAppGithubCicd.vue'
import { settings } from '../composables/useSettings'

function respond(handler) {
  global.fetch = vi.fn((url, options = {}) => {
    const { status = 200, body } = handler(String(url), options)
    return Promise.resolve({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: () => Promise.resolve(body), text: () => Promise.resolve('') })
  })
}

describe('KUApp GitHub CI/CD', () => {
  beforeEach(() => { settings.lang = 'en' })

  it('connects with a token, then associates repositories and shows activity (#238)', async () => {
    let connected = false
    let repositories = []
    respond((url, options) => {
      const method = options.method || 'GET'
      if (url.endsWith('/github/connection') && method === 'GET') return { body: { connected, login: connected ? 'octocat' : null } }
      if (url.endsWith('/github/connection') && method === 'PUT') { connected = true; return { body: { connected: true } } }
      if (url.endsWith('/github/repositories') && method === 'GET') return { body: { repositories } }
      if (url.endsWith('/github/repositories') && method === 'PUT') { repositories = JSON.parse(options.body).repositories; return { body: { repositories } } }
      if (url.endsWith('/github/activity')) return { body: { errors: [], metrics: { days: 30, deploys: 2, perWeek: 0.5, leadTimeHours: 3 }, events: [{ id: 'e1', repository: 'acme/api', number: 7, name: 'Deploy', conclusion: 'success', actor: 'ana', at: '2026-10-08T08:05:00.000Z', url: 'https://github.com/acme/api/actions/runs/7' }] } }
      return { body: {} }
    })
    const wrapper = mount(KUAppGithubCicd, { props: { applicationId: 'app-1' } })
    await flushPromises()
    expect(wrapper.text()).toContain('Not connected')

    await wrapper.get('[data-test="github-token"]').setValue('ghp_secret')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.text()).toContain('Connected as octocat')
    expect(wrapper.find('[data-test="github-token"]').exists()).toBe(false)

    await wrapper.get('[data-test="github-repos"]').setValue('acme/api\n')
    await wrapper.get('[data-test="github-save"]').trigger('click')
    await flushPromises()
    const [, put] = global.fetch.mock.calls.find(([url, request]) => String(url).endsWith('/github/repositories') && request?.method === 'PUT')
    expect(JSON.parse(put.body)).toEqual({ repositories: ['acme/api'] })
    expect(wrapper.get('[data-test="github-metrics"]').text()).toContain('2 deploys (0.5/week) · lead time 3 h')
    expect(wrapper.text()).toContain('acme/api #7 · Deploy')
  })
})
