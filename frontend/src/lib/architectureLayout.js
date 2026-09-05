const layoutCollator = new Intl.Collator('en', { sensitivity: 'base', numeric: true })

function compareNodes(left, right) {
  return layoutCollator.compare(left.name || left.label || left.id, right.name || right.label || right.id)
}

const PROVIDER_ORDER = ['aws', 'kubernetes', 'gcp', 'vercel', 'generic']

const RESOURCE_STAGE = {
  eventbridge: 0,
  apigateway: 0,
  apigatewayv2: 0,
  'api-route': 0,
  ingress: 0,
  sqs: 1,
  sns: 1,
  service: 1,
  lambda: 2,
  stepfunctions: 2,
  ecs: 2,
  ec2: 2,
  eks: 2,
  deployment: 2,
  statefulset: 2,
  daemonset: 2,
  pod: 3,
  node: 4,
  s3: 5,
  dynamodb: 5,
  rds: 5,
  elasticache: 5,
  configmap: 6,
  secret: 6,
  pvc: 6,
  iam: 7,
  'iam-policy': 7,
  policy: 7,
}

function nodeProvider(node) {
  if (node.provider) return node.provider
  const type = node.resourceType || ''
  if (['deployment', 'statefulset', 'daemonset', 'pod', 'service', 'ingress', 'configmap', 'secret', 'pvc', 'node'].includes(type)) return 'kubernetes'
  if (type.startsWith('gcp-')) return 'gcp'
  if (type.startsWith('vercel-')) return 'vercel'
  return 'aws'
}

function providerLabel(provider) {
  return { aws: 'AWS', kubernetes: 'Kubernetes', gcp: 'GCP', vercel: 'Vercel', generic: 'General' }[provider] || provider
}

function compareProviders(left, right) {
  const leftIndex = PROVIDER_ORDER.includes(left) ? PROVIDER_ORDER.indexOf(left) : PROVIDER_ORDER.length
  const rightIndex = PROVIDER_ORDER.includes(right) ? PROVIDER_ORDER.indexOf(right) : PROVIDER_ORDER.length
  return leftIndex - rightIndex || layoutCollator.compare(left, right)
}

function resourceStage(node) {
  return RESOURCE_STAGE[node.resourceType] ?? 8
}

function compareResourceTypes(left, right) {
  return resourceStage({ resourceType: left }) - resourceStage({ resourceType: right }) || layoutCollator.compare(left, right)
}

function layoutSpacing(options = {}) {
  return {
    requestXGap: options.requestXGap || 280,
    requestYGap: options.requestYGap || 130,
    requestVerticalXGap: options.requestVerticalXGap || 240,
    requestVerticalYGap: options.requestVerticalYGap || 150,
    gridXGap: options.gridXGap || 220,
    gridYGap: options.gridYGap || 120,
    laneXGap: options.laneXGap || 240,
    laneYGap: options.laneYGap || 122,
    providerResourceXGap: options.providerResourceXGap || 220,
    providerResourceYGap: options.providerResourceYGap || 120,
  }
}

function relationIndexes(document = {}) {
  const nodesById = new Map((document.nodes || []).map(node => [node.id, node]))
  const incoming = new Map()
  const outgoing = new Map()
  for (const edge of document.edges || []) {
    if (edge.status === 'rejected') continue
    const source = nodesById.get(edge.sourceNodeId)
    const target = nodesById.get(edge.targetNodeId)
    if (!source || !target) continue
    if (!incoming.has(target.id)) incoming.set(target.id, [])
    if (!outgoing.has(source.id)) outgoing.set(source.id, [])
    incoming.get(target.id).push(source.name || source.label || source.id)
    outgoing.get(source.id).push(target.name || target.label || target.id)
  }
  return { incoming, outgoing }
}

function compareByRelationships(indexes) {
  const key = node => [indexes.incoming.get(node.id)?.sort()[0], indexes.outgoing.get(node.id)?.sort()[0], node.name || node.label || node.id]
    .filter(Boolean).join(' / ')
  return (left, right) => layoutCollator.compare(key(left), key(right)) || compareNodes(left, right)
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

export function requestFlowLayout(document = {}, direction = 'horizontal', options = {}) {
  const spacing = layoutSpacing(options)
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
        ? { x: 80 + index * spacing.requestVerticalXGap, y: 70 + level * spacing.requestVerticalYGap }
        : { x: 80 + level * spacing.requestXGap, y: 70 + index * spacing.requestYGap }
    })
  }
  return layout
}

export function resourceTypeLayout(document = {}, options = {}) {
  const spacing = layoutSpacing(options)
  const relationshipSort = compareByRelationships(relationIndexes(document))
  const groups = new Map()
  for (const node of [...(document.nodes || [])].sort(relationshipSort)) {
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
    const width = Math.max(260, 80 + columns * spacing.gridXGap)
    const height = 70 + rows * spacing.gridYGap
    nodes.forEach((node, index) => {
      layout[node.id] = {
        x: 100 + (index % columns) * spacing.gridXGap,
        y: sectionY + 48 + Math.floor(index / columns) * spacing.gridYGap,
      }
    })
    sections.push({ type, count: nodes.length, x: 60, y: sectionY, width, height })
    sectionY += height + 36
  }
  return { layout, sections }
}

export function providerLaneLayout(document = {}, options = {}) {
  const spacing = layoutSpacing(options)
  const relationshipSort = compareByRelationships(relationIndexes(document))
  const groups = new Map()
  for (const node of [...(document.nodes || [])].sort((left, right) =>
    resourceStage(left) - resourceStage(right) || layoutCollator.compare(left.resourceType || '', right.resourceType || '') || relationshipSort(left, right))) {
    const provider = nodeProvider(node)
    if (!groups.has(provider)) groups.set(provider, [])
    groups.get(provider).push(node)
  }

  const layout = {}
  const sections = []
  let sectionY = 50
  for (const provider of [...groups.keys()].sort(compareProviders)) {
    const nodes = groups.get(provider)
    const stageGroups = new Map()
    for (const node of nodes) {
      const stage = resourceStage(node)
      if (!stageGroups.has(stage)) stageGroups.set(stage, [])
      stageGroups.get(stage).push(node)
    }
    const stages = [...stageGroups.keys()].sort((left, right) => left - right)
    const columnsByStage = new Map(stages.map(stage => [stage, Math.min(3, Math.max(1, Math.ceil(stageGroups.get(stage).length / 8)))]))
    const offsets = new Map()
    let columnOffset = 0
    for (const stage of stages) {
      offsets.set(stage, columnOffset)
      columnOffset += columnsByStage.get(stage)
    }
    let maxRows = 1
    for (const stage of stages) {
      const rows = Math.ceil(stageGroups.get(stage).length / columnsByStage.get(stage))
      maxRows = Math.max(maxRows, rows)
    }
    const width = Math.max(360, 120 + columnOffset * spacing.laneXGap)
    const height = 86 + maxRows * spacing.laneYGap
    for (const stage of stages) {
      const stageNodes = stageGroups.get(stage)
      const columns = columnsByStage.get(stage)
      const xOffset = offsets.get(stage)
      stageNodes.forEach((node, index) => {
        layout[node.id] = {
          x: 100 + (xOffset + (index % columns)) * spacing.laneXGap,
          y: sectionY + 56 + Math.floor(index / columns) * spacing.laneYGap,
        }
      })
    }
    sections.push({ type: `provider:${provider}`, resourceType: provider, label: providerLabel(provider), count: nodes.length, x: 60, y: sectionY, width, height })
    sectionY += height + 38
  }
  return { layout, sections }
}

export function providerResourceLayout(document = {}, options = {}) {
  const spacing = layoutSpacing(options)
  const relationshipSort = compareByRelationships(relationIndexes(document))
  const providers = new Map()
  for (const node of [...(document.nodes || [])].sort(relationshipSort)) {
    const provider = nodeProvider(node)
    const type = node.resourceType || 'service'
    if (!providers.has(provider)) providers.set(provider, new Map())
    const providerGroups = providers.get(provider)
    if (!providerGroups.has(type)) providerGroups.set(type, [])
    providerGroups.get(type).push(node)
  }

  const layout = {}
  const sections = []
  let sectionY = 50
  for (const provider of [...providers.keys()].sort(compareProviders)) {
    const providerGroups = providers.get(provider)
    const orderedTypes = [...providerGroups.keys()].sort(compareResourceTypes)
    const providerStartY = sectionY
    let providerWidth = 360
    let providerCount = 0
    const providerSections = []

    for (const type of orderedTypes) {
      const nodes = providerGroups.get(type)
      providerCount += nodes.length
      const columns = Math.min(6, Math.max(1, nodes.length))
      const rows = Math.ceil(nodes.length / columns)
      const width = Math.max(300, 86 + columns * spacing.providerResourceXGap)
      const height = 76 + rows * spacing.providerResourceYGap
      providerWidth = Math.max(providerWidth, width + 40)
      nodes.forEach((node, index) => {
        layout[node.id] = {
          x: 120 + (index % columns) * spacing.providerResourceXGap,
          y: sectionY + 52 + Math.floor(index / columns) * spacing.providerResourceYGap,
        }
      })
      providerSections.push({
        type: `provider-resource:${provider}:${type}`,
        provider,
        resourceType: type,
        count: nodes.length,
        x: 80,
        y: sectionY,
        width,
        height,
      })
      sectionY += height + 18
    }

    sections.push({
      type: `provider:${provider}`,
      resourceType: provider,
      label: providerLabel(provider),
      count: providerCount,
      x: 60,
      y: providerStartY - 18,
      width: providerWidth,
      height: sectionY - providerStartY + 8,
      zIndex: -2,
    }, ...providerSections)
    sectionY += 34
  }
  return { layout, sections }
}