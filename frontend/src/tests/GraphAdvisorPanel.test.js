import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import ArchitectureGraphAdvisor from '../components/architecture/ArchitectureGraphAdvisor.vue'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))

const arn = 'arn:aws:ec2:us-east-1:123456789012:instance/i-0123456789abcdef0'

function graph() {
  return { document: { nodes: [
    { id: 'ingress', name: 'public', provider: 'kubernetes', resourceType: 'ingress', kubeContext: 'eks-a', namespace: 'orders', details: { backendServiceNames: ['orders-api'] } },
    { id: 'service', name: 'orders-api', provider: 'kubernetes', resourceType: 'service', kubeContext: 'eks-a', namespace: 'orders' },
    { id: 'kube-node', name: 'ip-10-0-0-1', provider: 'kubernetes', resourceType: 'node', arn },
    { id: 'ec2', name: 'i-0123', provider: 'aws', resourceType: 'ec2', arn },
    { id: 'stale', name: 'old-worker', syncState: 'stale' },
  ], edges: [], view: {} } }
}

describe('ArchitectureGraphAdvisor', () => {
  it('adds relationship proposals to the diagram as suggested edges', async () => {
    const wrapper = mount(ArchitectureGraphAdvisor, { props: { graph: graph() } })

    expect(wrapper.text()).toContain('Possible missing relationship')
    await wrapper.findAll('button').find(button => button.text().includes('Add for review')).trigger('click')

    expect(wrapper.emitted('operation')[0][0]).toMatchObject({
      type: 'edge.upsert', value: { sourceNodeId: 'ingress', targetNodeId: 'service', status: 'suggested' },
    })
  })

  it('requires confirmation before merging duplicate ARN nodes', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true))
    const wrapper = mount(ArchitectureGraphAdvisor, { props: { graph: graph() } })
    await wrapper.findAll('button').find(button => button.text().includes('Merge')).trigger('click')

    expect(globalThis.confirm).toHaveBeenCalledOnce()
    expect(wrapper.emitted('operation').map(([operation]) => operation.type)).toContain('node.merge')
    vi.unstubAllGlobals()
  })

  it('requires confirmation before removing stale resources and can group by domain', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true))
    const wrapper = mount(ArchitectureGraphAdvisor, { props: { graph: graph() } })
    await wrapper.findAll('button').find(button => button.text().includes('Remove')).trigger('click')
    await wrapper.findAll('button').find(button => button.text().includes('Group')).trigger('click')

    expect(wrapper.emitted('operation').map(([operation]) => operation.type)).toContain('node.remove')
    expect(wrapper.emitted('operation').map(([operation]) => operation.type)).toContain('view.set')
    vi.unstubAllGlobals()
  })
})