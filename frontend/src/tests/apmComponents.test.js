import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))

import ApmObservabilityView from '../components/cloud/apm/ApmObservabilityView.vue'
import ApmSetupModal from '../components/cloud/apm/ApmSetupModal.vue'
import ApmTopologyGraph from '../components/cloud/apm/ApmTopologyGraph.vue'
import ApmProcessTrace from '../components/cloud/apm/ApmProcessTrace.vue'
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
  it('shows Kubernetes-only signals and opens logs for configured workloads', async () => {
    global.fetch = vi.fn((url) => {
      if (url.endsWith('/applications')) return response([{ id: 'app-eks', name: 'orders-eks', region: 'us-east-1' }])
      if (url.endsWith('/usage')) return response({ total: 0, limit: 100000 })
      if (url.includes('/overview')) return response({
        metrics: [{ metricName: 'cpu_cores', sum: 1, count: 1, average: 1, quality: 'full' }], health: { status: 'healthy', signals: [] }, latestRun: null,
      })
      if (url.endsWith('/topology')) return response({
        application: { id: 'app-eks' },
        resources: [{ id: 'deployment-a', type: 'kubernetes', kind: 'Deployment', name: 'api', namespace: 'orders', kubeContext: 'orders-eks', enabled: true, associationSource: 'manual' }], edges: [],
      })
      if (url.endsWith('/forecast')) return response({ lambdaCount: 0, monthlyRequestsMaximum: 0 })
      if (url.includes('/series?')) return response([])
      throw new Error(`Unexpected URL: ${url}`)
    })
    const wrapper = mount(ApmObservabilityView, {
      attachTo: document.body,
      props: { profileId: 'local:dev' },
      global: { stubs: { teleport: true, CloudMetricChart: true, ApmSetupModal: true, ApmTopologyGraph: true } },
    })
    await flushPromises()
    expect(wrapper.get('.kpi-grid').text()).toContain('Average CPU')
    expect(wrapper.get('.kpi-grid').text()).not.toContain('Observed invocations')

    await wrapper.findAll('.apm-view-tabs button').find(button => button.text().includes('Resources')).trigger('click')
    await wrapper.get('.architecture-resources tbody button').trigger('click')
    expect(wrapper.emitted('open-kubernetes-logs')[0][0]).toMatchObject({ name: 'api', kubeContext: 'orders-eks', kind: 'Deployment' })
    wrapper.unmount()
  })

  it('filters metric series to a resource opened from Architecture', async () => {
    global.fetch = vi.fn((url) => {
      if (url.endsWith('/applications')) return response([{ id: 'app-orders', name: 'orders', region: 'us-east-1' }])
      if (url.endsWith('/usage')) return response({ total: 0, limit: 100000 })
      if (url.includes('/overview')) return response({ metrics: [], metricsByResourceType: [], health: { status: 'unknown', signals: [] }, latestRun: null })
      if (url.endsWith('/topology')) return response({
        application: { id: 'app-orders' },
        resources: [{ id: 'lambda-a', type: 'lambda', name: 'orders-handler', arn: 'arn:aws:lambda:us-east-1:123:function:orders-handler', enabled: true }],
        edges: [],
      })
      if (url.endsWith('/forecast')) return response({ lambdaCount: 1, monthlyRequestsMaximum: 0 })
      if (url.includes('/series?')) return response([])
      throw new Error(`Unexpected URL: ${url}`)
    })
    const wrapper = mount(ApmObservabilityView, {
      attachTo: document.body,
      props: {
        profileId: 'local:dev',
        focusResource: {
          view: 'metrics',
          node: { provider: 'aws', resourceType: 'lambda', name: 'orders-handler', arn: 'arn:aws:lambda:us-east-1:123:function:orders-handler' },
        },
      },
      global: { stubs: { teleport: true, CloudMetricChart: true, ApmSetupModal: true, ApmTopologyGraph: true } },
    })
    await flushPromises()

    expect(wrapper.get('.apm-resource-focus').text()).toContain('orders-handler')
    expect(global.fetch.mock.calls.some(([url]) => url.includes('/series?') && url.includes('resourceId=lambda-a'))).toBe(true)
    wrapper.unmount()
  })

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

  it('edits and deletes the selected application from explicit actions', async () => {
    global.fetch = vi.fn((url, options = {}) => {
      if (url.endsWith('/applications') && (!options.method || options.method === 'GET')) return response([{
        id: 'app-a', name: 'orders', region: 'us-east-1', environment: 'dev', team: 'platform', pollingEnabled: false,
      }])
      if (url.endsWith('/usage')) return response({ total: 0, limit: 100000 })
      if (url.includes('/overview')) return response({ metrics: [], health: { status: 'unknown', signals: [] }, latestRun: null })
      if (url.endsWith('/topology')) return response({ application: { id: 'app-a' }, resources: [], edges: [] })
      if (url.endsWith('/forecast')) return response({ lambdaCount: 0, monthlyRequestsMaximum: 0 })
      if (url.includes('/series?')) return response([])
      if (url.endsWith('/applications/app-a') && options.method === 'PATCH') {
        return response({ id: 'app-a', region: 'us-east-1', ...JSON.parse(options.body) })
      }
      if (url.endsWith('/applications/app-a') && options.method === 'DELETE') return response(null, 204)
      throw new Error(`Unexpected URL: ${url}`)
    })
    const wrapper = mount(ApmObservabilityView, {
      attachTo: document.body,
      props: { profileId: 'local:dev' },
      global: { stubs: { teleport: true, CloudMetricChart: true, ApmSetupModal: true, ApmTopologyGraph: true } },
    })
    await flushPromises()

    await wrapper.get('button[title="Edit application"]').trigger('click')
    await wrapper.get('.application-editor input').setValue('orders-api')
    findButton('Save').click()
    await flushPromises()
    const update = global.fetch.mock.calls.find(([url, options = {}]) =>
      url.endsWith('/applications/app-a') && options.method === 'PATCH')
    expect(JSON.parse(update[1].body).name).toBe('orders-api')

    await wrapper.get('button[title="Delete application"]').trigger('click')
    findButton('Delete').click()
    await flushPromises()
    expect(global.fetch.mock.calls.some(([url, options = {}]) =>
      url.endsWith('/applications/app-a') && options.method === 'DELETE')).toBe(true)
    expect(wrapper.text()).toContain('Build an application view')
    wrapper.unmount()
  })
})

describe('APM process traces', () => {
  it('requests sanitized data explicitly and allows selecting a recent execution', async () => {
    const wrapper = mount(ApmProcessTrace, {
      props: {
        result: {
          traces: [], requests: 1,
          availableExecutions: [{
            executionArn: 'arn:aws:states:us-east-1:123:execution:orders:run-1',
            name: 'run-1', status: 'SUCCEEDED', startDate: '2026-08-11T10:00:00Z',
          }],
        },
      },
    })
    await wrapper.get('.ctrl-input').setValue('req-123')
    await wrapper.get('input[type="checkbox"]').setValue(true)
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('trace')[0]).toEqual(['req-123', true])

    await wrapper.get('.execution-row').trigger('click')
    expect(wrapper.emitted('trace')[1]).toEqual([
      'arn:aws:states:us-east-1:123:execution:orders:run-1', true,
    ])
  })
})

describe('APM setup cost consent', () => {
  it('detects EKS workloads without selecting them and persists only explicit choices', async () => {
    global.fetch = vi.fn((url, options = {}) => {
      if (url.endsWith('/kubernetes-contexts')) return response({
        contexts: [{ id: 'arn:aws:eks:us-east-1:123:cluster/dev', name: 'orders-eks' }],
      })
      if (url.includes('/kubernetes-workloads?contexts=arn%3Aaws%3Aeks%3Aus-east-1%3A123%3Acluster%2Fdev')) return response({
        estimate: { awsRequests: 0, kubernetesRequests: 3 },
        contexts: ['arn:aws:eks:us-east-1:123:cluster/dev'],
        failedContexts: [],
        workloads: [{
          key: 'arn:aws:eks:us-east-1:123:cluster/dev/orders/Deployment/api',
          context: 'arn:aws:eks:us-east-1:123:cluster/dev',
          namespace: 'orders', kind: 'Deployment', name: 'api',
        }],
      })
      if (url.endsWith('/applications') && options.method === 'POST') {
        return response({ id: 'app-new', name: 'orders', region: 'us-east-1' })
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
    await wrapper.get('input[placeholder="orders"]').setValue('orders')
    await wrapper.findAll('button').find(button => button.text().includes('Load clusters')).trigger('click')
    await flushPromises()
    await wrapper.get('.eks-context-tools select').setValue('arn:aws:eks:us-east-1:123:cluster/dev')
    await wrapper.findAll('button').find(button => button.text().includes('Detect workloads')).trigger('click')
    await flushPromises()

    const workloadInput = wrapper.get('.eks-workloads .resource-option input')
    expect(workloadInput.element.checked).toBe(false)
    expect(findButton('Create application').disabled).toBe(true)
    await workloadInput.setValue(true)
    findButton('Create application').click()
    await flushPromises()

    const association = global.fetch.mock.calls.find(([url, options = {}]) =>
      url.endsWith('/applications/app-new/resources') && options.method === 'POST')
    expect(JSON.parse(association[1].body)).toEqual({
      type: 'kubernetes',
      provider: 'aws',
      key: 'arn:aws:eks:us-east-1:123:cluster/dev/orders/Deployment/api',
      kubeContext: 'arn:aws:eks:us-east-1:123:cluster/dev',
      namespace: 'orders',
      kind: 'Deployment',
      name: 'api',
      associationSource: 'manual',
    })
    wrapper.unmount()
  })

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
      provider: 'aws',
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
    expect(wrapper.text()).toContain('publication-stack')

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
      provider: 'aws',
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

describe('APM topology intelligence', () => {
  it('shows explainable suggestions and emits confirmation explicitly', async () => {
    const wrapper = mount(ApmTopologyGraph, {
      props: {
        topology: {
          application: { id: 'gasco', name: 'GASCO' },
          resources: [
            { id: 'queue', type: 'sqs', name: 'gasco-orders-events', enabled: true },
            { id: 'worker', type: 'lambda', name: 'gasco-orders-worker', enabled: true },
          ],
          edges: [],
          analysis: {
            score: 45,
            coveragePercent: 0,
            counts: { suggestions: 1 },
            findings: [{ code: 'dependency_suggestions', severity: 'info', resourceIds: [] }],
            suggestions: [{
              sourceResourceId: 'queue', targetResourceId: 'worker', relationType: 'consumed_by',
              confidence: 0.81, confirmed: false,
              evidence: [{ type: 'shared_name_tokens', values: ['gasco', 'orders'] }],
            }],
            cloudScan: {
              requests: 1,
              failedResources: [],
              unresolvedReferences: [{
                sourceResourceId: 'flow', type: 'lambda', name: 'shared-worker', statePath: 'Invoke shared',
                candidate: { type: 'lambda', key: 'arn:shared', arn: 'arn:shared', name: 'shared-worker', associationSource: 'manual' },
              }],
            },
          },
        },
        canAnalyzeCloud: true,
      },
    })

    expect(wrapper.text()).toContain('Local intelligent assessment')
    expect(wrapper.text()).toContain('81% confidence')
    expect(wrapper.text()).toContain('shared name: gasco, orders')
    await wrapper.find('.suggestion-row button').trigger('click')
    expect(wrapper.emitted('confirm-dependency')[0][0].confirmed).toBe(false)
    await wrapper.find('.suggestion-heading button').trigger('click')
    expect(wrapper.emitted('confirm-all-dependencies')[0][0]).toHaveLength(1)
    await wrapper.find('.analysis-heading button').trigger('click')
    expect(wrapper.emitted('analyze-cloud')).toHaveLength(1)
    await wrapper.find('.unresolved-row button').trigger('click')
    expect(wrapper.emitted('add-cloud-resource')[0][0].candidate.name).toBe('shared-worker')
  })
})

describe('APM registry resources', () => {
  it('marks Architecture-only resources and explains that Observability is missing them', async () => {
    global.fetch = vi.fn((url) => {
      if (url.endsWith('/applications')) return response([{ id: 'app-a', name: 'orders', architectureProjectId: 'project-a' }])
      if (url.endsWith('/usage')) return response({ total: 0, limit: 100000 })
      if (url.includes('/overview')) return response({ metrics: [], health: { status: 'healthy', signals: [] }, latestRun: null })
      if (url.endsWith('/topology')) return response({ application: { id: 'app-a' }, resources: [], edges: [], analysis: {} })
      if (url.includes('/forecast')) return response({ monthlyRequestsMaximum: 0 })
      if (url.endsWith('/registry')) return response({
        resources: [{
          id: 'resource-a', provider: 'aws', resourceType: 'lambda', displayName: 'orders-worker',
          scopeId: '123456789012', location: 'us-east-1', sources: ['architecture_node'], correlatable: true, divergent: true,
        }], relationships: [], syncStatus: null,
      })
      throw new Error(`Unexpected URL: ${url}`)
    })
    const wrapper = mount(ApmObservabilityView, {
      attachTo: document.body,
      props: { profileId: 'local:dev' },
      global: { stubs: { teleport: true } },
    })
    await flushPromises()

    await [...wrapper.findAll('.apm-view-tabs button')].find(button => button.text().includes('Resources')).trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('orders-worker')
    expect(wrapper.text()).toContain('Architecture')
    expect(wrapper.text()).toContain('Single source')
    wrapper.unmount()
  })
})
