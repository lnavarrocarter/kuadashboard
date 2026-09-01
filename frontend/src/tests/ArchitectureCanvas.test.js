import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ArchitectureCanvas from '../components/architecture/ArchitectureCanvas.vue'
import { requestFlowLayout, resourceTypeLayout } from '../lib/architectureLayout'
import { architectureResourcePresentation } from '../lib/architectureResourcePresentation'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))

const graph = {
  revision: 2,
  document: {
    nodes: [{ id: 'manual:node:api', name: 'Orders API', resourceType: 'api', manual: true }],
    edges: [],
    layout: { 'manual:node:api': { x: 40, y: 60 } },
  },
}

const stubs = {
  VueFlow: {
    props: ['nodes', 'edges'],
    emits: ['connect', 'edge-click', 'node-click', 'node-drag-stop', 'pane-click'],
    template: `<div class="vue-flow-stub">
      <button class="select-node" @click="$emit('node-click', { node: nodes[0] })">Select</button>
      <button class="clear-pane" @click="$emit('pane-click')">Clear</button>
      <button class="connect-nodes" @click="$emit('connect', { source: 'manual:node:api', target: 'manual:node:db' })">Connect</button>
      <button class="drag-node" @click="$emit('node-drag-stop', { node: { id: 'manual:node:api', position: { x: 92.4, y: 118.8 } } })">Drag</button>
      <button v-if="edges[0]" class="select-edge" @click="$emit('edge-click', { edge: edges[0] })">Select edge</button>
      <slot />
    </div>`,
  },
  Background: true,
  Controls: true,
}

describe('ArchitectureCanvas', () => {
  beforeEach(() => {
    vi.stubGlobal('crypto', { randomUUID: () => 'generated-id' })
  })

  it('emits a canonical manual node operation', async () => {
    const wrapper = mount(ArchitectureCanvas, { props: { graph }, global: { stubs } })
    await wrapper.get('input[placeholder="Component name"]').setValue('Orders worker')
    await wrapper.get('.canvas-toolbar select').setValue('function')
    await wrapper.get('.canvas-toolbar button').trigger('click')

    expect(wrapper.emitted('operation')[0]).toEqual([
      {
        type: 'node.upsert',
        value: {
          id: 'manual:node:generated-id',
          name: 'Orders worker',
          resourceType: 'function',
          manual: true,
        },
      },
      'Add Orders worker',
    ])
  })

  it('uses a wider fallback layout for large imported diagrams', () => {
    const nodes = Array.from({ length: 45 }, (_, index) => ({
      id: `node:${index}`, name: `Resource ${index}`, resourceType: 'lambda',
    }))
    const wrapper = mount(ArchitectureCanvas, {
      props: { graph: { revision: 1, document: { nodes, edges: [], layout: {} } } },
      global: { stubs },
    })

    const flowNodes = wrapper.getComponent(stubs.VueFlow).props('nodes')
    expect(flowNodes[8].position).toEqual({ x: 1840, y: 70 })
    expect(flowNodes[9].position).toEqual({ x: 80, y: 220 })
  })

  it('uses recognizable AWS service icons and simpler policy treatment', () => {
    expect(architectureResourcePresentation('lambda')).toEqual({ icon: 'square-function', tone: 'compute' })
    expect(architectureResourcePresentation('layer')).toEqual({ icon: 'layers-3', tone: 'compute' })
    expect(architectureResourcePresentation('sqs')).toEqual({ icon: 'messages-square', tone: 'application' })
    expect(architectureResourcePresentation('s3')).toEqual({ icon: 'archive', tone: 'storage' })
    expect(architectureResourcePresentation('stepfunctions')).toEqual({ icon: 'workflow', tone: 'application' })
    expect(architectureResourcePresentation('sns')).toEqual({ icon: 'megaphone', tone: 'application' })
    expect(architectureResourcePresentation('iam-policy')).toEqual({ icon: 'file-key', tone: 'security-simple' })
    expect(architectureResourcePresentation('policy')).toEqual({ icon: 'file-text', tone: 'security-simple' })
    expect(architectureResourcePresentation('api-route')).toEqual({ icon: 'route', tone: 'network' })
    expect(architectureResourcePresentation('ec2')).toEqual({ icon: 'server', tone: 'compute' })
    expect(architectureResourcePresentation('deployment')).toEqual({ icon: 'boxes', tone: 'kubernetes' })
    expect(architectureResourcePresentation('service')).toEqual({ icon: 'network', tone: 'kubernetes-network' })
    expect(architectureResourcePresentation('ingress')).toEqual({ icon: 'route', tone: 'kubernetes-network' })
    expect(architectureResourcePresentation('configmap')).toEqual({ icon: 'file-cog', tone: 'kubernetes-config' })
    expect(architectureResourcePresentation('gcp-cloud-run')).toEqual({ icon: 'cloud-cog', tone: 'compute' })
  })

  it('shows API Gateway method details and navigates to the existing Lambda reference', async () => {
    const routeGraph = {
      revision: 1,
      document: {
        nodes: [
          { id: 'route', name: 'GetOrdersMethod', resourceType: 'api-route', kind: 'AWS::ApiGateway::Method' },
          { id: 'lambda', name: 'orders-worker', resourceType: 'lambda', kind: 'AWS::Lambda::Function' },
          { id: 'bucket', name: 'audit-bucket', resourceType: 's3', kind: 'AWS::S3::Bucket' },
        ],
        edges: [{
          id: 'route-lambda', sourceNodeId: 'route', targetNodeId: 'lambda', relationType: 'routes_to',
          status: 'automatic', confidence: 0.99,
          evidence: [{
            type: 'cloudformation_reference', path: 'Resources.GetOrders.Properties.Integration.Uri',
            intrinsic: 'Fn::Sub', method: 'GET', routePath: '/orders', route: 'GET /orders',
          }, { type: 'lambda_permission', logicalId: 'GetOrdersPermission' }],
        }],
        layout: {},
      },
    }
    const wrapper = mount(ArchitectureCanvas, { props: { graph: routeGraph }, global: { stubs } })
    expect(wrapper.getComponent(stubs.VueFlow).props('nodes')[0].data).toMatchObject({
      label: '/orders', method: 'GET', resourceType: 'api-route',
    })

    await wrapper.get('.select-node').trigger('click')
    expect(wrapper.getComponent(stubs.VueFlow).props('nodes').map(node => node.style?.opacity || 1)).toEqual([1, 1, 0.14])
    expect(wrapper.get('.component-reference').text()).toContain('orders-worker')
    expect(wrapper.get('.component-reference').text()).toContain('GET /orders')
    await wrapper.get('.component-reference').trigger('click')
    expect(wrapper.get('.canvas-inspector input').element.value).toBe('orders-worker')
    expect(wrapper.get('.api-gateway-routes').text()).toContain('GET /orders')
    expect(wrapper.get('.api-gateway-routes').text()).toContain('1 Lambda permission')
    expect(wrapper.get('.component-metadata').text()).toContain('AWS::Lambda::Function')
  })

  it('arranges request flow by graph depth in either direction', async () => {
    const document = {
      nodes: [
        { id: 'worker', name: 'Worker', resourceType: 'lambda' },
        { id: 'event', name: 'Order event', resourceType: 'eventbridge' },
        { id: 'isolated', name: 'Audit bucket', resourceType: 's3' },
        { id: 'queue', name: 'Order queue', resourceType: 'sqs' },
      ],
      edges: [
        { id: 'queue-worker', sourceNodeId: 'queue', targetNodeId: 'worker', status: 'automatic' },
        { id: 'event-queue', sourceNodeId: 'event', targetNodeId: 'queue', status: 'automatic' },
      ],
      layout: {},
    }

    expect(requestFlowLayout(document)).toEqual({
      event: { x: 80, y: 70 },
      isolated: { x: 80, y: 200 },
      queue: { x: 360, y: 70 },
      worker: { x: 640, y: 70 },
    })
    expect(requestFlowLayout(document, 'vertical')).toEqual({
      event: { x: 80, y: 70 },
      isolated: { x: 320, y: 70 },
      queue: { x: 80, y: 220 },
      worker: { x: 80, y: 370 },
    })

    const wrapper = mount(ArchitectureCanvas, {
      props: { graph: { revision: 1, document } },
      global: { stubs },
    })
    await wrapper.get('.canvas-layout-controls button').trigger('click')
    expect(wrapper.emitted('operation')[0]).toEqual([
      { type: 'layout.set', value: requestFlowLayout(document) },
      'Arrange request flow left to right',
    ])
  })

  it('arranges resources in labeled type sections with straight edges', async () => {
    const document = {
      nodes: [
        { id: 'worker-b', name: 'Worker B', resourceType: 'lambda' },
        { id: 'bucket', name: 'Audit bucket', resourceType: 's3' },
        { id: 'worker-a', name: 'Worker A', resourceType: 'lambda' },
      ],
      edges: [{ id: 'bucket-worker', sourceNodeId: 'bucket', targetNodeId: 'worker-a', status: 'automatic' }],
      layout: {},
    }
    expect(resourceTypeLayout(document)).toEqual({
      layout: {
        'worker-a': { x: 100, y: 98 },
        'worker-b': { x: 320, y: 98 },
        bucket: { x: 100, y: 324 },
      },
      sections: [
        { type: 'lambda', count: 2, x: 60, y: 50, width: 520, height: 190 },
        { type: 's3', count: 1, x: 60, y: 276, width: 300, height: 190 },
      ],
    })

    const wrapper = mount(ArchitectureCanvas, {
      props: { graph: { revision: 1, document } },
      global: { stubs },
    })
    await wrapper.get('select[title="Canvas arrangement"]').setValue('resource-type')
    expect(wrapper.emitted('operation')[0]).toEqual([
      {
        type: 'view.set',
        value: {
          layoutMode: 'resource-type', layoutDirection: 'horizontal', showEdgeLabels: false, showHealthOverlay: false,
          providerFilter: 'all', kubeContextFilter: '', namespaceFilter: '',
        },
      },
      'Update canvas view',
    ])
    await wrapper.get('.canvas-layout-controls button').trigger('click')

    expect(wrapper.emitted('operation')[1]).toEqual([
      { type: 'layout.set', value: resourceTypeLayout(document).layout },
      'Arrange resources by type',
    ])
    expect(wrapper.getComponent(stubs.VueFlow).props('nodes').filter(node => node.type === 'resource-section')).toHaveLength(2)
    expect(wrapper.getComponent(stubs.VueFlow).props('edges')[0].type).toBe('straight')
  })

  it('restores persisted canvas view preferences on reload', () => {
    const document = {
      nodes: [{ id: 'worker', name: 'Worker', resourceType: 'lambda' }],
      edges: [],
      layout: { worker: { x: 100, y: 98 } },
      view: { layoutMode: 'resource-type', layoutDirection: 'vertical', showEdgeLabels: true },
    }
    const wrapper = mount(ArchitectureCanvas, {
      props: { graph: { revision: 4, document } },
      global: { stubs },
    })

    expect(wrapper.get('select[title="Canvas arrangement"]').element.value).toBe('resource-type')
    expect(wrapper.getComponent(stubs.VueFlow).props('nodes').some(node => node.type === 'resource-section')).toBe(true)
    expect(wrapper.get('.canvas-layout-controls button[title="Toggle relationship labels"]').classes()).toContain('primary')
    expect(wrapper.emitted('operation')).toBeUndefined()
  })

  it('only shows the health overlay badge after the Health toggle is enabled', async () => {
    const healthGraph = {
      revision: 1,
      document: {
        nodes: [
          { id: 'deploy', name: 'orders-api', resourceType: 'deployment', provider: 'kubernetes', health: { status: 'degraded' } },
          { id: 'svc', name: 'orders-svc', resourceType: 'service', provider: 'kubernetes', health: { status: 'healthy' } },
          { id: 'stale-node', name: 'legacy-queue', resourceType: 'sqs', syncState: 'stale' },
        ],
        edges: [],
        layout: {},
      },
    }
    const wrapper = mount(ArchitectureCanvas, { props: { graph: healthGraph }, global: { stubs } })
    expect(wrapper.getComponent(stubs.VueFlow).props('nodes').every(node => node.data.health == null)).toBe(true)

    await wrapper.get('.canvas-layout-controls button[title="Toggle health/freshness overlay"]').trigger('click')
    expect(wrapper.emitted('operation')[0][0]).toEqual({
      type: 'view.set',
      value: {
        layoutMode: 'request-flow', layoutDirection: 'horizontal', showEdgeLabels: false, showHealthOverlay: true,
        providerFilter: 'all', kubeContextFilter: '', namespaceFilter: '',
      },
    })
    const nodes = wrapper.getComponent(stubs.VueFlow).props('nodes')
    expect(nodes.find(node => node.id === 'deploy').data.health).toEqual({ status: 'degraded', label: 'Degraded' })
    expect(nodes.find(node => node.id === 'svc').data.health).toEqual({ status: 'healthy', label: 'Healthy' })
    expect(nodes.find(node => node.id === 'stale-node').data.health.status).toBe('stale')
  })

  it('keeps the current local layout mode when a graph refresh has no persisted view yet', async () => {
    const document = {
      nodes: [{ id: 'worker', name: 'Worker', resourceType: 'lambda' }],
      edges: [],
      layout: { worker: { x: 100, y: 98 } },
    }
    const wrapper = mount(ArchitectureCanvas, {
      props: { graph: { revision: 4, document } },
      global: { stubs },
    })

    await wrapper.get('select[title="Canvas arrangement"]').setValue('resource-type')
    expect(wrapper.get('select[title="Canvas arrangement"]').element.value).toBe('resource-type')

    await wrapper.setProps({
      graph: { revision: 5, document: { nodes: document.nodes, edges: [], layout: document.layout } },
    })

    expect(wrapper.get('select[title="Canvas arrangement"]').element.value).toBe('resource-type')
    expect(wrapper.getComponent(stubs.VueFlow).props('nodes').some(node => node.type === 'resource-section')).toBe(true)
  })

  it('removes focus attenuation when the canvas selection is cleared', async () => {
    const routeGraph = {
      revision: 1,
      document: {
        nodes: [
          { id: 'api', name: 'API', resourceType: 'api' },
          { id: 'worker', name: 'Worker', resourceType: 'lambda' },
          { id: 'bucket', name: 'Bucket', resourceType: 's3' },
        ],
        edges: [{ id: 'api-worker', sourceNodeId: 'api', targetNodeId: 'worker', status: 'automatic' }],
        layout: {},
      },
    }
    const wrapper = mount(ArchitectureCanvas, { props: { graph: routeGraph }, global: { stubs } })
    await wrapper.get('.select-node').trigger('click')
    expect(wrapper.getComponent(stubs.VueFlow).props('nodes')[2].style.opacity).toBe(0.14)

    await wrapper.get('.clear-pane').trigger('click')
    expect(wrapper.find('.canvas-inspector').exists()).toBe(false)
    expect(wrapper.getComponent(stubs.VueFlow).props('nodes').every(node => node.style?.opacity == null)).toBe(true)
  })

  it('only keeps relationship labels on edges related to the selected node', async () => {
    const labeledGraph = {
      revision: 1,
      document: {
        nodes: [
          { id: 'api', name: 'API', resourceType: 'api' },
          { id: 'worker', name: 'Worker', resourceType: 'lambda' },
          { id: 'bucket', name: 'Bucket', resourceType: 's3' },
          { id: 'queue', name: 'Queue', resourceType: 'sqs' },
        ],
        edges: [
          { id: 'api-worker', sourceNodeId: 'api', targetNodeId: 'worker', relationType: 'routes_to', status: 'automatic' },
          { id: 'bucket-queue', sourceNodeId: 'bucket', targetNodeId: 'queue', relationType: 'triggers', status: 'automatic' },
        ],
        layout: {},
        view: { layoutMode: 'request-flow', layoutDirection: 'horizontal', showEdgeLabels: true },
      },
    }
    const wrapper = mount(ArchitectureCanvas, { props: { graph: labeledGraph }, global: { stubs } })
    expect(wrapper.getComponent(stubs.VueFlow).props('edges').map(edge => edge.label)).toEqual(['routes to', 'triggers'])

    await wrapper.get('.select-node').trigger('click')
    const edges = wrapper.getComponent(stubs.VueFlow).props('edges')
    expect(edges.map(edge => edge.label)).toEqual(['routes to', undefined])
    expect(edges[0].labelBgStyle).toMatchObject({ fill: '#1f6feb' })
    expect(edges[1].style.opacity).toBe(0.035)
  })

  it('opens the inspector and emits a partial node update', async () => {
    const wrapper = mount(ArchitectureCanvas, { props: { graph }, global: { stubs } })
    await wrapper.get('.select-node').trigger('click')
    await wrapper.get('.canvas-inspector input').setValue('Public Orders API')
    await wrapper.get('.canvas-inspector .primary').trigger('click')

    expect(wrapper.emitted('operation')[0]).toEqual([
      {
        type: 'node.upsert',
        value: { id: 'manual:node:api', name: 'Public Orders API', resourceType: 'api' },
      },
      'Update Public Orders API',
    ])
  })

  it('opens the selected Step Functions workflow diagram', async () => {
    const workflow = {
      revision: 1,
      document: {
        nodes: [{ id: 'aws:workflow', name: 'ProcessOrder', resourceType: 'stepfunctions' }],
        edges: [],
        layout: {},
      },
    }
    const wrapper = mount(ArchitectureCanvas, { props: { graph: workflow }, global: { stubs } })
    await wrapper.get('.select-node').trigger('click')
    await wrapper.get('.canvas-inspector > button.btn').trigger('click')

    expect(wrapper.emitted('inspect-workflow')).toEqual([[workflow.document.nodes[0]]])
  })

  it('exposes Kubernetes node navigation actions', async () => {
    const kubeGraph = {
      revision: 1,
      document: {
        nodes: [{
          id: 'k8s:deploy', name: 'orders-api', resourceType: 'service',
          provider: 'kubernetes', kind: 'Deployment', kubeContext: 'orders-eks', namespace: 'orders',
        }],
        edges: [],
        layout: {},
      },
    }
    const wrapper = mount(ArchitectureCanvas, { props: { graph: kubeGraph }, global: { stubs } })
    await wrapper.get('.select-node').trigger('click')
    const actionButtons = wrapper.findAll('.component-node-actions button')
    expect(actionButtons).toHaveLength(4)

    await actionButtons[0].trigger('click')
    expect(wrapper.emitted('node-action')[0]).toEqual([{ action: 'kubernetes-logs', node: kubeGraph.document.nodes[0] }])

    await actionButtons[1].trigger('click')
    expect(wrapper.emitted('node-action')[1]).toEqual([{ action: 'kubernetes-log-suggestions', node: kubeGraph.document.nodes[0] }])

    await actionButtons[3].trigger('click')
    expect(wrapper.emitted('node-action')[2]).toEqual([{ action: 'kubernetes-pods', node: kubeGraph.document.nodes[0] }])
  })

  it('exposes AWS Lambda node navigation actions', async () => {
    const lambdaGraph = {
      revision: 1,
      document: {
        nodes: [{ id: 'aws:fn', name: 'process-order', resourceType: 'lambda' }],
        edges: [],
        layout: {},
      },
    }
    const wrapper = mount(ArchitectureCanvas, { props: { graph: lambdaGraph }, global: { stubs } })
    await wrapper.get('.select-node').trigger('click')
    const actionButtons = wrapper.findAll('.component-node-actions button')
    expect(actionButtons).toHaveLength(2)

    await actionButtons[1].trigger('click')
    expect(wrapper.emitted('node-action')[0]).toEqual([{ action: 'aws-detail', node: lambdaGraph.document.nodes[0] }])
  })

  it('does not show navigation actions for unsupported resource types', async () => {
    const wrapper = mount(ArchitectureCanvas, { props: { graph }, global: { stubs } })
    await wrapper.get('.select-node').trigger('click')
    expect(wrapper.find('.component-node-actions').exists()).toBe(false)
  })

  it('emits canonical relationship and rounded layout operations', async () => {
    const wrapper = mount(ArchitectureCanvas, { props: { graph }, global: { stubs } })
    await wrapper.get('.connect-nodes').trigger('click')
    await wrapper.get('.drag-node').trigger('click')

    expect(wrapper.emitted('operation')[0][0]).toEqual({
      type: 'edge.upsert',
      value: {
        id: 'manual:edge:generated-id',
        sourceNodeId: 'manual:node:api',
        targetNodeId: 'manual:node:db',
        relationType: 'depends_on',
        status: 'manual',
        confidence: 1,
        evidence: [],
      },
    })
    expect(wrapper.emitted('operation')[1]).toEqual([
      { type: 'layout.set', value: { 'manual:node:api': { x: 92, y: 119 } } },
      'Move Orders API',
    ])
  })

  it('reviews an automatic relationship without changing its evidence in the client', async () => {
    const relationshipGraph = {
      revision: 3,
      document: {
        nodes: [
          { id: 'node:worker', name: 'Worker', resourceType: 'lambda' },
          { id: 'node:queue', name: 'Queue', resourceType: 'sqs' },
        ],
        edges: [{
          id: 'edge:queue-worker', sourceNodeId: 'node:queue', targetNodeId: 'node:worker',
          relationType: 'triggers', status: 'automatic', confidence: 0.99,
          evidence: [{ type: 'cloudformation_reference', intrinsic: 'AWS::Lambda::EventSourceMapping', path: 'Resources.QueueMapping.Properties' }],
        }],
        layout: {},
      },
    }
    const wrapper = mount(ArchitectureCanvas, { props: { graph: relationshipGraph }, global: { stubs } })
    await wrapper.get('.select-edge').trigger('click')
    expect(wrapper.get('.relationship-direction').text()).toContain('triggers')
    expect(wrapper.get('.relationship-status').text()).toContain('Automatic · 99%')
    await wrapper.get('.canvas-inspector .danger').trigger('click')

    expect(wrapper.emitted('operation')[0]).toEqual([
      { type: 'edge.review', subjectId: 'edge:queue-worker', value: { decision: 'reject' } },
      'Reject inferred relationship',
    ])
  })

  it('downloads a Mermaid file describing the visible nodes and relationships', async () => {
    const relationshipGraph = {
      revision: 3,
      document: {
        nodes: [
          { id: 'node:worker', name: 'Worker', resourceType: 'lambda' },
          { id: 'node:queue', name: 'Queue', resourceType: 'sqs' },
        ],
        edges: [{
          id: 'edge:queue-worker', sourceNodeId: 'node:queue', targetNodeId: 'node:worker',
          relationType: 'triggers', status: 'automatic', confidence: 0.99, evidence: [],
        }],
        layout: {},
      },
    }
    const createObjectURL = vi.fn(() => 'blob:mock')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL })
    const clickSpy = vi.fn()
    const originalCreateElement = document.createElement.bind(document)
    const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation(tag => {
      if (tag !== 'a') return originalCreateElement(tag)
      return { click: clickSpy, set href(_value) {}, set download(_value) {} }
    })

    const wrapper = mount(ArchitectureCanvas, { props: { graph: relationshipGraph }, global: { stubs } })
    await wrapper.get('button[title="Download the diagram as a Mermaid file"]').trigger('click')

    expect(clickSpy).toHaveBeenCalled()
    const blob = createObjectURL.mock.calls[0][0]
    const text = await blob.text()
    expect(text).toContain('flowchart LR')
    expect(text).toContain('["Worker [Lambda]"]')
    expect(text).toContain('["Queue [SQS queue]"]')
    expect(text).toContain('-->|triggers|')

    createElementSpy.mockRestore()
  })
})