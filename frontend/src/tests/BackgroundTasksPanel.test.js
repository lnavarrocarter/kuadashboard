import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import BackgroundTasksPanel from '../components/BackgroundTasksPanel.vue'
import { settings } from '../composables/useSettings'

const BASE = '/api/system/tasks'

function task(overrides = {}) {
  return {
    id: 'logs.scan.4', name: 'Log scan #4', type: 'scan', state: 'running', intervalMs: null,
    startedAt: '2026-10-06T11:00:00.000Z', lastRunAt: '2026-10-06T11:00:00.000Z',
    lastFinishedAt: null, nextRunAt: null, lastRunStatus: null, progress: 0.45, errorCode: null,
    supportedActions: ['pause', 'resume', 'cancel'], availableActions: ['pause', 'cancel'],
    ...overrides,
  }
}

function snapshot(tasks = [task()]) {
  return {
    generatedAt: '2026-10-06T12:00:00.000Z',
    process: { uptimeSeconds: 3600, cpuMicros: { user: 1000000, system: 500000 }, memoryBytes: { rss: 1048576, heapUsed: 524288, external: 100 } },
    tasks,
  }
}

function stubFetch(handler) {
  const calls = []
  vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
    calls.push({ url, method: options.method || 'GET' })
    const response = await handler(url, options)
    return response
  }))
  return calls
}

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) }
}

describe('BackgroundTasksPanel', () => {
  beforeEach(() => { settings.lang = 'en' })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

  it('shows only available actions and labels CPU/memory as process aggregates', async () => {
    const calls = stubFetch(async url => jsonResponse(url === BASE ? snapshot([
      task(),
      task({ id: 'apps.sync', name: 'Application sync', type: 'scheduler', state: 'scheduled', progress: null, supportedActions: ['pause', 'resume'], availableActions: ['pause'] }),
      task({ id: 'team.sync', name: 'Team sync', type: 'scheduler', state: 'scheduled', progress: null, supportedActions: ['pause', 'resume'], availableActions: [] }),
      task({ id: 'logs.scan.3', type: 'scan', state: 'error', progress: null, errorCode: 'scan_failed', availableActions: ['resume', 'cancel'] }),
    ]) : { task: task(), changed: true }))
    const wrapper = mount(BackgroundTasksPanel, { props: { show: true, pollMs: 60000 } })
    await flushPromises()

    expect(wrapper.find('[data-test="task-logs.scan.4"]').findAll('button').map(button => button.attributes('aria-label'))).toEqual(['Pause', 'Cancel'])
    expect(wrapper.find('[data-test="task-apps.sync"]').findAll('button').map(button => button.attributes('aria-label'))).toEqual(['Pause'])
    expect(wrapper.find('[data-test="task-team.sync"]').findAll('button')).toHaveLength(0)
    expect(wrapper.find('[data-test="task-logs.scan.3"]').findAll('button').map(button => button.attributes('aria-label'))).toEqual(['Resume', 'Cancel'])
    expect(wrapper.find('[data-test="task-logs.scan.4"] [role="progressbar"]').attributes('aria-valuenow')).toBe('45')
    expect(wrapper.text()).toContain('process-wide totals, not per-task usage')
    expect(wrapper.get('[data-test="process-metrics"]').text()).toContain('RSS')
    expect(calls[0]).toEqual({ url: BASE, method: 'GET' })
    wrapper.unmount()
  })

  it('posts only an available action and refreshes the task snapshot', async () => {
    const calls = stubFetch(async (url, options) => {
      if (url === BASE) return jsonResponse(snapshot())
      return jsonResponse({ task: task({ state: 'pause_requested' }), changed: true })
    })
    const wrapper = mount(BackgroundTasksPanel, { props: { show: true } })
    await flushPromises()
    await wrapper.get('[data-test="task-action-logs.scan.4-pause"]').trigger('click')
    await flushPromises()

    expect(calls.filter(call => call.method === 'POST')).toEqual([{ url: `${BASE}/logs.scan.4/pause`, method: 'POST' }])
    expect(calls.filter(call => call.method === 'GET')).toHaveLength(2)
    wrapper.unmount()
  })

  it('shows loading, API error, retry and empty states', async () => {
    let fail = true
    stubFetch(async () => fail
      ? jsonResponse({ error: 'Local API unavailable' }, 503)
      : jsonResponse(snapshot([])))
    const wrapper = mount(BackgroundTasksPanel, { props: { show: true } })
    await nextTick()
    expect(wrapper.find('[data-test="tasks-loading"]').exists()).toBe(true)
    await flushPromises()
    expect(wrapper.get('[data-test="tasks-error"]').text()).toContain('Local API unavailable')
    fail = false
    await wrapper.get('[data-test="tasks-retry"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-test="tasks-empty"]').text()).toContain('No background tasks')
    wrapper.unmount()
  })

  it('refreshes when the window regains focus and clears its timer and listeners on close', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    const calls = stubFetch(async () => jsonResponse(snapshot()))
    const wrapper = mount(BackgroundTasksPanel, { props: { show: true, pollMs: 5000 } })
    await flushPromises()
    expect(calls.filter(call => call.method === 'GET')).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(5000)
    await flushPromises()
    expect(calls.filter(call => call.method === 'GET')).toHaveLength(2)
    window.dispatchEvent(new Event('focus'))
    await flushPromises()
    expect(calls.filter(call => call.method === 'GET')).toHaveLength(3)

    wrapper.unmount()
    window.dispatchEvent(new Event('focus'))
    await flushPromises()
    expect(calls.filter(call => call.method === 'GET')).toHaveLength(3)
  })

  it('does not request or poll while hidden, then starts and stops with visibility', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    const calls = stubFetch(async () => jsonResponse(snapshot()))
    const wrapper = mount(BackgroundTasksPanel, { props: { show: false, pollMs: 5000 } })
    await flushPromises()
    expect(calls).toHaveLength(0)

    await wrapper.setProps({ show: true })
    await flushPromises()
    expect(calls.filter(call => call.method === 'GET')).toHaveLength(1)
    await wrapper.setProps({ show: false })
    await vi.advanceTimersByTimeAsync(10000)
    window.dispatchEvent(new Event('focus'))
    await flushPromises()
    expect(calls.filter(call => call.method === 'GET')).toHaveLength(1)
    wrapper.unmount()
  })

  it('localizes task names and states in Spanish', async () => {
    settings.lang = 'es'
    stubFetch(async () => jsonResponse(snapshot([task({ id: 'apm.collection', type: 'scheduler', state: 'scheduled', progress: null, availableActions: ['pause'] })])))
    const wrapper = mount(BackgroundTasksPanel, { props: { show: true } })
    await flushPromises()
    expect(wrapper.get('[data-test="task-apm.collection"]').text()).toContain('Recolección de Observabilidad')
    expect(wrapper.get('[data-test="task-apm.collection"]').text()).toContain('Programada')
    wrapper.unmount()
  })
})