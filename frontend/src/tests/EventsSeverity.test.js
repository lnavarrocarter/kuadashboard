import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))

import ResourceTable from '../components/ResourceTable.vue'
import { RESOURCES } from '../config/resources'
import { eventSeverity } from '../config/eventSeverity'
import { useKubeStore } from '../stores/useKubeStore'

const now = new Date().toISOString()
const ev = (name, type, reason, message = '') => ({
  name, namespace: 'default', type, reason, object: `Pod/${name}`, count: 1, message, age: now,
})

const EVENTS = [
  ev('a', 'Warning', 'BackOff', 'Back-off restarting failed container'),
  ev('b', 'Warning', 'FailedMount', 'MountVolume.SetUp failed'),
  ev('c', 'Warning', 'Unhealthy', 'Readiness probe failed'),
  ev('d', 'Normal', 'Scheduled', 'Successfully assigned default/d'),
  ev('e', 'Normal', 'Pulled', 'Container image already present'),
]

describe('eventSeverity', () => {
  it('classifies failing workloads and nodes as critical', () => {
    for (const reason of ['BackOff', 'ErrImagePull', 'OOMKilling', 'Evicted', 'FailedMount', 'NodeNotReady', 'FailedCreate']) {
      expect(eventSeverity({ type: 'Warning', reason })).toBe('critical')
    }
  })

  it('detects critical conditions reported only in the message', () => {
    expect(eventSeverity({ type: 'Warning', reason: 'Failed', message: 'x' })).toBe('critical')
    expect(eventSeverity({ type: 'Warning', reason: 'SomethingElse', message: 'container was OOMKilled' })).toBe('critical')
  })

  it('treats other Warning events as warning and Normal as normal', () => {
    expect(eventSeverity({ type: 'Warning', reason: 'Unhealthy' })).toBe('warning')
    expect(eventSeverity({ type: 'Warning', reason: 'FailedScheduling' })).toBe('warning')
    expect(eventSeverity({ type: 'Normal', reason: 'Scheduled' })).toBe('normal')
    expect(eventSeverity({})).toBe('normal')
  })
})

describe('Events table config', () => {
  it('adds a Severity badge column that sorts critical first', () => {
    expect(RESOURCES.events.cols[0]).toBe('Severity')
    expect(RESOURCES.events.row(EVENTS[0])[0]).toEqual({ badge: 'Critical', sort: 0 })
    expect(RESOURCES.events.row(EVENTS[2])[0]).toEqual({ badge: 'Warning', sort: 1 })
    expect(RESOURCES.events.row(EVENTS[3])[0]).toEqual({ badge: 'Normal', sort: 2 })
  })

  it('colours rows by severity', () => {
    expect(RESOURCES.events.rowClass(EVENTS[0])).toBe('sev-row sev-critical')
    expect(RESOURCES.events.rowClass(EVENTS[3])).toBe('sev-row sev-normal')
  })
})

describe('ResourceTable — Events severity colours and filter', () => {
  let wrapper, store

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useKubeStore()
    store.resource = 'events'
    store.rows = EVENTS
    wrapper = mount(ResourceTable, { props: { resource: 'events' } })
  })

  const visibleNames = () => wrapper.findAll('tbody tr').map(tr => tr.findAll('td').find(td => td.text().startsWith('Pod/')).text())
  const chip = value => wrapper.find(`.facet-chip.facet-${value}`)

  it('renders severity badges and row classes', () => {
    const rows = wrapper.findAll('tbody tr')
    expect(rows[0].classes()).toContain('sev-critical')
    expect(rows[0].find('.badge.critical').text()).toBe('Critical')
    expect(rows[2].classes()).toContain('sev-warning')
    expect(rows[3].find('.badge.normal').exists()).toBe(true)
  })

  it('shows a chip per severity with counts', () => {
    expect(chip('critical').text()).toContain('2')
    expect(chip('warning').text()).toContain('1')
    expect(chip('normal').text()).toContain('2')
  })

  it('filters by one or several severities and clears', async () => {
    await chip('critical').trigger('click')
    expect(visibleNames()).toEqual(['Pod/a', 'Pod/b'])
    expect(chip('critical').classes()).toContain('active')

    await chip('warning').trigger('click')
    expect(visibleNames()).toEqual(['Pod/a', 'Pod/b', 'Pod/c'])

    await wrapper.find('.facet-clear').trigger('click')
    expect(wrapper.findAll('tbody tr')).toHaveLength(5)
  })

  it('combines the severity filter with the text filter', async () => {
    await chip('critical').trigger('click')
    await wrapper.find('.search-input').setValue('mount')
    expect(visibleNames()).toEqual(['Pod/b'])
  })

  it('explains the empty state when filters hide every row', async () => {
    store.rows = EVENTS.filter(e => e.type === 'Normal')
    await wrapper.vm.$nextTick()
    await chip('critical').trigger('click')
    expect(wrapper.find('.empty-state').text()).toContain('The active filters hide all 2 resources.')
  })

  it('does not render chips for resources without a facet', async () => {
    store.resource = 'pods'
    store.rows = []
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.facet-chip:not(.quick-chip)').exists()).toBe(false)
  })
})
