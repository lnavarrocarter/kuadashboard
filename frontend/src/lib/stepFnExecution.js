export function executionScopes(definition) {
  let root
  try { root = typeof definition === 'string' ? JSON.parse(definition) : definition } catch { return [] }
  const scopes = []
  function collect(machine, id, label, parentState = null) {
    if (!machine?.States) return
    scopes.push({ id, label, definition: JSON.stringify(machine), states: machine.States, parentState })
    for (const [name, state] of Object.entries(machine.States)) {
      const key = JSON.stringify([id, name])
      state.Branches?.forEach((branch, index) => collect(branch, `${key}:branch:${index}`, `${label} / ${name} / Rama ${index + 1}`, key))
      if (state.ItemProcessor || state.Iterator) collect(state.ItemProcessor || state.Iterator, `${key}:map`, `${label} / ${name}`, key)
    }
  }
  collect(root, 'root', 'Principal')
  return scopes
}

export function buildExecution(events = [], definition) {
  const scopes = executionScopes(definition)
  const visits = []
  const owners = new Map()
  const iterations = new Map()
  const transitions = []
  const ordered = [...events].sort((left, right) => left.id - right.id)
  for (const event of ordered) {
    let owner = owners.get(event.previousEventId)
    const iteration = event.mapIterationStartedEventDetails?.index ?? iterations.get(event.previousEventId)
    if (iteration !== undefined) iterations.set(event.id, iteration)
    if (event.type?.endsWith('StateEntered')) {
      const details = event.stateEnteredEventDetails || {}
      const parent = owner && !owner.exited && ['Map', 'Parallel'].includes(owner.type) ? owner : owner?.parent
      const candidates = scopes.filter(scope => scope.parentState === (parent?.key ?? null) && scope.states[details.name])
      const scope = candidates.length === 1 ? candidates[0] : null
      const visit = {
        id: event.id, name: details.name, type: event.type.replace('StateEntered', ''),
        scopeId: scope?.id, key: scope ? JSON.stringify([scope.id, details.name]) : null,
        parent, iteration, start: event.timestamp, end: null, status: 'RUNNING',
        input: details.input, output: undefined, events: [], exited: false,
      }
      if (owner && (owner.exited || ['FAILED', 'TIMED_OUT'].includes(owner.status)) && owner.scopeId && owner.scopeId === visit.scopeId) transitions.push({ scopeId: visit.scopeId, from: owner.name, to: visit.name })
      visits.push(visit)
      owner = visit
    } else if (event.type?.endsWith('StateExited')) {
      const name = event.stateExitedEventDetails?.name
      while (owner && owner.name !== name) owner = owner.parent
      if (owner) {
        owner.exited = true
        owner.status = 'SUCCEEDED'
        owner.output = event.stateExitedEventDetails?.output
        owner.end = event.timestamp
      }
    }
    if (owner && !event.type?.startsWith('Execution')) {
      owner.events.push(event)
      if (/Failed|TimedOut|Aborted$/.test(event.type)) {
        owner.status = event.type.includes('TimedOut') ? 'TIMED_OUT' : event.type.includes('Aborted') ? 'ABORTED' : 'FAILED'
        owner.end = event.timestamp
      } else if (!owner.exited && /Scheduled|Started|Succeeded$/.test(event.type)) {
        owner.status = 'RUNNING'
        owner.end = null
      }
    }
    if (owner) owners.set(event.id, owner)
  }
  const terminal = ordered.findLast(event => /^Execution(Succeeded|Failed|TimedOut|Aborted)$/.test(event.type))
  if (terminal) {
    for (const visit of visits.filter(item => !item.exited && item.id <= terminal.id)) {
      if (visit.status === 'RUNNING') visit.status = terminal.type === 'ExecutionSucceeded' ? 'SUCCEEDED' : terminal.type === 'ExecutionTimedOut' ? 'TIMED_OUT' : 'ABORTED'
      visit.end ||= terminal.timestamp
    }
    const owner = owners.get(terminal.previousEventId)
    if (owner && terminal.type === 'ExecutionFailed' && !owner.exited) {
      owner.status = 'FAILED'
      owner.events.push(terminal)
    }
  }
  return { scopes, visits, transitions }
}

export function formatExecutionJson(value) {
  function decode(item, depth = 0) {
    if (depth > 12) return item
    if (typeof item === 'string' && /^[\s]*[\[{]/.test(item)) {
      try { return decode(JSON.parse(item), depth + 1) } catch { return item }
    }
    if (Array.isArray(item)) return item.map(child => decode(child, depth + 1))
    if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).map(([key, child]) => [key, decode(child, depth + 1)]))
    return item
  }
  return JSON.stringify(decode(value), null, 2) ?? ''
}