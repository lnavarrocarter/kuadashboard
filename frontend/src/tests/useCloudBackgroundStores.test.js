import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAwsStore } from '../stores/useAwsStore'
import { useVercelStore } from '../stores/useVercelStore'

function pendingJsonResponse() {
  let resolve
  global.fetch = vi.fn().mockReturnValue(new Promise(done => { resolve = done }))
  return body => resolve({
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    json: () => Promise.resolve(body),
  })
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.restoreAllMocks()
})

describe('cloud store background refresh', () => {
  it('refreshes AWS without exposing global loading', async () => {
    const store = useAwsStore()
    store.setActiveProfile('local:test')
    const resolve = pendingJsonResponse()

    const pending = store.runInBackground(() => store.fetchEc2Instances())
    expect(store.loading).toBe(false)
    expect(fetch.mock.calls[0][1].headers['X-KUA-Background']).toBe('1')
    resolve([{ id: 'i-123' }])
    await pending
    expect(store.ec2Instances).toEqual([{ id: 'i-123' }])
  })

  it('refreshes Vercel without exposing global loading', async () => {
    const store = useVercelStore()
    store.setActiveProfile('profile-1')
    const resolve = pendingJsonResponse()

    const pending = store.runInBackground(() => store.fetchProjects())
    expect(store.loading).toBe(false)
    expect(fetch.mock.calls[0][1].headers['X-KUA-Background']).toBe('1')
    resolve([{ id: 'project-1' }])
    await pending
    expect(store.projects).toEqual([{ id: 'project-1' }])
  })
})