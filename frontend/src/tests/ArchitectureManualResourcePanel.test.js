import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ArchitectureManualResourcePanel from '../components/architecture/ArchitectureManualResourcePanel.vue'
import { useArchitectureStore } from '../stores/useArchitectureStore'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))

describe('ArchitectureManualResourcePanel', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.stubGlobal('crypto', { randomUUID: () => 'resource-id' })
  })

  it('adds an explicit AWS EC2 resource through the versioned graph operation', async () => {
    const store = useArchitectureStore()
    store.applyOperation = vi.fn().mockResolvedValue({ revision: 1 })
    const wrapper = mount(ArchitectureManualResourcePanel)
    const inputs = wrapper.findAll('input')
    await inputs[0].setValue('orders-worker')
    await inputs[1].setValue('ec2')
    await inputs[2].setValue('i-0123456789abcdef0')
    await inputs[3].setValue('123456789012')
    await inputs[4].setValue('us-east-1')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(store.applyOperation).toHaveBeenCalledWith({
      type: 'node.upsert',
      value: expect.objectContaining({
        id: 'manual:aws:resource-id', provider: 'aws', resourceType: 'ec2', name: 'orders-worker',
        nativeId: 'i-0123456789abcdef0', accountId: '123456789012', region: 'us-east-1', manual: true,
      }),
    }, { reason: 'Add manual aws resource orders-worker' })
    expect(wrapper.emitted('imported')).toHaveLength(1)
  })
})