import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createRefreshGate } from '../composables/refreshGate'
import { syncServerCacheSettings } from '../composables/serverCacheSettings'
import { settings, SETTINGS_DEFAULTS } from '../composables/useSettings'

describe('refresh gate', () => {
  it('skips background reloads inside the chosen interval, per key', () => {
    let now = 0
    const gate = createRefreshGate(() => now)
    expect(gate.fresh('p1|vms', 30)).toBe(false)
    gate.mark('p1|vms')
    now = 29_000
    expect(gate.fresh('p1|vms', 30)).toBe(true)
    expect(gate.fresh('p1|sql', 30)).toBe(false)
    expect(gate.fresh('p2|vms', 30)).toBe(false)
    now = 30_000
    expect(gate.fresh('p1|vms', 30)).toBe(false)
  })

  it('an interval of 0 follows every auto-refresh tick', () => {
    const gate = createRefreshGate(() => 0)
    gate.mark('k')
    expect(gate.fresh('k', 0)).toBe(false)
  })
})

describe('server cache settings sync', () => {
  afterEach(() => {
    Object.assign(settings, { kubeListCacheSec: SETTINGS_DEFAULTS.kubeListCacheSec, kubePrometheusDiscoveryMin: SETTINGS_DEFAULTS.kubePrometheusDiscoveryMin })
    vi.unstubAllGlobals()
  })

  it('sends the Kubernetes cache choices on start and on change', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, headers: { get: () => 'application/json' }, json: async () => ({}) }))
    vi.stubGlobal('fetch', fetchMock)
    const stop = syncServerCacheSettings()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/system/cache-settings')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ kubeListCacheSec: 15, kubePrometheusDiscoveryMin: 5, metricHistoryDays: 30 })
    settings.kubeListCacheSec = 60
    await nextTick()
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: 'PUT' })
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).kubeListCacheSec).toBe(60)
    stop()
  })
})
