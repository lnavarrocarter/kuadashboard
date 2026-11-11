import { afterEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import * as Api from '../composables/useApi'
import GcpEntrypoints from '../components/cloud/GcpEntrypoints.vue'
import { settings } from '../composables/useSettings'

afterEach(() => vi.restoreAllMocks())

it('loads only on request and retains available entries when another GCP source is denied', async () => {
  settings.lang = 'en'
  const read = vi.spyOn(Api, 'api').mockResolvedValue({
    projectId: 'shop',
    groups: [
      { source: 'vms', status: 'complete', entries: [{ name: 'web', addresses: ['203.0.113.2'] }] },
      { source: 'domains', status: 'unavailable', entries: [] },
      { source: 'forwardingRules', status: 'partial', entries: [] },
    ],
  })
  const panel = mount(GcpEntrypoints, { props: { profileId: 'selected' } })
  expect(read).not.toHaveBeenCalled()
  await panel.get('button').trigger('click')
  await flushPromises()
  expect(read).toHaveBeenCalledWith('GET', '/api/cloud/gcp/entrypoints', undefined, { headers: { 'X-Profile-Id': 'selected' } })
  expect(panel.text()).toContain('203.0.113.2')
  expect(panel.text()).toContain('Source unavailable')
  expect(panel.text()).toContain('Inventory is partial')
})
