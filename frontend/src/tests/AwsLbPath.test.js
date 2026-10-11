import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))

import AwsLbPath from '../components/cloud/networking/AwsLbPath.vue'
import { useAwsStore } from '../stores/useAwsStore'
import { settings } from '../composables/useSettings'

const PATH = {
  loadBalancer: { arn: 'arn:lb', name: 'web', public: true, subnets: [{ id: 'subnet-a', zone: 'us-east-1a', cidr: '10.0.0.0/24', defaultRoute: { kind: 'internet', target: 'igw-1' } }] },
  groups: [{
    arn: 'tg-1', name: 'api', protocol: 'HTTP', port: 8080, healthCheck: { port: 'traffic-port', path: '/health' },
    targets: [{ id: 'i-1', port: 8080, healthCheckPort: 8080, state: 'unhealthy', reason: 'Target.Timeout', instance: { name: 'api-1' },
      subnet: { id: 'subnet-app', cidr: '10.0.10.0/24', defaultRoute: { kind: 'nat', target: 'nat-1' } },
      traffic: { verdict: 'blocked', rule: null }, healthCheck: { verdict: 'blocked', rule: null } }],
  }],
  findings: [{ level: 'critical', key: 'targetPortBlocked', params: { target: 'i-1', port: 8080, group: 'api' } }],
  notes: ['nacl'],
}

describe('load balancer network path', () => {
  beforeEach(() => { settings.lang = 'en'; setActivePinia(createPinia()) })
  afterEach(() => vi.restoreAllMocks())

  it('reads only when asked and explains a Target.Timeout', async () => {
    const store = useAwsStore()
    const fetchPath = vi.spyOn(store, 'fetchLoadBalancerPath').mockResolvedValue(PATH)
    const wrapper = mount(AwsLbPath, { props: { lb: { id: 'lb-1', arn: 'arn:lb' } } })
    expect(fetchPath).not.toHaveBeenCalled()
    await wrapper.get('[data-test="elb-path-check"]').trigger('click')
    await flushPromises()
    expect(fetchPath).toHaveBeenCalledWith({ id: 'lb-1', arn: 'arn:lb' })
    expect(wrapper.get('[data-test="elb-path-findings"]').text()).toContain('i-1: no security group rule lets the load balancer reach port 8080 (target group api). This explains a Target.Timeout.')
    const target = wrapper.get('[data-test="elb-path-target"]')
    expect(target.text()).toContain('api-1 · i-1:8080')
    expect(target.text()).toContain('NAT gateway nat-1')
    expect(wrapper.get('[data-test="elb-path-traffic"]').text()).toBe('8080 not allowed')
    expect(wrapper.text()).toContain('Network ACLs are not evaluated')
  })
})
