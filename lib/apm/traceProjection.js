'use strict';

const IDENTITY_ATTRIBUTES = ['cloud.resource_id', 'faas.id', 'aws.lambda.invoked_arn', 'aws.ecs.task.arn', 'k8s.pod.uid'];
const CONFIRMED_EDGE_STATES = new Set(['automatic', 'manual', 'confirmed']);

function valuesMatch(left, right) {
  return left != null && right != null && String(left).trim().toLowerCase() === String(right).trim().toLowerCase();
}

function mapGcpResourceToNode(resource, nodes) {
  const project = resource['cloud.account.id'] || resource['gcp.project_id'];
  const platform = String(resource['cloud.platform'] || '').toLowerCase();
  const region = resource['cloud.region'];
  const zone = resource['cloud.availability_zone'];
  let candidates = null;
  if (project && resource['faas.name']) {
    const types = platform.includes('cloud_functions') ? new Set(['gcp-function'])
      : platform.includes('cloud_run') ? new Set(['gcp-cloud-run']) : null;
    if (types) candidates = nodes.filter(node => node.provider === 'gcp' && types.has(node.resourceType)
      && valuesMatch(node.accountId || node.projectId, project) && valuesMatch(node.name, resource['faas.name'])
      && (!region || valuesMatch(node.region || node.location, region)));
  } else if (project && resource['k8s.cluster.name']) {
    candidates = nodes.filter(node => node.provider === 'gcp' && node.resourceType === 'gcp-gke'
      && valuesMatch(node.accountId || node.projectId, project) && valuesMatch(node.name, resource['k8s.cluster.name'])
      && (!(region || zone) || valuesMatch(node.region || node.location, zone || region)));
  } else if (project && platform.includes('compute_engine') && resource['host.id']) {
    candidates = nodes.filter(node => node.provider === 'gcp' && node.resourceType === 'gcp-compute-instance'
      && valuesMatch(node.accountId || node.projectId, project) && valuesMatch(node.instanceId, resource['host.id'])
      && (!zone || valuesMatch(node.region || node.location, zone)));
  }
  if (!candidates) return null;
  if (candidates.length === 1) return { status: 'matched', node: candidates[0], method: 'gcp_resource_identity' };
  if (candidates.length > 1) return { status: 'ambiguous', nodeIds: candidates.map(node => node.id), method: 'gcp_resource_identity' };
  return null;
}

function mapSpanToNode(span, nodes) {
  const identities = IDENTITY_ATTRIBUTES.map(key => span.resource?.[key]).filter(Boolean);
  if (identities.length) {
    const matches = nodes.filter(node => [node.arn, node.nativeId, node.discoveryKey].some(identity => identities.some(value => valuesMatch(identity, value))));
    if (matches.length === 1) return { status: 'matched', node: matches[0], method: 'resource_identity' };
    if (matches.length > 1) return { status: 'ambiguous', nodeIds: matches.map(node => node.id), method: 'resource_identity' };
  }

  if (span.resource?.['cloud.provider'] === 'gcp') {
    const gcpMapping = mapGcpResourceToNode(span.resource, nodes);
    if (gcpMapping) return gcpMapping;
  }

  const namespace = span.resource?.['k8s.namespace.name'];
  const workload = span.resource?.['k8s.deployment.name'] || span.resource?.['k8s.pod.name'];
  if (namespace && workload) {
    const matches = nodes.filter(node => valuesMatch(node.namespace, namespace) && valuesMatch(node.name, workload));
    if (matches.length === 1) return { status: 'matched', node: matches[0], method: 'kubernetes_identity' };
    if (matches.length > 1) return { status: 'ambiguous', nodeIds: matches.map(node => node.id), method: 'kubernetes_identity' };
  }

  const serviceName = span.serviceName;
  const matches = nodes.filter(node => valuesMatch(node.name, serviceName));
  if (matches.length === 1) return { status: 'matched', node: matches[0], method: 'service_name' };
  if (matches.length > 1) return { status: 'ambiguous', nodeIds: matches.map(node => node.id), method: 'service_name' };
  return { status: 'unmatched', method: 'no_architecture_identity' };
}

function databaseTargetForSpan(span, nodes) {
  const attributes = span.attributes || {};
  const system = attributes['db.system.name'];
  if (span.kind !== 3 || typeof system !== 'string') return null;
  const address = attributes['server.address'];
  if (typeof address !== 'string') return { status: 'unmatched', method: 'db_peer_address_missing', system,
    clientCallObserved: true, databaseServerSpanObserved: false };
  const normalizedAddress = address.trim().toLowerCase().replace(/\.$/, '');
  const candidates = nodes.filter(node => {
    const endpoint = node.endpoint && typeof node.endpoint === 'object'
      ? [node.endpoint.address, node.endpoint.Address, node.endpoint.hostname]
      : [node.endpoint];
    const evidenceValues = (node.evidence || []).flatMap(item => Array.isArray(item.values) ? item.values : []);
    const addresses = [...endpoint, ...(Array.isArray(node.endpoints) ? node.endpoints : []), node.address, node.hostname, node.host, node.endpointAddress,
      node.publicAddress, node.privateAddress, node.name, node.nativeId, node.discoveryKey, ...evidenceValues]
      .filter(value => typeof value === 'string')
      .map(value => value.trim().toLowerCase().replace(/\.$/, ''));
    return addresses.includes(normalizedAddress);
  });
  if (candidates.length === 1) return {
    status: 'matched', method: 'database_peer_address', system,
    node: publicNode(candidates[0]), clientCallObserved: true, databaseServerSpanObserved: false,
  };
  return { status: candidates.length > 1 ? 'ambiguous' : 'unmatched', method: 'database_peer_address', system,
    nodeIds: candidates.map(node => node.id), clientCallObserved: true, databaseServerSpanObserved: false };
}

function shortestInventoryPath(graph, fromId, toId) {
  if (fromId === toId) return { status: 'unique', nodes: [fromId], edges: [] };
  const adjacency = new Map((graph.document.nodes || []).map(node => [node.id, []]));
  for (const edge of graph.document.edges || []) {
    if (!CONFIRMED_EDGE_STATES.has(edge.status)) continue;
    if (!adjacency.has(edge.sourceNodeId) || !adjacency.has(edge.targetNodeId)) continue;
    adjacency.get(edge.sourceNodeId).push({ nodeId: edge.targetNodeId, edge, traversal: 'source_to_target' });
    adjacency.get(edge.targetNodeId).push({ nodeId: edge.sourceNodeId, edge, traversal: 'target_to_source' });
  }
  const queue = [{ nodeId: fromId, nodes: [fromId], edges: [] }];
  const candidates = [];
  let shortestLength = Infinity;
  while (queue.length && candidates.length < 2) {
    const current = queue.shift();
    if (current.edges.length >= shortestLength) continue;
    for (const step of adjacency.get(current.nodeId) || []) {
      if (current.nodes.includes(step.nodeId)) continue;
      const path = { nodeId: step.nodeId, nodes: [...current.nodes, step.nodeId], edges: [...current.edges, step] };
      if (step.nodeId === toId) {
        shortestLength = path.edges.length;
        candidates.push(path);
      } else if (path.edges.length < shortestLength) queue.push(path);
    }
  }
  if (!candidates.length) return { status: 'missing' };
  if (candidates.length > 1) return { status: 'ambiguous' };
  return { status: 'unique', nodes: candidates[0].nodes, edges: candidates[0].edges };
}

function publicNode(node) {
  return {
    id: node.id, name: node.name, provider: node.provider || '', resourceType: node.resourceType || '',
    kind: node.kind || '', namespace: node.namespace || '',
    evidence: (node.evidence || []).map(item => ({ type: item.type || '', sourceId: item.sourceId || '' })),
  };
}

function normalizedPeerAddress(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return null;
  try { if (/^https?:\/\//i.test(text)) return new URL(text).hostname.toLowerCase().replace(/\.$/, ''); } catch { return null; }
  return text.toLowerCase().replace(/\.$/, '');
}

function peerTargetForSpan(span, nodes) {
  if (span.kind !== 3) return null;
  const address = normalizedPeerAddress(span.attributes?.['server.address']);
  if (!address) return { status: 'unmatched', method: 'peer_address_missing', clientCallObserved: true };
  const candidates = nodes.filter(node => {
    const endpoint = node.endpoint && typeof node.endpoint === 'object'
      ? [node.endpoint.address, node.endpoint.Address, node.endpoint.hostname]
      : [node.endpoint];
    const addresses = [...endpoint, ...(Array.isArray(node.endpoints) ? node.endpoints : []), node.address,
      node.hostname, node.host, node.uri, node.publicAddress, node.privateAddress]
      .map(normalizedPeerAddress).filter(Boolean);
    return addresses.includes(address);
  });
  if (candidates.length === 1) return {
    status: 'matched', method: 'peer_endpoint', node: publicNode(candidates[0]), clientCallObserved: true,
  };
  return { status: candidates.length > 1 ? 'ambiguous' : 'unmatched', method: 'peer_endpoint',
    nodeIds: candidates.map(node => node.id), clientCallObserved: true };
}

function projectTraceToArchitecture(trace, project, graph) {
  const nodes = graph?.document?.nodes || [];
  const spans = trace.spans.map(span => {
    const mapping = mapSpanToNode(span, nodes);
    const peerTarget = peerTargetForSpan(span, nodes);
    const databaseTarget = databaseTargetForSpan(span, nodes);
    return {
      traceId: span.traceId, spanId: span.spanId, parentSpanId: span.parentSpanId || null,
      serviceName: span.serviceName, operation: span.name, kind: span.kind,
      statusCode: span.statusCode, startTime: span.startTime, endTime: span.endTime,
      architecture: mapping.status === 'matched'
        ? { status: mapping.status, method: mapping.method, node: publicNode(mapping.node) }
        : { status: mapping.status, method: mapping.method, nodeIds: mapping.nodeIds || [] },
      peerTarget,
      databaseTarget,
    };
  });
  const spanById = new Map(spans.map(span => [span.spanId, span]));
  const segments = [];
  const gaps = [];
  for (const child of spans) {
    if (!child.parentSpanId) continue;
    const parent = spanById.get(child.parentSpanId);
    if (!parent) {
      gaps.push({ fromSpanId: child.parentSpanId, toSpanId: child.spanId, reason: 'parent_span_missing' });
      segments.push({ fromSpanId: child.parentSpanId, toSpanId: child.spanId, status: 'partial', reason: 'parent_span_missing' });
      continue;
    }
    if (parent.architecture.status !== 'matched' || child.architecture.status !== 'matched') {
      const reason = parent.architecture.status !== 'matched' ? 'parent_resource_unmapped' : 'child_resource_unmapped';
      gaps.push({ fromSpanId: parent.spanId, toSpanId: child.spanId, reason });
      segments.push({ fromSpanId: parent.spanId, toSpanId: child.spanId, status: 'partial', reason });
      continue;
    }
    // A traced client span may identify the public endpoint even when no server
    // span is emitted by the load balancer. Start the configured topology path
    // at that exact inventory match so the gateway and backend stay visible.
    const peerNode = parent.peerTarget?.status === 'matched' ? parent.peerTarget.node : null;
    const pathStart = peerNode?.id || parent.architecture.node.id;
    const path = shortestInventoryPath(graph, pathStart, child.architecture.node.id);
    if (path.status !== 'unique') {
      const reason = path.status === 'ambiguous' ? 'architecture_path_ambiguous' : 'architecture_path_missing';
      gaps.push({ fromSpanId: parent.spanId, toSpanId: child.spanId, reason });
      segments.push({ fromSpanId: parent.spanId, toSpanId: child.spanId, status: 'unknown', reason });
      continue;
    }
    const inventoryNodeIds = [...(peerNode && peerNode.id !== child.architecture.node.id ? [peerNode.id] : []), ...path.nodes.slice(1, -1)];
    const inventoryNodes = [...new Set(inventoryNodeIds)].map(id => publicNode(nodes.find(node => node.id === id)));
    const inventoryEdges = path.edges.map(({ edge, traversal }) => ({
      id: edge.id, relationType: edge.relationType || 'related_to', status: edge.status,
      traversal, observedSpan: false,
      evidence: (edge.evidence || []).map(item => ({ type: item.type || '', sourceId: item.sourceId || '' })),
    }));
    const status = inventoryNodes.length ? 'partial' : 'observed';
    if (status === 'partial') gaps.push({ fromSpanId: parent.spanId, toSpanId: child.spanId, reason: 'unobserved_architecture_hops', nodeIds: inventoryNodes.map(node => node.id) });
    segments.push({ fromSpanId: parent.spanId, toSpanId: child.spanId, status,
      observedRelationship: 'parent_child_span', inventoryNodes, inventoryEdges });
  }
  const causalLinks = trace.links.map(link => ({ sourceTraceId: link.linkedTraceId, sourceSpanId: link.linkedSpanId,
    targetTraceId: link.traceId, targetSpanId: link.spanId,
    sourceAvailable: link.linkedTraceId === trace.traceId && spanById.has(link.linkedSpanId),
    targetAvailable: link.traceId === trace.traceId && spanById.has(link.spanId) }));
  for (const link of causalLinks) {
    if (!link.sourceAvailable || !link.targetAvailable
      || !spanById.has(link.sourceSpanId) || !spanById.has(link.targetSpanId)
      || segments.some(segment => segment.fromSpanId === link.sourceSpanId && segment.toSpanId === link.targetSpanId)) continue;
    const source = spanById.get(link.sourceSpanId);
    const target = spanById.get(link.targetSpanId);
    if (source.architecture.status !== 'matched' || target.architecture.status !== 'matched') {
      const reason = source.architecture.status !== 'matched' ? 'parent_resource_unmapped' : 'child_resource_unmapped';
      gaps.push({ fromSpanId: source.spanId, toSpanId: target.spanId, reason });
      segments.push({ fromSpanId: source.spanId, toSpanId: target.spanId, status: 'partial', reason, observedRelationship: 'span_link' });
      continue;
    }
    const path = shortestInventoryPath(graph, source.architecture.node.id, target.architecture.node.id);
    if (path.status !== 'unique') {
      const reason = path.status === 'ambiguous' ? 'architecture_path_ambiguous' : 'architecture_path_missing';
      gaps.push({ fromSpanId: source.spanId, toSpanId: target.spanId, reason });
      segments.push({ fromSpanId: source.spanId, toSpanId: target.spanId, status: 'unknown', reason, observedRelationship: 'span_link' });
      continue;
    }
    const inventoryNodes = path.nodes.slice(1, -1).map(id => publicNode(nodes.find(node => node.id === id)));
    const inventoryEdges = path.edges.map(({ edge, traversal }) => ({
      id: edge.id, relationType: edge.relationType || 'related_to', status: edge.status,
      traversal, observedSpan: false,
      evidence: (edge.evidence || []).map(item => ({ type: item.type || '', sourceId: item.sourceId || '' })),
    }));
    const status = inventoryNodes.length ? 'partial' : 'observed';
    if (status === 'partial') gaps.push({ fromSpanId: source.spanId, toSpanId: target.spanId, reason: 'unobserved_architecture_hops', nodeIds: inventoryNodes.map(node => node.id) });
    segments.push({ fromSpanId: source.spanId, toSpanId: target.spanId, status,
      observedRelationship: 'span_link', inventoryNodes, inventoryEdges });
  }
  for (const span of spans) {
    if (span.architecture.status !== 'matched') gaps.push({ spanId: span.spanId, reason: span.architecture.status === 'ambiguous' ? 'resource_mapping_ambiguous' : 'resource_unmapped' });
    if (span.peerTarget?.clientCallObserved && !span.databaseTarget?.clientCallObserved && span.peerTarget.status !== 'matched') {
      const reason = span.peerTarget.status === 'ambiguous' ? 'client_peer_ambiguous'
        : span.peerTarget.method === 'peer_address_missing' ? 'client_peer_address_missing' : 'client_peer_unmapped';
      gaps.push({ spanId: span.spanId, reason, nodeIds: span.peerTarget.nodeIds || [] });
    }
    if (span.databaseTarget?.clientCallObserved) {
      const reason = span.databaseTarget.status === 'matched' ? 'database_server_span_unobserved'
        : span.databaseTarget.status === 'ambiguous' ? 'database_peer_ambiguous' : 'database_peer_unmapped';
      gaps.push({ spanId: span.spanId, reason, nodeIds: span.databaseTarget.node?.id ? [span.databaseTarget.node.id] : span.databaseTarget.nodeIds || [] });
    }
  }
  if (trace.truncated) gaps.push({ reason: 'trace_data_truncated' });
  const spanAdjacency = new Map(spans.map(span => [span.spanId, []]));
  const spanTargets = new Set();
  for (const segment of segments) {
    if (!spanAdjacency.has(segment.fromSpanId) || !spanAdjacency.has(segment.toSpanId)) continue;
    spanAdjacency.get(segment.fromSpanId).push(segment.toSpanId);
    spanTargets.add(segment.toSpanId);
  }
  const roots = spans.filter(span => !spanTargets.has(span.spanId));
  const visited = new Set();
  const pending = roots.length === 1 ? [roots[0].spanId] : [];
  while (pending.length) {
    const spanId = pending.pop();
    if (visited.has(spanId)) continue;
    visited.add(spanId);
    pending.push(...(spanAdjacency.get(spanId) || []));
  }
  const fullyObserved = spans.length > 1 && roots.length === 1 && visited.size === spans.length
    && segments.length === spans.length - 1 && !trace.truncated
    && spans.every(span => span.architecture.status === 'matched')
    && spans.every(span => !span.databaseTarget?.clientCallObserved)
    && spans.every(span => !span.peerTarget?.clientCallObserved || span.peerTarget.status === 'matched')
    && segments.every(segment => segment.status === 'observed');
  return {
    traceId: trace.traceId,
    project: { id: project.id, name: project.name, profileId: project.profileId },
    coverage: fullyObserved ? 'observed' : 'partial',
    truncated: !!trace.truncated,
    coverageMeaning: 'Coverage describes received spans and confirmed Architecture links for this trace. Inventory edges do not claim a component emitted a span.',
    spans, segments, causalLinks, gaps,
  };
}

module.exports = { databaseTargetForSpan, mapGcpResourceToNode, mapSpanToNode, peerTargetForSpan, projectTraceToArchitecture, shortestInventoryPath };
