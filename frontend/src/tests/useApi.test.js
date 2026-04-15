import { describe, it, expect, vi, beforeEach } from 'vitest'
import { api } from '../composables/useApi'

function mockFetch({ ok = true, status = 200, json = null, text = '' }) {
  const ct = json !== null ? 'application/json' : 'text/plain'
  return vi.fn().mockResolvedValue({
    ok,
    status,
    headers: { get: () => ct },
    json: () => Promise.resolve(json),
    text: () => Promise.resolve(text),
  })
}

describe('useApi – api()', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('makes a GET request and returns parsed JSON', async () => {
    global.fetch = mockFetch({ json: { contexts: ['a'], current: 'a' } })
    const data = await api('GET', '/api/contexts')
    expect(fetch).toHaveBeenCalledWith('/api/contexts', expect.objectContaining({ method: 'GET' }))
    expect(data).toEqual({ contexts: ['a'], current: 'a' })
  })

  it('sends body as JSON for POST', async () => {
    global.fetch = mockFetch({ json: { ok: true } })
    await api('POST', '/api/contexts/switch', { context: 'my-ctx' })
    const call = fetch.mock.calls[0]
    expect(call[1].method).toBe('POST')
    expect(call[1].headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(call[1].body)).toEqual({ context: 'my-ctx' })
  })

  it('returns text when response is not JSON', async () => {
    global.fetch = mockFetch({ text: 'hello text', json: null })
    const result = await api('GET', '/api/health')
    expect(result).toBe('hello text')
  })

  it('throws Error with server message on 4xx JSON error', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve({ error: 'not found' }),
      text: () => Promise.resolve(''),
    })
    await expect(api('GET', '/api/missing')).rejects.toThrow('not found')
  })

  it('throws Error with "HTTP <status>" fallback when no error body', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve({ error: '' }),
      text: () => Promise.resolve(''),
    })
    await expect(api('GET', '/api/crash')).rejects.toThrow('HTTP 500')
  })

  it('throws Error with plain text body on non-JSON error', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      headers: { get: () => 'text/plain' },
      json: () => Promise.resolve({}),
      text: () => Promise.resolve('service unavailable'),
    })
    await expect(api('DELETE', '/api/something')).rejects.toThrow('service unavailable')
  })
})
