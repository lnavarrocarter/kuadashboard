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
  it('loads the KUA Application catalog and scopes projects to the selected application', async () => {
    global.fetch = vi.fn((url, options = {}) => {
      expect(options.headers['X-Profile-Id']).toBe('local:dev')
      if (url.endsWith('/applications')) return response([{ id: 'application-a', name: 'Orders', provider: 'generic' }])
      if (url.includes('/projects?applicationId=application-a')) return response([])
      throw new Error(`Unexpected URL: ${url}`)
    })
    store.setActiveProfile('local:dev')

    await store.loadApplications()
    await store.selectApplication('application-a')

    expect(store.selectedApplication.name).toBe('Orders')
    expect(store.projects).toEqual([])
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/architecture/projects?applicationId=application-a',
      expect.objectContaining({ headers: expect.objectContaining({ 'X-Profile-Id': 'local:dev' }) }),
    )
  })

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

  it('loads the shared registry for the linked application', async () => {
    global.fetch = vi.fn((url, options = {}) => {
      expect(options.headers['X-Profile-Id']).toBe('local:dev')
      if (url.endsWith('/projects')) return response([{ id: 'project-a', name: 'Orders' }])
      if (url.endsWith('/projects/project-a/graph')) return response({ revision: 1, document: { nodes: [], edges: [] } })
      if (url.endsWith('/projects/project-a/snapshots')) return response([])
      if (url.includes('/projects/project-a/changes')) return response([])
      if (url.endsWith('/projects/project-a/application')) return response({ application: { id: 'application-a', name: 'Orders', profileId: 'local:dev' } })
      if (url.endsWith('/apm/applications/application-a/registry')) {
        return response({ resources: [{ id: 'resource-a', sources: ['apm_resource'] }], relationships: [] })
      }
      throw new Error(`Unexpected URL: ${url}`)
    })
    store.setActiveProfile('local:dev')
    await store.loadProjects()
    expect(store.linkedApplication.id).toBe('application-a')

    await store.loadRegistry()

    expect(store.registry.resources).toHaveLength(1)
  })

  it('does not call the registry endpoint without a linked application', async () => {
    global.fetch = vi.fn()
    store.setActiveProfile('local:dev')

    const result = await store.loadRegistry()

    expect(result).toBeNull()
    expect(global.fetch).not.toHaveBeenCalled()
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

  it('deletes the selected project and selects the next available project', async () => {
    global.fetch = vi.fn((url, options = {}) => {
      if (url.endsWith('/projects/project-a')) {
        expect(options.method).toBe('DELETE')
        return response(null, 204)
      }
      if (url.endsWith('/projects/project-b/graph')) return response({ revision: 0, document: { nodes: [], edges: [] } })
      if (url.endsWith('/projects/project-b/snapshots')) return response([])
      if (url.includes('/projects/project-b/changes')) return response([])
      throw new Error(`Unexpected URL: ${url}`)
    })
    store.setActiveProfile('local:dev')
    store.projects = [{ id: 'project-a', name: 'Orders' }, { id: 'project-b', name: 'Payments' }]
    store.selectedProjectId = 'project-a'

    const deleted = await store.deleteProject()

    expect(deleted).toBe(true)
    expect(store.projects.map(project => project.id)).toEqual(['project-b'])
    expect(store.selectedProjectId).toBe('project-b')
    expect(store.graph.revision).toBe(0)
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

  it('loads AWS sync preview without mutating the current graph', async () => {
    global.fetch = vi.fn((url, options = {}) => {
      if (url.endsWith('/discovery/aws/sync-preview')) {
        expect(options.method).toBe('POST')
        expect(JSON.parse(options.body)).toEqual({
          region: 'us-east-1', accountId: '123456789012', stackNames: ['orders'],
        })
        return response({
          summary: {
            changeCount: 2,
            resources: { new: 1, changed: 1, unchanged: 0, missing: 0, stale: 0, manual: 0 },
            relationships: { new: 0, reinforced: 0, unchanged: 0, missingEvidence: 0, rejected: 0, manual: 0 },
          },
          resources: { new: [], changed: [], unchanged: [], missing: [], stale: [], manual: [] },
          relationships: { new: [], reinforced: [], unchanged: [], missingEvidence: [], rejected: [], manual: [] },
        })
      }
      throw new Error(`Unexpected URL: ${url}`)
    })
    store.setActiveProfile('local:dev')
    store.selectedProjectId = 'project-a'
    store.graph = { revision: 7, document: { nodes: [], edges: [] } }

    const preview = await store.previewAwsSync({
      region: 'us-east-1', accountId: '123456789012', stackNames: ['orders'],
    })

    expect(preview.summary.changeCount).toBe(2)
    expect(store.syncPreview.summary.resources.new).toBe(1)
    expect(store.graph.revision).toBe(7)
    expect(store.syncPreviewing).toBe(false)
  })

  it('imports relationships that connect a new Kubernetes resource to one already in the project', async () => {
    let imported = null
    global.fetch = vi.fn((url, options = {}) => {
      if (url.endsWith('/operations')) {
        imported = JSON.parse(options.body).operation.value
        return response({ revision: 8, document: { nodes: [], edges: [] } })
      }
      if (url.includes('/changes')) return response([])
      throw new Error(`Unexpected URL: ${url}`)
    })
    store.setActiveProfile('local:dev')
    store.selectedProjectId = 'project-a'
    store.graph = { revision: 7, document: { nodes: [], edges: [] } }
    store.kubernetesPreview = {
      sources: [{ id: 'kubernetes:context:eks', context: 'eks' }],
      nodes: [
        { id: 'deploy-1', alreadyInGraph: true },
        { id: 'pod-1', alreadyInGraph: false },
      ],
      relationships: [{ id: 'edge-1', sourceNodeId: 'deploy-1', targetNodeId: 'pod-1', relationType: 'owns' }],
    }

    // The Deployment is already in the project, so the panel does not offer it for selection.
    await store.importKubernetesResources({ selectedNodeIds: ['pod-1'] })

    expect(imported.edges).toHaveLength(1)
    // The already-present node travels as context so the edge has both ends; the server merges it.
    expect(imported.nodes.map(node => node.id).sort()).toEqual(['deploy-1', 'pod-1'])
  })
})
