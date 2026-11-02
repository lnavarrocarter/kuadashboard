// What the task coordinator of an application is doing right now, in words (#330): one status
// line for the Review tab instead of a spinner per component. It comes from the coordinator
// events, the same ones the background task manager shows.
import { computed, onUnmounted, ref, watch } from 'vue'
import { taskCoordinatorFor } from '../lib/taskCoordinator'

const FINAL = new Set(['completed', 'failed', 'cancelled', 'stale'])

// Most important first: a pending write says more than the reloads it causes.
function activityKey(runs) {
  const values = [...runs.values()]
  if (values.some(run => run.kind === 'write')) return 'kuapps.activity.saving'
  const cloud = values.find(run => run.key.startsWith('topology.analyze-cloud'))
  if (cloud) return cloud.started ? 'kuapps.activity.cloudRunning' : 'kuapps.activity.cloudQueued'
  if (values.some(run => run.key === 'app.topology')) return 'kuapps.activity.topology'
  if (values.some(run => run.key.includes('registry'))) return 'kuapps.activity.registry'
  return values.length ? 'kuapps.activity.updating' : ''
}

/** applicationId: a getter or ref. Returns { activity }: an i18n key, or '' when idle. */
export function useCoordinatorActivity(applicationId) {
  const runs = ref(new Map())
  let stop = () => {}

  function follow(id) {
    stop()
    runs.value = new Map()
    if (!id) {
      stop = () => {}
      return
    }
    stop = taskCoordinatorFor(id).onEvent(event => {
      if (!event.runId) return
      const next = new Map(runs.value)
      if (event.type === 'queued') next.set(event.runId, { key: event.key, kind: event.kind, started: false })
      else if (event.type === 'started' && next.has(event.runId)) next.set(event.runId, { ...next.get(event.runId), started: true })
      else if (FINAL.has(event.type)) next.delete(event.runId)
      else return
      runs.value = next
    })
  }

  watch(applicationId, follow, { immediate: true })
  onUnmounted(() => stop())

  return { activity: computed(() => activityKey(runs.value)) }
}
