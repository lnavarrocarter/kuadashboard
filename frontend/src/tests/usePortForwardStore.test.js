import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { usePortForwardStore } from '../stores/usePortForwardStore'
import * as ApiModule from '../composables/useApi'

const PF_KEY = 'kuadashboard_pf_saved'

describe('usePortForwardStore', () => {
  let store

  beforeEach(() => {
    setActivePinia(createPinia())
    store = usePortForwardStore()
    localStorage.clear()
    vi.restoreAllMocks()
  })

  describe('load()', () => {
    it('sets list from API response', async () => {
      const pfs = [{ namespace: 'default', name: 'nginx', localPort: 8080, remotePort: 80 }]
      vi.spyOn(ApiModule, 'api').mockResolvedValue(pfs)
      await store.load()
      expect(store.list).toEqual(pfs)
    })

    it('sets empty list if API throws', async () => {
      vi.spyOn(ApiModule, 'api').mockRejectedValue(new Error('unreachable'))
      await store.load()
      expect(store.list).toEqual([])
    })
  })

  describe('start()', () => {
    it('calls the correct API endpoint and refreshes list', async () => {
      const spy = vi.spyOn(ApiModule, 'api').mockResolvedValue({})
      await store.start('default', 'nginx', 8080, 80)
      expect(spy).toHaveBeenCalledWith(
        'POST',
        '/api/default/services/nginx/portforward',
        { localPort: 8080, remotePort: 80 }
      )
      // second call is load() → GET /api/portforwards
      expect(spy).toHaveBeenCalledWith('GET', '/api/portforwards')
    })
  })

  describe('stop()', () => {
    it('calls DELETE for the given localPort and refreshes list', async () => {
      const spy = vi.spyOn(ApiModule, 'api').mockResolvedValue({})
      await store.stop(8080)
      expect(spy).toHaveBeenCalledWith('DELETE', '/api/portforward/8080')
    })
  })

  describe('persist()', () => {
    it('saves current list to localStorage', () => {
      store.list = [{ namespace: 'ns', name: 'svc', localPort: 9090, remotePort: 9090 }]
      store.persist()
      const saved = JSON.parse(localStorage.getItem(PF_KEY))
      expect(saved).toEqual(store.list)
    })
  })

  describe('autoRestore()', () => {
    it('replays saved port-forwards and loads current list', async () => {
      const saved = [
        { namespace: 'default', name: 'redis', localPort: 6379, remotePort: 6379 },
      ]
      localStorage.setItem(PF_KEY, JSON.stringify(saved))
      const spy = vi.spyOn(ApiModule, 'api').mockResolvedValue({})

      await store.autoRestore()

      expect(spy).toHaveBeenCalledWith(
        'POST',
        '/api/default/services/redis/portforward',
        { localPort: 6379, remotePort: 6379 }
      )
      // Final load()
      expect(spy).toHaveBeenCalledWith('GET', '/api/portforwards')
    })

    it('silently ignores errors for individual port-forwards', async () => {
      const saved = [
        { namespace: 'default', name: 'broken', localPort: 1234, remotePort: 1234 },
      ]
      localStorage.setItem(PF_KEY, JSON.stringify(saved))
      vi.spyOn(ApiModule, 'api').mockRejectedValue(new Error('already in use'))

      await expect(store.autoRestore()).resolves.not.toThrow()
    })

    it('does nothing when localStorage is empty', async () => {
      const spy = vi.spyOn(ApiModule, 'api').mockResolvedValue([])
      await store.autoRestore()
      // Only the final load() call, no POST
      expect(spy).toHaveBeenCalledTimes(1)
      expect(spy).toHaveBeenCalledWith('GET', '/api/portforwards')
    })
  })
})
