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
    expect(wrapper.get('.stack-resource-summary').text()).toContain('2 resources · 1 relationships')
    await wrapper.get('.stack-resource-summary button').trigger('click')
    expect(store.importAwsResources).toHaveBeenCalledWith({
      region: 'us-east-1', accountId: '123456789012', stackNames: ['orders-stack'],
      selectedNodeIds: ['node:bucket', 'node:policy'],
    })
  })
})