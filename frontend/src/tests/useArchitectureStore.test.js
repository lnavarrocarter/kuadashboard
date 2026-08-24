import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useArchitectureStore } from '../stores/useArchitectureStore'

function response(body, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(''),
  })
}

let store

beforeEach(() => {
  setActivePinia(createPinia())
  store = useArchitectureStore()
  vi.restoreAllMocks()
})

describe('architecture workspace', () => {
  it('loads profile-scoped projects with their graph and snapshots', async () => {
    global.fetch = vi.fn((url, options = {}) => {
      expect(options.headers['X-Profile-Id']).toBe('local:dev')
      if (url.endsWith('/projects')) return response([{ id: 'project-a', name: 'Orders' }])
      if (url.endsWith('/projects/project-a/graph')) return response({ revision: 2, document: { nodes: [], edges: [] } })
      if (url.endsWith('/projects/project-a/snapshots')) return response([{ id: 'snapshot-a', version: 1 }])
      throw new Error(`Unexpected URL: ${url}`)
    })
    store.setActiveProfile('local:dev')

    await store.loadProjects()

    expect(store.selectedProjectId).toBe('project-a')
    expect(store.graph.revision).toBe(2)
    expect(store.snapshots).toHaveLength(1)
  })

  it('creates a snapshot only through an explicit POST', async () => {
    global.fetch = vi.fn((url, options = {}) => {
      expect(url).toContain('/projects/project-a/snapshots')
      expect(options.method).toBe('POST')
      return response({ id: 'snapshot-b', version: 2, name: 'Release' }, 201)
    })
    store.setActiveProfile('local:dev')
    store.selectedProjectId = 'project-a'

    const snapshot = await store.createSnapshot({ name: 'Release' })

    expect(snapshot.version).toBe(2)
    expect(store.snapshots[0].name).toBe('Release')
  })
})