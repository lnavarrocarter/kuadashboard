import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import CfnConfirm from '../components/cloud/cfn/CfnConfirm.vue'
import CfnChangeSets from '../components/cloud/cfn/CfnChangeSets.vue'
import CfnOperations from '../components/cloud/cfn/CfnOperations.vue'
import CfnApplications from '../components/cloud/cfn/CfnApplications.vue'
import CfnExports from '../components/cloud/cfn/CfnExports.vue'

const STACK_ID = 'arn:aws:cloudformation:us-east-1:111111111111:stack/orders/12345678-1234-1234-1234-123456789012'

function stubApi(handler) {
  const calls = []
  vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : null
    calls.push({ url, method: options.method || 'GET', body })
    return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => handler(url, options.method || 'GET', body) }
  }))
  return calls
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('CfnConfirm', () => {
  it('enables the action only with the exact stack name (and a reason when required)', async () => {
    const wrapper = mount(CfnConfirm, { props: { stackName: 'orders', actionLabel: 'Delete', requireReason: true } })
    const [name, reason] = wrapper.findAll('input')
    const action = () => wrapper.find('.cfc-actions button')
    await name.setValue('Orders')
    expect(action().attributes('disabled')).toBeDefined()
    await name.setValue('orders')
    expect(action().attributes('disabled')).toBeDefined()
    await reason.setValue('retired service')
    expect(action().attributes('disabled')).toBeUndefined()
    await action().trigger('click')
    expect(wrapper.emitted('confirm')[0][0]).toEqual({ confirm: 'orders', reason: 'retired service' })
  })
})

describe('CfnChangeSets', () => {
  const changeSet = risk => ({
    id: 'cs1', name: 'kua-1', status: 'CREATE_COMPLETE', executionStatus: 'AVAILABLE', parameters: [], capabilities: [],
    changes: [{ action: 'Modify', logicalId: 'Table', type: 'AWS::DynamoDB::Table', replacement: risk === 'high' ? 'True' : 'False', dataBearing: true, details: [] }],
    risk: { level: risk, removals: 0, replacements: risk === 'high' ? 1 : 0, conditionalReplacements: 0, dataBearing: risk === 'high' ? ['Table'] : [], counts: { Modify: 1 } },
  })

  async function mountWith(risk) {
    const calls = stubApi((url, method) => {
      if (url.includes('/stack/change-sets')) return { changeSets: [{ id: 'cs1', name: 'kua-1', status: 'CREATE_COMPLETE', executionStatus: 'AVAILABLE' }] }
      if (url.includes('/change-set/execute')) return { executed: true }
      return changeSet(risk)
    })
    const wrapper = mount(CfnChangeSets, { props: { stackId: STACK_ID, stackName: 'orders', profileId: 'p' } })
    await flushPromises()
    await wrapper.find('tbody button').trigger('click')
    await flushPromises()
    return { wrapper, calls }
  }

  it('executes a low-risk change set directly', async () => {
    const { wrapper, calls } = await mountWith('low')
    await wrapper.find('.ccs-detail .btn.primary').trigger('click')
    await flushPromises()
    expect(calls.find(c => c.url.includes('/change-set/execute')).body).toMatchObject({ stack: STACK_ID, changeSet: 'cs1', confirm: '' })
    expect(wrapper.emitted('changed')).toBeTruthy()
  })

  it('asks for the stack name before executing a change set that may lose data', async () => {
    const { wrapper, calls } = await mountWith('high')
    expect(wrapper.find('.ccs-detail').text()).toContain('Table')
    await wrapper.find('.ccs-detail .btn.danger').trigger('click')
    expect(calls.some(c => c.url.includes('/change-set/execute'))).toBe(false)
    const confirm = wrapper.findComponent(CfnConfirm)
    expect(confirm.exists()).toBe(true)
    confirm.vm.$emit('confirm', { confirm: 'orders', reason: '' })
    await flushPromises()
    expect(calls.find(c => c.url.includes('/change-set/execute')).body.confirm).toBe('orders')
  })
})

describe('CfnOperations', () => {
  const stack = { id: STACK_ID, name: 'orders', terminationProtection: true, parameters: [{ key: 'Memory', value: '128' }, { key: 'Secret', value: '****' }] }

  it('previews a parameter change as a change set and shows the history', async () => {
    const calls = stubApi(url => {
      if (url.includes('/stack/history')) return { entries: [{ id: '1', timestamp: '2026-10-01T00:00:00Z', level: 'info', action: 'CloudFormation change set created (preview)', details: { changeSet: 'kua-1' } }] }
      return { changeSetId: 'cs-new', changeSetName: 'kua-2' }
    })
    const wrapper = mount(CfnOperations, { props: { stack, profileId: 'p' } })
    await flushPromises()
    expect(wrapper.find('.cop-history').text()).toContain('kua-1')
    const inputs = wrapper.findAll('.cop-param input')
    expect(inputs[1].attributes('disabled')).toBeDefined()
    await inputs[0].setValue('512')
    await wrapper.find('.cop-section .btn.primary').trigger('click')
    await flushPromises()
    expect(calls.find(c => c.url.includes('/parameter-change-set')).body).toEqual({ stack: STACK_ID, parameters: { Memory: '512' } })
    expect(wrapper.emitted('change-set-created')[0]).toEqual(['cs-new'])
  })

  it('shows delete blockers and hides the confirmation while the stack is protected', async () => {
    stubApi(url => {
      if (url.includes('/stack/history')) return { entries: [] }
      return {
        stack: { name: 'orders' }, risk: 'high', blockers: ['termination_protection'], blockingImports: [], templateError: null,
        summary: { total: 1, removed: 1, retained: 0, dataBearingRemoved: ['Table'], nestedStacks: 0 },
        resources: [{ logicalId: 'Table', type: 'AWS::DynamoDB::Table', deletionPolicy: 'Delete', dataBearing: true }],
      }
    })
    const wrapper = mount(CfnOperations, { props: { stack, profileId: 'p' } })
    await flushPromises()
    await wrapper.findAll('.cop-section')[2].find('button').trigger('click')
    await flushPromises()
    const text = wrapper.findAll('.cop-section')[2].text()
    expect(text).toContain('Table')
    expect(text).toContain('Termination protection is on')
    expect(wrapper.findAllComponents(CfnConfirm).length).toBe(0)
  })
})

describe('CfnApplications', () => {
  it('lists linked applications and links the stack to a new application', async () => {
    const calls = stubApi((url, method) => {
      if (url.includes('/stack-applications')) return { stackName: 'orders', linkable: 3, applications: [{ applicationId: 'a1', name: 'billing', environment: 'prod', matched: 1, total: 4 }] }
      if (url.endsWith('/applications') && method === 'POST') return { id: 'new-app' }
      if (url.includes('/applications?')) return [{ id: 'a1', name: 'billing' }, { id: 'a2', name: 'orders-old' }]
      return { added: 3, alreadyLinked: 0 }
    })
    const wrapper = mount(CfnApplications, { props: { stackName: 'orders', region: 'us-east-1', profileId: 'p' } })
    await flushPromises()
    expect(wrapper.text()).toContain('billing')
    expect(wrapper.findAll('option').map(o => o.text())).toEqual(['New application "orders"', 'orders-old'])
    await wrapper.find('.cap-row .btn.primary').trigger('click')
    await flushPromises()
    expect(calls.find(c => c.method === 'POST' && c.url.endsWith('/applications')).body).toEqual({ name: 'orders', region: 'us-east-1' })
    expect(calls.find(c => c.url.includes('/applications/new-app/link-stack')).body).toEqual({ stackName: 'orders', region: 'us-east-1' })
    expect(wrapper.emitted('linked')[0][0]).toMatchObject({ applicationId: 'new-app', added: 3 })
  })
})

describe('CfnExports', () => {
  it('filters unused exports and opens the exporting stack', async () => {
    stubApi(() => ({ importsChecked: 2, exports: [
      { name: 'orders-url', value: 'https://x', exportingStack: 'orders', exportingStackId: STACK_ID, importedBy: ['web'] },
      { name: 'old-arn', value: 'arn:x', exportingStack: 'legacy', exportingStackId: 'legacy-id', importedBy: [] },
    ] }))
    const wrapper = mount(CfnExports, { props: { profileId: 'p' } })
    await flushPromises()
    expect(wrapper.findAll('tbody tr')).toHaveLength(2)
    await wrapper.find('.cfn-check input').setValue(true)
    expect(wrapper.findAll('tbody tr')).toHaveLength(1)
    expect(wrapper.find('tbody').text()).toContain('old-arn')
    await wrapper.find('tbody .cfn-link').trigger('click')
    expect(wrapper.emitted('open-stack')[0]).toEqual(['legacy-id'])
  })
})
