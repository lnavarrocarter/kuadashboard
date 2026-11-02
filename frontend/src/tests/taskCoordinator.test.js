import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTaskCoordinator, isAborted, resetTaskCoordinators, taskCoordinatorFor } from '../lib/taskCoordinator'

function deferred() {
  let resolve
  let reject
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail })
  return { promise, resolve, reject }
}

const tick = () => new Promise(resolve => setTimeout(resolve, 0))
const types = (coordinator, key) => coordinator.snapshot().events.filter(event => !key || event.key === key).map(event => event.type)

afterEach(() => resetTaskCoordinators())

describe('task coordinator reads', () => {
  it('runs one request for concurrent reads of the same key', async () => {
    const coordinator = createTaskCoordinator()
    const gate = deferred()
    const run = vi.fn(() => gate.promise)
    const first = coordinator.read('app.topology', run)
    const second = coordinator.read('app.topology', run)
    expect(second).toBe(first)
    await tick()
    gate.resolve('topology')
    await expect(first).resolves.toBe('topology')
    expect(run).toHaveBeenCalledTimes(1)
    expect(types(coordinator)).toEqual(['queued', 'deduplicated', 'started', 'completed'])
    // Once settled, the next read runs again.
    await coordinator.read('app.topology', () => 'again')
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('passes an X-KUA-Task value and an abort signal to the work', async () => {
    const coordinator = createTaskCoordinator()
    let received
    await coordinator.read('app.registry', input => { received = input })
    expect(received.task).toMatch(/^app\.registry;[a-z0-9-]+$/)
    expect(received.signal).toBeInstanceOf(AbortSignal)
  })

  it('cancel aborts running reads, and a result that ignores the signal is dropped as stale', async () => {
    const coordinator = createTaskCoordinator()
    const gate = deferred()
    const read = coordinator.read('app.overview', () => gate.promise)
    await tick()
    coordinator.cancel()
    gate.resolve('late data')
    const error = await read.catch(caught => caught)
    expect(isAborted(error)).toBe(true)
    expect(types(coordinator, 'app.overview')).toEqual(['queued', 'started', 'stale'])
  })

  it('a failed read rejects with its error and does not block the next one', async () => {
    const coordinator = createTaskCoordinator()
    await expect(coordinator.read('app.forecast', () => { throw new Error('boom') })).rejects.toThrow('boom')
    await expect(coordinator.read('app.forecast', () => 'ok')).resolves.toBe('ok')
    expect(types(coordinator, 'app.forecast')).toEqual(['queued', 'started', 'failed', 'queued', 'started', 'completed'])
  })
})

describe('task coordinator writes', () => {
  it('runs writes one at a time and in order', async () => {
    const coordinator = createTaskCoordinator()
    const order = []
    const first = deferred()
    const a = coordinator.write('edge.confirm', async () => { order.push('a:start'); await first.promise; order.push('a:end') })
    const b = coordinator.write('relationship.review', async () => { order.push('b') })
    await tick()
    expect(order).toEqual(['a:start'])
    first.resolve()
    await Promise.all([a, b])
    expect(order).toEqual(['a:start', 'a:end', 'b'])
  })

  it('reads wait for a running write', async () => {
    const coordinator = createTaskCoordinator()
    const gate = deferred()
    const order = []
    const write = coordinator.write('edge.confirm', async () => { await gate.promise; order.push('write') })
    const read = coordinator.read('app.topology', () => { order.push('read') })
    await tick()
    expect(order).toEqual([])
    gate.resolve()
    await Promise.all([write, read])
    expect(order).toEqual(['write', 'read'])
  })

  it('a read cancelled while waiting for a write stops at once', async () => {
    const coordinator = createTaskCoordinator()
    const gate = deferred()
    const write = coordinator.write('edge.confirm', () => gate.promise)
    const run = vi.fn()
    const read = coordinator.read('app.topology', run)
    coordinator.cancel()
    await expect(read).rejects.toMatchObject({ name: 'AbortError' })
    expect(run).not.toHaveBeenCalled()
    gate.resolve()
    await write
  })

  it('merges the invalidations of several writes into one reload, then settles them', async () => {
    const coordinator = createTaskCoordinator()
    const reloads = []
    coordinator.subscribe(parts => { reloads.push([...parts].sort()) })
    await Promise.all([
      coordinator.write('edge.confirm', () => 1, { invalidates: ['topology', 'registry'] }),
      coordinator.write('edge.confirm', () => 2, { invalidates: ['topology'] }),
      coordinator.write('resource.add', () => 3, { invalidates: ['overview'] }),
    ])
    expect(reloads).toEqual([['overview', 'registry', 'topology']])
    expect(coordinator.snapshot().events.find(event => event.type === 'coalesced')).toMatchObject({ writes: 3 })
  })

  it('a write resolves only after the reload it caused', async () => {
    const coordinator = createTaskCoordinator()
    const reload = deferred()
    let reloaded = false
    coordinator.subscribe(async () => { await reload.promise; reloaded = true })
    const write = coordinator.write('edge.confirm', () => 'done', { invalidates: ['topology'] })
    let settled = false
    write.then(() => { settled = true })
    await tick()
    await tick()
    expect(settled).toBe(false)
    reload.resolve()
    await expect(write).resolves.toBe('done')
    expect(reloaded).toBe(true)
  })

  it('a failed write rejects, its parts are still reloaded and the queue goes on', async () => {
    const coordinator = createTaskCoordinator()
    const reloads = []
    coordinator.subscribe(parts => { reloads.push([...parts]) })
    const failed = coordinator.write('edge.confirm', () => { throw new Error('conflict') }, { invalidates: ['topology'] })
    const next = coordinator.write('relationship.review', () => 'ok', { invalidates: ['registry'] })
    await expect(failed).rejects.toThrow('conflict')
    await expect(next).resolves.toBe('ok')
    expect(reloads).toEqual([['topology', 'registry']])
  })

  it('a subscriber error does not keep other subscribers or the write from settling', async () => {
    const coordinator = createTaskCoordinator()
    const seen = []
    coordinator.subscribe(() => { throw new Error('view gone') })
    coordinator.subscribe(parts => { seen.push([...parts]) })
    await coordinator.write('edge.confirm', () => null, { invalidates: ['topology'] })
    expect(seen).toEqual([['topology']])
  })

  it('invalidate reloads once outside a write, and unsubscribe stops reloads', async () => {
    const coordinator = createTaskCoordinator()
    const reloads = []
    const unsubscribe = coordinator.subscribe(parts => { reloads.push([...parts]) })
    coordinator.invalidate(['overview'])
    coordinator.invalidate(['forecast'])
    await tick()
    expect(reloads).toEqual([['overview', 'forecast']])
    unsubscribe()
    coordinator.invalidate(['overview'])
    await tick()
    expect(reloads).toHaveLength(1)
  })
})

describe('task coordinator events and registry', () => {
  it('keeps a bounded event history and notifies listeners', async () => {
    const coordinator = createTaskCoordinator({ maxEvents: 4 })
    const listened = []
    coordinator.onEvent(event => listened.push(event.type))
    await coordinator.read('a', () => null)
    await coordinator.read('b', () => null)
    expect(coordinator.snapshot().events).toHaveLength(4)
    expect(listened).toEqual(['queued', 'started', 'completed', 'queued', 'started', 'completed'])
  })

  it('shares one coordinator per application', () => {
    expect(taskCoordinatorFor('app-a')).toBe(taskCoordinatorFor('app-a'))
    expect(taskCoordinatorFor('app-a')).not.toBe(taskCoordinatorFor('app-b'))
  })

  it('never evicts a coordinator that views are subscribed to', () => {
    const watched = taskCoordinatorFor('watched')
    const unsubscribe = watched.subscribe(() => {})
    for (let index = 0; index < 30; index += 1) taskCoordinatorFor(`app-${index}`)
    expect(taskCoordinatorFor('watched')).toBe(watched)
    unsubscribe()
  })
})
