function hasRelationship(edges, sourceNodeId, targetNodeId, relationType) {
  return edges.some(edge => edge.sourceNodeId === sourceNodeId && edge.targetNodeId === targetNodeId && edge.relationType === relationType)
}

function relationshipSuggestion(source, target, relationType, reason, confidence = 0.55) {
  return {
    id: `graph-advisor:edge:${source.id}:${target.id}:${relationType}`,
    type: 'relationship',
    source,
    target,
    reason,
    operation: {
      type: 'edge.upsert',
      value: {
        id: `graph-advisor:edge:${source.id}:${target.id}:${relationType}`,
        sourceNodeId: source.id,
        targetNodeId: target.id,
        relationType,
        status: 'suggested',
        confidence,
        evidence: [{ type: 'graph_advisor', reason }],
      },
    },
  }
}

function sameScope(left, right, keys) {
  return keys.every(key => left[key] && right[key] && left[key] === right[key])
}

function relationshipSuggestions(nodes, edges) {
  const suggestions = []
  for (const ingress of nodes.filter(node => node.provider === 'kubernetes' && node.resourceType === 'ingress' && node.kubeContext && node.namespace)) {
    if (edges.some(edge => edge.sourceNodeId === ingress.id && edge.relationType === 'routes_to')) continue
    const backendServiceNames = new Set(ingress.details?.backendServiceNames || [])
    if (!backendServiceNames.size) continue
    const services = nodes.filter(node => node.provider === 'kubernetes' && node.resourceType === 'service' && backendServiceNames.has(node.name) &&
      sameScope(ingress, node, ['kubeContext', 'namespace']))
    if (services.length === 1 && !hasRelationship(edges, ingress.id, services[0].id, 'routes_to')) {
      suggestions.push(relationshipSuggestion(ingress, services[0], 'routes_to', 'The Ingress backend explicitly names this Service in the same namespace and Kubernetes context.', 0.95))
    }
  }

  for (const loadBalancer of nodes.filter(node => node.provider === 'aws' && node.resourceType === 'loadbalancer' && node.accountId && node.region)) {
    const loadBalancerArn = String(loadBalancer.arn || '').toLowerCase()
    const targetGroups = nodes.filter(node => node.provider === 'aws' && node.resourceType === 'targetgroup' && loadBalancerArn &&
      (node.details?.loadBalancerArns || []).some(arn => String(arn).toLowerCase() === loadBalancerArn))
    if (targetGroups.length === 1 && !hasRelationship(edges, loadBalancer.id, targetGroups[0].id, 'routes_to')) {
      suggestions.push(relationshipSuggestion(loadBalancer, targetGroups[0], 'routes_to', 'The target group explicitly lists this load balancer ARN.', 0.95))
    }
    const dnsName = String(loadBalancer.details?.dnsName || '').trim().toLowerCase().replace(/\.$/, '')
    if (!dnsName) continue
    for (const node of nodes.filter(item => item.provider === 'kubernetes' && ['ingress', 'service'].includes(item.resourceType))) {
      const hostnames = (node.details?.loadBalancerHostnames || []).map(hostname => String(hostname).trim().toLowerCase().replace(/\.$/, ''))
      if (hostnames.includes(dnsName) && !hasRelationship(edges, loadBalancer.id, node.id, 'routes_to')) {
        suggestions.push(relationshipSuggestion(loadBalancer, node, 'routes_to', 'The Kubernetes load balancer hostname exactly matches the AWS load balancer DNS name.', 0.95))
      }
    }
  }
  return suggestions
}

function compatibleMergeGroup(nodes) {
  if (nodes.length !== 2) return false
  const [left, right] = nodes
  const sameResourceType = left.provider === right.provider && left.resourceType === right.resourceType
  const eksInstancePair = new Set([`${left.provider}:${left.resourceType}`, `${right.provider}:${right.resourceType}`])
  return sameResourceType || (eksInstancePair.has('aws:ec2') && eksInstancePair.has('kubernetes:node'))
}

export function architectureGraphRecommendations(graph = {}) {
  const nodes = graph.document?.nodes || []
  const edges = graph.document?.edges || []
  const recommendations = relationshipSuggestions(nodes, edges)
  const byArn = new Map()

  for (const node of nodes) {
    if (!node.arn) continue
    const key = String(node.arn).toLowerCase()
    const group = byArn.get(key) || []
    group.push(node)
    byArn.set(key, group)
  }

  for (const duplicates of byArn.values()) {
    if (!compatibleMergeGroup(duplicates)) continue
    const target = duplicates.find(node => node.provider === 'aws' && node.resourceType === 'ec2') || duplicates[0]
    const sources = duplicates.filter(node => node.id !== target.id)
    recommendations.push({
      id: `graph-advisor:merge:${target.id}:${sources.map(node => node.id).sort().join(':')}`,
      type: 'deduplicate',
      target,
      sources,
      operation: { type: 'node.merge', value: { targetId: target.id, sourceIds: sources.map(node => node.id) } },
    })
  }

  for (const node of nodes.filter(item => item.syncState === 'stale')) {
    recommendations.push({
      id: `graph-advisor:remove:${node.id}`,
      type: 'remove',
      node,
      operation: { type: 'node.remove', subjectId: node.id },
    })
  }

  if (nodes.length >= 3 && graph.document?.view?.layoutMode !== 'system-domains') {
    recommendations.push({
      id: 'graph-advisor:layout:system-domains',
      type: 'aggregate',
      count: nodes.length,
      operation: { type: 'view.set', value: { layoutMode: 'system-domains' } },
    })
  }

  return recommendations
}