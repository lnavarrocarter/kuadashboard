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

  it('keeps routes distinct when the same nodes have different relationships', () => {
    const groups = architectureRouteGroups({
      nodes: [
        { id: 'rule', name: 'Schedule', resourceType: 'eventbridge' },
        { id: 'workflow', name: 'Workflow', resourceType: 'stepfunctions' },
        { id: 'worker', name: 'Worker', resourceType: 'lambda' },
      ],
      edges: [
        { id: 'rule-workflow', sourceNodeId: 'rule', targetNodeId: 'workflow', relationType: 'triggers' },
        { id: 'workflow-invokes', sourceNodeId: 'workflow', targetNodeId: 'worker', relationType: 'invokes' },
        { id: 'workflow-starts', sourceNodeId: 'workflow', targetNodeId: 'worker', relationType: 'starts_execution' },
      ],
    })

    expect(groups[0].paths).toHaveLength(2)
    expect(new Set(groups[0].paths.map(path => path.id))).toHaveProperty('size', 2)
  })

  it('groups Kubernetes Ingress and Service paths as microservice routes', () => {
    const document = {
      nodes: [
        { id: 'ingress', name: 'public', resourceType: 'ingress', kubeContext: 'orders-eks', namespace: 'orders' },
        { id: 'service', name: 'api', resourceType: 'service', kubeContext: 'orders-eks', namespace: 'orders' },
        { id: 'pod', name: 'api-a', resourceType: 'pod', kubeContext: 'orders-eks', namespace: 'orders' },
        { id: 'config', name: 'api-config', resourceType: 'configmap', kubeContext: 'orders-eks', namespace: 'orders' },
      ],
      edges: [
        { id: 'ingress-service', sourceNodeId: 'ingress', targetNodeId: 'service', relationType: 'routes_to', evidence: [{ type: 'ingress_backend' }] },
        { id: 'service-pod', sourceNodeId: 'service', targetNodeId: 'pod', relationType: 'routes_to', evidence: [{ type: 'service_selector' }] },
        { id: 'pod-config', sourceNodeId: 'pod', targetNodeId: 'config', relationType: 'uses', evidence: [{ type: 'env_from_configmap' }] },
      ],
    }
    const groups = architectureRouteGroups(document)
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ type: 'ingress', category: 'microservice', config: { context: 'orders-eks', namespace: 'orders', entryType: 'ingress' } })
    expect(groups[0].paths[0].nodes.map(node => node.id)).toEqual(['ingress', 'service', 'pod', 'config'])

    const wrapper = mount(ArchitectureRoutes, { props: { graph: { revision: 1, document } } })
    expect(wrapper.get('.routes-title').text()).toContain('Application routes')
    expect(wrapper.get('.event-order').text()).toContain('MICROSERVICE 01')
    expect(wrapper.get('.microservice-structure').text()).toContain('orders-eks')
    expect(wrapper.get('.route-path').text()).toContain('Service routing')
  })

  it('applies the persisted canvas filters to routes', () => {
    const filteredGraph = {
      revision: 2,
      document: {
        view: { providerFilter: 'kubernetes', kubeContextFilter: 'orders-eks', namespaceFilter: 'orders' },
        nodes: [
          { id: 'orders-ingress', name: 'orders-public', provider: 'kubernetes', resourceType: 'ingress', kubeContext: 'orders-eks', namespace: 'orders' },
          { id: 'orders-service', name: 'orders-api', provider: 'kubernetes', resourceType: 'service', kubeContext: 'orders-eks', namespace: 'orders' },
          { id: 'payments-service', name: 'payments-api', provider: 'kubernetes', resourceType: 'service', kubeContext: 'orders-eks', namespace: 'payments' },
          { id: 'aws-worker', name: 'worker', provider: 'aws', resourceType: 'lambda' },
        ],
        edges: [
          { id: 'orders-route', sourceNodeId: 'orders-ingress', targetNodeId: 'orders-service', relationType: 'routes_to' },
          { id: 'payments-route', sourceNodeId: 'orders-ingress', targetNodeId: 'payments-service', relationType: 'routes_to' },
        ],
      },
    }

    const wrapper = mount(ArchitectureRoutes, { props: { graph: filteredGraph } })

    expect(wrapper.get('.route-count').text()).toContain('1 route')
    expect(wrapper.text()).toContain('orders-api')
    expect(wrapper.text()).not.toContain('payments-api')
    expect(wrapper.text()).not.toContain('worker')
  })

  it('exposes its own provider/context/namespace filters that persist through the shared canvas view', async () => {
    const graph = {
      revision: 1,
      document: {
        nodes: [
          { id: 'orders-service', name: 'orders-api', provider: 'kubernetes', resourceType: 'service', kubeContext: 'orders-eks', namespace: 'orders' },
          { id: 'aws-worker', name: 'worker', provider: 'aws', resourceType: 'lambda' },
        ],
        edges: [],
      },
    }
    const wrapper = mount(ArchitectureRoutes, { props: { graph } })

    await wrapper.get('select[title="Filter providers"]').setValue('kubernetes')
    expect(wrapper.text()).not.toContain('worker')
    expect(wrapper.emitted('operation')[0]).toEqual([
      { type: 'view.set', value: { providerFilter: 'kubernetes', kubeContextFilter: '', namespaceFilter: '' } },
      'Update canvas view',
    ])

    await wrapper.get('select[title="Filter Kubernetes namespace"]').setValue('orders')
    expect(wrapper.emitted('operation')[1]).toEqual([
      { type: 'view.set', value: { providerFilter: 'kubernetes', kubeContextFilter: '', namespaceFilter: 'orders' } },
      'Update canvas view',
    ])
  })

  it('offers application-friendly route ordering modes', async () => {
    const orderedGraph = {
      revision: 1,
      document: {
        nodes: [
          { id: 'workflow', name: 'AWorkflow', resourceType: 'stepfunctions' },
          { id: 'rule-short', name: 'BEvent', resourceType: 'eventbridge' },
          { id: 'rule-long', name: 'CEvent', resourceType: 'eventbridge' },
          { id: 'fast', name: 'FastWorker', resourceType: 'lambda' },
          { id: 'queue', name: 'Queue', resourceType: 'sqs' },
          { id: 'worker', name: 'Worker', resourceType: 'lambda' },
        ],
        edges: [
          { id: 'long-queue', sourceNodeId: 'rule-long', targetNodeId: 'queue', relationType: 'triggers', evidence: [{ type: 'eventbridge_target', eventBus: 'alpha' }] },
          { id: 'long-fast', sourceNodeId: 'rule-long', targetNodeId: 'fast', relationType: 'triggers', evidence: [{ type: 'eventbridge_target', eventBus: 'alpha' }] },
          { id: 'queue-worker', sourceNodeId: 'queue', targetNodeId: 'worker', relationType: 'triggers' },
          { id: 'short-worker', sourceNodeId: 'rule-short', targetNodeId: 'worker', relationType: 'triggers', evidence: [{ type: 'eventbridge_target', eventBus: 'zeta' }] },
        ],
      },
    }
    const wrapper = mount(ArchitectureRoutes, { props: { graph: orderedGraph } })

    expect(wrapper.findAll('.route-group > header strong').map(item => item.text())).toEqual(['BEvent', 'CEvent', 'AWorkflow'])
    await wrapper.get('.route-order-control select').setValue('name')
    expect(wrapper.findAll('.route-group > header strong').map(item => item.text())).toEqual(['AWorkflow', 'BEvent', 'CEvent'])
    await wrapper.get('.route-order-control select').setValue('bus')
    expect(wrapper.findAll('.route-group > header strong').map(item => item.text())).toEqual(['CEvent', 'BEvent', 'AWorkflow'])
    await wrapper.get('.route-order-control select').setValue('service')
    expect(wrapper.findAll('.route-group').at(1).findAll('.route-path').map(path => path.findAll('.route-node strong').at(-1).text())).toEqual(['FastWorker', 'Worker'])
    await wrapper.get('.route-order-control select').setValue('depth')
    expect(wrapper.findAll('.route-group > header strong').map(item => item.text())).toEqual(['CEvent', 'BEvent', 'AWorkflow'])
    expect(wrapper.findAll('.route-group').at(0).find('.route-path').findAll('.route-node')).toHaveLength(3)
  })

  it('opens the internal diagram from a Step Functions route', async () => {
    const wrapper = mount(ArchitectureRoutes, { props: { graph } })

    expect(wrapper.get('.routes-title').text()).toContain('Application routes')
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
