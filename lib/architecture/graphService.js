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

function applyGraphOperation(input, operation) {
  const graph = clone(normalizeGraph(input, input?.projectId));
  if (!operation || typeof operation !== 'object' || Array.isArray(operation)) {
    throw Object.assign(new Error('operation must be an object'), { statusCode: 400 });
  }
  const [subjectType, action] = String(operation.type || '').split('.');
  const collectionName = COLLECTIONS[subjectType];

  if (operation.type === 'layout.set') {
    const positions = operation.value;
    if (!positions || typeof positions !== 'object' || Array.isArray(positions)) {
      throw Object.assign(new Error('layout value must be an object'), { statusCode: 400 });
    }
    graph.layout = operation.replace ? clone(positions) : { ...graph.layout, ...clone(positions) };
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
  return { changeCount, collections, layout };
}

function subjectState(graph, operation) {
  if (operation.type === 'layout.set') return graph.layout;
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

module.exports = { ArchitectureGraphService, applyGraphOperation, diffGraphs };