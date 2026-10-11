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

describe('KUApp GitHub sync option', () => {
  beforeEach(() => { settings.lang = 'en' })

  it('enables the sync and picks repositories using the gh CLI of this computer (#238)', async () => {
    let state = { enabled: false, repositories: [] }
    respond((url, options) => {
      const method = options.method || 'GET'
      if (url.includes('/github/connection')) return { body: { available: true, authenticated: true, login: 'octocat' } }
      if (url.endsWith('/api/kua-apps/github/repositories')) return { body: { repositories: ['acme/api', 'acme/web'] } }
      if (url.endsWith('/github/activity')) return { body: { errors: [], metrics: { days: 30, deploys: 2, perWeek: 0.5, leadTimeHours: 3 }, events: [{ id: 'e1', repository: 'acme/api', number: 7, name: 'Deploy', conclusion: 'success', actor: 'ana', at: '2026-10-08T08:05:00.000Z', url: 'https://github.com/acme/api/actions/runs/7' }] } }
      if (url.endsWith('/github') && method === 'PUT') { state = JSON.parse(options.body); return { body: state } }
      if (url.endsWith('/github')) return { body: state }
      return { body: {} }
    })
    const wrapper = mount(KUAppGithubCicd, { props: { applicationId: 'app-1' } })
    await flushPromises()
    expect(wrapper.get('[data-test="github-status"]').text()).toBe('Connected as octocat')
    expect(wrapper.find('input[type="password"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="github-repo-acme/api"]').exists()).toBe(false)

    await wrapper.get('[data-test="github-enabled"]').setValue(true)
    await flushPromises()
    await wrapper.get('[data-test="github-repo-acme/api"]').setValue(true)
    await flushPromises()
    expect(state).toEqual({ enabled: true, repositories: ['acme/api'] })
    expect(wrapper.get('[data-test="github-metrics"]').text()).toContain('2 deploys (0.5/week) · lead time 3 h')
    expect(wrapper.text()).toContain('acme/api #7 · Deploy')
  })

  it('explains what to do when the gh CLI is missing or logged out', async () => {
    respond(url => (url.includes('/github/connection')
      ? { body: { available: false, authenticated: false, code: 'GH_NOT_INSTALLED' } }
      : { body: { enabled: false, repositories: [] } }))
    const wrapper = mount(KUAppGithubCicd, { props: { applicationId: 'app-1' } })
    await flushPromises()
    expect(wrapper.get('[data-test="github-unavailable"]').text()).toContain('gh auth login')
    expect(wrapper.find('[data-test="github-enabled"]').exists()).toBe(false)
  })
})
