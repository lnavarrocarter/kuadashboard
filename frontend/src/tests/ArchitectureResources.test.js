import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import ArchitectureResources from '../components/architecture/ArchitectureResources.vue'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))

const graph = {
  revision: 1,
  document: {
    nodes: [
      { id: 'node-a', name: 'orders-api', resourceType: 'deployment', registryResourceId: 'resource-a', health: { status: 'degraded' } },
      { id: 'node-b', name: 'legacy-queue', resourceType: 'sqs', registryResourceId: 'resource-b', syncState: 'stale' },
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
