import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useVercelStore } from '../stores/useVercelStore'
import * as ApiModule from '../composables/useApi'

describe('useVercelStore — race condition protection', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('changing project without changing tab triggers reload', async () => {
    const resolvers = []
    vi.spyOn(ApiModule, 'useApi').mockReturnValue({
      apiFetch: vi.fn(() => new Promise(resolve => resolvers.push(resolve))),
    })

    const store = useVercelStore()
    store.activeProfileId = 'profile-1'

    // Simulate: user is on Deployments tab, selects project A
    const projectA = { id: 'proj-a', name: 'Project A' }
    store.selectProject(projectA)
    const deployA = store.fetchDeployments('proj-a')

    // Simulate: user quickly selects project B (still on Deployments tab)
    const projectB = { id: 'proj-b', name: 'Project B' }
    store.selectProject(projectB)
    const deployB = store.fetchDeployments('proj-b')

    // Resolve in order
    resolvers[0]([{ id: 'deploy-a-1', name: 'Deploy A1' }])
    await deployA
    resolvers[1]([{ id: 'deploy-b-1', name: 'Deploy B1' }])
    await deployB

    expect(store.deployments).toEqual([{ id: 'deploy-b-1', name: 'Deploy B1' }])
  })

  it('ignores stale response from previous project', async () => {
    const resolvers = []
    vi.spyOn(ApiModule, 'useApi').mockReturnValue({
      apiFetch: vi.fn(() => new Promise(resolve => resolvers.push(resolve))),
    })

    const store = useVercelStore()
    store.activeProfileId = 'profile-1'

    // Request 1: fetch deployments for project A
    store.selectProject({ id: 'proj-a', name: 'Project A' })
    const deployA = store.fetchDeployments('proj-a')

    // Request 2: user quickly selects project B
    store.selectProject({ id: 'proj-b', name: 'Project B' })
    const deployB = store.fetchDeployments('proj-b')

    // Response 2 arrives first (project B)
    resolvers[1]([{ id: 'deploy-b-1' }])
    await deployB
    expect(store.deployments).toEqual([{ id: 'deploy-b-1' }])

    // Response 1 arrives late (project A, should be ignored)
    resolvers[0]([{ id: 'deploy-a-1' }])
    await deployA

    // Expect data from project B, NOT overwritten by stale project A response
    expect(store.deployments).toEqual([{ id: 'deploy-b-1' }])
  })

  it('clears context selections when project changes', async () => {
    const store = useVercelStore()
    store.activeProfileId = 'profile-1'

    // Setup: user selected a deployment for viewing functions
    const projectA = { id: 'proj-a' }
    store.selectProject(projectA)
    store.selectedDeploymentForFunctions = { id: 'deploy-a-1' }
    store.selectedDeploymentForChecks = { id: 'deploy-a-1' }
    store.logsDeployment = { id: 'deploy-a-1' }
    store.deploymentTarget = 'production'

    // Verify setup
    expect(store.selectedDeploymentForFunctions).toBeTruthy()
    expect(store.selectedDeploymentForChecks).toBeTruthy()
    expect(store.logsDeployment).toBeTruthy()
    expect(store.deploymentTarget).toBe('production')

    // Change project
    const projectB = { id: 'proj-b' }
    store.selectProject(projectB)

    // Verify context selections are cleared
    expect(store.selectedDeploymentForFunctions).toBeNull()
    expect(store.selectedDeploymentForChecks).toBeNull()
    expect(store.logsDeployment).toBeNull()
    expect(store.deploymentTarget).toBe('')
  })

  it('clears context selections when profile changes', async () => {
    const store = useVercelStore()

    // Setup: user selected context in profile 1
    store.setActiveProfile('profile-1')
    store.selectedProject = { id: 'proj-a' }
    store.selectedDeploymentForFunctions = { id: 'deploy-a-1' }

    // Change profile
    store.setActiveProfile('profile-2')

    // Verify everything is cleared, including selected project
    expect(store.selectedProject).toBeNull()
    expect(store.selectedDeploymentForFunctions).toBeNull()
    expect(store.activeProfileId).toBe('profile-2')
  })

  it('race condition: domains should also ignore stale responses', async () => {
    const resolvers = []
    vi.spyOn(ApiModule, 'useApi').mockReturnValue({
      apiFetch: vi.fn(() => new Promise(resolve => resolvers.push(resolve))),
    })

    const store = useVercelStore()
    store.activeProfileId = 'profile-1'

    // Request 1: fetch domains for project A
    store.selectProject({ id: 'proj-a' })
    const domainsA = store.fetchDomains('proj-a')

    // Request 2: user switches to project B
    store.selectProject({ id: 'proj-b' })
    const domainsB = store.fetchDomains('proj-b')

    // Response 2 arrives first
    resolvers[1]([{ name: 'domain-b.com' }])
    await domainsB
    expect(store.domains).toEqual([{ name: 'domain-b.com' }])

    // Response 1 arrives late and should be ignored
    resolvers[0]([{ name: 'domain-a.com' }])
    await domainsA
    expect(store.domains).toEqual([{ name: 'domain-b.com' }])
  })
})
