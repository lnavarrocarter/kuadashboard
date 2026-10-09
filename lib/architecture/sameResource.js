'use strict';
/**
 * lib/architecture/sameResource.js
 * Nodes of one map that are the same resource become one node (#239).
 *
 * Two nodes are the same resource when they share an ARN (an EKS worker node and its EC2 instance,
 * a load balancer discovered by CloudFormation and projected from Observability) or, in Kubernetes,
 * the same context, namespace, kind and name. A name alone never joins two nodes. The node kept is
 * the discovered one before a projection from Observability; it takes the relationships (reviewed
 * ones keep their decision), the place, the evidence and the details the other one had.
 */

const ARN = /^arn:aws[a-z-]*:[a-z0-9-]+:/i;

function identityKeys(node) {
  const keys = [];
  for (const value of [node.arn, node.nativeId]) {
    if (ARN.test(String(value || ''))) keys.push(`arn:${String(value).toLowerCase()}`);
  }
  if (node.provider === 'kubernetes' && node.kubeContext && node.discoveryKey) keys.push(`k8s:${String(node.discoveryKey).toLowerCase()}`);
  return [...new Set(keys)];
}

const reviewed = status => status === 'manual' || status === 'rejected';

function rank(node, edgeCount) {
  return (String(node.id).startsWith('apm-resource:') ? 0 : 4) + (node.manual ? 0 : 2) + (node.registryResourceId ? 1 : 0) + Math.min(edgeCount, 99) / 100;
}

/**
 * Merges in place the nodes of a graph document that are the same resource.
 * @returns [{ targetId, sourceIds }] (empty when nothing changed)
 */
function mergeSameResourceNodes(document) {
  const nodes = document?.nodes || [];
  if (nodes.length < 2) return [];
  // Union-find over shared identity keys.
  const parent = new Map(nodes.map(node => [node.id, node.id]));
  const find = id => { while (parent.get(id) !== id) { parent.set(id, parent.get(parent.get(id))); id = parent.get(id); } return id; };
  const owner = new Map();
  for (const node of nodes) {
    for (const key of identityKeys(node)) {
      if (!owner.has(key)) owner.set(key, node.id);
      else parent.set(find(node.id), find(owner.get(key)));
    }
  }
  const groups = new Map();
  for (const node of nodes) {
    const root = find(node.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(node);
  }
  const edgeCount = new Map();
  for (const edge of document.edges || []) {
    edgeCount.set(edge.sourceNodeId, (edgeCount.get(edge.sourceNodeId) || 0) + 1);
    edgeCount.set(edge.targetNodeId, (edgeCount.get(edge.targetNodeId) || 0) + 1);
  }
  const merges = [];
  const remap = new Map();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const target = group.reduce((best, node) => (rank(node, edgeCount.get(node.id) || 0) > rank(best, edgeCount.get(best.id) || 0) ? node : best));
    const sources = group.filter(node => node !== target);
    for (const source of sources) {
      for (const [key, value] of Object.entries(source)) {
        if (['id', 'hidden', 'manual', 'sourceId', 'registryResourceId'].includes(key)) continue;
        if (target[key] == null || target[key] === '') target[key] = JSON.parse(JSON.stringify(value));
      }
      target.evidence = [...new Map([...(target.evidence || []), ...(source.evidence || [])].map(item => [JSON.stringify(item), item])).values()];
      for (const key of ['labels', 'details']) {
        if (target[key] || source[key]) target[key] = { ...(source[key] || {}), ...(target[key] || {}) };
      }
      remap.set(source.id, target.id);
    }
    // Visible when any copy was visible: hiding one copy never hides the resource.
    if (target.hidden && sources.some(source => !source.hidden)) delete target.hidden;
    if (!document.layout?.[target.id]) {
      const placed = sources.find(source => document.layout?.[source.id]);
      if (placed && document.layout) document.layout[target.id] = document.layout[placed.id];
    }
    merges.push({ targetId: target.id, sourceIds: sources.map(source => source.id) });
  }
  if (!merges.length) return [];

  const resolve = id => remap.get(id) || id;
  const kept = new Map();
  for (const original of document.edges || []) {
    const edge = { ...original, sourceNodeId: resolve(original.sourceNodeId), targetNodeId: resolve(original.targetNodeId) };
    if (edge.sourceNodeId === edge.targetNodeId) continue;
    const key = `${edge.sourceNodeId}\u0000${edge.targetNodeId}\u0000${edge.relationType || ''}`;
    const existing = kept.get(key);
    if (!existing) { kept.set(key, edge); continue; }
    existing.evidence = [...new Map([...(existing.evidence || []), ...(edge.evidence || [])].map(item => [JSON.stringify(item), item])).values()];
    if (reviewed(edge.status) && !reviewed(existing.status)) Object.assign(existing, { status: edge.status, decision: edge.decision });
  }
  document.edges = [...kept.values()];
  document.nodes = nodes.filter(node => !remap.has(node.id));
  if (document.layout) for (const id of remap.keys()) delete document.layout[id];
  if (Array.isArray(document.groups)) {
    document.groups = document.groups.map(group => ({
      ...group,
      nodeIds: Array.isArray(group.nodeIds) ? [...new Set(group.nodeIds.map(resolve))] : group.nodeIds,
    }));
  }
  return merges;
}

module.exports = { identityKeys, mergeSameResourceNodes };
