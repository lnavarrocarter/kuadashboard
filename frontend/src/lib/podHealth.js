// Pod health as an operator reads it. The pod phase (Running, Pending…) only
// says where the pod is in its lifecycle: a Running pod can have a container
// in CrashLoopBackOff and serve nothing. Health is derived from readiness and
// each container's state; the phase is kept as a secondary fact.

// Waiting reasons that are part of a normal start-up, not a problem.
const STARTING_REASONS = new Set(['ContainerCreating', 'PodInitializing'])

function describeContainer(status = {}, init = false) {
  const state = status.state || {}
  const kind = state.waiting ? 'waiting' : state.terminated ? 'terminated' : state.running ? 'running' : 'unknown'
  const current = state[kind] || {}
  const last = status.lastState?.terminated
  return {
    name: status.name,
    init,
    ready: !!status.ready,
    restarts: status.restartCount || 0,
    state: kind,
    reason: current.reason || '',
    message: current.message || '',
    exitCode: current.exitCode ?? null,
    lastTermination: last ? { reason: last.reason || '', exitCode: last.exitCode ?? null, finishedAt: last.finishedAt || null } : null,
  }
}

function isProblem(container, phase) {
  if (container.state === 'waiting') return !!container.reason && !STARTING_REASONS.has(container.reason)
  // A finished init container or a completed Job pod exits 0 on purpose.
  if (container.state === 'terminated') return container.exitCode !== 0 && phase !== 'Succeeded'
  return false
}

/**
 * @returns {{ level: 'ok'|'not-ready'|'failing'|'pending'|'completed'|'unknown',
 *   phase: string, ready: number, total: number, restarts: number,
 *   problems: object[], containers: object[], lastTermination: object|null }}
 */
export function podHealth(pod = {}) {
  const status = pod.status || {}
  const phase = status.phase || 'Unknown'
  const main = (status.containerStatuses || []).map(c => describeContainer(c))
  const init = (status.initContainerStatuses || []).map(c => describeContainer(c, true))
  const containers = [...init, ...main]
  const total = pod.spec?.containers?.length || main.length
  const ready = main.filter(c => c.ready).length
  const restarts = containers.reduce((sum, c) => sum + c.restarts, 0)
  const problems = containers.filter(c => isProblem(c, phase))

  // The most recent termination of any container: why it last stopped.
  const lastTermination = containers
    .filter(c => c.lastTermination)
    .map(c => ({ container: c.name, ...c.lastTermination }))
    .sort((a, b) => String(b.finishedAt || '').localeCompare(String(a.finishedAt || '')))[0] || null

  let level = 'unknown'
  if (phase === 'Succeeded') level = 'completed'
  else if (phase === 'Failed' || problems.length) level = 'failing'
  else if (phase === 'Pending') level = 'pending'
  else if (phase === 'Running') level = total && ready === total ? 'ok' : 'not-ready'

  return { level, phase, ready, total, restarts, problems, containers, lastTermination }
}
