import { describe, it, expect, vi } from 'vitest'
import { ref, nextTick } from 'vue'
import { useArchitectureContext } from '../composables/useArchitectureContext'

function memoryStorage(initial = {}) {
  const data = { ...initial }
  return {
    data,
    get: (k, def = '') => data[k] ?? def,
    set: (k, v) => { if (v) data[k] = v; else delete data[k] },
  }
}

describe('useArchitectureContext', () => {
  it('falls back to the global AWS profile when there is no active application', () => {
    const awsProfileId = ref('aws-profile-1')
    const { architectureProfileId } = useArchitectureContext({
      storage: memoryStorage(), awsProfileId, setProvider: vi.fn(),
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

  it('setApplicationContext stores the application returned by the linked project', () => {
    const { setApplicationContext, activeApplicationContext } = useArchitectureContext({
      storage: memoryStorage(), awsProfileId: ref(''), setProvider: vi.fn(),
    })
    setApplicationContext({ id: 'app-2', provider: 'gcp', profileId: 'gcp-profile' })
    expect(activeApplicationContext.value).toMatchObject({ id: 'app-2' })
  })
})
