import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.fn()
vi.mock('../composables/useApi', () => ({ api: (...args) => api(...args) }))

describe('providers catalog (#193)', () => {
  beforeEach(() => { api.mockReset(); vi.resetModules() })

  it('lists the providers by flag from the catalog shared with the backend', async () => {
    const { providerIds } = await import('../lib/providers')
    expect(providerIds('cloudApi')).toEqual(['aws', 'gcp', 'vercel'])
    expect(providerIds('view')).toEqual(['kubernetes', 'aws', 'gcp', 'vercel'])
    expect(providerIds('observability')).toEqual(['aws', 'gcp', 'vercel', 'generic'])
    const { VIEWS } = await import('../composables/useViewUrl')
    expect(VIEWS).toEqual(['kubernetes', 'aws', 'gcp', 'vercel', 'kuapps'])
  })

  it('shows every provider until the backend answers, then only those that are on', async () => {
    let answer
    api.mockReturnValue(new Promise(resolve => { answer = resolve }))
    const { useProviders } = await import('../composables/useProviders')
    const { isProviderOn, refreshProviders } = useProviders()
    expect(isProviderOn('vercel')).toBe(true)
    answer({ providers: [{ id: 'aws', active: true }, { id: 'vercel', active: false }] })
    await vi.waitFor(() => expect(isProviderOn('vercel')).toBe(false))
    expect(isProviderOn('aws')).toBe(true)
    api.mockResolvedValue({ providers: [{ id: 'vercel', active: true }] })
    await refreshProviders()
    expect(isProviderOn('vercel')).toBe(true)
  })

  it('keeps every provider visible when the backend cannot answer', async () => {
    api.mockRejectedValue(new Error('offline'))
    const { useProviders } = await import('../composables/useProviders')
    const { isProviderOn, refreshProviders } = useProviders()
    await refreshProviders()
    expect(isProviderOn('vercel')).toBe(true)
  })
})
