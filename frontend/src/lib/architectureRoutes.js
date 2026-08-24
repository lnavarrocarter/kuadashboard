function parseEventPattern(value) {
  if (!value) return null
  if (typeof value === 'object') return value
  try { return JSON.parse(value) } catch { return null }
}

function eventConfig(edges) {
  const evidence = edges
    .flatMap(edge => edge.evidence || [])
    .find(item => item.type === 'eventbridge_target')
  if (!evidence) return null
  return {
    eventBus: evidence.eventBus || 'default',
    eventPattern: parseEventPattern(evidence.eventPattern),
    scheduleExpression: evidence.scheduleExpression || '',
    description: evidence.description || '',
  }
}

function enumeratePaths(rootId, outgoing, trail = [], depth = 0) {
  const path = [...trail, rootId]
  if (depth >= 12) return [{ nodeIds: path, edgeIds: [] }]
  const edges = (outgoing.get(rootId) || []).filter(edge => !path.includes(edge.targetNodeId))
  if (!edges.length) return [{ nodeIds: path, edgeIds: [] }]
  return edges.flatMap(edge => enumeratePaths(edge.targetNodeId, outgoing, path, depth + 1)
    .map(next => ({ nodeIds: next.nodeIds, edgeIds: [edge.id, ...next.edgeIds] })))
}

export function architectureRouteGroups(document = {}) {
  const nodes = document.nodes || []
  const edges = (document.edges || []).filter(edge => edge.status !== 'rejected')
  const nodesById = new Map(nodes.map(node => [node.id, node]))
  const outgoing = new Map(nodes.map(node => [node.id, []]))
  const incoming = new Map(nodes.map(node => [node.id, 0]))
  for (const edge of edges) {
    outgoing.get(edge.sourceNodeId)?.push(edge)
    incoming.set(edge.targetNodeId, (incoming.get(edge.targetNodeId) || 0) + 1)
  }
  const roots = nodes.filter(node =>
    node.resourceType === 'eventbridge' ||
    (node.resourceType === 'stepfunctions' && incoming.get(node.id) === 0))
  return roots.map(root => {
    const rootEdges = outgoing.get(root.id) || []
    const paths = enumeratePaths(root.id, outgoing).map(path => ({
      id: path.nodeIds.join('>'),
      nodes: path.nodeIds.map(id => nodesById.get(id)).filter(Boolean),
      relations: path.edgeIds.map(id => edges.find(edge => edge.id === id)).filter(Boolean),
    }))
    return {
      id: root.id,
      name: root.name,
      type: root.resourceType,
      config: root.resourceType === 'eventbridge' ? eventConfig(rootEdges) : null,
      paths,
    }
  })
}
