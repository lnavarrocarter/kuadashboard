import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ArchitectureDiscoveryPanel from '../components/architecture/ArchitectureDiscoveryPanel.vue'
import { useArchitectureStore } from '../stores/useArchitectureStore'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))

describe('ArchitectureDiscoveryPanel', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('draws every resource in an identified application explicitly', async () => {
    const store = useArchitectureStore()
    store.discoveryPreview = {
      scope: { accountId: '123456789012', region: 'us-east-1' },
      estimate: { truncated: true },
      nodes: [
        { id: 'node:rule', name: 'OrderRule', resourceType: 'eventbridge', evidence: [] },
        { id: 'node:queue', name: 'OrderQueue', resourceType: 'sqs', evidence: [] },
        { id: 'node:worker', name: 'UnrelatedWorker', resourceType: 'lambda', evidence: [] },
      ],
      relationshipSuggestions: [{
        id: 'edge:rule-queue', sourceNodeId: 'node:rule', targetNodeId: 'node:queue',
        relationType: 'triggers', confidence: 0.99, evidence: [{ intrinsic: 'EventBridge target' }],
      }],
      applicationCandidates: [{
        id: 'application:orders', name: 'OrderQueue application',
        nodeIds: ['node:rule', 'node:queue'], resourceCount: 2, relationshipCount: 1, confidence: 0.99,
        resourceTypes: [{ type: 'eventbridge', count: 1 }, { type: 'sqs', count: 1 }],
      }],
    }
    store.importAwsResources = vi.fn().mockResolvedValue({ revision: 1 })

    const wrapper = mount(ArchitectureDiscoveryPanel)
    expect(wrapper.get('.application-types').text()).toContain('1 EventBridge rule')
    expect(wrapper.get('.application-types').text()).toContain('1 SQS queue')
    await wrapper.get('.application-row button').trigger('click')

    expect(wrapper.get('.inventory-warning').text()).toContain('500-resource preview limit')
    expect(store.importAwsResources).toHaveBeenCalledWith({
      region: 'us-east-1',
      accountId: '123456789012',
      stackNames: [],
      selectedNodeIds: ['node:rule', 'node:queue'],
    })
    expect(wrapper.emitted('imported')).toHaveLength(1)
  })

  it('shows a visible status while AWS stacks or resources are loading', async () => {
    const store = useArchitectureStore()
    store.discovering = true
    store.discoveryPhase = 'stacks'
    const wrapper = mount(ArchitectureDiscoveryPanel)

    expect(wrapper.get('.discovery-progress').text()).toContain('Loading CloudFormation stacks')
    expect(wrapper.get('.discovery-progress').text()).toContain('listing deployments')

    store.discoveryPhase = 'resources'
    await wrapper.vm.$nextTick()
    expect(wrapper.get('.discovery-progress').text()).toContain('Analyzing AWS resources')
    expect(wrapper.get('.discovery-progress').text()).toContain('This can take a moment')
  })

  it('guides setup from CloudFormation deployments to resource confirmation', async () => {
    const store = useArchitectureStore()
    store.loadAwsDeployments = vi.fn(async () => {
      store.discoveryCatalog = {
        scope: { accountId: '123456789012', region: 'us-east-1' },
        estimate: { awsRequests: 2 },
        deployments: [{ id: 'stack:orders', name: 'orders-stack', status: 'CREATE_COMPLETE', updatedAt: null }],
      }
    })
    store.previewAwsResources = vi.fn(async input => {
      store.discoveryPreview = {
        scope: { accountId: input.accountId, region: input.region },
        estimate: { truncated: false },
        nodes: [
          { id: 'node:bucket', name: 'orders-data', resourceType: 's3', stackName: 'orders-stack', evidence: [] },
          { id: 'node:policy', name: 'orders-policy', resourceType: 'policy', stackName: 'orders-stack', evidence: [] },
          { id: 'node:worker', name: 'orders-worker', resourceType: 'lambda', stackName: 'orders-stack', evidence: [] },
        ],
        applicationCandidates: [],
        relationshipSuggestions: [{
          id: 'edge:policy-bucket', sourceNodeId: 'node:policy', targetNodeId: 'node:bucket',
          relationType: 'governs', confidence: 0.95, evidence: [{ intrinsic: 'Ref' }],
        }],
      }
    })
    store.importAwsResources = vi.fn().mockResolvedValue({ revision: 1 })
    const wrapper = mount(ArchitectureDiscoveryPanel)

    expect(wrapper.get('.discovery-steps .active strong').text()).toBe('CloudFormation')
    await wrapper.get('.discovery-controls button').trigger('click')
    await flushPromises()
    await wrapper.get('.deployment-list input').setValue(true)
    await wrapper.get('.discovery-next-actions .primary').trigger('click')
    await flushPromises()

    expect(store.previewAwsResources).toHaveBeenCalledWith({
      region: 'us-east-1', accountId: '123456789012', stackNames: ['orders-stack'],
    })
    expect(wrapper.get('.discovery-steps .active strong').text()).toBe('Resources')
    expect(wrapper.get('.resource-step-heading').text()).toContain('1 CloudFormation deployment selected')
    expect(wrapper.get('.stack-resource-summary').text()).toContain('3 resources · 1 relationships')
    expect(wrapper.findAll('.resource-group-heading').map(item => item.text())).toEqual([
      'Lambda1 resource',
    ])
    expect(wrapper.get('.resource-list').text()).toContain('orders-worker')
    expect(wrapper.get('.resource-list').text()).not.toContain('orders-data')
    await wrapper.get('.stack-resource-summary button').trigger('click')
    expect(store.importAwsResources).toHaveBeenCalledWith({
      region: 'us-east-1', accountId: '123456789012', stackNames: ['orders-stack'],
      selectedNodeIds: ['node:bucket', 'node:policy', 'node:worker'],
    })
  })

  it('filters CloudFormation deployments by name or status without clearing hidden selections', async () => {
    const store = useArchitectureStore()
    store.discoveryCatalog = {
      scope: { accountId: '123456789012', region: 'us-east-1' },
      estimate: { awsRequests: 2 },
      deployments: [
        { id: 'stack:orders', name: 'orders-api', status: 'CREATE_COMPLETE', updatedAt: null },
        { id: 'stack:billing', name: 'billing-worker', status: 'UPDATE_COMPLETE', updatedAt: null },
      ],
    }
    store.previewAwsResources = vi.fn(async input => {
      store.discoveryPreview = { scope: { accountId: input.accountId, region: input.region }, estimate: {}, nodes: [], relationshipSuggestions: [] }
    })
    const wrapper = mount(ArchitectureDiscoveryPanel)
    const rows = wrapper.findAll('.deployment-list .discovery-row')
    await rows[0].get('input').setValue(true)

    await wrapper.get('.deployment-search input').setValue('BILLING')
      expect(wrapper.findAll('.deployment-list .discovery-row').map(row => row.text())[0]).toContain('billing-worker')
    expect(wrapper.get('.selection-count').text()).toBe('1 selected')

    await wrapper.get('.deployment-search input').setValue('update_complete')
    expect(wrapper.findAll('.deployment-list .discovery-row')).toHaveLength(1)
    await wrapper.get('.deployment-search input').setValue('not-found')
    expect(wrapper.get('.discovery-empty').text()).toBe('No stacks match your search.')

    await wrapper.get('.deployment-search input').setValue('')
    expect(wrapper.findAll('.deployment-list input')[0].element.checked).toBe(true)
    await wrapper.get('.discovery-next-actions .primary').trigger('click')
    await flushPromises()
    expect(store.previewAwsResources).toHaveBeenCalledWith({
      region: 'us-east-1', accountId: '123456789012', stackNames: ['orders-api'],
    })
  })

  it('reviews suggested relationships after selecting unlinked resources', async () => {
    const store = useArchitectureStore()
    store.discoveryPreview = {
      scope: { accountId: '123456789012', region: 'us-east-1' },
      estimate: { truncated: false },
      nodes: [
        { id: 'node:api', name: 'OrdersApi', resourceType: 'api', evidence: [] },
        { id: 'node:worker', name: 'OrdersWorker', resourceType: 'lambda', evidence: [] },
        { id: 'node:bucket', name: 'AuditBucket', resourceType: 's3', evidence: [] },
      ],
      applicationCandidates: [],
      relationshipSuggestions: [{
        id: 'edge:api-worker', sourceNodeId: 'node:api', targetNodeId: 'node:worker',
        relationType: 'routes_to', confidence: 0.96, evidence: [{ intrinsic: 'Ref' }],
      }],
    }
    store.importAwsResources = vi.fn().mockResolvedValue({ revision: 1 })
    const wrapper = mount(ArchitectureDiscoveryPanel)

    expect(wrapper.get('.resource-list').text()).toContain('AuditBucket')
    expect(wrapper.get('.resource-list').text()).not.toContain('OrdersApi')
    await wrapper.get('.resource-row input').setValue(true)
    await wrapper.get('.discovery-section-heading .primary').trigger('click')

    expect(wrapper.get('.discovery-steps .active strong').text()).toBe('Diagram')
    expect(wrapper.get('.suggestion-list').text()).toContain('OrdersApi')
    expect(wrapper.get('.suggestion-list').text()).toContain('routes to')
    await wrapper.get('.review-actions .primary').trigger('click')
    expect(store.importAwsResources).toHaveBeenCalledWith({
      region: 'us-east-1', accountId: '123456789012', stackNames: [],
      selectedNodeIds: ['node:api', 'node:worker', 'node:bucket'],
    })
  })

  it('looks up a mapped AWS resource by ARN and opens relationship review before importing', async () => {
    const store = useArchitectureStore()
    store.previewAwsResources = vi.fn(async input => {
      store.discoveryPreview = {
        scope: { accountId: input.accountId, region: input.region },
        estimate: { truncated: false },
        nodes: [{ id: 'node:alb', name: 'public-alb', arn: 'arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/app/public/abc', resourceType: 'loadbalancer', evidence: [] }],
        applicationCandidates: [], relationshipSuggestions: [],
      }
      return store.discoveryPreview
    })
    store.importAwsResources = vi.fn().mockResolvedValue({ revision: 1 })
    const wrapper = mount(ArchitectureDiscoveryPanel)

    await wrapper.get('[data-test="aws-arn-input"]').setValue('arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/app/public/abc')
    await wrapper.get('[data-test="aws-arn-search"]').trigger('submit')
    await flushPromises()

    expect(store.previewAwsResources).toHaveBeenCalledWith({ region: 'us-east-1', accountId: '123456789012', stackNames: [] })
    expect(wrapper.get('.discovery-steps .active strong').text()).toBe('Diagram')
    await wrapper.get('.review-actions .primary').trigger('click')
    expect(store.importAwsResources).toHaveBeenCalledWith({
      region: 'us-east-1', accountId: '123456789012', stackNames: [], selectedNodeIds: ['node:alb'],
    })
  })

  it('allows adding a valid ARN that is not in the mapped inventory as an unverified reference', async () => {
    const store = useArchitectureStore()
    store.previewAwsResources = vi.fn(async input => {
      store.discoveryPreview = { scope: { accountId: input.accountId, region: input.region }, estimate: {}, nodes: [], relationshipSuggestions: [] }
      return store.discoveryPreview
    })
    store.applyOperation = vi.fn().mockResolvedValue({ revision: 2 })
    const wrapper = mount(ArchitectureDiscoveryPanel)
    const arn = 'arn:aws:ec2:us-east-1:123456789012:instance/i-0123456789abcdef0'

    await wrapper.get('[data-test="aws-arn-input"]').setValue(arn)
    await wrapper.get('[data-test="aws-arn-search"]').trigger('submit')
    await flushPromises()
    await wrapper.get('[data-test="aws-arn-add-manual"]').trigger('click')

    expect(store.applyOperation).toHaveBeenCalledWith(expect.objectContaining({
      type: 'node.upsert', value: expect.objectContaining({
        provider: 'aws', resourceType: 'ec2', arn, manual: true,
        evidence: [{ type: 'manual_resource', values: [arn], unverified: true }],
      }),
    }), expect.objectContaining({ reason: expect.stringContaining('i-0123456789abcdef0') }))
    expect(wrapper.emitted('imported')).toEqual([[{ revision: 2 }]])
  })

  it('draws all resources when more than one stack is selected', async () => {
    const store = useArchitectureStore()
    store.discoveryCatalog = {
      scope: { accountId: '123456789012', region: 'us-east-1' },
      estimate: { awsRequests: 2 },
      deployments: [
        { id: 'stack:api', name: 'api-stack', status: 'CREATE_COMPLETE', updatedAt: null },
        { id: 'stack:data', name: 'data-stack', status: 'CREATE_COMPLETE', updatedAt: null },
      ],
    }
    store.previewAwsResources = vi.fn(async input => {
      store.discoveryPreview = {
        scope: { accountId: input.accountId, region: input.region },
        estimate: { truncated: false },
        nodes: [
          { id: 'node:api', name: 'Api', resourceType: 'api', stackName: 'api-stack', evidence: [] },
          { id: 'node:table', name: 'Table', resourceType: 'dynamodb', stackName: 'data-stack', evidence: [] },
        ],
        applicationCandidates: [],
        relationshipSuggestions: [],
      }
    })
    store.importAwsResources = vi.fn().mockResolvedValue({ revision: 1 })
    const wrapper = mount(ArchitectureDiscoveryPanel)

    const stackInputs = wrapper.findAll('.deployment-list input')
    await stackInputs[0].setValue(true)
    await stackInputs[1].setValue(true)
    await wrapper.get('.discovery-next-actions .primary').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('Multiple stacks draw the complete stack diagram')
    expect(wrapper.find('.resource-list').exists()).toBe(false)
    await wrapper.findAll('.discovery-section-heading .primary').at(-1).trigger('click')
    expect(store.importAwsResources).toHaveBeenCalledWith({
      region: 'us-east-1', accountId: '123456789012', stackNames: ['api-stack', 'data-stack'],
      selectedNodeIds: ['node:api', 'node:table'],
    })
  })

  it('shows resources already present in the project graph as unselectable, instead of hiding them', async () => {
    const store = useArchitectureStore()
    store.discoveryPreview = {
      scope: { accountId: '123456789012', region: 'us-east-1' },
      estimate: { truncated: false },
      nodes: [
        { id: 'node:worker', name: 'orders-worker', resourceType: 'lambda', evidence: [], alreadyInGraph: true, existingNodeId: 'node:worker' },
        { id: 'node:queue', name: 'orders-queue', resourceType: 'sqs', evidence: [], alreadyInGraph: false, existingNodeId: null },
      ],
      applicationCandidates: [],
      relationshipSuggestions: [],
    }
    const wrapper = mount(ArchitectureDiscoveryPanel)

    const rows = wrapper.findAll('.resource-row')
    const workerRow = rows.find(row => row.text().includes('orders-worker'))
    const queueRow = rows.find(row => row.text().includes('orders-queue'))

    expect(workerRow.classes()).toContain('already-in-project')
    expect(workerRow.get('input').element.disabled).toBe(true)
    expect(workerRow.text()).toContain('Already in project')
    expect(queueRow.classes()).not.toContain('already-in-project')
    expect(queueRow.get('input').element.disabled).toBe(false)
  })
})