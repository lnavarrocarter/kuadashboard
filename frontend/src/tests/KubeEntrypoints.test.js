import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import KubeEntrypoints from '../components/KubeEntrypoints.vue'
import { useKubeStore } from '../stores/useKubeStore'
import * as Api from '../composables/useApi'
import { settings } from '../composables/useSettings'

const response = () => ({ context: 'home', entries: [{ kind: 'Ingress', resource: 'ingresses', name: '<img src=x onerror=alert(1)>', namespace: 'shop', type: 'Ingress', addresses: ['10.0.0.2'], className: 'traefik', tlsConfigured: true, routes: [{ host: 'shop.example', path: '/', backend: 'web:80', tls: true }] }], unavailable: [] })
describe('Kubernetes entry points', () => {
  let store, spy
  beforeEach(() => {
    setActivePinia(createPinia())
    store = useKubeStore()
    store.currentContext = 'home'
    store.namespace = 'shop'
    vi.restoreAllMocks()
    spy = vi.spyOn(Api, 'api').mockResolvedValue(response())
  })
  it('reads only on demand, renders plain text routes and navigates through a button', async () => {
    const wrapper = mount(KubeEntrypoints)
    expect(spy).not.toHaveBeenCalled()
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(spy).toHaveBeenCalledWith('GET', '/api/entrypoints?namespace=shop')
    expect(wrapper.text()).toContain('shop.example/ → web:80')
    expect(wrapper.text()).toContain('10.0.0.2')
    expect(wrapper.find('img').exists()).toBe(false)
    await wrapper.get('.entrypoints-link').trigger('click')
    expect(wrapper.emitted('navigate')[0]).toEqual([{ resource: 'ingresses', filter: response().entries[0].name, namespace: 'shop' }])
  })
  it('shows partial permission failures without claiming an empty inventory', async () => {
    spy.mockResolvedValue({ context: 'home', entries: [], unavailable: [{ resource: 'services', reason: 'forbidden' }] })
    const wrapper = mount(KubeEntrypoints)
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Could not read services')
    expect(wrapper.text()).not.toContain('No Ingress, LoadBalancer')
  })
  it('discards late replies after a context switch and clears the old inventory', async () => {
    let finish
    spy.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const wrapper = mount(KubeEntrypoints)
    await wrapper.get('button').trigger('click')
    store.currentContext = 'other'
    await flushPromises()
    finish(response())
    await flushPromises()
    expect(wrapper.find('table').exists()).toBe(false)
    expect(wrapper.get('button').attributes('disabled')).toBeUndefined()
  })
  it('rejects a response from a different active server context and allows retry', async () => {
    spy.mockResolvedValue({ ...response(), context: 'other' })
    const wrapper = mount(KubeEntrypoints)
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('active cluster changed')
    expect(wrapper.find('table').exists()).toBe(false)
  })
  it('renders Spanish and empty states', async () => {
    settings.lang = 'es'
    try {
      spy.mockResolvedValue({ context: 'home', entries: [], unavailable: [] })
      const wrapper = mount(KubeEntrypoints)
      await wrapper.get('button').trigger('click')
      await flushPromises()
      expect(wrapper.text()).toContain('Entradas de red')
      expect(wrapper.text()).toContain('Sin entradas Ingress')
    } finally { settings.lang = 'en' }
  })
})
