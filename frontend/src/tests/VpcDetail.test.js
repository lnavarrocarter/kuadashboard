import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import VpcDetail from '../components/cloud/VpcDetail.vue'
import { useAwsStore } from '../stores/useAwsStore'

const VPC_CONFIG = {
  vpc: {
    VpcId: 'vpc-123', CidrBlock: '10.0.0.0/16', State: 'available', IsDefault: false,
    InstanceTenancy: 'default', DhcpOptionsId: 'dopt-1',
    Tags: [{ Key: 'Name', Value: 'main-vpc' }, { Key: 'env', Value: 'prod' }],
  },
  subnets: [
    { SubnetId: 'subnet-a', CidrBlock: '10.0.1.0/24', AvailabilityZone: 'us-east-1a', State: 'available', MapPublicIpOnLaunch: true, AvailableIpAddressCount: 250 },
  ],
  securityGroups: [
    { GroupId: 'sg-1', GroupName: 'web', Description: 'web sg', IpPermissions: [
      { IpProtocol: 'tcp', FromPort: 443, ToPort: 443, IpRanges: [{ CidrIp: '0.0.0.0/0' }] },
      { IpProtocol: '-1', UserIdGroupPairs: [{ GroupId: 'sg-2' }] },
    ] },
  ],
  routeTables: [
    { RouteTableId: 'rtb-1', Associations: [{ Main: true }], Tags: [], Routes: [
      { DestinationCidrBlock: '0.0.0.0/0', GatewayId: 'igw-1', State: 'active' },
    ] },
  ],
  internetGateways: [
    { InternetGatewayId: 'igw-1', Attachments: [{ State: 'available' }], Tags: [{ Key: 'Name', Value: 'main-igw' }] },
  ],
  natGateways: [
    { NatGatewayId: 'nat-1', SubnetId: 'subnet-a', State: 'available', NatGatewayAddresses: [{ PublicIp: '1.2.3.4', PrivateIp: '10.0.1.5' }] },
  ],
}

const VPC_ROW = { id: 'vpc-123', name: 'main-vpc', state: 'available', default: false }

function mountDetail(props = {}) {
  return mount(VpcDetail, {
    props: { open: true, vpc: VPC_ROW, ...props },
    global: { stubs: { Teleport: true } },
    attachTo: document.body,
  })
}

describe('VpcDetail.vue (#70)', () => {
  let store

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useAwsStore()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('loads data through fetchResourceConfig("vpc", { id }) when opened', async () => {
    const spy = vi.spyOn(store, 'fetchResourceConfig').mockResolvedValue(VPC_CONFIG)
    mountDetail()
    await flushPromises()
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith('vpc', { id: 'vpc-123' })
  })

  it('does not fetch while closed', async () => {
    const spy = vi.spyOn(store, 'fetchResourceConfig').mockResolvedValue(VPC_CONFIG)
    mountDetail({ open: false })
    await flushPromises()
    expect(spy).not.toHaveBeenCalled()
  })

  it('renders the header badge and all existing tabs', async () => {
    vi.spyOn(store, 'fetchResourceConfig').mockResolvedValue(VPC_CONFIG)
    const w = mountDetail()
    await flushPromises()

    expect(w.find('.vpcd-id-badge').text()).toBe('vpc-123')
    const labels = w.findAll('.vpcd-tab').map(t => t.text())
    expect(labels).toHaveLength(6)
    expect(labels[0]).toContain('Overview')
    for (const id of ['overview', 'subnets', 'sgs', 'routes', 'igws', 'nats']) {
      expect(w.find(`[data-tab="${id}"]`).exists()).toBe(true)
    }
  })

  it('renders each tab content with the dl/dt/dd and table pattern', async () => {
    vi.spyOn(store, 'fetchResourceConfig').mockResolvedValue(VPC_CONFIG)
    const w = mountDetail()
    await flushPromises()

    const overview = w.find('[data-tab="overview"]')
    expect(overview.findAll('dt').map(d => d.text())).toContain('CIDR')
    expect(overview.text()).toContain('10.0.0.0/16')
    expect(overview.text()).toContain('env')

    expect(w.find('[data-tab="subnets"]').text()).toContain('subnet-a')
    const sgs = w.find('[data-tab="sgs"]').text()
    expect(sgs).toContain('443')
    expect(sgs).toContain('0.0.0.0/0')
    expect(sgs).toContain('sg-2')
    const routes = w.find('[data-tab="routes"]').text()
    expect(routes).toContain('rtb-1')
    expect(routes).toContain('Main')
    expect(w.find('[data-tab="igws"]').text()).toContain('main-igw')
    expect(w.find('[data-tab="nats"]').text()).toContain('1.2.3.4')
  })

  it('switches the active tab on click', async () => {
    vi.spyOn(store, 'fetchResourceConfig').mockResolvedValue(VPC_CONFIG)
    const w = mountDetail()
    await flushPromises()

    await w.findAll('.vpcd-tab')[1].trigger('click')
    expect(w.findAll('.vpcd-tab')[1].classes()).toContain('active')
    expect(w.find('[data-tab="subnets"]').isVisible()).toBe(true)
    expect(w.find('[data-tab="overview"]').isVisible()).toBe(false)
  })

  it('shows the store error when the fetch returns null', async () => {
    vi.spyOn(store, 'fetchResourceConfig').mockImplementation(async () => {
      store.error = 'AccessDenied'
      return null
    })
    const w = mountDetail()
    await flushPromises()
    expect(w.find('.vpcd-error').text()).toBe('AccessDenied')
  })

  it('emits close from the header button', async () => {
    vi.spyOn(store, 'fetchResourceConfig').mockResolvedValue(VPC_CONFIG)
    const w = mountDetail()
    await w.find('.vpcd-close').trigger('click')
    expect(w.emitted('close')).toHaveLength(1)
  })
})

describe('useAwsStore.fetchResourceConfig("vpc") — regression', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('still calls GET /api/cloud/aws/vpc/:id/config with the profile header', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => VPC_CONFIG,
    })
    vi.stubGlobal('fetch', fetchMock)

    const store = useAwsStore()
    store.activeProfileId = 'prof-1'
    const res = await store.fetchResourceConfig('vpc', { id: 'vpc-123' })

    expect(res).toEqual(VPC_CONFIG)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/cloud/aws/vpc/vpc-123/config')
    expect(opts.method).toBe('GET')
    expect(opts.headers['X-Profile-Id']).toBe('prof-1')
  })
})

describe('VpcDetail.vue — security group search and outbound rules (H4)', () => {
  let store
  const GROUPS = [
    { GroupId: 'sg-web', GroupName: 'web', Description: 'public web', IpPermissions: [
      { IpProtocol: 'tcp', FromPort: 443, ToPort: 443, IpRanges: [{ CidrIp: '0.0.0.0/0' }], Ipv6Ranges: [{ CidrIpv6: '::/0' }] },
    ], IpPermissionsEgress: [
      { IpProtocol: 'tcp', FromPort: 5432, ToPort: 5432, UserIdGroupPairs: [{ GroupId: 'sg-db' }] },
    ] },
    { GroupId: 'sg-db', GroupName: 'db', Description: 'postgres', IpPermissions: [
      { IpProtocol: 'tcp', FromPort: 5432, ToPort: 5432, UserIdGroupPairs: [{ GroupId: 'sg-web' }] },
    ], IpPermissionsEgress: [] },
    { GroupId: 'sg-admin', GroupName: 'admin', Description: 'bastion', IpPermissions: [
      { IpProtocol: 'tcp', FromPort: 20, ToPort: 25, PrefixListIds: [{ PrefixListId: 'pl-office' }] },
    ], IpPermissionsEgress: [{ IpProtocol: '-1', IpRanges: [{ CidrIp: '0.0.0.0/0' }] }] },
  ]

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useAwsStore()
    vi.spyOn(store, 'fetchResourceConfig').mockResolvedValue({ ...VPC_CONFIG, securityGroups: GROUPS })
  })
  afterEach(() => vi.restoreAllMocks())

  async function openGroups() {
    const w = mountDetail()
    await flushPromises()
    const tab = w.findAll('.vpcd-tab').find(item => item.text().startsWith('Grupos de seguridad') || item.text().startsWith('Security groups'))
    await tab.trigger('click')
    return w
  }
  const shown = w => w.findAll('[data-test="sg-card"]').map(card => card.find('.vpcd-card-title').text().split(' ')[1])

  it('shows outbound rules with the referenced group named', async () => {
    const w = await openGroups()
    const outbound = w.findAll('[data-test="sg-outbound"]')[0].text()
    expect(outbound).toContain('5432')
    expect(outbound).toContain('sg-db (db)')
    expect(w.findAll('[data-test="sg-inbound"]')[0].text()).toContain('::/0')
  })

  it('finds groups by port, CIDR, referenced group or prefix list', async () => {
    const w = await openGroups()
    const search = w.find('[data-test="sg-search"]')
    await search.setValue('5432')
    expect(shown(w)).toEqual(['web', 'db', 'admin'])   // admin allows all outbound traffic
    await search.setValue('22')
    expect(shown(w)).toEqual(['admin'])
    await search.setValue('::/0')
    expect(shown(w)).toEqual(['web'])
    await search.setValue('sg-web')
    expect(shown(w)).toEqual(['web', 'db'])
    await search.setValue('pl-office')
    expect(shown(w)).toEqual(['admin'])
    await search.setValue('nothing-here')
    expect(shown(w)).toEqual([])
    expect(w.find('[data-test="sg-count"]').text()).toMatch(/^0 /)
  })
})
