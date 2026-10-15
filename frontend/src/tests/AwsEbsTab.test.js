import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))

import AwsEbsTab from '../components/cloud/AwsEbsTab.vue'
import { useAwsStore } from '../stores/useAwsStore'
import { settings } from '../composables/useSettings'

const EBS = {
  volumes: [
    { id: 'vol-old', name: 'vol-old', size: 5, type: 'gp2', state: 'available', unattached: true, attachedTo: null, az: 'us-east-1a', encrypted: false, createdAt: '2026-05-10T00:00:00Z', monthlyUsd: 0.5, kubernetes: { cluster: 'EKS130-360-Dev', namespace: 'backend-libros', pvc: 'postgres-data-planificador-postgres-0', pv: 'pvc-17f9' }, tags: [] },
    { id: 'vol-root', name: 'root', size: 20, type: 'gp3', state: 'in-use', unattached: false, attachedTo: 'i-1', az: 'us-east-1a', encrypted: true, createdAt: '2026-01-01T00:00:00Z', monthlyUsd: 1.6, kubernetes: null, tags: [] },
  ],
  summary: { total: 2, unattached: 1, unattachedGb: 5, unattachedMonthlyUsd: 0.5, monthlyUsd: 2.1 },
  truncated: false,
}

let store
beforeEach(() => {
  setActivePinia(createPinia())
  settings.lang = 'en'
  store = useAwsStore()
  store.activeProfileId = 'p1'
})

describe('AwsEbsTab', () => {
  it('loads the volumes of the region from GET /ebs', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => EBS }))
    vi.stubGlobal('fetch', fetchMock)
    await store.fetchEbsVolumes()
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/cloud/aws/ebs')
    expect(store.ebsVolumes.summary.unattached).toBe(1)
  })

  it('says what unattached volumes cost and filters them, with their Kubernetes claim', async () => {
    store.ebsVolumes = EBS
    const wrapper = mount(AwsEbsTab, { props: { search: '' } })
    await flushPromises()
    expect(wrapper.find('[data-test="ebs-unattached"]').text()).toContain('1 volumes are attached to nothing (5 GiB, about $0.50 per month')
    expect(wrapper.findAll('tbody tr')).toHaveLength(2)
    expect(wrapper.text()).toContain('backend-libros/postgres-data-planificador-postgres-0')
    await wrapper.find('[data-test="ebs-only-unattached"]').trigger('click')
    expect(wrapper.findAll('tbody tr')).toHaveLength(1)
    expect(wrapper.find('tbody tr').text()).toContain('unattached')
  })

  it('searches and says when nothing matches', async () => {
    store.ebsVolumes = EBS
    const wrapper = mount(AwsEbsTab, { props: { search: 'nothing-like-this' } })
    expect(wrapper.find('[data-test="empty-ebs"]').text()).toContain('No')
  })
})
