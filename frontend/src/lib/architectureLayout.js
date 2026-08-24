const layoutCollator = new Intl.Collator('en', { sensitivity: 'base', numeric: true })

function compareNodes(left, right) {
  return layoutCollator.compare(left.name || left.label || left.id, right.name || right.label || right.id)
}

function orderLayers(layers, incoming, outgoing) {
  const ordered = [...layers.entries()].sort(([left], [right]) => left - right)
  const positions = () => new Map(ordered.flatMap(([, nodes]) =>
    nodes.map((node, index) => [node.id, nodes.length === 1 ? 0.5 : index / (nodes.length - 1)])))
  const sortByNeighbors = (nodes, neighbors, indexes) => nodes.sort((left, right) => {
    const score = node => {
      const values = neighbors.get(node.id).map(id => indexes.get(id)).filter(value => value != null)
      return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : Number.POSITIVE_INFINITY
    }
    return score(left) - score(right) || compareNodes(left, right)
  })

  for (let pass = 0; pass < 2; pass += 1) {
    let indexes = positions()
    for (let index = 1; index < ordered.length; index += 1) {
      sortByNeighbors(ordered[index][1], incoming, indexes)
      indexes = positions()
    }
    for (let index = ordered.length - 2; index >= 0; index -= 1) {
      sortByNeighbors(ordered[index][1], outgoing, indexes)
      indexes = positions()
    }
  }
  return ordered
}

export function requestFlowLayout(document = {}, direction = 'horizontal') {
  const nodes = [...(document.nodes || [])].sort(compareNodes)
  const nodeIds = new Set(nodes.map(node => node.id))
  const edges = (document.edges || []).filter(edge =>
    edge.status !== 'rejected' && nodeIds.has(edge.sourceNodeId) && nodeIds.has(edge.targetNodeId))
  const outgoing = new Map(nodes.map(node => [node.id, []]))
  const incoming = new Map(nodes.map(node => [node.id, []]))
  const indegree = new Map(nodes.map(node => [node.id, 0]))
  const depth = new Map(nodes.map(node => [node.id, 0]))

  for (const edge of edges) {
    outgoing.get(edge.sourceNodeId).push(edge.targetNodeId)
    incoming.get(edge.targetNodeId).push(edge.sourceNodeId)
    indegree.set(edge.targetNodeId, indegree.get(edge.targetNodeId) + 1)
  }

  const queue = nodes.filter(node => indegree.get(node.id) === 0)
  const processed = new Set()
  while (queue.length) {
    queue.sort(compareNodes)
    const node = queue.shift()
    processed.add(node.id)
    for (const targetId of outgoing.get(node.id)) {
      depth.set(targetId, Math.max(depth.get(targetId), depth.get(node.id) + 1))
      indegree.set(targetId, indegree.get(targetId) - 1)
      if (indegree.get(targetId) === 0) queue.push(nodes.find(item => item.id === targetId))
    }
  }

  for (const node of nodes.filter(item => !processed.has(item.id))) {
    const knownParents = incoming.get(node.id).filter(parentId => processed.has(parentId))
    depth.set(node.id, knownParents.length
      ? Math.max(...knownParents.map(parentId => depth.get(parentId) + 1))
      : 0)
  }

  const layers = new Map()
  for (const node of nodes) {
    const level = depth.get(node.id)
    if (!layers.has(level)) layers.set(level, [])
    layers.get(level).push(node)
  }

  const layout = {}
  for (const [level, layerNodes] of orderLayers(layers, incoming, outgoing)) {
    layerNodes.forEach((node, index) => {
      layout[node.id] = direction === 'vertical'
        ? { x: 80 + index * 240, y: 70 + level * 150 }
        : { x: 80 + level * 280, y: 70 + index * 130 }
    })
  }
  return layout
}

export function resourceTypeLayout(document = {}) {
  const groups = new Map()
  for (const node of [...(document.nodes || [])].sort(compareNodes)) {
    const type = node.resourceType || 'service'
    if (!groups.has(type)) groups.set(type, [])
    groups.get(type).push(node)
  }

  const layout = {}
  const sections = []
  let sectionY = 50
  for (const [type, nodes] of [...groups.entries()].sort(([left], [right]) => layoutCollator.compare(left, right))) {
    const columns = Math.min(8, Math.max(1, nodes.length))
    const rows = Math.ceil(nodes.length / columns)
    const width = Math.max(260, 80 + columns * 220)
    const height = 70 + rows * 120
    nodes.forEach((node, index) => {
      layout[node.id] = {
        x: 100 + (index % columns) * 220,
        y: sectionY + 48 + Math.floor(index / columns) * 120,
      }
    })
    sections.push({ type, count: nodes.length, x: 60, y: sectionY, width, height })
    sectionY += height + 36
  }
  return { layout, sections }
}