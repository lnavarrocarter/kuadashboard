import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { startCoordinatorReporting } from '../lib/coordinatorReporter'
import { taskCoordinatorFor } from '../lib/taskCoordinator'
import { useCoordinatorActivity } from '../composables/useCoordinatorActivity'

describe('coordinator reporting (#330)', () => {
  let stop = () => {}
  afterEach(() => { stop(); vi.useRealTimers() })

  it('batches events once a second per application, without error messages', async () => {
    vi.useFakeTimers()
    const post = vi.fn(async () => ({ cancel: false }))
    stop = startCoordinatorReporting({ post })
    const tasks = taskCoordinatorFor('app-1')
    await tasks.read('app.topology', async () => 'ok')
    await expect(tasks.read('app.forecast', async () => { throw new Error('arn:aws:lambda:secret') })).rejects.toThrow()
    expect(post).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1000)
    expect(post).toHaveBeenCalledTimes(1)
    const body = post.mock.calls[0][0]
    expect(body.applicationId).toBe('app-1')
    expect(body.state).toEqual({ reading: 0, queuedWrites: 0, writing: false })
    expect(body.events.map(event => `${event.key}:${event.type}`)).toEqual([
      'app.topology:queued', 'app.topology:started', 'app.topology:completed',
      'app.forecast:queued', 'app.forecast:started', 'app.forecast:failed',
    ])
    expect(JSON.stringify(body)).not.toContain('secret')
    expect(body.events.some(event => 'scope' in event || 'error' in event)).toBe(false)

    await vi.advanceTimersByTimeAsync(5000)
    expect(post).toHaveBeenCalledTimes(1)
  })

  it('aborts the reads of the application when the panel asked to cancel', async () => {
    vi.useFakeTimers()
    stop = startCoordinatorReporting({ post: async () => ({ cancel: true }) })
    const tasks = taskCoordinatorFor('app-2')
    const pending = tasks.read('app.topology', ({ signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
    }))
    const outcome = pending.catch(error => error.name)
    await vi.advanceTimersByTimeAsync(1000)
    expect(await outcome).toBe('AbortError')
  })

  it('keeps reporting while a read runs without events, so a later cancel still arrives', async () => {
    vi.useFakeTimers()
    const post = vi.fn()
      .mockResolvedValueOnce({ cancel: false })
      .mockResolvedValueOnce({ cancel: true })
    stop = startCoordinatorReporting({ post })
    const tasks = taskCoordinatorFor('app-5')
    const outcome = tasks.read('app.topology', ({ signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
    })).catch(error => error.name)
    await vi.advanceTimersByTimeAsync(1000)
    expect(post).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(post).toHaveBeenCalledTimes(2)
    expect(post.mock.calls[1][0].events).toEqual([])
    expect(await outcome).toBe('AbortError')
  })

  it('marks the reads a reload asked for as triggered by an invalidation', async () => {
    const tasks = taskCoordinatorFor('app-3')
    const events = []
    tasks.onEvent(event => events.push(event))
    tasks.subscribe(parts => (parts.has('topology') ? tasks.read('app.topology', async () => 'ok') : null))
    await tasks.write('edge.confirm-batch', async () => 'done')
    const queued = events.filter(event => event.type === 'queued')
    expect(queued.find(event => event.key === 'edge.confirm-batch').trigger).toBeUndefined()
    expect(queued.find(event => event.key === 'app.topology').trigger).toBe('invalidation')
  })
})

describe('useCoordinatorActivity', () => {
  it('words what the coordinator runs and clears when it is done', async () => {
    const applicationId = ref('app-4')
    let activity
    const Probe = defineComponent({
      setup() {
        activity = useCoordinatorActivity(applicationId).activity
        return () => h('span', activity.value)
      },
    })
    const wrapper = mount(Probe)
    const tasks = taskCoordinatorFor('app-4')
    let finishCloud
    const cloud = tasks.read('topology.analyze-cloud', () => new Promise(resolve => { finishCloud = resolve }), { kind: 'cloud-read' })
    await flushPromises()
    expect(activity.value).toBe('kuapps.activity.cloudRunning')

    let finishWrite
    const write = tasks.write('relationship.review', () => new Promise(resolve => { finishWrite = resolve }), { invalidates: [] })
    await nextTick()
    expect(activity.value).toBe('kuapps.activity.saving')
    finishWrite()
    await write
    finishCloud({})
    await cloud
    await flushPromises()
    expect(activity.value).toBe('')

    applicationId.value = null
    await nextTick()
    tasks.read('app.topology', async () => 'ok')
    expect(activity.value).toBe('')
    wrapper.unmount()
  })
})
