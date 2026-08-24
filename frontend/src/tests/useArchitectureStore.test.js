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
      if (url.includes('/projects/project-a/changes')) return response([{ id: 'change-a', revision: 2 }])
      throw new Error(`Unexpected URL: ${url}`)
    })
    store.setActiveProfile('local:dev')

    await store.loadProjects()

    expect(store.selectedProjectId).toBe('project-a')
    expect(store.graph.revision).toBe(2)
    expect(store.snapshots).toHaveLength(1)
    expect(store.changes).toHaveLength(1)
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

  it('reverts from the current revision and refreshes change history', async () => {
    global.fetch = vi.fn((url, options = {}) => {
      if (url.endsWith('/snapshots/snapshot-a/revert')) {
        expect(options.method).toBe('POST')
        expect(JSON.parse(options.body).expectedRevision).toBe(4)
        return response({
          graph: { revision: 5, document: { nodes: [], edges: [], sources: [] } },
          snapshot: { id: 'snapshot-b', version: 2, sourceRevision: 5 },
        }, 201)
      }
      if (url.includes('/changes')) return response([{ id: 'change-b', revision: 5, type: 'snapshot.revert' }])
      throw new Error(`Unexpected URL: ${url}`)
    })
    store.setActiveProfile('local:dev')
    store.selectedProjectId = 'project-a'
    store.graph = { revision: 4, document: { nodes: [], edges: [] } }

    const result = await store.revertSnapshot('snapshot-a', { reason: 'Restore baseline' })

    expect(result.graph.revision).toBe(5)
    expect(store.snapshots[0].version).toBe(2)
    expect(store.changes[0].type).toBe('snapshot.revert')
  })

  it('previews AWS discovery without mutation and imports only confirmed nodes', async () => {
    global.fetch = vi.fn((url, options = {}) => {
      if (url.includes('/discovery/aws/deployments')) {
        return response({
          scope: { accountId: '123456789012', region: 'us-east-1' },
          estimate: { awsRequests: 1 },
          deployments: [{ id: 'stack-a', name: 'orders' }],
        })
      }
      if (url.endsWith('/discovery/aws/preview')) {
        expect(options.method).toBe('POST')
        return response({ nodes: [{ id: 'aws:node:worker', name: 'worker' }], relationshipSuggestions: [] })
      }
      if (url.endsWith('/discovery/aws/import')) {
        const body = JSON.parse(options.body)
        expect(body.expectedRevision).toBe(3)
        expect(body.selectedNodeIds).toEqual(['aws:node:worker'])
        return response({ revision: 4, document: { nodes: [{ id: 'aws:node:worker' }], edges: [] } })
      }
      if (url.includes('/changes')) return response([{ id: 'change-import', revision: 4, type: 'discovery.import' }])
      throw new Error(`Unexpected URL: ${url}`)
    })
    store.setActiveProfile('local:dev')
    store.selectedProjectId = 'project-a'
    store.graph = { revision: 3, document: { nodes: [], edges: [] } }

    await store.loadAwsDeployments('us-east-1')
    const preview = await store.previewAwsResources({
      region: 'us-east-1', accountId: '123456789012', stackNames: ['orders'],
    })
    expect(preview.nodes).toHaveLength(1)
    expect(store.graph.revision).toBe(3)

    const graph = await store.importAwsResources({
      region: 'us-east-1', accountId: '123456789012', stackNames: ['orders'],
      selectedNodeIds: ['aws:node:worker'],
    })
    expect(graph.revision).toBe(4)
    expect(store.discoveryPreview).toBeNull()
    expect(store.changes[0].type).toBe('discovery.import')
  })
})