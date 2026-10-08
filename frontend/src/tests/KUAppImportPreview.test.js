import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import KUAppImportPreview from '../components/kuapps/KUAppImportPreview.vue'

const stubs = { BaseModal: { props: ['show'], template: '<div v-if="show"><slot name="title"/><slot/></div>' } }

function preview(overrides = {}) {
  return {
    contentVersion: 2,
    application: { sourceId: 'app-1', name: 'Checkout', importAs: 'Checkout', environment: 'production', team: 'Payments', legacy: null, alreadyHere: true, sameName: [] },
    scopes: [
      { provider: 'aws', scopeId: '111111111111', location: 'us-east-1', label: 'Payments account', supported: true },
      { provider: 'zabbix', scopeId: 'monitoring', location: '', label: '', supported: false },
    ],
    views: [{ name: 'Checkout', importAs: 'Checkout (imported)', nodes: 3, edges: 1, snapshots: 1 }],
    resources: {
      total: 4, members: 2, fromViews: 1,
      skipped: [{ id: 'r-4', displayName: 'broker', resourceType: 'mq', reason: 'unsupported_type' }],
      existing: [{ id: 'r-1', displayName: 'orders-api', applications: [{ id: 'app-1', name: 'Checkout' }] }],
      outsideScopes: [],
    },
    relationships: { total: 2, confirmed: 1, rejected: 1, suggested: 0 },
    detachments: 1,
    acceptances: 0,
    issues: [{ kind: 'relationship_dangling', count: 1 }],
    ...overrides,
  }
}

describe('KUApp import preview', () => {
  it('shows what comes back, what does not and what the file left out before importing', async () => {
    const wrapper = mount(KUAppImportPreview, { props: { show: true, preview: preview() }, global: { stubs } })
    const text = wrapper.text()

    expect(wrapper.find('[data-test="import-already-here"]').exists()).toBe(true)
    expect(text).toContain('Accounts and scopes (2)')
    expect(text).toContain('does not support this provider')
    expect(text).toContain('Checkout (imported)')
    expect(text).toContain('2 return as members, 1 come back with their views, 1 cannot be restored.')
    expect(text).toContain('Restoring a resource does not turn on collection.')
    expect(text).toContain('Resource type not supported by this KUA')
    expect(wrapper.find('[data-test="import-issues"]').text()).toContain('1 relationship(s) to resources that are not in the file')

    await wrapper.find('[data-test="import-confirm"]').trigger('click')
    expect(wrapper.emitted('confirm')).toHaveLength(1)
  })

  it('says when a name is taken and when the file comes from a newer KUA', () => {
    const wrapper = mount(KUAppImportPreview, {
      props: {
        show: true,
        preview: preview({
          application: { ...preview().application, alreadyHere: false, importAs: 'Checkout (imported)', sameName: [{ id: 'x', name: 'Checkout' }] },
          issues: [{ kind: 'newer_content', contentVersion: 5 }],
        }),
      },
      global: { stubs },
    })
    expect(wrapper.find('[data-test="import-same-name"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('"Checkout" is already used here')
    expect(wrapper.text()).toContain('content version 5')
  })
})
