import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ArchitectureDiscoveryPanel from '../components/architecture/ArchitectureDiscoveryPanel.vue'
import { useArchitectureStore } from '../stores/useArchitectureStore'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))

describe('ArchitectureDiscoveryPanel', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('selects every resource in an identified application explicitly', async () => {
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
      }],
    }
    store.importAwsResources = vi.fn().mockResolvedValue({ revision: 1 })

    const wrapper = mount(ArchitectureDiscoveryPanel)
    const importButton = wrapper.get('.discovery-section-heading .primary')
    expect(importButton.attributes('disabled')).toBeDefined()

    await wrapper.get('.application-row button').trigger('click')

    expect(importButton.attributes('disabled')).toBeUndefined()
    expect(importButton.text()).toContain('Import 2')
    expect(wrapper.findAll('.resource-row input:checked')).toHaveLength(2)
    expect(wrapper.get('.inventory-warning').text()).toContain('500-resource preview limit')

    await importButton.trigger('click')
    expect(store.importAwsResources).toHaveBeenCalledWith({
      region: 'us-east-1',
      accountId: '123456789012',
      stackNames: [],
      selectedNodeIds: ['node:rule', 'node:queue'],
    })
  })
})