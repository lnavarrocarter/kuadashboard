import { afterEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import * as Api from '../composables/useApi'
import AwsPublicEndpointsTab from '../components/cloud/networking/AwsPublicEndpointsTab.vue'
import { settings } from '../composables/useSettings'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('loads AWS endpoint chains on activation, filters by domain, status and risk', async () => {
  settings.lang = 'en'
  const read = vi.spyOn(Api, 'api').mockResolvedValue({
    region: 'us-east-1', requests: 17, partial: false, unavailable: [],
    entries: [
      { id: 'healthy', hostname: 'shop.example.com', hops: [{ type: 'load_balancer', name: 'shop', status: 'resolved' }] },
      { id: 'unresolved', hostname: 'old.example.com', hops: [{ type: 'unresolved', status: 'unresolved', reason: 'target_not_in_selected_inventory' }] },
    ],
  })
  const panel = mount(AwsPublicEndpointsTab, { props: { active: true, profileId: 'selected', accountId: '123456789012', region: 'us-east-1' } })
  await flushPromises()

  expect(read).toHaveBeenCalledWith('GET', '/api/cloud/aws/public-endpoints', undefined, { headers: { 'X-Profile-Id': 'selected' } })
  expect(panel.text()).toContain('17 AWS API requests')
  expect(panel.text()).toContain('shop.example.com')
  expect(panel.text()).toContain('old.example.com')

  await panel.findAll('input[type="search"]')[0].setValue('999999999999')
  expect(panel.text()).toContain('No endpoint chains match these filters.')
  await panel.findAll('input[type="search"]')[0].setValue('123456789012')
  await panel.get('[data-test="domain-filter"]').setValue('old')
  expect(panel.text()).toContain('old.example.com')
  expect(panel.text()).not.toContain('shop.example.com')
  await panel.findAll('select')[0].setValue('resolved')
  expect(panel.text()).toContain('No endpoint chains match these filters.')
  await panel.findAll('select')[0].setValue('')
  await panel.findAll('select')[1].setValue('unknown')
  expect(panel.text()).toContain('old.example.com')
})

it('exports only filtered endpoint identity, evidence and chain data', async () => {
  settings.lang = 'en'
  vi.spyOn(Api, 'api').mockResolvedValue({
    region: 'us-east-1', requests: 2, partial: false, unavailable: [],
    entries: [{ id: 'one', hostname: 'api.example.com', hops: [{ type: 'route53', name: 'api.example.com', status: 'resolved' }] }],
  })
  const createObjectURL = vi.fn(() => 'blob:test')
  const revokeObjectURL = vi.fn()
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL })
  const panel = mount(AwsPublicEndpointsTab, { props: { active: true, profileId: 'selected', accountId: '123456789012', region: 'us-east-1' } })
  await flushPromises()
  await panel.get('button:nth-of-type(2)').trigger('click')

  expect(click).toHaveBeenCalledOnce()
  expect(createObjectURL).toHaveBeenCalledOnce()
  const exported = await createObjectURL.mock.calls[0][0].text()
  expect(exported).toContain('api.example.com')
  expect(exported).toContain('123456789012')
  expect(exported).not.toContain('credential')
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:test')
})

it('does not show a prior profile response after the account changes', async () => {
  settings.lang = 'en'
  const requests = []
  vi.spyOn(Api, 'api').mockImplementation((_method, _path, _body, options) => new Promise(resolve => {
    requests.push({ profile: options.headers['X-Profile-Id'], resolve })
  }))
  const panel = mount(AwsPublicEndpointsTab, { props: { active: true, profileId: 'first' } })
  await flushPromises()
  await panel.setProps({ profileId: 'second' })
  await flushPromises()
  expect(requests.map(request => request.profile)).toEqual(['first', 'second'])

  requests[0].resolve({ entries: [{ id: 'old', hostname: 'old.example.com', hops: [] }] })
  await flushPromises()
  expect(panel.text()).not.toContain('old.example.com')
  requests[1].resolve({ entries: [{ id: 'new', hostname: 'new.example.com', hops: [] }] })
  await flushPromises()
  expect(panel.text()).toContain('new.example.com')
  expect(panel.text()).not.toContain('old.example.com')
})
