import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))
const fitView = vi.fn()
vi.mock('@vue-flow/core', async original => ({ ...(await original()), useVueFlow: () => ({ fitView, setCenter: vi.fn(), getNodes: { value: [] } }) }))

import ArchitectureCanvas from '../components/architecture/ArchitectureCanvas.vue'

const stubs = {
  VueFlow: {
    props: ['nodes', 'edges'],
    emits: ['init', 'node-click'],
    template: '<div class="vue-flow-stub"><button class="flow-init" @click="$emit(\'init\')">init</button><slot /></div>',
  },
  Background: true,
  Controls: true,
}

const node = (id, name, resourceType = 'lambda') => ({ id, name, resourceType, provider: 'aws' })
function graphOf(nodes, edges = [], view = undefined) {
  return { revision: 1, document: { nodes, edges, layout: {}, ...(view ? { view } : {}) } }
}

describe('ArchitectureCanvas navigation (#239)', () => {
  beforeEach(() => fitView.mockClear())

  it('opens at a readable size, and a large map without an arrangement opens grouped by domain', async () => {
    const many = Array.from({ length: 41 }, (_, index) => node(`n${index}`, `fn-${index}`))
    const wrapper = mount(ArchitectureCanvas, { props: { graph: graphOf(many) }, global: { stubs } })
    await flushPromises()
    expect(wrapper.get('.canvas-layout-controls select').element.value).toBe('system-domains')
    await wrapper.get('.flow-init').trigger('click')
    expect(fitView).toHaveBeenCalledWith(expect.objectContaining({ minZoom: 0.6 }))

    // A chosen arrangement is kept, and a small map keeps the request flow.
    const chosen = mount(ArchitectureCanvas, { props: { graph: graphOf(many, [], { layoutMode: 'resource-type' }) }, global: { stubs } })
    await flushPromises()
    expect(chosen.get('.canvas-layout-controls select').element.value).toBe('resource-type')
    const small = mount(ArchitectureCanvas, { props: { graph: graphOf(many.slice(0, 3)) }, global: { stubs } })
    await flushPromises()
    expect(small.get('.canvas-layout-controls select').element.value).toBe('request-flow')
  })

  it('search is always visible; Enter selects the first match and zooms to it and its neighbours', async () => {
    const nodes = [node('api', 'orders-api'), node('db', 'orders-table', 'dynamodb'), node('other', 'billing')]
    const edges = [{ id: 'e', sourceNodeId: 'api', targetNodeId: 'db', relationType: 'writes_to', status: 'confirmed' }]
    const wrapper = mount(ArchitectureCanvas, { props: { graph: graphOf(nodes, edges) }, global: { stubs } })
    await flushPromises()
    const search = wrapper.get('[data-test="canvas-search"]')
    expect(search.element.closest('details')).toBe(null)
    await search.setValue('orders-api')
    await search.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(wrapper.emitted('resource-selected')[0][0].id).toBe('api')
    const call = fitView.mock.calls.at(-1)[0]
    expect(call.nodes).toEqual(['api'])
    expect(call.minZoom).toBe(0.6)

    await search.setValue('')
    await flushPromises()
    await wrapper.get('[data-test="canvas-zoom-neighbors"]').trigger('click')
    expect(fitView.mock.calls.at(-1)[0].nodes.sort()).toEqual(['api', 'db'])
  })
})
