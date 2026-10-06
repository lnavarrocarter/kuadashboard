import { describe, it, expect, vi } from 'vitest'
import { ref, nextTick } from 'vue'
import { applicationContextFromView, useArchitectureContext } from '../composables/useArchitectureContext'

function memoryStorage(initial = {}) {
  const data = { ...initial }
  return {
    data,
    get: (k, def = '') => data[k] ?? def,
    set: (k, v) => { if (v) data[k] = v; else delete data[k] },
  }
}

describe('useArchitectureContext', () => {
  it('does not choose AWS implicitly when entering Architecture without an application', () => {
    const awsProfileId = ref('aws-profile-1')
    const { architectureProfileId } = useArchitectureContext({
      storage: memoryStorage(), awsProfileId, setProvider: vi.fn(),
    })
    expect(architectureProfileId.value).toBe('')
  })

  it('keeps the AWS fallback for legacy unlinked projects', () => {
    const awsProfileId = ref('aws-profile-1')
    const { architectureProfileId } = useArchitectureContext({
      storage: memoryStorage({ architectureProject: 'legacy-project' }), awsProfileId, setProvider: vi.fn(),
    })
    expect(architectureProfileId.value).toBe('aws-profile-1')
  })

  it('keeps a non-AWS/local application profile without overriding it with the global AWS profile', () => {
    const awsProfileId = ref('aws-profile-1')
    const { openApplicationArchitecture, architectureProfileId, activeApplicationContext } = useArchitectureContext({
      storage: memoryStorage(), awsProfileId, setProvider: vi.fn(),
    })
    openApplicationArchitecture({ applicationId: 'app-1', provider: 'kubernetes', profileId: 'local:my-context' })
    expect(activeApplicationContext.value.profileId).toBe('local:my-context')
    expect(architectureProfileId.value).toBe('local:my-context')
  })

  it('calls setProvider("architecture") when opening an application', () => {
    const setProvider = vi.fn()
    const { openApplicationArchitecture } = useArchitectureContext({
      storage: memoryStorage(), awsProfileId: ref(''), setProvider,
    })
    openApplicationArchitecture({ applicationId: 'app-1', projectId: 'proj-1' })
    expect(setProvider).toHaveBeenCalledWith('architecture')
  })

  it('persists the application context and project id to storage', async () => {
    const storage = memoryStorage()
    const { openApplicationArchitecture } = useArchitectureContext({
      storage, awsProfileId: ref(''), setProvider: vi.fn(),
    })
    openApplicationArchitecture({ applicationId: 'app-1', projectId: 'proj-1', provider: 'aws', profileId: 'aws-profile-1' })
    await nextTick()
    expect(storage.data.architectureProject).toBe('proj-1')
    expect(JSON.parse(storage.data.architectureApplication)).toMatchObject({ id: 'app-1', provider: 'aws', profileId: 'aws-profile-1' })
  })

  it('rehydrates the persisted application context on init', () => {
    const storage = memoryStorage({
      architectureApplication: JSON.stringify({ id: 'app-1', provider: 'kubernetes', profileId: 'local:ctx' }),
      architectureProject: 'proj-1',
    })
    const { activeApplicationContext, architectureProjectId, architectureProfileId } = useArchitectureContext({
      storage, awsProfileId: ref('aws-profile-1'), setProvider: vi.fn(),
    })
    expect(activeApplicationContext.value).toMatchObject({ id: 'app-1', provider: 'kubernetes' })
    expect(architectureProjectId.value).toBe('proj-1')
    expect(architectureProfileId.value).toBe('local:ctx')
  })

  it('ignores corrupted persisted application context', () => {
    const storage = memoryStorage({ architectureApplication: '{not-json' })
    const { activeApplicationContext } = useArchitectureContext({
      storage, awsProfileId: ref(''), setProvider: vi.fn(),
    })
    expect(activeApplicationContext.value).toBeNull()
  })

  it('clears the application context when opening a bare project id', () => {
    const { openApplicationArchitecture, activeApplicationContext } = useArchitectureContext({
      storage: memoryStorage(), awsProfileId: ref(''), setProvider: vi.fn(),
    })
    openApplicationArchitecture('proj-1')
    expect(activeApplicationContext.value).toBeNull()
  })

  it('never takes the global AWS profile for an application without provider', () => {
    const { openApplicationArchitecture, activeApplicationContext, architectureProfileId } = useArchitectureContext({
      storage: memoryStorage(), awsProfileId: ref('aws-profile-1'), setProvider: vi.fn(),
    })
    openApplicationArchitecture({ applicationId: 'app-1' })
    expect(activeApplicationContext.value).toMatchObject({ id: 'app-1', provider: null, profileId: null })
    expect(architectureProfileId.value).toBe('')
  })

  it('reads ?app= and keeps it in sync with the active application', async () => {
    const location = { href: 'http://localhost/?tab=x&app=app-9', search: '?tab=x&app=app-9' }
    const history = { state: null, replaceState: vi.fn((_state, _title, href) => { location.href = href; location.search = new URL(href).search }) }
    const { urlApplicationId, setApplicationContext } = useArchitectureContext({
      storage: memoryStorage(), awsProfileId: ref(''), setProvider: vi.fn(), location, history,
    })
    expect(urlApplicationId).toBe('app-9')
    setApplicationContext({ id: 'app-2', provider: null })
    await nextTick()
    expect(location.href).toBe('http://localhost/?tab=x&app=app-2')
  })

  it('does not ask to load the URL application when it is already the stored one', () => {
    const location = { href: 'http://localhost/?app=app-1', search: '?app=app-1' }
    const { urlApplicationId } = useArchitectureContext({
      storage: memoryStorage({ architectureApplication: JSON.stringify({ id: 'app-1' }) }),
      awsProfileId: ref(''), setProvider: vi.fn(), location, history: { replaceState: vi.fn() },
    })
    expect(urlApplicationId).toBe('')
  })

  it('maps an application view to the App context, legacy profile included', () => {
    expect(applicationContextFromView({ id: 'a', name: 'Orders', views: { architectureProjectIds: ['p1'] }, local: { legacy: { provider: 'aws', profileId: 'prod', region: 'us-east-1' } } }))
      .toMatchObject({ id: 'a', provider: 'aws', profileId: 'prod', architectureProjectId: 'p1' })
    expect(applicationContextFromView({ id: 'b', name: 'Checkout', local: { legacy: null } }))
      .toMatchObject({ id: 'b', provider: null, profileId: null, architectureProjectId: null })
  })

  it('setApplicationContext stores the application returned by the linked project', () => {
    const { setApplicationContext, activeApplicationContext } = useArchitectureContext({
      storage: memoryStorage(), awsProfileId: ref(''), setProvider: vi.fn(),
    })
    setApplicationContext({ id: 'app-2', provider: 'gcp', profileId: 'gcp-profile' })
    expect(activeApplicationContext.value).toMatchObject({ id: 'app-2' })
  })
})
