import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ApmDistributedTrace from '../components/cloud/apm/ApmDistributedTrace.vue'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('ApmDistributedTrace', () => {
  it('loads a profile-scoped trace and labels ELB as inventory without a span', async () => {
    const projection = {
      coverage: 'partial',
      spans: [
        { spanId: 'a'.repeat(16), serviceName: 'shop-web', operation: 'GET HTTP', startTime: '2026-11-12T13:00:00.000Z', architecture: { status: 'matched', method: 'service_name', node: { id: 'web', name: 'shop-web' } } },
        { spanId: 'b'.repeat(16), parentSpanId: 'a'.repeat(16), serviceName: 'checkout-api', operation: 'HTTP server', startTime: '2026-11-12T13:00:00.010Z', architecture: { status: 'matched', method: 'service_name', node: { id: 'api', name: 'checkout-api' } } },
        { spanId: 'c'.repeat(16), parentSpanId: 'b'.repeat(16), serviceName: 'checkout-api', operation: 'Database operation', startTime: '2026-11-12T13:00:00.020Z', architecture: { status: 'matched', method: 'service_name', node: { id: 'api', name: 'checkout-api' } }, databaseTarget: { status: 'matched', system: 'postgresql', node: { id: 'db', name: 'orders-db' }, clientCallObserved: true, databaseServerSpanObserved: false } },
      ],
      segments: [{ fromSpanId: 'a'.repeat(16), toSpanId: 'b'.repeat(16), status: 'partial', inventoryNodes: [{ id: 'alb', name: 'public-alb', provider: 'aws', resourceType: 'elb' }], inventoryEdges: [{ id: 'route', observedSpan: false }] }],
      gaps: [{ reason: 'unobserved_architecture_hops' }],
    }
    const fetch = vi.fn(async () => ({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => projection,
    }))
    vi.stubGlobal('fetch', fetch)
    const wrapper = mount(ApmDistributedTrace, {
      props: { application: { id: 'app-1', architectureProjectId: 'project-1' }, profileId: 'aws:dev' },
    })

    await wrapper.get('input').setValue('1'.repeat(32))
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(fetch).toHaveBeenCalledWith(expect.stringContaining(`/api/observability/otlp/traces/${'1'.repeat(32)}/architecture?projectId=project-1`), expect.objectContaining({ headers: { 'X-Profile-Id': 'aws:dev' } }))
    expect(wrapper.text()).toContain('public-alb')
    expect(wrapper.text()).toMatch(/no span|sin span/i)
    expect(wrapper.text()).toMatch(/partial|parcial/i)
    expect(wrapper.find('[data-test="database-target"]').text()).toContain('orders-db')
    expect(wrapper.find('[data-test="database-target"]').text()).toMatch(/database-side span not observed|span del lado de la base no observado/i)
    wrapper.unmount()
  })
})
