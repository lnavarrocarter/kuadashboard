'use strict';

const { normalizeGraph } = require('./graphModel');

const COLLECTIONS = Object.freeze({
  scope: 'scopes',
  source: 'sources',
  node: 'nodes',
  edge: 'edges',
  group: 'groups',
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = stableValue(value[key]);
    return result;
  }, {});
}

function sameValue(left, right) {
  return JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right));
}

function requiredId(value, field = 'id') {
  const id = String(value || '').trim();
  if (!id) throw Object.assign(new Error(`${field} is required`), { statusCode: 400 });
  return id;
}

function requiredRevision(value) {
  if (!Number.isInteger(value) || value < 0) {
    throw Object.assign(new Error('expectedRevision must be a non-negative integer'), { statusCode: 400 });
  }
  return value;
}

function upsert(collection, value) {
  const id = requiredId(value?.id);
  const index = collection.findIndex(item => item.id === id);
  if (index === -1) collection.push({ ...value, id });
  else collection[index] = { ...collection[index], ...value, id };
}

function removeById(collection, id) {
  const index = collection.findIndex(item => item.id === id);
  if (index === -1) throw Object.assign(new Error(`Graph subject not found: ${id}`), { statusCode: 404 });
  return collection.splice(index, 1)[0];
}

function discoveryIdentityKeys(node) {
  const scope = [node.provider, node.accountId, node.region].map(value => String(value || '').toLowerCase()).join(':');
  const kind = String(node.kind || node.resourceType || '').toLowerCase();
  const keys = [];
  if (node.arn) keys.push(`arn:${String(node.arn).toLowerCase()}`);
  if (node.nativeId) keys.push(`native:${scope}:${kind}:${String(node.nativeId).toLowerCase()}`);
  if (node.discoveryKey) keys.push(`discovery:${scope}:${kind}:${String(node.discoveryKey).toLowerCase()}`);
  if (node.stackName && node.logicalId) {
    keys.push(`logical:${scope}:${String(node.stackName).toLowerCase()}:${kind}:${String(node.logicalId).toLowerCase()}`);
  }
  return keys;
}

function reviewedEdgeStatus(status) {
  return status === 'manual' || status === 'rejected';
}

// Evidence read straight from a resource's own declaration (an Ingress naming its Service, a
// selector, a scheduled node) is a fact, not a guess: asking a human to confirm it is busywork.
// Anything inferred from naming or heuristics stays below this and still needs review.
const DECLARATIVE_CONFIDENCE = 0.95;

function autoConfirmDeclarativeEdges(edges = []) {
  return edges.map(edge => (edge.status === 'suggested' && Number(edge.confidence) >= DECLARATIVE_CONFIDENCE
    ? { ...edge, status: 'automatic' }
    : edge));
}

function reconcileDiscoveryImport(graph, value) {
  const existingByIdentity = new Map();
  for (const node of graph.nodes) {
    for (const key of discoveryIdentityKeys(node)) {
      const matches = existingByIdentity.get(key) || [];
      matches.push(node);
      existingByIdentity.set(key, matches);
    }
  }
  const remappedIds = new Map();
  const duplicateIds = new Map();
  const nodes = value.nodes.map(node => {
    const matches = [...new Map(discoveryIdentityKeys(node)
      .flatMap(key => existingByIdentity.get(key) || [])
      .map(item => [item.id, item])).values()];
    const primary = matches.find(item => item.id === node.id) || matches[0];
    if (!primary) return node;
    remappedIds.set(node.id, primary.id);
    for (const match of matches) {
      if (match.id !== primary.id) duplicateIds.set(match.id, primary.id);
    }
    return { ...primary, ...node, id: primary.id };
  });
  if (!remappedIds.size && !duplicateIds.size) return value;

  const resolveId = id => {
    let current = remappedIds.get(id) || duplicateIds.get(id) || id;
    while (duplicateIds.has(current)) current = duplicateIds.get(current);
    return current;
  };
  graph.nodes = graph.nodes.filter(node => !duplicateIds.has(node.id));
  graph.layout = Object.entries(graph.layout).reduce((layout, [id, position]) => {
    const nextId = resolveId(id);
    if (!layout[nextId]) layout[nextId] = position;
    return layout;
  }, {});
  graph.groups = graph.groups.map(group => ({
    ...group,
    nodeIds: Array.isArray(group.nodeIds) ? [...new Set(group.nodeIds.map(resolveId))] : group.nodeIds,
  }));

  const edgesByRelation = new Map();
  graph.edges = graph.edges.flatMap(edge => {
    const remapped = { ...edge, sourceNodeId: resolveId(edge.sourceNodeId), targetNodeId: resolveId(edge.targetNodeId) };
    if (remapped.sourceNodeId === remapped.targetNodeId) return [];
    const key = `${remapped.sourceNodeId}:${remapped.targetNodeId}:${remapped.relationType}`;
    const existing = edgesByRelation.get(key);
    if (!existing) {
      edgesByRelation.set(key, remapped);
      return [remapped];
    }
    if (reviewedEdgeStatus(remapped.status) && !reviewedEdgeStatus(existing.status)) Object.assign(existing, remapped);
    return [];
  });
  const edges = value.edges.map(edge => {
    const remapped = { ...edge, sourceNodeId: resolveId(edge.sourceNodeId), targetNodeId: resolveId(edge.targetNodeId) };
    const existing = edgesByRelation.get(`${remapped.sourceNodeId}:${remapped.targetNodeId}:${remapped.relationType}`);
    return reviewedEdgeStatus(existing?.status) ? { ...remapped, id: existing.id, status: existing.status, decision: existing.decision } : remapped;
  });
  return { ...value, nodes, edges };
}

function retireDiscoveryNodes(graph, value) {
  const retiredKinds = new Set(value.retiredNodeKinds || []);
  const sourceIds = new Set((value.sources || []).map(source => source.id));
  if (!retiredKinds.size || !sourceIds.size) return;
  const removedIds = new Set(graph.nodes
    .filter(node => retiredKinds.has(node.kind) && sourceIds.has(node.sourceId))
    .map(node => node.id));
  if (!removedIds.size) return;
  graph.nodes = graph.nodes.filter(node => !removedIds.has(node.id));
  graph.edges = graph.edges.filter(edge => !removedIds.has(edge.sourceNodeId) && !removedIds.has(edge.targetNodeId));
  graph.groups = graph.groups.map(group => ({
    ...group,
    nodeIds: Array.isArray(group.nodeIds) ? group.nodeIds.filter(nodeId => !removedIds.has(nodeId)) : group.nodeIds,
  }));
  for (const nodeId of removedIds) delete graph.layout[nodeId];
}

function reconcileDiscoverySync(graph, value) {
  const sourceIds = new Set((value.sources || []).map(source => source.id));
  value = reconcileDiscoveryImport(graph, value);
  value = { ...value, edges: autoConfirmDeclarativeEdges(value.edges) };
  const discoveredIds = new Set((value.nodes || []).map(node => node.id));
  for (const node of graph.nodes) {
    if (node.manual || !sourceIds.has(node.sourceId)) continue;
    if (discoveredIds.has(node.id)) {
      delete node.syncState;
      delete node.staleAt;
      continue;
    }
    node.syncState = 'stale';
    node.staleAt = value.syncedAt;
  }
  for (const node of value.nodes || []) {
    delete node.syncState;
    delete node.staleAt;
  }
  return value;
}

function applyGraphOperation(input, operation) {
  const graph = clone(normalizeGraph(input, input?.projectId));
  if (!operation || typeof operation !== 'object' || Array.isArray(operation)) {
    throw Object.assign(new Error('operation must be an object'), { statusCode: 400 });
  }
  const [subjectType, action] = String(operation.type || '').split('.');
  const collectionName = COLLECTIONS[subjectType];

  if (operation.type === 'discovery.import') {
    let value = operation.value;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw Object.assign(new Error('discovery import value must be an object'), { statusCode: 400 });
    }
    retireDiscoveryNodes(graph, value);
    value = reconcileDiscoveryImport(graph, value);
    value = { ...value, edges: autoConfirmDeclarativeEdges(value.edges) };
    for (const [name, collectionName] of [['scopes', 'scopes'], ['sources', 'sources'], ['nodes', 'nodes'], ['edges', 'edges']]) {
      if (!Array.isArray(value[name]) || value[name].length > 500) {
        throw Object.assign(new Error(`${name} must be an array with at most 500 items`), { statusCode: 400 });
      }
      for (const item of value[name]) {
        const existing = graph[collectionName].find(entry => entry.id === item.id);
        if (name === 'edges' && ['manual', 'rejected'].includes(existing?.status)) continue;
        upsert(graph[collectionName], clone(item));
      }
    }
    return normalizeGraph(graph, graph.projectId);
  }

  if (operation.type === 'discovery.sync') {
    let value = operation.value;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw Object.assign(new Error('discovery sync value must be an object'), { statusCode: 400 });
    }
    value = reconcileDiscoverySync(graph, value);
    for (const [name, collectionName] of [['scopes', 'scopes'], ['sources', 'sources'], ['nodes', 'nodes'], ['edges', 'edges']]) {
      if (!Array.isArray(value[name]) || value[name].length > 500) {
        throw Object.assign(new Error(`${name} must be an array with at most 500 items`), { statusCode: 400 });
      }
      for (const item of value[name]) {
        const existing = graph[collectionName].find(entry => entry.id === item.id);
        if (name === 'edges' && ['manual', 'rejected'].includes(existing?.status)) continue;
        upsert(graph[collectionName], clone(item));
      }
    }
    return normalizeGraph(graph, graph.projectId);
  }

  if (operation.type === 'edge.review') {
    const id = requiredId(operation.subjectId, 'subjectId');
    const edge = graph.edges.find(item => item.id === id);
    if (!edge) throw Object.assign(new Error(`Graph subject not found: ${id}`), { statusCode: 404 });
    const decision = String(operation.value?.decision || '');
    if (!['accept', 'reject'].includes(decision)) {
      throw Object.assign(new Error('edge review decision must be accept or reject'), { statusCode: 400 });
    }
    edge.status = decision === 'accept' ? 'manual' : 'rejected';
    edge.decision = decision === 'accept' ? 'accepted' : 'rejected';
    return normalizeGraph(graph, graph.projectId);
  }

  if (operation.type === 'layout.set') {
    const positions = operation.value;
    if (!positions || typeof positions !== 'object' || Array.isArray(positions)) {
      throw Object.assign(new Error('layout value must be an object'), { statusCode: 400 });
    }
    graph.layout = operation.replace ? clone(positions) : { ...graph.layout, ...clone(positions) };
    return normalizeGraph(graph, graph.projectId);
  }

  if (operation.type === 'view.set') {
    const view = operation.value;
    if (!view || typeof view !== 'object' || Array.isArray(view)) {
      throw Object.assign(new Error('view value must be an object'), { statusCode: 400 });
    }
    graph.view = { ...graph.view, ...clone(view) };
    return normalizeGraph(graph, graph.projectId);
  }

  if (!collectionName || !['upsert', 'remove'].includes(action)) {
    throw Object.assign(new Error(`Unsupported graph operation: ${operation.type || ''}`), { statusCode: 400 });
  }

  if (action === 'upsert') {
    upsert(graph[collectionName], clone(operation.value || {}));
  } else {
    const id = requiredId(operation.subjectId, 'subjectId');
    removeById(graph[collectionName], id);
    if (subjectType === 'node') {
      graph.edges = graph.edges.filter(edge => edge.sourceNodeId !== id && edge.targetNodeId !== id);
      delete graph.layout[id];
      graph.groups = graph.groups.map(group => ({
        ...group,
        nodeIds: Array.isArray(group.nodeIds) ? group.nodeIds.filter(nodeId => nodeId !== id) : group.nodeIds,
      }));
    }
    if (subjectType === 'group') {
      for (const [nodeId, position] of Object.entries(graph.layout)) {
        if (position?.groupId === id) graph.layout[nodeId] = { ...position, groupId: null };
      }
    }
  }
  return normalizeGraph(graph, graph.projectId);
}

function diffCollection(before, after) {
  const beforeById = new Map(before.map(item => [item.id, item]));
  const afterById = new Map(after.map(item => [item.id, item]));
  return {
    added: after.filter(item => !beforeById.has(item.id)),
    removed: before.filter(item => !afterById.has(item.id)),
    updated: after
      .filter(item => beforeById.has(item.id) && !sameValue(beforeById.get(item.id), item))
      .map(item => ({ before: beforeById.get(item.id), after: item })),
  };
}

function diffGraphs(beforeInput, afterInput) {
  const projectId = beforeInput?.projectId || afterInput?.projectId;
  const before = normalizeGraph(beforeInput, projectId);
  const after = normalizeGraph(afterInput, projectId);
  const collections = {};
  let changeCount = 0;
  for (const collectionName of Object.values(COLLECTIONS)) {
    collections[collectionName] = diffCollection(before[collectionName], after[collectionName]);
    changeCount += collections[collectionName].added.length +
      collections[collectionName].removed.length + collections[collectionName].updated.length;
  }
  const layout = diffCollection(
    Object.entries(before.layout).map(([id, value]) => ({ id, ...value })),
    Object.entries(after.layout).map(([id, value]) => ({ id, ...value })),
  );
  changeCount += layout.added.length + layout.removed.length + layout.updated.length;
  const view = sameValue(before.view, after.view) ? null : { before: before.view, after: after.view };
  if (view) changeCount += 1;
  return { changeCount, collections, layout, view };
}

function subjectState(graph, operation) {
  if (operation.type === 'discovery.import' || operation.type === 'discovery.sync') {
    return {
      scopeIds: (operation.value?.scopes || []).map(item => item.id),
      sourceIds: (operation.value?.sources || []).map(item => item.id),
      nodeIds: (operation.value?.nodes || []).map(item => item.id),
      edgeIds: (operation.value?.edges || []).map(item => item.id),
    };
  }
  if (operation.type === 'layout.set') return graph.layout;
  if (operation.type === 'view.set') return graph.view;
  const [subjectType] = String(operation.type || '').split('.');
  const collectionName = COLLECTIONS[subjectType];
  if (!collectionName) return null;
  const id = operation.subjectId || operation.value?.id;
  return graph[collectionName].find(item => item.id === id) || null;
}

class ArchitectureGraphService {
  constructor({ database }) {
    if (!database) throw new Error('database is required');
    this.database = database;
  }

  applyOperation(projectId, operation, { expectedRevision, author = 'local', reason = '' } = {}) {
    expectedRevision = requiredRevision(expectedRevision);
    const current = this.database.getGraph(projectId);
    if (!current) throw Object.assign(new Error('Architecture project not found'), { statusCode: 404 });
    const nextDocument = applyGraphOperation(current.document, operation);
    const subjectType = String(operation.type || '').split('.')[0] || 'graph';
    const subjectId = operation.subjectId || operation.value?.id || null;
    return this.database.saveGraph(projectId, nextDocument, {
      expectedRevision,
      change: {
        type: operation.type,
        subjectType,
        subjectId,
        author,
        reason,
        previousState: subjectState(current.document, operation),
        newState: subjectState(nextDocument, operation),
      },
    });
  }

  diffSnapshot(projectId, snapshotId) {
    const snapshot = this.database.getSnapshot(projectId, snapshotId);
    if (!snapshot) throw Object.assign(new Error('Architecture snapshot not found'), { statusCode: 404 });
    const current = this.database.getGraph(projectId);
    return {
      snapshot: { ...snapshot, document: undefined },
      currentRevision: current.revision,
      diff: diffGraphs(snapshot.document, current.document),
    };
  }

  revertSnapshot(projectId, snapshotId, input = {}) {
    return this.database.revertToSnapshot(projectId, snapshotId, {
      ...input,
      expectedRevision: requiredRevision(input.expectedRevision),
    });
  }
}

module.exports = { ArchitectureGraphService, DECLARATIVE_CONFIDENCE, applyGraphOperation, autoConfirmDeclarativeEdges, diffGraphs, discoveryIdentityKeys };