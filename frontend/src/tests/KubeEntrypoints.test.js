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

describe('AWS entry point matching', () => {
  let store, spy
  const arn = 'arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/app/shop/abcdef'
  const inventory = { loadBalancers: [{ arn, name: 'shop', dnsName: 'my-alb.example', scheme: 'internal' }] }
  const entries = () => ({ ...response(), entries: [{ ...response().entries[0], name: 'web', addresses: ['my-alb.example'] }] })
  beforeEach(() => {
    setActivePinia(createPinia())
    store = useKubeStore()
    store.currentContext = 'home'
    store.namespace = 'shop'
    vi.restoreAllMocks()
    spy = vi.spyOn(Api, 'api').mockImplementation(async (_method, path) => path === '/api/cloud/aws/elb' ? inventory : entries())
  })
  async function loaded(props = { awsProfileId: 'selected' }) {
    const wrapper = mount(KubeEntrypoints, { props })
    await wrapper.get('button').trigger('click')
    await flushPromises()
    return wrapper
  }
  it('reads AWS only on explicit request, sends the selected profile and opens the matched resource', async () => {
    const wrapper = await loaded()
    expect(spy).toHaveBeenCalledTimes(1)
    await wrapper.get('[data-test="match-aws"]').trigger('click')
    await flushPromises()
    expect(spy).toHaveBeenLastCalledWith('GET', '/api/cloud/aws/elb', undefined, { headers: { 'X-Profile-Id': 'selected' } })
    await wrapper.get('[data-test="aws-link"]').trigger('click')
    expect(wrapper.emitted('open-aws-resource')[0][0]).toMatchObject({ arn, awsProfileId: 'selected', region: 'us-east-1', name: 'shop' })
  })
  it('disables AWS reads without a profile and keeps Kubernetes visible after AWS permission failure', async () => {
    const noProfile = await loaded({})
    expect(noProfile.get('[data-test="match-aws"]').attributes('disabled')).toBeDefined()
    const wrapper = await loaded()
    spy.mockRejectedValueOnce(new Error('AWS access denied'))
    await wrapper.get('[data-test="match-aws"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('AWS access denied')
    expect(wrapper.get('table').text()).toContain('web')
  })
  it('discards a late AWS response after the profile changes', async () => {
    const wrapper = await loaded()
    let finish
    spy.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    await wrapper.get('[data-test="match-aws"]').trigger('click')
    await wrapper.setProps({ awsProfileId: 'other' })
    finish(inventory)
    await flushPromises()
    expect(wrapper.find('[data-test="aws-link"]').exists()).toBe(false)
  })
  it('displays partial inventory separately from no match and clears links after refreshing Kubernetes', async () => {
    const wrapper = await loaded()
    spy.mockResolvedValueOnce({ ...inventory, truncated: true })
    await wrapper.get('[data-test="match-aws"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('inventory is incomplete')
    expect(wrapper.find('[data-test="aws-link"]').exists()).toBe(true)
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-test="aws-link"]').exists()).toBe(false)
  })
})
