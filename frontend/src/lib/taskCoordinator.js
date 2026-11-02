// One coordinator per KUA application decides what runs, what is merged and what is cancelled
// (#326), so the Review tab stops firing overlapping reloads:
// - Reads are single-flight per key: asking again while one runs returns the same promise.
//   They wait while a write of the same application runs, and cancel() aborts them; a response
//   that arrives after that is dropped instead of overwriting newer state.
// - Writes run one at a time in order, so they never race on the registry reconciliation.
//   What each invalidates comes from the action catalog (#329) unless the caller says otherwise;
//   when the queue is empty, subscribers receive the union of
//   those parts once, so N writes cause one reload. A write's promise settles after that reload.
// - Every step is recorded as an event (queued, started, deduplicated, coalesced, cancelled,
//   stale, completed, failed): the source of its view in the background task manager (#330).
// Requests carry the X-KUA-Task header so the backend task journal attributes them (#325).
import { taskRun } from './taskTrace'
import { invalidatesFor } from './actionCatalog'

const MAX_EVENTS = 200
const MAX_COORDINATORS = 20

export class TaskAbortedError extends Error {
  constructor(key) {
    super(`Task cancelled: ${key}`)
    this.name = 'AbortError'
  }
}

export const isAborted = error => error?.name === 'AbortError'

export function createTaskCoordinator({ scope = '', now = () => Date.now(), maxEvents = MAX_EVENTS } = {}) {
  const reads = new Map()
  const writes = []
  const subscribers = new Set()
  const listeners = new Set()
  const events = []
  let pending = new Set()
  let pendingWaiters = []
  let pendingWrites = 0
  let writing = false
  let idleWaiters = []
  let flushScheduled = false
  // Reads asked while subscribers reload after writes were triggered by an invalidation.
  let flushing = false

  function record(type, key, details = {}) {
    const event = { at: new Date(now()).toISOString(), scope, type, key, ...details }
    events.push(event)
    if (events.length > maxEvents) events.shift()
    for (const listener of listeners) {
      try { listener(event) } catch { /* a listener never breaks the coordinator */ }
    }
    return event
  }

  // Resolves when no write runs or waits; a cancelled read stops waiting at once.
  function writesIdle(signal) {
    if (!writing && !writes.length) return Promise.resolve()
    return new Promise(resolve => {
      idleWaiters.push(resolve)
      signal?.addEventListener('abort', resolve, { once: true })
    })
  }

  function read(key, run, { kind = 'read' } = {}) {
    const current = reads.get(key)
    if (current) {
      record('deduplicated', key, { kind, runId: current.runId })
      return current.promise
    }
    const task = taskRun(key)
    const runId = task.split(';')[1]
    const controller = new AbortController()
    const entry = { controller, runId, promise: null }
    const startedAt = now()
    record('queued', key, { kind, runId, ...(flushing ? { trigger: 'invalidation' } : {}) })
    entry.promise = (async () => {
      try {
        await writesIdle(controller.signal)
        if (controller.signal.aborted) throw new TaskAbortedError(key)
        record('started', key, { kind, runId })
        const result = await run({ signal: controller.signal, task })
        // The work ignored the signal: its result is stale and must not be applied.
        if (controller.signal.aborted) {
          record('stale', key, { kind, runId, durationMs: now() - startedAt })
          throw new TaskAbortedError(key)
        }
        record('completed', key, { kind, runId, durationMs: now() - startedAt })
        return result
      } catch (error) {
        if (isAborted(error) || controller.signal.aborted) {
          if (!events.some(event => event.runId === runId && ['cancelled', 'stale'].includes(event.type))) {
            record('cancelled', key, { kind, runId, durationMs: now() - startedAt })
          }
          throw isAborted(error) ? error : new TaskAbortedError(key)
        }
        record('failed', key, { kind, runId, durationMs: now() - startedAt, error: String(error?.message || error).slice(0, 200) })
        throw error
      } finally {
        if (reads.get(key) === entry) reads.delete(key)
      }
    })()
    reads.set(key, entry)
    return entry.promise
  }

  function write(key, run, { invalidates = invalidatesFor(key) } = {}) {
    const task = taskRun(key)
    const runId = task.split(';')[1]
    record('queued', key, { kind: 'write', runId, invalidates })
    return new Promise((resolve, reject) => {
      writes.push({ key, run, invalidates, task, runId, resolve, reject })
      drain()
    })
  }

  async function drain() {
    if (writing) return
    writing = true
    while (writes.length) {
      const item = writes.shift()
      const startedAt = now()
      record('started', item.key, { kind: 'write', runId: item.runId })
      let result
      let failure = null
      try {
        result = await item.run({ task: item.task })
        record('completed', item.key, { kind: 'write', runId: item.runId, durationMs: now() - startedAt })
      } catch (error) {
        failure = error
        record('failed', item.key, { kind: 'write', runId: item.runId, durationMs: now() - startedAt, error: String(error?.message || error).slice(0, 200) })
      }
      const settle = () => (failure ? item.reject(failure) : item.resolve(result))
      if (!item.invalidates.length) {
        // Nothing to reload: the caller continues at once.
        settle()
        continue
      }
      // A failed write may still have changed something: its parts are reloaded too.
      for (const part of item.invalidates) pending.add(part)
      pendingWrites += 1
      pendingWaiters.push(settle)
    }
    writing = false
    const waiters = idleWaiters
    idleWaiters = []
    waiters.forEach(resolve => resolve())
    scheduleFlush()
  }

  function scheduleFlush() {
    if (flushScheduled) return
    flushScheduled = true
    // Writes queued while the queue drains join this flush.
    queueMicrotask(flush)
  }

  async function flush() {
    flushScheduled = false
    if (writing || writes.length) return
    const parts = pending
    const waiters = pendingWaiters
    const merged = pendingWrites
    pending = new Set()
    pendingWaiters = []
    pendingWrites = 0
    if (parts.size) {
      if (merged > 1) record('coalesced', 'invalidation', { writes: merged, parts: [...parts] })
      flushing = true
      const reloads = [...subscribers].map(subscriber => {
        try { return subscriber(parts) } catch (error) { return Promise.reject(error) }
      })
      flushing = false
      await Promise.allSettled(reloads)
    }
    waiters.forEach(settle => settle())
  }

  /** Marks parts as changed outside a write (e.g. a range change) and reloads them once. */
  function invalidate(parts) {
    for (const part of parts) pending.add(part)
    if (!writing && !writes.length) scheduleFlush()
  }

  /** subscriber(parts: Set<string>) reloads what it owns; returns an unsubscribe function. */
  function subscribe(subscriber) {
    subscribers.add(subscriber)
    return () => subscribers.delete(subscriber)
  }

  function onEvent(listener) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  /** Aborts running and waiting reads. Writes already sent are never cancelled halfway. */
  function cancel() {
    for (const entry of reads.values()) entry.controller.abort()
  }

  function snapshot() {
    return {
      scope,
      reading: [...reads.keys()],
      writing,
      queuedWrites: writes.length,
      pendingInvalidations: [...pending],
      events: [...events],
    }
  }

  const hasSubscribers = () => subscribers.size > 0

  return { read, write, invalidate, subscribe, onEvent, cancel, snapshot, hasSubscribers }
}

const coordinators = new Map()
const creationListeners = new Set()

/** listener(applicationId, coordinator) for every coordinator created from now on (#330). */
export function onTaskCoordinatorCreated(listener) {
  creationListeners.add(listener)
  return () => creationListeners.delete(listener)
}

/** The coordinator of an application if one exists; never creates it. */
export function existingTaskCoordinator(applicationId) {
  return coordinators.get(String(applicationId || '')) || null
}

/** The shared coordinator of an application: the Observability store and KUApps views use the same one. */
export function taskCoordinatorFor(applicationId) {
  const key = String(applicationId || '')
  let coordinator = coordinators.get(key)
  if (coordinator) {
    // Most recently used last, so the oldest is evicted first.
    coordinators.delete(key)
  } else {
    coordinator = createTaskCoordinator({ scope: key })
    for (const listener of creationListeners) {
      try { listener(key, coordinator) } catch { /* reporting never breaks the coordinator */ }
    }
  }
  coordinators.set(key, coordinator)
  // Evicts the least recently used coordinators nobody is subscribed to.
  for (const [candidateKey, candidate] of coordinators) {
    if (coordinators.size <= MAX_COORDINATORS) break
    if (candidate === coordinator || candidate.hasSubscribers()) continue
    candidate.cancel()
    coordinators.delete(candidateKey)
  }
  return coordinator
}

export function resetTaskCoordinators() {
  for (const coordinator of coordinators.values()) coordinator.cancel()
  coordinators.clear()
}
