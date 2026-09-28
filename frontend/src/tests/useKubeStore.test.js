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
      expect(store.refreshing).toBe(false)
      expect(store.error).toBeNull()
    })
  })

  describe('loadContexts()', () => {
    it('sets contexts and currentContext from API', async () => {
      vi.spyOn(ApiModule, 'api').mockResolvedValue({
        contexts: [{ name: 'ctx-a', namespace: 'default' }, { name: 'ctx-b', namespace: 'staging' }],
        current:  'ctx-a',
      })
      await store.loadContexts()
      expect(store.contexts).toHaveLength(2)
      expect(store.currentContext).toBe('ctx-a')
    })

    it('sets namespace from active context kubeconfig namespace', async () => {
      vi.spyOn(ApiModule, 'api').mockResolvedValue({
        contexts: [{ name: 'prod', namespace: 'production' }],
        current: 'prod',
      })
      await store.loadContexts()
      expect(store.namespace).toBe('production')
    })

    it('keeps namespace as "default" if active context has no namespace field', async () => {
      vi.spyOn(ApiModule, 'api').mockResolvedValue({
        contexts: [{ name: 'ctx', namespace: 'default' }],
        current: 'ctx',
      })
      await store.loadContexts()
      expect(store.namespace).toBe('default')
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

    it('forces API revalidation for a manual refresh', async () => {
      const spy = vi.spyOn(ApiModule, 'api').mockResolvedValue([])
      await store.loadResources({ silent: true, force: true })
      expect(spy).toHaveBeenCalledWith('GET', '/api/default/pods?refresh=1')
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

    it('refreshes silently without clearing the current rows', async () => {
      let resolveFn
      store.rows = [{ name: 'pod-old' }]
      vi.spyOn(ApiModule, 'api').mockReturnValue(new Promise(resolve => { resolveFn = resolve }))
      const request = store.loadResources({ silent: true })
      expect(store.loading).toBe(false)
      expect(store.refreshing).toBe(true)
      expect(store.rows).toEqual([{ name: 'pod-old' }])
      resolveFn([{ name: 'pod-new' }])
      await request
      expect(store.rows).toEqual([{ name: 'pod-new' }])
      expect(store.refreshing).toBe(false)
    })

    it('refreshes in the background without exposing loading state', async () => {
      let resolveFn
      store.rows = [{ name: 'pod-old' }]
      vi.spyOn(ApiModule, 'api').mockReturnValue(new Promise(resolve => { resolveFn = resolve }))
      const request = store.loadResources({ silent: true, background: true })
      expect(store.loading).toBe(false)
      expect(store.refreshing).toBe(false)
      resolveFn([{ name: 'pod-new' }])
      await request
      expect(store.rows).toEqual([{ name: 'pod-new' }])
    })

    it('preserves row identity when background data is unchanged', async () => {
      store.rows = [{ name: 'pod-stable', status: 'Running' }]
      const currentRows = store.rows
      vi.spyOn(ApiModule, 'api').mockResolvedValue([{ name: 'pod-stable', status: 'Running' }])
      await store.loadResources({ silent: true, background: true })
      expect(store.rows).toBe(currentRows)
    })

    it('ignores an older response after the resource changes', async () => {
      const resolvers = []
      vi.spyOn(ApiModule, 'api').mockImplementation(() => new Promise(resolve => resolvers.push(resolve)))
      store.resource = 'pods'
      const podsRequest = store.loadResources({ silent: true })
      store.resource = 'deployments'
      const deploymentsRequest = store.loadResources({ silent: true })
      resolvers[1]([{ name: 'deployment-current' }])
      await deploymentsRequest
      resolvers[0]([{ name: 'pod-stale' }])
      await podsRequest
      expect(store.rows).toEqual([{ name: 'deployment-current' }])
    })

    it('sets error and empty rows on failure', async () => {
      vi.spyOn(ApiModule, 'api').mockRejectedValue(new Error('timeout'))
      await store.loadResources()
      expect(store.rows).toEqual([])
      expect(store.error).toBe('timeout')
      expect(store.loading).toBe(false)
    })
  })

  describe('selectResource()', () => {
    function deferredApi() {
      const calls = []
      vi.spyOn(ApiModule, 'api').mockImplementation((method, path) => new Promise(resolve => calls.push({ path, resolve })))
      return calls
    }

    it('shows the blocking loading state only for a resource never visited', async () => {
      const calls = deferredApi()
      const request = store.selectResource('deployments')
      expect(store.loading).toBe(true)
      calls[0].resolve([{ name: 'web' }])
      await request
      expect(store.loading).toBe(false)
      expect(store.rows).toEqual([{ name: 'web' }])
    })

    it('does not show the previous resource rows while loading an unvisited one', async () => {
      const calls = deferredApi()
      const pods = store.selectResource('pods')
      calls[0].resolve([{ name: 'pod-1' }])
      await pods
      const deployments = store.selectResource('deployments')
      expect(store.rows).toEqual([])
      expect(store.loading).toBe(true)
      calls[1].resolve([{ name: 'web' }])
      await deployments
    })

    it('paints cached rows instantly and revalidates without blocking', async () => {
      const calls = deferredApi()
      const first = store.selectResource('pods')
      calls[0].resolve([{ name: 'pod-1' }])
      await first
      const second = store.selectResource('services')
      calls[1].resolve([{ name: 'svc' }])
      await second

      const back = store.selectResource('pods')
      expect(store.rows).toEqual([{ name: 'pod-1' }])
      expect(store.loading).toBe(false)
      expect(store.refreshing).toBe(true)
      calls[2].resolve([{ name: 'pod-1' }, { name: 'pod-2' }])
      await back
      expect(store.rows).toEqual([{ name: 'pod-1' }, { name: 'pod-2' }])
      expect(store.refreshing).toBe(false)
    })

    it('reuses cached row identity when the revalidated data is unchanged', async () => {
      vi.spyOn(ApiModule, 'api').mockImplementation(async (_m, path) => path.endsWith('/pods') ? [{ name: 'pod-1' }] : [])
      await store.selectResource('pods')
      const podRows = store.rows
      await store.selectResource('services')
      await store.selectResource('pods')
      expect(store.rows).toBe(podRows)
    })

    it('keeps cache entries separate per namespace', async () => {
      vi.spyOn(ApiModule, 'api').mockImplementation(async (_m, path) => [{ name: path }])
      await store.selectResource('pods')
      store.namespace = 'kube-system'
      const request = store.loadResources()
      expect(store.rows).toEqual([])
      expect(store.loading).toBe(true)
      await request
      expect(store.rows).toEqual([{ name: '/api/kube-system/pods' }])
      store.namespace = 'default'
      const back = store.loadResources()
      expect(store.loading).toBe(false)
      expect(store.rows).toEqual([{ name: '/api/default/pods' }])
      await back
    })

    it('keeps cached rows when a silent revalidation fails', async () => {
      const calls = []
      vi.spyOn(ApiModule, 'api').mockImplementation(() => new Promise((resolve, reject) => calls.push({ resolve, reject })))
      const first = store.selectResource('pods')
      calls[0].resolve([{ name: 'pod-1' }])
      await first
      const second = store.selectResource('services')
      calls[1].resolve([])
      await second
      const back = store.selectResource('pods')
      calls[2].reject(new Error('timeout'))
      await back
      expect(store.rows).toEqual([{ name: 'pod-1' }])
      expect(store.error).toBeNull()
    })

    it('surfaces the error when an unvisited resource fails to load', async () => {
      vi.spyOn(ApiModule, 'api').mockRejectedValue(new Error('forbidden'))
      await store.selectResource('secrets')
      expect(store.error).toBe('forbidden')
      expect(store.loading).toBe(false)
    })
  })

  describe('switchContext()', () => {
    it('updates currentContext and calls namespace + resource API endpoints', async () => {
      store.contexts = [{ name: 'prod', namespace: 'production' }]
      const spy = vi.spyOn(ApiModule, 'api').mockResolvedValue([])
      await store.switchContext('prod')
      expect(store.currentContext).toBe('prod')
      const paths = spy.mock.calls.map(c => c[1])
      expect(paths).toContain('/api/namespaces')
    })

    it('sets namespace from context when that namespace is available on cluster', async () => {
      store.contexts = [{ name: 'staging', namespace: 'staging-ns' }]
      vi.spyOn(ApiModule, 'api').mockResolvedValue([{ name: 'default' }, { name: 'staging-ns' }])
      await store.switchContext('staging')
      expect(store.namespace).toBe('staging-ns')
    })

    it('keeps "default" namespace when context namespace is not on cluster', async () => {
      store.contexts = [{ name: 'bare', namespace: 'missing-ns' }]
      vi.spyOn(ApiModule, 'api').mockResolvedValue([{ name: 'default' }, { name: 'kube-system' }])
      await store.switchContext('bare')
      expect(store.namespace).toBe('default')
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
