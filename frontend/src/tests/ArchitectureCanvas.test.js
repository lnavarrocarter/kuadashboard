import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ArchitectureCanvas from '../components/architecture/ArchitectureCanvas.vue'

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
    emits: ['connect', 'edge-click', 'node-click', 'node-drag-stop'],
    template: `<div class="vue-flow-stub">
      <button class="select-node" @click="$emit('node-click', { node: nodes[0] })">Select</button>
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
})