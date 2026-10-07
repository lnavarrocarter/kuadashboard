import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))

import AwsLoadBalancersTab from '../components/cloud/networking/AwsLoadBalancersTab.vue'
import { useAwsStore } from '../stores/useAwsStore'
import { settings } from '../composables/useSettings'

const ARN = 'arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/app/web/0123456789abcdef'

const WEB = {
  id: ARN, arn: ARN, name: 'web', type: 'application', scheme: 'internet-facing', public: true,
  dnsName: 'web-1.us-east-1.elb.amazonaws.com', state: 'active', vpcId: 'vpc-1', zones: ['us-east-1a'], securityGroups: ['sg-1'],
  ipAddressType: 'ipv4', createdAt: '2026-01-01T00:00:00.000Z',
  listeners: [
    { arn: 'l80', port: 80, protocol: 'HTTP', sslPolicy: null, oldTls: false, certificates: 0, defaultAction: { type: 'fixed-response', status: '404' } },
    { arn: 'l443', port: 443, protocol: 'HTTPS', sslPolicy: 'ELBSecurityPolicy-2016-08', oldTls: true, certificates: 1, defaultAction: { type: 'forward', targetGroups: ['api'] } },
  ],
  targetGroups: [{
    arn: 'tg', name: 'api', protocol: 'HTTP', port: 80, targetType: 'ip', healthCheck: 'HTTP /health',
    targets: { total: 2, healthy: 1, unhealthy: 1, other: 0 },
    unhealthyTargets: [{ id: '10.0.0.2', port: 80, state: 'unhealthy', reason: 'Target.FailedHealthChecks', description: 'Health checks failed' }],
  }],
  health: { status: 'warning', reasons: [{ level: 'warning', key: 'lbHttpNotRedirected', params: { port: 80 } }, { level: 'warning', key: 'lbOldTls', params: { port: 443, policy: 'ELBSecurityPolicy-2016-08' } }] },
}
const DB = {
  id: 'db', arn: null, name: 'db', type: 'network', scheme: 'internal', public: false, dnsName: 'db.elb.amazonaws.com', state: 'active',
  vpcId: null, zones: [], securityGroups: [], listeners: [{ port: 5432, protocol: 'TCP', oldTls: false, defaultAction: { type: 'forward', targetGroups: ['pg'] } }],
  targetGroups: [{ name: 'pg', protocol: 'TCP', port: 5432, targetType: 'instance', targets: { total: 1, healthy: 0, unhealthy: 1, other: 0 }, unhealthyTargets: [] }],
  health: { status: 'critical', reasons: [{ level: 'critical', key: 'lbNoHealthyTargets', params: { group: 'pg' } }] },
}

let store
beforeEach(() => {
  setActivePinia(createPinia())
  settings.lang = 'en'
  store = useAwsStore()
  store.activeProfileId = 'p1'
})
afterEach(() => vi.unstubAllGlobals())

describe('Load Balancers tab', () => {
  it('lists load balancers with exposure, listeners, target health and the cost of reading them', () => {
    store.loadBalancers = [WEB, DB]
    const wrapper = mount(AwsLoadBalancersTab)
    expect(wrapper.find('.msg-hint').text()).toContain('no charge')
    expect(wrapper.find('.elb-summary').text()).toContain('2 load balancer(s) · 1 public')
    expect(wrapper.find('.elb-summary').text()).toContain('2 need attention')
    const rows = wrapper.findAll('tbody > tr')
    expect(rows[0].text()).toContain('web')
    expect(rows[0].text()).toContain('Public')
    expect(rows[0].text()).toContain('ALB')
    expect(rows[0].text()).toContain('1/2')
    // The plain HTTP listener of a public ALB and the old TLS policy are flagged.
    expect(rows[0].findAll('.msg-chip.warn').map(chip => chip.text())).toEqual(['Public', 'HTTP:80', 'HTTPS:443'])
    expect(rows[1].text()).toContain('Internal')
    expect(rows[1].find('.status-err').text()).toBe('0/1')
  })

  it('opens the detail with rules, attributes, unhealthy targets and tags', async () => {
    store.loadBalancers = [WEB]
    const fetch = vi.fn(async () => ({
      ok: true, status: 200, headers: { get: () => 'application/json' },
      json: async () => ({
        arn: ARN,
        listeners: [{ ...WEB.listeners[1], rules: [{ priority: '10', conditions: [{ field: 'host-header', values: ['api.example.com'] }], action: { type: 'forward', targetGroups: ['api'] } }] }],
        attributes: { deletionProtection: false, accessLogs: 'alb-logs', dropInvalidHeaders: true, idleTimeoutSeconds: 60, crossZone: null },
        tags: [{ key: 'env', value: 'prod' }],
      }),
    }))
    vi.stubGlobal('fetch', fetch)
    const wrapper = mount(AwsLoadBalancersTab)
    await wrapper.find('tbody button.btn.sm:not(.btn-icon)').trigger('click')
    await flushPromises()
    expect(String(fetch.mock.calls[0][0])).toContain(`/api/cloud/aws/elb/detail?arn=${encodeURIComponent(ARN)}`)
    const detail = wrapper.find('[data-test="aws-elb-detail"]')
    expect(detail.text()).toContain('Public HTTP listener on port 80 does not redirect to HTTPS')
    expect(detail.text()).toContain('host-header: api.example.com → forward → api')
    expect(detail.text()).toContain('s3://alb-logs')
    expect(detail.text()).toContain('10.0.0.2:80')
    expect(detail.text()).toContain('Target.FailedHealthChecks')
    expect(detail.text()).toContain('env=prod')
  })

  it('reports a source that could not be read and offers to request access', async () => {
    store.loadBalancers = [DB]
    store.loadBalancersUnavailable = [{ source: 'classic', error: { message: 'not authorized' }, access: { actions: ['elasticloadbalancing:DescribeLoadBalancers'] } }]
    const wrapper = mount(AwsLoadBalancersTab)
    const notice = wrapper.find('.activity-notice')
    expect(notice.text()).toContain('Classic load balancers could not be read: not authorized')
    await notice.find('button').trigger('click')
    expect(wrapper.emitted('request-access')[0][0].access.actions).toEqual(['elasticloadbalancing:DescribeLoadBalancers'])
  })
})
