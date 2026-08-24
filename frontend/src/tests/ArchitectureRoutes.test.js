import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import ArchitectureRoutes from '../components/architecture/ArchitectureRoutes.vue'
import { architectureRouteGroups } from '../lib/architectureRoutes'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))

const graph = {
  revision: 4,
  document: {
    nodes: [
      { id: 'rule', name: 'OrderCreated', resourceType: 'eventbridge' },
      { id: 'queue', name: 'OrderQueue', resourceType: 'sqs' },
      { id: 'worker', name: 'OrderWorker', resourceType: 'lambda' },
      { id: 'workflow', name: 'OrderWorkflow', resourceType: 'stepfunctions', arn: 'arn:aws:states:us-east-1:123:stateMachine:orders' },
    ],
    edges: [
      {
        id: 'rule-queue', sourceNodeId: 'rule', targetNodeId: 'queue', relationType: 'triggers', status: 'automatic',
        evidence: [{ type: 'eventbridge_target', eventBus: 'orders', eventPattern: '{"source":["shop.orders"]}' }],
      },
      {
        id: 'queue-worker', sourceNodeId: 'queue', targetNodeId: 'worker', relationType: 'triggers', status: 'automatic',
        evidence: [{ type: 'lambda_event_source_mapping' }],
      },
    ],
  },
}

describe('ArchitectureRoutes', () => {
  it('groups an event path and standalone workflow as application entrypoints', () => {
    const groups = architectureRouteGroups(graph.document)

    expect(groups).toHaveLength(2)
    expect(groups[0].config).toEqual({
      eventBus: 'orders', eventPattern: { source: ['shop.orders'] }, scheduleExpression: '', description: '',
    })
    expect(groups[0].paths[0].nodes.map(node => node.id)).toEqual(['rule', 'queue', 'worker'])
    expect(groups[1].paths[0].nodes.map(node => node.id)).toEqual(['workflow'])
  })

  it('opens the internal diagram from a Step Functions route', async () => {
    const wrapper = mount(ArchitectureRoutes, { props: { graph } })

    await wrapper.get('.route-group:last-child button').trigger('click')

    expect(wrapper.emitted('inspect-workflow')[0][0]).toEqual(graph.document.nodes[3])
  })
})