import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useKubeStore } from '../stores/useKubeStore'
import * as ApiModule from '../composables/useApi'

describe('useKubeStore', () => {
  let store

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useKubeStore()
    vi.restoreAllMocks()
  })

  describe('initial state', () => {
    it('has correct defaults', () => {
      expect(store.resource).toBe('pods')
      expect(store.namespace).toBe('default')
      expect(store.rows).toEqual([])
      expect(store.contexts).toEqual([])
      expect(store.currentContext).toBe('')
      expect(store.namespaces).toEqual([])
      expect(store.loading).toBe(false)
      expect(store.error).toBeNull()
    })
  })

  describe('loadContexts()', () => {
    it('sets contexts and currentContext from API', async () => {
      vi.spyOn(ApiModule, 'api').mockResolvedValue({
        contexts: ['ctx-a', 'ctx-b'],
        current:  'ctx-a',
      })
      await store.loadContexts()
      expect(store.contexts).toEqual(['ctx-a', 'ctx-b'])
      expect(store.currentContext).toBe('ctx-a')
    })

    it('sets error when API throws', async () => {
      vi.spyOn(ApiModule, 'api').mockRejectedValue(new Error('network error'))
      await store.loadContexts()
      expect(store.error).toBe('network error')
    })
  })

  describe('loadNamespaces()', () => {
    it('puts "default" first in the list', async () => {
      vi.spyOn(ApiModule, 'api').mockResolvedValue([
        { name: 'kube-system' },
        { name: 'default' },
        { name: 'production' },
      ])
      await store.loadNamespaces()
      expect(store.namespaces[0]).toBe('default')
      expect(store.namespaces).toContain('kube-system')
      expect(store.namespaces).toContain('production')
    })

    it('prepends "default" if not present in API response', async () => {
      vi.spyOn(ApiModule, 'api').mockResolvedValue([
        { name: 'staging' },
        { name: 'production' },
      ])
      await store.loadNamespaces()
      expect(store.namespaces[0]).toBe('default')
    })

    it('sets error when API throws', async () => {
      vi.spyOn(ApiModule, 'api').mockRejectedValue(new Error('forbidden'))
      await store.loadNamespaces()
      expect(store.error).toBe('forbidden')
    })
  })

  describe('loadResources()', () => {
    it('calls correct URL for pods in a namespace', async () => {
      const spy = vi.spyOn(ApiModule, 'api').mockResolvedValue([{ name: 'pod-1' }])
      store.resource  = 'pods'
      store.namespace = 'kube-system'
      await store.loadResources()
      expect(spy).toHaveBeenCalledWith('GET', '/api/kube-system/pods')
      expect(store.rows).toEqual([{ name: 'pod-1' }])
    })

    it('calls /api/nodes for the "nodes" resource (cluster-scoped)', async () => {
      const spy = vi.spyOn(ApiModule, 'api').mockResolvedValue([])
      store.resource = 'nodes'
      await store.loadResources()
      expect(spy).toHaveBeenCalledWith('GET', '/api/nodes')
    })

    it('calls /<ns>/events URL for events', async () => {
      const spy = vi.spyOn(ApiModule, 'api').mockResolvedValue([])
      store.resource  = 'events'
      store.namespace = 'default'
      await store.loadResources()
      expect(spy).toHaveBeenCalledWith('GET', '/api/default/events')
    })

    it('sets loading true while fetching then false', async () => {
      let resolveFn
      vi.spyOn(ApiModule, 'api').mockReturnValue(new Promise(r => { resolveFn = r }))
      const p = store.loadResources()
      expect(store.loading).toBe(true)
      resolveFn([])
      await p
      expect(store.loading).toBe(false)
    })

    it('sets error and empty rows on failure', async () => {
      vi.spyOn(ApiModule, 'api').mockRejectedValue(new Error('timeout'))
      await store.loadResources()
      expect(store.rows).toEqual([])
      expect(store.error).toBe('timeout')
      expect(store.loading).toBe(false)
    })
  })

  describe('switchContext()', () => {
    it('updates currentContext and calls namespace + resource API endpoints', async () => {
      const spy = vi.spyOn(ApiModule, 'api').mockResolvedValue([])
      await store.switchContext('prod')
      expect(store.currentContext).toBe('prod')
      // switchContext calls loadNamespaces (/api/namespaces) then loadResources
      const paths = spy.mock.calls.map(c => c[1])
      expect(paths).toContain('/api/namespaces')
    })
  })

  describe('deleteContext()', () => {
    it('calls DELETE API and then reloads contexts via GET', async () => {
      const spy = vi.spyOn(ApiModule, 'api').mockResolvedValue({ contexts: [], current: '' })
      await store.deleteContext('old-ctx')
      expect(spy).toHaveBeenCalledWith('DELETE', '/api/contexts/old-ctx')
      // loadContexts is called after delete → GET /api/contexts
      expect(spy).toHaveBeenCalledWith('GET', '/api/contexts')
    })

    it('encodes special characters in context name', async () => {
      const spy = vi.spyOn(ApiModule, 'api').mockResolvedValue({})
      vi.spyOn(store, 'loadContexts').mockResolvedValue()
      await store.deleteContext('my ctx/with spaces')
      expect(spy).toHaveBeenCalledWith('DELETE', '/api/contexts/my%20ctx%2Fwith%20spaces')
    })
  })
})
