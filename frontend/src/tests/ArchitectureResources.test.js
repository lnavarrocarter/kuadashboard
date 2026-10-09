import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import ArchitectureResources from '../components/architecture/ArchitectureResources.vue'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))

const graph = {
  revision: 1,
  document: {
    nodes: [
      { id: 'node-a', name: 'orders-api', resourceType: 'deployment', registryResourceId: 'resource-a', kubeContext: 'orders-eks', namespace: 'orders', health: { status: 'degraded' } },
      { id: 'node-b', name: 'legacy-queue', resourceType: 'sqs', registryResourceId: 'resource-b', stackName: 'legacy-stack', syncState: 'stale' },
    ],
    edges: [],
  },
}

const registry = {
  resources: [
    {
      id: 'resource-a', provider: 'kubernetes', resourceType: 'deployment', displayName: 'orders-api',
      scopeId: 'orders-eks', location: '', sources: ['apm_resource', 'architecture_node'], correlatable: true, divergent: false,
    },
    {
      id: 'resource-b', provider: 'aws', resourceType: 'sqs', displayName: 'legacy-queue',
      scopeId: '123456789012', location: 'us-east-1', sources: ['architecture_node'], correlatable: true, divergent: true,
    },
  ],
  relationships: [
    { id: 'rel-1', sourceResourceId: 'resource-a', targetResourceId: 'resource-b', relationType: 'depends_on', status: 'confirmed', divergent: false },
  ],
}

describe('ArchitectureResources', () => {
  it('shows an empty state when there are no canonical resources yet', () => {
    const wrapper = mount(ArchitectureResources, { props: { graph: null, registry: null, loading: false } })
    expect(wrapper.text()).toContain('No canonical resources yet')
  })

  it('shows a loading state while the registry is being fetched', () => {
    const wrapper = mount(ArchitectureResources, { props: { graph: null, registry: null, loading: true } })
    expect(wrapper.text()).toContain('Loading canonical resources')
  })

  it('lists resources with provider, scope, sources, status and relationship count', () => {
    const wrapper = mount(ArchitectureResources, { props: { graph, registry, loading: false } })
    const rows = wrapper.findAll('.resources-table tbody tr')
    expect(rows).toHaveLength(2)

    expect(rows[0].text()).toContain('orders-api')
    expect(rows[0].text()).toContain('orders-eks')
    expect(rows[0].find('.resource-status').classes()).toContain('degraded')
    expect(rows[0].findAll('.resource-source-badge')).toHaveLength(2)
    expect(rows[0].find('.resource-divergence').exists()).toBe(false)
    expect(rows[0].text()).toContain('1')

    expect(rows[1].text()).toContain('legacy-queue')
    expect(rows[1].find('.resource-status').classes()).toContain('stale')
    expect(rows[1].find('.resource-divergence').exists()).toBe(true)
  })

  it('emits refresh when the reload button is clicked', async () => {
    const wrapper = mount(ArchitectureResources, { props: { graph, registry, loading: false } })
    await wrapper.get('button[title="Refresh resources"]').trigger('click')
    expect(wrapper.emitted('refresh')).toHaveLength(1)
  })

  it('filters only the resources in the selected CloudFormation stack or Kubernetes namespace', async () => {
    const wrapper = mount(ArchitectureResources, { props: { graph, registry, loading: false } })
    const scopeFilter = wrapper.get('[data-test="resource-scope-filter"]')
    const options = scopeFilter.findAll('option').map(option => option.text())
    expect(options).toContain('CloudFormation · legacy-stack')
    expect(options).toContain('Kubernetes namespace · orders')

    await scopeFilter.setValue('namespace:orders')
    expect(wrapper.findAll('.resources-table tbody tr').map(row => row.text())).toHaveLength(1)
    expect(wrapper.find('.resources-table').text()).toContain('orders-api')
    expect(wrapper.find('.resources-table').text()).not.toContain('legacy-queue')

    await scopeFilter.setValue('cloudformation:legacy-stack')
    expect(wrapper.findAll('.resources-table tbody tr')).toHaveLength(1)
    expect(wrapper.find('.resources-table').text()).toContain('legacy-queue')
    expect(wrapper.emitted('operation')).toHaveLength(2)
  })

  it('never flags a structurally single-source resource type as divergent, and surfaces divergent relationships per resource', () => {
    const singleSourceRegistry = {
      resources: [
        {
          id: 'resource-c', provider: 'aws', resourceType: 'kinesis', displayName: 'orders-stream',
          scopeId: '123456789012', location: 'us-east-1', sources: ['architecture_node'], correlatable: false, divergent: false,
        },
        {
          id: 'resource-a', provider: 'kubernetes', resourceType: 'deployment', displayName: 'orders-api',
          scopeId: 'orders-eks', location: '', sources: ['apm_resource', 'architecture_node'], correlatable: true, divergent: false,
        },
      ],
      relationships: [
        { id: 'rel-2', sourceResourceId: 'resource-c', targetResourceId: 'resource-a', relationType: 'depends_on', status: 'suggested', divergent: true },
      ],
    }
    const wrapper = mount(ArchitectureResources, { props: { graph, registry: singleSourceRegistry, loading: false } })
    const rows = wrapper.findAll('.resources-table tbody tr')

    const streamRow = rows.find(row => row.text().includes('orders-stream'))
    expect(streamRow.find('.resource-divergence').exists()).toBe(false)
    expect(streamRow.text()).toContain('1 pending review')

    const apiRow = rows.find(row => row.text().includes('orders-api'))
    expect(apiRow.text()).toContain('1 pending review')
  })
})

describe('ArchitectureResources: open each resource where it lives (#239)', () => {
  it('offers the Kubernetes view, the AWS view or the AWS console per row', async () => {
    const CONTEXT = 'arn:aws:eks:us-east-1:1:cluster/dev'
    const registry = { relationships: [], resources: [
      { id: 'k', provider: 'kubernetes', resourceType: 'deployment', displayName: 'authv1', kubeContext: CONTEXT, namespace: 'backend360', nativeIdentifier: `${CONTEXT}/backend360/Deployment/authv1`, sources: ['architecture_node'] },
      { id: 'q', provider: 'aws', resourceType: 'sqs', displayName: 'jobs', nativeIdentifier: 'arn:aws:sqs:us-east-1:1:jobs', sources: ['apm_resource'] },
      { id: 's', provider: 'aws', resourceType: 'ec2', displayName: 'sg-1', location: 'us-east-1', nativeIdentifier: 'AWS::EC2::SecurityGroup:sg-1', sources: ['architecture_node'] },
    ] }
    const wrapper = mount(ArchitectureResources, { props: { graph: null, registry, loading: false } })
    const opens = wrapper.findAll('[data-test="registry-resource-open"]')
    expect(opens.map(open => open.attributes('title'))).toEqual(['Open in Kubernetes', 'Open in AWS view', 'Open in the AWS console'])
    await opens[0].trigger('click')
    expect(wrapper.emitted('open-destination')[0][0]).toMatchObject({ event: 'open-kubernetes-detail', payload: { kind: 'Deployment', name: 'authv1', namespace: 'backend360' } })
    await opens[1].trigger('click')
    expect(wrapper.emitted('open-destination')[1][0]).toMatchObject({ event: 'open-aws' })
    expect(opens[2].attributes('href')).toContain('#SecurityGroup:groupId=sg-1')
  })
})
