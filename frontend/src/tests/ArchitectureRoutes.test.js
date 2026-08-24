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

  it('orders shuffled event entrypoints and branches deterministically', () => {
    const document = {
      nodes: [
        { id: 'workflow', name: 'DailyWorkflow', resourceType: 'stepfunctions' },
        { id: 'rule-z', name: 'ZetaEvent', resourceType: 'eventbridge' },
        { id: 'worker-z', name: 'ZetaWorker', resourceType: 'lambda' },
        { id: 'rule-10', name: 'Event10', resourceType: 'eventbridge' },
        { id: 'rule-2', name: 'Event2', resourceType: 'eventbridge' },
        { id: 'rule-a', name: 'AlphaEvent', resourceType: 'eventbridge' },
        { id: 'worker-a', name: 'AlphaWorker', resourceType: 'lambda' },
      ],
      edges: [
        { id: 'z-z', sourceNodeId: 'rule-z', targetNodeId: 'worker-z', relationType: 'triggers' },
        { id: 'z-a', sourceNodeId: 'rule-z', targetNodeId: 'worker-a', relationType: 'triggers' },
      ],
    }

    const groups = architectureRouteGroups(document)

    expect(groups.map(group => group.name)).toEqual(['AlphaEvent', 'Event2', 'Event10', 'ZetaEvent', 'DailyWorkflow'])
    expect(groups[3].paths.map(path => path.nodes.at(-1).name)).toEqual(['AlphaWorker', 'ZetaWorker'])
  })

  it('opens the internal diagram from a Step Functions route', async () => {
    const wrapper = mount(ArchitectureRoutes, { props: { graph } })

    expect(wrapper.get('.routes-title').text()).toContain('APL event flow')
    expect(wrapper.get('.route-count').text()).toContain('2 routes · 2 entries')
    expect(wrapper.get('.event-order').text()).toBe('EVENT 01')
    expect(wrapper.findAll('.event-order').at(-1).text()).toBe('WORKFLOW 01')
    expect(wrapper.get('.path-order').text()).toContain('01')
    expect(wrapper.findAll('.stage-order').slice(0, 3).map(item => item.text())).toEqual(['01', '02', '03'])
    expect(wrapper.findAll('.route-node small').slice(0, 3).map(item => item.text())).toEqual(['Event source', 'Message buffer', 'Compute'])
    await wrapper.get('.route-group:last-child button').trigger('click')

    expect(wrapper.emitted('inspect-workflow')[0][0]).toEqual(graph.document.nodes[3])
  })
})