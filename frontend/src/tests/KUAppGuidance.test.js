import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))

import KUAppIssues from '../components/kuapps/KUAppIssues.vue'
import KUAppResourceInspector from '../components/kuapps/KUAppResourceInspector.vue'
import { settings } from '../composables/useSettings'

const NOW = Date.now()
const ISSUES = {
  counts: { critical: 1, warning: 2, info: 0 },
  issues: [
    { id: 'threshold:r1:errorRatePercent', kind: 'threshold', severity: 'critical', resourceId: 'r1', resourceName: 'payments', since: new Date(NOW - 2 * 3600000).toISOString(), evidence: { metric: 'errorRatePercent', value: 30, threshold: 5, comparison: 'maximum' }, action: 'open_signals' },
    { id: 'gone:r2', kind: 'gone', severity: 'warning', resourceId: 'r2', resourceName: 'attencion-3.9.1', since: new Date(NOW - 26 * 3600000).toISOString(), action: 'review_missing' },
    { id: 'collection:r3', kind: 'collection_failed', severity: 'warning', resourceId: 'r3', resourceName: 'reports', since: new Date(NOW - 600000).toISOString(), evidence: { errorCode: 'AccessDeniedException', message: 'not authorized' }, action: 'retry' },
  ],
}

function respond(body) {
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: () => Promise.resolve(body), text: () => Promise.resolve('') }))
}

describe('KUApps guidance (#239)', () => {
  beforeEach(() => { settings.lang = 'en' })

  it('lists issues with resource, evidence, age and a concrete action, limited in the Summary', async () => {
    respond(ISSUES)
    const wrapper = mount(KUAppIssues, { props: { applicationId: 'app-1', hours: 24, limit: 2 } })
    await flushPromises()
    expect(global.fetch.mock.calls[0][0]).toBe('/api/kua-apps/applications/app-1/observability/issues?hours=24')
    const items = wrapper.findAll('.kis-item').map(item => item.text())
    expect(items[0]).toContain('payments')
    expect(items[0]).toContain('error rate (%)')
    expect(items[0]).toContain('30 (threshold 5) · since 2 h ago')
    expect(items[0]).toContain('See metrics')
    expect(items[1]).toContain('No longer exists where it lived · since 26 h ago')
    expect(items).toHaveLength(2)
    expect(wrapper.text()).toContain('1 critical')
    await wrapper.get('[data-test="kuapp-issues-more"]').trigger('click')
    expect(wrapper.emitted('show-all')).toHaveLength(1)
    await wrapper.get('[data-test="issue-action-threshold:r1:errorRatePercent"]').trigger('click')
    expect(wrapper.emitted('action')[0][0].resourceId).toBe('r1')

    respond(ISSUES)
    const all = mount(KUAppIssues, { props: { applicationId: 'app-1' } })
    await flushPromises()
    expect(all.text()).toContain('Last collection failed: AccessDeniedException: not authorized')
  })

  it('says when nothing needs attention, and survives an unexpected answer', async () => {
    respond({ counts: { critical: 0, warning: 0, info: 0 }, issues: [] })
    const wrapper = mount(KUAppIssues, { props: { applicationId: 'app-1' } })
    await flushPromises()
    expect(wrapper.get('[data-test="kuapp-issues-none"]').text()).toBe('Nothing needs attention in this range.')
    // Something that is not an issues list is a failed read, never "nothing needs attention" (#239 N02).
    respond([])
    const odd = mount(KUAppIssues, { props: { applicationId: 'app-1' } })
    await flushPromises()
    expect(odd.find('[data-test="kuapp-issues-none"]').exists()).toBe(false)
    expect(odd.text()).toContain('This does not mean there are none')
    expect(odd.emitted('loaded').at(-1)).toEqual([null])
    respond({ counts: { critical: 0, warning: 0, info: 0 }, issues: [] })
    await odd.get('[data-test="kuapp-issues-retry"]').trigger('click')
    await flushPromises()
    expect(odd.find('[data-test="kuapp-issues-none"]').exists()).toBe(true)
  })

  it('the inspector moves between tabs with the arrow keys and only offers actions that apply', async () => {
    const resource = { id: 'kua-resource:a', displayName: 'jobs', provider: 'aws', resourceType: 'sqs', nativeIdentifier: 'arn:aws:sqs:us-east-1:1:jobs', signals: { state: 'unsupported' } }
    const wrapper = mount(KUAppResourceInspector, {
      props: { applicationId: 'app-1', resource, signalsAvailable: true, relationships: [{ id: 'r', otherId: 'b', otherName: 'api', outgoing: false, relationType: 'reads_from', status: 'confirmed' }] },
      global: { stubs: { KUAppResourceSignals: true } },
      attachTo: document.body,
    })
    // An unsupported type never promises signals.
    expect(wrapper.find('[data-test="inspector-open-signals"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="inspector-open-map"]').exists()).toBe(true)

    await wrapper.get('[data-test="inspector-tab-detail"]').trigger('keydown', { key: 'ArrowRight' })
    expect(wrapper.get('[data-test="inspector-tab-signals"]').attributes('aria-selected')).toBe('true')
    await wrapper.get('[data-test="inspector-tab-signals"]').trigger('keydown', { key: 'ArrowRight' })
    expect(wrapper.text()).toContain('reads from')
    expect(wrapper.text()).not.toContain('reads_from')
    await wrapper.get('[data-test="inspector-tab-relationships"]').trigger('keydown', { key: 'Home' })
    expect(wrapper.get('[data-test="inspector-tab-detail"]').attributes('aria-selected')).toBe('true')

    await wrapper.setProps({ resource: { ...resource, signals: { state: 'no_connection' } } })
    await wrapper.get('[data-test="inspector-bind"]').trigger('click')
    expect(wrapper.emitted('bind-scope')).toHaveLength(1)
    wrapper.unmount()
  })
})
