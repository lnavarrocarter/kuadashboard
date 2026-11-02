// Sends what the KUApps task coordinators do to the background task manager (#330): events are
// batched once a second per application, with the current counts, to
// POST /api/system/tasks/kuapps/coordinators/events (this computer only). A cancel asked from the panel comes back
// in the response and aborts that application's reads; while reads run, a batch goes every second
// even without events, so that cancel always arrives.
// Privacy: application ids, task keys, run ids, timings and counts. Error messages are not sent.
import { onTaskCoordinatorCreated } from './taskCoordinator'

const FLUSH_MS = 1000
const FIELDS = ['at', 'type', 'key', 'kind', 'runId', 'durationMs', 'writes', 'invalidates', 'parts', 'trigger']

function cleanEvent(event) {
  return Object.fromEntries(FIELDS.filter(field => event[field] !== undefined).map(field => [field, event[field]]))
}

function counts(coordinator) {
  const snapshot = coordinator.snapshot()
  return { reading: snapshot.reading.length, queuedWrites: snapshot.queuedWrites, writing: snapshot.writing }
}

/**
 * Starts reporting every coordinator created from now on. post(body) sends one batch and
 * resolves to the server response. Returns a function that stops reporting.
 */
export function startCoordinatorReporting({ post, flushMs = FLUSH_MS, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const reporters = new Set()

  function report(applicationId, coordinator) {
    if (!applicationId) return
    let buffer = []
    let timer = null
    let sending = false
    let stopped = false

    async function flush() {
      timer = null
      if (sending) {
        schedule()
        return
      }
      const events = buffer
      buffer = []
      sending = true
      const state = counts(coordinator)
      let failed = false
      try {
        const response = await post({ applicationId, events, state })
        if (response?.cancel) coordinator.cancel()
      } catch {
        // The task manager is a diagnostic: a failed batch is dropped, never retried in a loop.
        failed = true
      } finally {
        sending = false
      }
      if (!failed && !stopped && (state.reading > 0 || state.writing || state.queuedWrites > 0)) schedule()
    }

    function schedule() {
      if (!timer) timer = setTimer(flush, flushMs)
    }

    const stopListening = coordinator.onEvent(event => {
      buffer.push(cleanEvent(event))
      schedule()
    })
    const reporter = () => {
      stopped = true
      stopListening()
      if (timer) clearTimer(timer)
      timer = null
    }
    reporters.add(reporter)
  }

  const stopCreation = onTaskCoordinatorCreated(report)
  return () => {
    stopCreation()
    for (const reporter of reporters) reporter()
    reporters.clear()
  }
}
