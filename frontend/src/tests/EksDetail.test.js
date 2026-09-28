import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))

import EksDetail from '../components/cloud/EksDetail.vue'
import AwsView from '../components/cloud/AwsView.vue'
import { useAwsStore } from '../stores/useAwsStore'

const DETAILS = {
  region: 'us-east-1',
  cluster: {
    name: 'prod', arn: 'arn:aws:eks:us-east-1:123:cluster/prod', status: 'ACTIVE', version: '1.30',
    platformVersion: 'eks.5', endpoint: 'https://abc.eks.amazonaws.com',
    endpointPublicAccess: true, endpointPrivateAccess: false, publicAccessCidrs: ['0.0.0.0/0'],
    roleArn: 'arn:aws:iam::123:role/eks', oidcIssuer: 'https://oidc.eks/abc',
    serviceIpv4Cidr: '172.20.0.0/16', ipFamily: 'ipv4', authenticationMode: 'API_AND_CONFIG_MAP',
    logging: ['api', 'audit'], createdAt: '2026-01-01T00:00:00Z', tags: { team: 'platform' },
  },
  network: {
    vpc: { id: 'vpc-1', cidr: '10.0.0.0/16', name: 'main', state: 'available' },
    subnets: [{ id: 'subnet-a', name: 'private-a', cidr: '10.0.1.0/24', az: 'us-east-1a', availableIps: 200, mapPublicIp: false, usedBy: ['control plane', 'node group general'] }],
    securityGroups: [{ id: 'sg-cluster', name: 'eks-cluster-sg', description: 'EKS', inboundRules: 1, outboundRules: 1, roles: ['cluster security group'] }],
  },
  nodegroups: [{
    name: 'general', status: 'ACTIVE', architecture: 'x86_64', amiType: 'AL2023_x86_64_STANDARD', capacityType: 'ON_DEMAND',
    instanceTypes: ['m6i.large'], scaling: { minSize: 2, desiredSize: 2, maxSize: 4 }, labels: {}, tags: {},
    version: '1.30', releaseVersion: '1.30.0-20260101', diskSize: 50, nodeRole: 'arn:aws:iam::123:role/node',
    subnets: ['subnet-a'], launchTemplate: null, autoScalingGroups: ['eks-general-asg'], remoteAccessSecurityGroup: null,
    healthIssues: [{ code: 'AsgInstanceLaunchFailures', message: 'capacity' }], instanceCount: 2,
  }],
  instances: [
    { id: 'i-1', name: 'prod-general-1', type: 'm6i.large', state: 'running', az: 'us-east-1a', privateIp: '10.0.1.10', subnetId: 'subnet-a', lifecycle: 'on-demand', launchTime: null, nodegroup: 'general' },
    { id: 'i-3', name: null, type: 'm7g.large', state: 'running', az: 'us-east-1b', privateIp: '10.0.2.11', subnetId: 'subnet-b', lifecycle: 'spot', launchTime: null, nodegroup: 'karpenter/default' },
  ],
  addons: [{ name: 'vpc-cni', version: 'v1.18.0-eksbuild.1', status: 'ACTIVE', serviceAccountRoleArn: null, healthIssues: [] }],
  warnings: [],
}

const CLUSTER_ROW = { name: 'prod', status: 'ACTIVE', version: '1.30', region: 'us-east-1' }

function mountDetail(props = {}) {
  return mount(EksDetail, {
    props: { open: true, cluster: CLUSTER_ROW, ...props },
    global: { stubs: { Teleport: true } },
  })
}

describe('EksDetail.vue (#69)', () => {
  let store

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useAwsStore()
  })
  afterEach(() => vi.restoreAllMocks())

  it('loads the cluster infrastructure once when opened', async () => {
    const spy = vi.spyOn(store, 'fetchEksDetails').mockResolvedValue(DETAILS)
    mountDetail()
    await flushPromises()
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith('prod')
  })

  it('renders the Info header and all tabs', async () => {
    vi.spyOn(store, 'fetchEksDetails').mockResolvedValue(DETAILS)
    const w = mountDetail()
    await flushPromises()
    expect(w.find('.eksd-id-badge').text()).toBe('v1.30')
    expect(w.findAll('.eksd-tab')).toHaveLength(5)
    for (const id of ['overview', 'network', 'nodegroups', 'instances', 'addons']) {
      expect(w.find(`[data-tab="${id}"]`).exists()).toBe(true)
    }
  })

  it('shows VPC, subnets and security groups', async () => {
    vi.spyOn(store, 'fetchEksDetails').mockResolvedValue(DETAILS)
    const w = mountDetail()
    await flushPromises()
    expect(w.find('[data-tab="overview"]').text()).toContain('vpc-1')
    const net = w.find('[data-tab="network"]').text()
    expect(net).toContain('subnet-a')
    expect(net).toContain('node group general')
    expect(net).toContain('sg-cluster')
    expect(net).toContain('cluster security group')
  })

  it('shows node groups with scaling, EC2 count and health issues', async () => {
    vi.spyOn(store, 'fetchEksDetails').mockResolvedValue(DETAILS)
    const w = mountDetail()
    await flushPromises()
    const ng = w.find('[data-tab="nodegroups"]').text()
    expect(ng).toContain('general')
    expect(ng).toContain('min 2 · deseado 2 · max 4')
    expect(ng).toContain('eks-general-asg')
    expect(ng).toContain('AsgInstanceLaunchFailures')
  })

  it('shows EC2 instances with their origin and add-ons', async () => {
    vi.spyOn(store, 'fetchEksDetails').mockResolvedValue(DETAILS)
    const w = mountDetail()
    await flushPromises()
    const inst = w.find('[data-tab="instances"]').text()
    expect(inst).toContain('i-1')
    expect(inst).toContain('karpenter/default')
    expect(inst).toContain('spot')
    expect(w.find('[data-tab="addons"]').text()).toContain('vpc-cni')
  })

  it('shows partial-data warnings per section', async () => {
    vi.spyOn(store, 'fetchEksDetails').mockResolvedValue({
      ...DETAILS, instances: [], warnings: [{ section: 'instances', message: 'not authorized to perform ec2:DescribeInstances' }],
    })
    const w = mountDetail()
    await flushPromises()
    expect(w.find('.eksd-notice').text()).toContain('Instancias EC2')
    expect(w.find('.eksd-notice').text()).toContain('ec2:DescribeInstances')
  })

  it('shows the error when the request fails', async () => {
    vi.spyOn(store, 'fetchEksDetails').mockRejectedValue(new Error('AccessDenied'))
    const w = mountDetail()
    await flushPromises()
    expect(w.find('.eksd-error').text()).toBe('AccessDenied')
  })

  it('store.fetchEksDetails calls GET /api/cloud/aws/eks/:name/details with the profile header', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, headers: { get: () => 'application/json' }, json: async () => DETAILS })
    vi.stubGlobal('fetch', fetchMock)
    store.activeProfileId = 'prof-1'
    await store.fetchEksDetails('prod cluster')
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/cloud/aws/eks/prod%20cluster/details')
    expect(opts.headers['X-Profile-Id']).toBe('prof-1')
    vi.unstubAllGlobals()
  })
})

describe('AwsView EKS table (#69)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, headers: { get: () => 'application/json' }, json: async () => [] }))
  })
  afterEach(() => vi.unstubAllGlobals())

  async function mountEksTable(clusters) {
    const store = useAwsStore()
    store.activeProfileId = 'prof-1' // the view only renders tabs with a profile selected
    const w = mount(AwsView, { props: { activeService: 'eks' }, global: { stubs: { Teleport: true } } })
    await flushPromises() // let the initial (stubbed, empty) load settle before seeding rows
    store.eksClusters = clusters
    await flushPromises()
    return w.find('.tab-panel table')
  }

  it('adds Node groups and EC2 columns and an Info action', async () => {
    const table = await mountEksTable([
      { ...CLUSTER_ROW, endpoint: 'https://abc.eks.amazonaws.com', tags: {}, nodegroups: ['general', 'arm'], instanceCount: 3 },
    ])
    const headers = table.findAll('thead th').map(th => th.text())
    expect(headers.some(h => h.startsWith('Node groups'))).toBe(true)
    expect(headers.some(h => h.startsWith('EC2'))).toBe(true)
    const row = table.find('tbody tr').text()
    expect(row).toContain('general')
    expect(row).toContain('arm')
    expect(row).toContain('3')
    expect(row).toContain('Info')
  })

  it('shows "?" when node groups or instances could not be read, and "—" for none', async () => {
    const table = await mountEksTable([
      { ...CLUSTER_ROW, name: 'a', tags: {}, nodegroups: null, instanceCount: null },
      { ...CLUSTER_ROW, name: 'b', tags: {}, nodegroups: [], instanceCount: 0 },
    ])
    const cells = table.findAll('tbody tr').map(tr => tr.findAll('td').map(td => td.text()))
    const ngIdx = table.findAll('thead th').findIndex(th => th.text().startsWith('Node groups'))
    expect(cells[0][ngIdx]).toBe('?')
    expect(cells[0][ngIdx + 1]).toBe('?')
    expect(cells[1][ngIdx]).toBe('—')
    expect(cells[1][ngIdx + 1]).toBe('0')
  })
})
