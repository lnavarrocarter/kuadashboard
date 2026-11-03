import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import BackgroundTasksPanel from '../components/BackgroundTasksPanel.vue'
import { settings } from '../composables/useSettings'
import { taskCoordinatorFor } from '../lib/taskCoordinator'

const BASE = '/api/system/tasks'

function task(overrides = {}) {
  return {
    id: 'logs.scan.4', name: 'Log scan #4', type: 'scan', state: 'running', intervalMs: null,
    provider: 'aws',
    detail: '/aws/lambda/orders · us-east-1',
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
      task({ id: 'apm.collect.app-a', name: 'Orders', type: 'collection', provider: 'mixed', detail: 'Orders · api', supportedActions: [], availableActions: [] }),
      task({ id: 'apps.sync', name: 'Application sync', type: 'scheduler', state: 'scheduled', progress: null, detail: 'Payments API', supportedActions: ['pause', 'resume'], availableActions: ['pause'] }),
      task({ id: 'team.sync', name: 'Team sync', type: 'scheduler', state: 'scheduled', progress: null, supportedActions: ['pause', 'resume'], availableActions: [] }),
      task({ id: 'logs.scan.3', type: 'scan', state: 'error', progress: null, errorCode: 'scan_failed', availableActions: ['resume', 'cancel'] }),
    ]) : { task: task(), changed: true }))
    const wrapper = mount(BackgroundTasksPanel, { props: { show: true, pollMs: 60000 } })
    await flushPromises()

    expect(wrapper.find('[data-test="task-logs.scan.4"]').findAll('button').map(button => button.attributes('aria-label'))).toEqual(['Pause', 'Cancel'])
    expect(wrapper.find('[data-test="task-apps.sync"]').findAll('button').map(button => button.attributes('aria-label'))).toEqual(['Pause'])
    expect(wrapper.find('[data-test="task-team.sync"]').findAll('button')).toHaveLength(0)
    expect(wrapper.find('[data-test="task-logs.scan.3"]').findAll('button').map(button => button.attributes('aria-label'))).toEqual(['Resume', 'Cancel'])
    expect(wrapper.get('[data-test="task-logs.scan.4"]').text()).toContain('Targets: /aws/lambda/orders · us-east-1')
    expect(wrapper.get('[data-test="task-apps.sync"]').text()).toContain('Checks linked KUApps in this KUA account.')
    expect(wrapper.get('[data-test="task-apps.sync"]').text()).toContain('Targets: Payments API')
    expect(wrapper.get('[data-test="task-apm.collect.app-a"]').text()).toContain('Collection · Orders')
    expect(wrapper.get('[data-test="task-apm.collect.app-a"]').text()).toContain('Collects this application’s metrics')
    expect(wrapper.get('[data-test="task-apm.collect.app-a"]').text()).toContain('Targets: Orders · api')
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
    expect(calls.filter(call => call.url === BASE && call.method === 'GET')).toHaveLength(2)
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
    expect(calls.filter(call => call.url === BASE && call.method === 'GET')).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(5000)
    await flushPromises()
    expect(calls.filter(call => call.url === BASE && call.method === 'GET')).toHaveLength(2)
    window.dispatchEvent(new Event('focus'))
    await flushPromises()
    expect(calls.filter(call => call.url === BASE && call.method === 'GET')).toHaveLength(3)

    wrapper.unmount()
    window.dispatchEvent(new Event('focus'))
    await flushPromises()
    expect(calls.filter(call => call.url === BASE && call.method === 'GET')).toHaveLength(3)
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
    expect(calls.filter(call => call.url === BASE && call.method === 'GET')).toHaveLength(1)
    await wrapper.setProps({ show: false })
    await vi.advanceTimersByTimeAsync(10000)
    window.dispatchEvent(new Event('focus'))
    await flushPromises()
    expect(calls.filter(call => call.url === BASE && call.method === 'GET')).toHaveLength(1)
    wrapper.unmount()
  })

  it('localizes task names and states in Spanish', async () => {
    settings.lang = 'es'
    stubFetch(async () => jsonResponse(snapshot([task({ id: 'apm.collection', type: 'scheduler', state: 'scheduled', progress: null, availableActions: ['pause'] })])))
    const wrapper = mount(BackgroundTasksPanel, { props: { show: true } })
    await flushPromises()
    expect(wrapper.get('[data-test="task-apm.collection"]').text()).toContain('Recolección de Observabilidad')
    expect(wrapper.get('[data-test="task-apm.collection"]').text()).toContain('Programada')
    expect(wrapper.get('[data-test="task-apm.collection"]').text()).toContain('Recolecta señales de las KUApps')
    wrapper.unmount()
  })

  it('shows AWS activity costs for the last 30 days without implying per-run attribution', async () => {
    stubFetch(async url => url === BASE
      ? jsonResponse(snapshot([task()]))
      : jsonResponse({ enabled: true, byFeature: [{ feature: 'log-scans', usd: 0.00012, potentialUsd: 0.004 }] }))
    const wrapper = mount(BackgroundTasksPanel, { props: { show: true } })
    await flushPromises()

    expect(wrapper.get('[data-test="task-logs.scan.4"]').text()).toContain('AWS')
    expect(wrapper.get('[data-test="task-cost-logs.scan.4"]').text()).toContain('AWS · 30d: $0.00012')
    expect(wrapper.get('[data-test="task-cost-logs.scan.4"]').text()).toContain('$0.004 potential beyond free tier')
    expect(wrapper.text()).toContain('not an individual run')
    wrapper.unmount()
  })

  it('does not show a zero cloud cost for a provider without metering', async () => {
    stubFetch(async url => url === BASE
      ? jsonResponse(snapshot([task({ provider: 'kubernetes' })]))
      : jsonResponse({ enabled: true, byFeature: [] }))
    const wrapper = mount(BackgroundTasksPanel, { props: { show: true } })
    await flushPromises()

    expect(wrapper.get('[data-test="task-logs.scan.4"]').text()).toContain('Kubernetes')
    expect(wrapper.get('[data-test="task-cost-logs.scan.4"]').text()).toContain('Provider cost is not tracked')
    wrapper.unmount()
  })

  it('labels known scheduler providers when the backend snapshot predates provider metadata', async () => {
    stubFetch(async url => url === BASE
      ? jsonResponse(snapshot([task({ id: 'apps.sync', name: 'Application sync', provider: null, type: 'scheduler', state: 'scheduled', progress: null })]))
      : jsonResponse({ enabled: true, byFeature: [] }))
    const wrapper = mount(BackgroundTasksPanel, { props: { show: true } })
    await flushPromises()

    expect(wrapper.get('[data-test="task-apps.sync"]').text()).toContain('KUA')
    wrapper.unmount()
  })

  it('updates elapsed runtime every second without waiting for the API poll', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(new Date('2026-10-07T12:00:30.000Z'))
    stubFetch(async url => url === BASE
      ? jsonResponse(snapshot([task({ startedAt: '2026-10-07T12:00:00.000Z', lastRunAt: '2026-10-07T12:00:00.000Z' })]))
      : jsonResponse({ enabled: true, byFeature: [] }))
    const wrapper = mount(BackgroundTasksPanel, { props: { show: true, pollMs: 60000 } })
    await flushPromises()

    expect(wrapper.get('[data-test="task-logs.scan.4"]').text()).toContain('Elapsed: 0 min 30 s')
    await vi.advanceTimersByTimeAsync(1000)
    expect(wrapper.get('[data-test="task-logs.scan.4"]').text()).toContain('Elapsed: 0 min 31 s')
    wrapper.unmount()
  })
  it('shows the KUApps coordinator with its runs, copies diagnostics and cancels its reads here (#330)', async () => {
    const coordinator = task({
      id: 'kuapps.coordinator.app-12345678-xyz', name: 'KUApps task coordinator', type: 'coordinator', provider: 'kua', detail: null,
      progress: null, summary: { reading: 1, queuedWrites: 1, writing: 1 }, supportedActions: ['cancel'], availableActions: ['cancel'],
    })
    const detail = {
      applicationId: 'app-12345678-xyz', windowMinutes: 15,
      runs: [
        { runId: 'r2', key: 'app.topology', kind: 'read', trigger: 'invalidation', outcome: 'completed', durationMs: 900, requests: 1, reconciles: 0, awsCalls: 0, invalidates: [], flags: ['slow'] },
        { runId: 'r1', key: 'edge.confirm-batch', kind: 'write', trigger: 'user', outcome: 'completed', durationMs: 80, requests: 1, reconciles: 1, awsCalls: 0, stores: ['apm-db'], revision: 'checked', invalidates: ['topology'], flags: [] },
      ],
      metrics: { requested: 4, executed: 2, deduplicated: 2, cancelled: 0, failed: 0, coalescedWrites: 3, maxQueueDepth: 2, reconcilesPerWrite: 1, awsCalls: 0, untracked: 0, byKey: [{ key: 'app.topology', runs: 6, p50Ms: 100, p95Ms: 200 }] },
    }
    const calls = stubFetch(async url => {
      if (url === BASE) return jsonResponse(snapshot([coordinator]))
      if (url === `${BASE}/kuapps/coordinators/app-12345678-xyz`) return jsonResponse(detail)
      return jsonResponse({ task: coordinator, changed: true })
    })
    const writeText = vi.fn(async () => {})
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const reads = taskCoordinatorFor('app-12345678-xyz')
    const pending = reads.read('app.topology', ({ signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
    })).catch(error => error.name)

    const wrapper = mount(BackgroundTasksPanel, { props: { show: true, pollMs: 60000 } })
    await flushPromises()
    const row = wrapper.get('[data-test="task-kuapps.coordinator.app-12345678-xyz"]')
    expect(row.text()).toContain('KUApps task coordinator · app-1234')
    expect(row.text()).toContain('1 reads running · 2 changes queued')

    await row.get('[data-test="coordinator-toggle-kuapps.coordinator.app-12345678-xyz"]').trigger('click')
    await flushPromises()
    const panel = wrapper.get('[data-test="coordinator-detail"]')
    expect(panel.text()).toContain('Ran of the ones asked')
    expect(panel.text()).toContain('of 4')
    expect(panel.text()).toContain('2 ran')
    expect(panel.text()).toContain('2 shared')
    expect(panel.get('[data-test="coordinator-metrics"]').text()).toContain('Changes with a merged reload3')
    expect(panel.text()).toContain('After a change')
    expect(panel.text()).toContain('Over 3 × its p95')
    expect(panel.text()).toContain('Writes: apm-db')
    expect(panel.text()).toContain('1 requests · 1 reconciliations · 0 AWS calls')
    expect(panel.text()).toContain('6 runs · p50 100 ms · p95 200 ms')

    await panel.get('[data-test="coordinator-copy"]').trigger('click')
    await flushPromises()
    expect(JSON.parse(writeText.mock.calls[0][0]).runs).toHaveLength(2)
    expect(panel.text()).toContain('Diagnostics copied')

    await row.get('[data-test="task-action-kuapps.coordinator.app-12345678-xyz-cancel"]').trigger('click')
    await flushPromises()
    expect(await pending).toBe('AbortError')
    expect(calls.filter(call => call.method === 'POST').map(call => call.url)).toEqual([`${BASE}/kuapps.coordinator.app-12345678-xyz/cancel`])
    wrapper.unmount()
  })

  it('puts failing tasks in Needs attention with bars of their last runs and the next run (#351)', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(new Date('2026-11-02T12:00:00.000Z'))
    const recent = [100, 120, 900, 110, 105].map((durationMs, index) => ({ durationMs, outcome: index === 2 || index === 4 ? 'failed' : 'completed' }))
    stubFetch(async url => url === BASE ? jsonResponse(snapshot([
      task({ id: 'logs.refresh', name: 'Logs', type: 'scheduler', state: 'scheduled', progress: null, nextRunAt: '2026-11-02T12:12:00.000Z', availableActions: ['pause'], history: { recent, typicalMs: 110, failuresInLast5: 2 } }),
      task({ id: 'apm.collection', type: 'scheduler', state: 'scheduled', progress: null, nextRunAt: '2026-11-02T12:03:00.000Z', availableActions: [], history: { recent: recent.map(run => ({ ...run, outcome: 'completed' })), typicalMs: 64000, failuresInLast5: 0 } }),
    ])) : jsonResponse({ enabled: true, byFeature: [{ feature: 'observability', usd: 1.5 }, { feature: 'log-scans', usd: 0.34 }] }))
    const wrapper = mount(BackgroundTasksPanel, { props: { show: true, pollMs: 60000 } })
    await flushPromises()

    const attention = wrapper.get('[data-test="tasks-section-attention"]')
    expect(attention.find('[data-test="task-logs.refresh"]').exists()).toBe(true)
    expect(attention.text()).toContain('Failed 2 of its last 5 runs')
    expect(wrapper.get('[data-test="tasks-tab-history"]').text()).toContain('1 need attention')
    const scheduled = wrapper.get('[data-test="tasks-section-scheduled"]')
    expect(scheduled.text()).toContain('Next in 3 min')
    expect(scheduled.text()).toContain('Typical: 1 min 4 s')
    const bars = wrapper.findAll('[data-test="task-spark-logs.refresh"] span')
    expect(bars).toHaveLength(5)
    expect(bars.filter(bar => bar.classes('failed'))).toHaveLength(2)
    expect(wrapper.get('[data-test="task-spark-logs.refresh"]').attributes('aria-label')).toBe('Duration of the last 5 runs, 2 failed')
    expect(wrapper.get('[data-test="process-metrics"]').text()).toContain('$1.84')
    wrapper.unmount()
  })

  it('shows the history grouped by day, filters it and opens a run (#351)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-02T12:00:00'))
    const runs = [
      { id: 3, taskId: 'team.sync', name: 'Team sync', type: 'scheduler', provider: 'kua', startedAt: '2026-11-02T09:29:58', finishedAt: '2026-11-02T09:30:00', durationMs: 2000, outcome: 'failed', errorCode: 'auth_expired' },
      { id: 2, taskId: 'apps.sync', name: 'Application sync', type: 'scheduler', provider: 'kua', startedAt: '2026-11-02T08:00:00', finishedAt: '2026-11-02T08:00:03', durationMs: 3000, outcome: 'completed', errorCode: null },
      { id: 1, taskId: 'logs.scan.2', name: 'Log scan', type: 'scan', provider: 'aws', startedAt: '2026-11-01T18:00:00', finishedAt: '2026-11-01T18:01:00', durationMs: 60000, outcome: 'cancelled', errorCode: null },
    ]
    const calls = stubFetch(async url => {
      if (url === BASE) return jsonResponse(snapshot([]))
      if (url.startsWith(`${BASE}/history`)) {
        const outcome = new URL(url, 'http://kua').searchParams.get('outcome')
        return jsonResponse({ runs: runs.filter(run => !outcome || run.outcome === outcome), summary24h: { runs: 3, completed: 1, failed: 1, cancelled: 1 }, retentionDays: 7, maxRuns: 2000 })
      }
      return jsonResponse({ enabled: true, byFeature: [] })
    })
    const writeText = vi.fn(async () => {})
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const wrapper = mount(BackgroundTasksPanel, { props: { show: true, pollMs: 60000 } })
    await flushPromises()
    await wrapper.get('[data-test="tasks-tab-history"]').trigger('click')
    await flushPromises()

    const history = wrapper.get('[data-test="task-history"]')
    expect(history.text()).toContain('Today')
    expect(history.text()).toContain('2 runs · 1 failed')
    expect(history.text()).toContain('Yesterday')
    expect(history.text()).toContain('Application sync')
    expect(history.text()).toContain('Kept 7 days or the last 2000 runs')

    await history.get('[data-test="history-run-3"] button').trigger('click')
    expect(history.get('[data-test="history-detail"]').text()).toContain('auth_expired')
    await history.get('[data-test="history-copy"]').trigger('click')
    await flushPromises()
    expect(JSON.parse(writeText.mock.calls[0][0]).errorCode).toBe('auth_expired')

    await history.get('[data-test="history-filter-failed"]').trigger('click')
    await flushPromises()
    expect(calls.some(call => call.url === `${BASE}/history?outcome=failed`)).toBe(true)
    expect(history.findAll('[data-test^="history-run-"]')).toHaveLength(1)
    wrapper.unmount()
  })
})
