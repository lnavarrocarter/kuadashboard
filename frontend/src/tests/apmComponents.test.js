import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))

import ApmObservabilityView from '../components/cloud/apm/ApmObservabilityView.vue'
import ApmSetupModal from '../components/cloud/apm/ApmSetupModal.vue'
import { settings } from '../composables/useSettings'

function response(body, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(''),
  })
}

function findButton(text) {
  return [...document.body.querySelectorAll('button')].find(button => button.textContent.includes(text))
}

beforeEach(() => {
  setActivePinia(createPinia())
  settings.lang = 'en'
  document.body.innerHTML = ''
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('APM collection controls', () => {
  it('does not collect until the user confirms the read', async () => {
    global.fetch = vi.fn((url, options = {}) => {
      if (url.endsWith('/applications')) return response([{ id: 'app-a', name: 'orders', region: 'us-east-1' }])
      if (url.endsWith('/usage')) return response({ total: 4, limit: 100000 })
      if (url.includes('/overview')) return response({
        metrics: [],
        latestRun: { status: 'partial', errorCode: 'metrics_api_unavailable', startedAt: '2026-08-04T12:00:00.000Z' },
      })
      if (url.endsWith('/topology')) return response({ application: { id: 'app-a' }, resources: [{ id: 'lambda-a', type: 'lambda', name: 'orders' }], edges: [] })
      if (url.endsWith('/forecast')) return response({ lambdaCount: 1, monthlyRequestsMaximum: 2880 })
      if (url.includes('/series?')) return response([])
      if (url.endsWith('/collect-now')) return response({ run: { status: 'completed' } })
      throw new Error(`Unexpected URL: ${url}`)
    })

    const wrapper = mount(ApmObservabilityView, {
      attachTo: document.body,
      props: { profileId: 'local:dev' },
      global: {
        stubs: {
          CloudMetricChart: true,
          ApmSetupModal: true,
          ApmTopologyGraph: true,
        },
      },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('Metrics Server is unavailable')

    await wrapper.get('.application-actions button').trigger('click')
    await flushPromises()
    expect(global.fetch.mock.calls.some(([, options]) => options.method === 'POST')).toBe(false)

    findButton('Confirm collection').click()
    await flushPromises()
    expect(global.fetch.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(1)
    expect(global.fetch.mock.calls.find(([, options]) => options.method === 'POST')[0]).toContain('/collect-now')

    wrapper.unmount()
  })

  it('updates thresholds locally without collecting cloud data', async () => {
    global.fetch = vi.fn((url, options = {}) => {
      if (url.endsWith('/applications')) return response([{
        id: 'app-a', name: 'orders', region: 'us-east-1',
        thresholds: { errorRatePercent: 5, durationMs: 1000, readyPodsPercent: 100, restartDelta: 1 },
      }])
      if (url.endsWith('/usage')) return response({ total: 0, limit: 100000 })
      if (url.includes('/overview')) return response({ metrics: [], health: { status: 'unknown', signals: [] }, latestRun: null })
      if (url.endsWith('/topology')) return response({ application: { id: 'app-a' }, resources: [], edges: [] })
      if (url.endsWith('/forecast')) return response({ lambdaCount: 0, monthlyRequestsMaximum: 0 })
      if (url.includes('/series?')) return response([])
      if (url.endsWith('/applications/app-a/thresholds') && options.method === 'PATCH') {
        return response(JSON.parse(options.body))
      }
      throw new Error(`Unexpected URL: ${url}`)
    })
    const wrapper = mount(ApmObservabilityView, {
      attachTo: document.body,
      props: { profileId: 'local:dev' },
      global: { stubs: { teleport: true, CloudMetricChart: true, ApmSetupModal: true, ApmTopologyGraph: true } },
    })
    await flushPromises()
    await wrapper.find('button[title="Configure thresholds"]').trigger('click')
    await flushPromises()
    await wrapper.get('input[name="errorRatePercent"]').setValue('2.5')
    findButton('Save thresholds').click()
    await flushPromises()

    const write = global.fetch.mock.calls.find(([url, options = {}]) =>
      url.endsWith('/applications/app-a/thresholds') && options.method === 'PATCH')
    expect(JSON.parse(write[1].body).errorRatePercent).toBe(2.5)
    expect(global.fetch.mock.calls.some(([url]) => url.endsWith('/collect-now'))).toBe(false)
    wrapper.unmount()
  })
})

describe('APM setup cost consent', () => {
  it('associates an inventory Step Function only after explicit selection', async () => {
    const loadInventory = vi.fn().mockResolvedValue(undefined)
    global.fetch = vi.fn((url, options = {}) => {
      if (url.endsWith('/applications') && options.method === 'POST') {
        return response({ id: 'app-new', name: 'publication', region: 'us-east-1' })
      }
      if (url.endsWith('/applications/app-new/resources') && options.method === 'POST') {
        return response({ id: 'resource-new' })
      }
      throw new Error(`Unexpected URL: ${url}`)
    })
    const wrapper = mount(ApmSetupModal, {
      attachTo: document.body,
      props: {
        show: true,
        profileId: 'local:dev',
        loadInventory,
        stepFunctions: [{
          name: 'AutoAtencionV2ScheduleCampaignStateMachine',
          arn: 'arn:aws:states:us-east-1:073746111526:stateMachine:AutoAtencionV2ScheduleCampaignStateMachine',
          type: 'STANDARD',
        }],
      },
      global: { stubs: { teleport: true } },
    })
    await wrapper.get('input[placeholder="orders"]').setValue('publication')
    const inventoryInput = wrapper.get('.inventory-resources .resource-option input')
    expect(inventoryInput.element.checked).toBe(false)
    expect(findButton('Create application').disabled).toBe(true)

    await wrapper.findAll('button').find(button => button.text().includes('Load AWS inventory')).trigger('click')
    await flushPromises()
    expect(loadInventory).toHaveBeenCalledTimes(1)
    await inventoryInput.setValue(true)
    findButton('Create application').click()
    await flushPromises()

    const association = global.fetch.mock.calls.find(([url, options = {}]) =>
      url.endsWith('/applications/app-new/resources') && options.method === 'POST')
    expect(JSON.parse(association[1].body)).toEqual({
      type: 'stepfunctions',
      key: 'arn:aws:states:us-east-1:073746111526:stateMachine:AutoAtencionV2ScheduleCampaignStateMachine',
      arn: 'arn:aws:states:us-east-1:073746111526:stateMachine:AutoAtencionV2ScheduleCampaignStateMachine',
      name: 'AutoAtencionV2ScheduleCampaignStateMachine',
      service: '',
      kind: 'AWS::StepFunctions::StateMachine',
      logGroup: null,
      associationSource: 'manual',
    })
    wrapper.unmount()
  })

  it('previews deployment resources without selecting them and persists only explicit choices', async () => {
    global.fetch = vi.fn((url, options = {}) => {
      if (url.includes('/deployments?')) return response({
        scope: { profileId: 'local:dev', region: 'us-east-1', accountId: '073746111526' },
        estimate: { awsRequests: 2, kubernetesRequests: 0 },
        deployments: [{ id: 'stack-1', name: 'publication-stack', status: 'UPDATE_COMPLETE' }],
      })
      if (url.endsWith('/deployment-resources') && options.method === 'POST') return response({
        estimate: { awsRequests: 3, kubernetesRequests: 0 },
        resources: [
          { type: 'lambda', key: 'lambda-1', name: 'PublishFunction', stackName: 'publication-stack', kind: 'AWS::Lambda::Function' },
          { type: 'sqs', key: 'queue-1', name: 'PublishQueue', stackName: 'publication-stack', kind: 'AWS::SQS::Queue' },
          { type: 'ecs', key: 'service-1', name: 'publicacion-service', service: 'Publicacion-Cluster', stackName: 'publication-stack', kind: 'AWS::ECS::Service' },
        ],
      })
      if (url.endsWith('/applications') && options.method === 'POST') {
        return response({ id: 'app-new', name: 'publication', region: 'us-east-1' })
      }
      if (url.endsWith('/applications/app-new/resources') && options.method === 'POST') {
        return response({ id: 'resource-new' })
      }
      throw new Error(`Unexpected URL: ${url}`)
    })
    const wrapper = mount(ApmSetupModal, {
      attachTo: document.body,
      props: { show: true, profileId: 'local:dev' },
      global: { stubs: { teleport: true } },
    })
    await wrapper.get('input[placeholder="orders"]').setValue('publication')
    await wrapper.findAll('button').find(button => button.text().includes('Load deployments')).trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('073746111526')

    await wrapper.get('.deployment-option input').setValue(true)
    await wrapper.findAll('button').find(button => button.text().includes('Preview resources')).trigger('click')
    await flushPromises()
    const resourceInputs = wrapper.findAll('.deployment-resources .resource-option input')
    expect(resourceInputs).toHaveLength(3)
    expect(resourceInputs.every(input => input.element.checked === false)).toBe(true)
    expect(findButton('Create application').disabled).toBe(true)

    await resourceInputs[2].setValue(true)
    expect(findButton('Create application').disabled).toBe(false)
    findButton('Create application').click()
    await flushPromises()

    const association = global.fetch.mock.calls.find(([url, options = {}]) =>
      url.endsWith('/applications/app-new/resources') && options.method === 'POST')
    expect(JSON.parse(association[1].body)).toEqual({
      type: 'ecs',
      key: 'service-1',
      name: 'publicacion-service',
      service: 'Publicacion-Cluster',
      kind: 'AWS::ECS::Service',
      logGroup: null,
      associationSource: 'deployment',
    })
    wrapper.unmount()
  })

  it('analyzes loaded candidates without selecting them', async () => {
    global.fetch = vi.fn((url, options = {}) => {
      if (url.endsWith('/candidates') && options.method === 'POST') {
        return response({
          estimate: { awsRequests: 0, kubernetesRequests: 0 },
          candidates: [{
            key: 'orders-handler', name: 'orders-handler', status: 'suggested',
            identity: { candidates: [] },
            suggestions: [{ source: 'name', application: { name: 'orders' }, score: 0.5 }],
          }],
        })
      }
      throw new Error(`Unexpected URL: ${url}`)
    })
    const wrapper = mount(ApmSetupModal, {
      attachTo: document.body,
      props: {
        show: true,
        profileId: 'local:dev',
        lambdas: [{ name: 'orders-handler', runtime: 'nodejs20.x' }],
      },
      global: { stubs: { teleport: true } },
    })
    await wrapper.get('input[placeholder="orders"]').setValue('orders')
    await wrapper.findAll('button').find(button => button.text().includes('Analyze loaded resources')).trigger('click')
    await flushPromises()

    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect(wrapper.get('.resource-option input').element.checked).toBe(false)
    expect(document.body.textContent).toContain('Name suggestion: orders')
    expect(document.body.textContent).toContain('0 AWS reads and 0 Kubernetes reads')
    wrapper.unmount()
  })

  it('requires explicit consent before enabling Lambda polling', async () => {
    const wrapper = mount(ApmSetupModal, {
      attachTo: document.body,
      props: {
        show: true,
        profileId: 'local:dev',
        lambdas: [{ name: 'orders-handler', runtime: 'nodejs20.x' }],
      },
      global: { stubs: { teleport: true } },
    })
    await wrapper.get('input[placeholder="orders"]').setValue('orders')
    await wrapper.get('.resource-option input').setValue(true)
    await wrapper.get('.poll-toggle input').setValue(true)

    expect(document.body.textContent).toContain('up to 2,880 AWS reads/month')
    expect(findButton('Create application').disabled).toBe(true)

    await wrapper.get('.cost-ack input').setValue(true)
    expect(findButton('Create application').disabled).toBe(false)

    wrapper.unmount()
  })

  it('removes a newly-created application when resource association fails', async () => {
    global.fetch = vi.fn((url, options = {}) => {
      if (url.endsWith('/applications') && options.method === 'POST') {
        return response({ id: 'app-new', name: 'orders', region: 'us-east-1' })
      }
      if (url.endsWith('/applications/app-new/resources')) return response({ error: 'association failed' }, 500)
      if (url.endsWith('/applications/app-new') && options.method === 'DELETE') return response({ success: true })
      throw new Error(`Unexpected URL: ${url}`)
    })

    const wrapper = mount(ApmSetupModal, {
      attachTo: document.body,
      props: {
        show: true,
        profileId: 'local:dev',
        lambdas: [{ name: 'orders-handler', runtime: 'nodejs20.x' }],
      },
      global: { stubs: { teleport: true } },
    })
    await wrapper.get('input[placeholder="orders"]').setValue('orders')
    await wrapper.get('.resource-option input').setValue(true)
    await wrapper.findAll('button').find(button => button.text().includes('Create application')).trigger('click')
    await flushPromises()

    expect(global.fetch.mock.calls.map(([url, options = {}]) => [url, options.method || 'GET']))
      .toEqual(expect.arrayContaining([
        [expect.stringContaining('/applications'), 'POST'],
        [expect.stringContaining('/applications/app-new/resources'), 'POST'],
        [expect.stringContaining('/applications/app-new'), 'DELETE'],
      ]))
    expect(wrapper.emitted('created')).toBeUndefined()

    wrapper.unmount()
  })
})