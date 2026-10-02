import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import AwsCfnTab from '../components/cloud/cfn/AwsCfnTab.vue'

const ARN = 'arn:aws:cloudformation:us-east-1:111111111111:stack/orders-api/12345678-1234-1234-1234-123456789012'
const stack = (name, status, statusGroup, extra = {}) => ({
  id: extra.id || `arn:aws:cloudformation:us-east-1:111111111111:stack/${name}/00000000-0000-0000-0000-000000000000`, name, status, statusGroup,
  drift: { status: 'NOT_CHECKED', checkedAt: null }, terminationProtection: false, parentId: null, parameters: [], outputs: [], tags: {}, capabilities: [], createdTime: '2026-09-01T00:00:00Z', ...extra,
})

function stubApi(handler) {
  const calls = []
  vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
    calls.push({ url, method: options.method || 'GET' })
    return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => handler(url, options) }
  }))
  return calls
}

describe('AwsCfnTab', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

  const list = {
    region: 'us-east-1', truncated: false, counts: { ok: 2, rollback: 1 },
    stacks: [
      stack('orders-api', 'UPDATE_COMPLETE', 'ok', { id: ARN, drift: { status: 'DRIFTED', checkedAt: '2026-09-30T00:00:00Z' }, terminationProtection: true }),
      stack('orders-api-Nested', 'CREATE_COMPLETE', 'ok', { parentId: ARN }),
      stack('billing', 'UPDATE_ROLLBACK_COMPLETE', 'rollback', { statusReason: 'The following resource(s) failed to update: [Table]' }),
    ],
  }

  it('filters by status group and drift, and hides nested stacks unless asked', async () => {
    stubApi(() => list)
    const wrapper = mount(AwsCfnTab, { props: { profileId: 'p' } })
    await flushPromises()
    const names = () => wrapper.findAll('tbody tr').map(r => r.find('.cfn-name span').text()).sort()
    expect(names()).toEqual(['billing', 'orders-api'])
    const chip = label => wrapper.findAll('.cfn-chips button').find(b => b.text().startsWith(label))
    await chip('Rolled back').trigger('click')
    expect(names()).toEqual(['billing'])
    await chip('Drifted').trigger('click')
    expect(names()).toEqual(['orders-api'])
    await chip('All').trigger('click')
    await wrapper.find('.cfn-check input').setValue(true)
    expect(names()).toContain('orders-api-Nested')
  })

  it('opens a failed stack on its events with the root cause, and links resources to KUA tabs', async () => {
    const calls = stubApi(url => {
      if (url.includes('/stack-list')) return list
      if (url.includes('/stack/events')) return { truncated: false, events: [{ id: 'e1', timestamp: 1, logicalId: 'Table', type: 'AWS::DynamoDB::Table', status: 'UPDATE_FAILED', statusGroup: 'failed', reason: 'Table already exists' }], rootCause: { id: 'e1', timestamp: 1, logicalId: 'Table', type: 'AWS::DynamoDB::Table', status: 'UPDATE_FAILED', reason: 'Table already exists' } }
      return {
        stack: list.stacks[2], byType: { 'AWS::Lambda::Function': 1 }, resourcesTruncated: false,
        resources: [{ logicalId: 'Fn', physicalId: 'billing-Fn', type: 'AWS::Lambda::Function', status: 'UPDATE_COMPLETE', statusGroup: 'ok', drift: 'NOT_CHECKED', kuaTab: 'lambda', kuaName: 'billing-Fn' }],
      }
    })
    const wrapper = mount(AwsCfnTab, { props: { profileId: 'p' } })
    await flushPromises()
    await wrapper.findAll('tbody tr').find(r => r.text().includes('billing')).find('td:last-child button').trigger('click')
    await flushPromises()
    expect(wrapper.find('.cfn-root').text()).toContain('Table already exists')
    expect(calls.some(c => c.url.includes('/stack/events?stack=') && c.url.includes('&name=billing'))).toBe(true)
    await wrapper.findAll('.cfn-tabs button').find(b => b.text().startsWith('Resources')).trigger('click')
    await wrapper.find('.cfn-resources button').trigger('click')
    expect(wrapper.emitted('open-resource')[0][0]).toEqual({ tab: 'lambda', name: 'billing-Fn' })
  })

  it('detects drift and polls until it finishes', async () => {
    vi.useFakeTimers()
    let polls = 0
    const calls = stubApi((url, options) => {
      if (url.includes('/stack-list')) return list
      if (url.includes('/stack/drift') && options.method === 'POST') return { detectionId: '11111111-2222-3333-4444-555555555555' }
      if (url.includes('/stack/drift')) {
        polls += 1
        return polls < 2
          ? { detectionStatus: 'DETECTION_IN_PROGRESS', resources: [] }
          : { detectionStatus: 'DETECTION_COMPLETE', stackDriftStatus: 'DRIFTED', driftedResources: 1, resources: [{ logicalId: 'Fn', type: 'AWS::Lambda::Function', status: 'MODIFIED', differences: [{ path: '/MemorySize', expected: '128', actual: '512' }] }] }
      }
      return { stack: list.stacks[0], byType: {}, resources: [], resourcesTruncated: false }
    })
    const wrapper = mount(AwsCfnTab, { props: { profileId: 'p' } })
    await flushPromises()
    await wrapper.findAll('tbody tr').find(r => r.text().includes('orders-api')).find('td:last-child button').trigger('click')
    await flushPromises()
    await wrapper.findAll('.cfn-tabs button').find(b => b.text() === 'Drift').trigger('click')
    await wrapper.find('.cfn-detail .btn.primary').trigger('click')
    await flushPromises()
    await vi.advanceTimersByTimeAsync(2000)
    await flushPromises()
    expect(polls).toBe(2)
    expect(wrapper.find('.cfn-drift').text()).toContain('/MemorySize')
    expect(wrapper.find('.cfn-drift').text()).toContain('512')
    expect(calls.filter(c => c.url.includes('/stack-list')).length).toBe(2)
  })
})
