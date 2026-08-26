'use strict';

const crypto = require('crypto');

const SCHEMA_VERSION = 1;
const EDGE_STATUSES = new Set(['automatic', 'suggested', 'manual', 'rejected', 'stale']);
const LAYOUT_MODES = new Set(['request-flow', 'resource-type']);
const LAYOUT_DIRECTIONS = new Set(['horizontal', 'vertical']);

function requiredString(value, field) {
  const normalized = String(value || '').trim();
  if (!normalized) throw Object.assign(new Error(`${field} is required`), { statusCode: 400 });
  return normalized;
}

function optionalString(value) {
  return value == null ? '' : String(value).trim();
}

function stableNodeId({ provider, accountId, region, resourceType, nativeId }) {
  const identity = [provider, accountId, region, resourceType, nativeId]
    .map((value, index) => requiredString(value, ['provider', 'accountId', 'region', 'resourceType', 'nativeId'][index]).toLowerCase())
    .join('/');
  const digest = crypto.createHash('sha256').update(identity).digest('hex').slice(0, 16);
  return `${identity}/${digest}`;
}

function emptyGraph(projectId) {
  return {
    schemaVersion: SCHEMA_VERSION,
    projectId: requiredString(projectId, 'projectId'),
    scopes: [],
    sources: [],
    nodes: [],
    edges: [],
    groups: [],
    layout: {},
    view: normalizeView(),
  };
}

function normalizeGraph(input, projectId) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw Object.assign(new Error('graph must be an object'), { statusCode: 400 });
  }
  const graph = {
    schemaVersion: SCHEMA_VERSION,
    projectId: requiredString(projectId || input.projectId, 'projectId'),
    scopes: normalizeCollection(input.scopes, 'scope'),
    sources: normalizeCollection(input.sources, 'source'),
    nodes: normalizeCollection(input.nodes, 'node'),
    edges: normalizeEdges(input.edges),
    groups: normalizeCollection(input.groups, 'group'),
    layout: normalizeLayout(input.layout),
    view: normalizeView(input.view),
  };
  const nodeIds = new Set(graph.nodes.map(node => node.id));
  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.sourceNodeId) || !nodeIds.has(edge.targetNodeId)) {
      throw Object.assign(new Error(`edge ${edge.id} references an unknown node`), { statusCode: 400 });
    }
    if (edge.sourceNodeId === edge.targetNodeId) {
      throw Object.assign(new Error(`edge ${edge.id} cannot reference the same node twice`), { statusCode: 400 });
    }
  }
  return graph;
}

function normalizeCollection(value, label) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw Object.assign(new Error(`${label}s must be an array`), { statusCode: 400 });
  const ids = new Set();
  return value.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw Object.assign(new Error(`${label} must be an object`), { statusCode: 400 });
    }
    const normalized = { ...item, id: requiredString(item.id, `${label}.id`) };
    if (ids.has(normalized.id)) throw Object.assign(new Error(`Duplicate ${label} id: ${normalized.id}`), { statusCode: 400 });
    ids.add(normalized.id);
    return normalized;
  });
}

function normalizeEdges(value) {
  const edges = normalizeCollection(value, 'edge');
  return edges.map(edge => {
    const status = optionalString(edge.status) || 'suggested';
    if (!EDGE_STATUSES.has(status)) {
      throw Object.assign(new Error(`Unsupported edge status: ${status}`), { statusCode: 400 });
    }
    const confidence = edge.confidence == null ? (status === 'manual' ? 1 : 0) : Number(edge.confidence);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      throw Object.assign(new Error('edge.confidence must be between 0 and 1'), { statusCode: 400 });
    }
    return {
      ...edge,
      sourceNodeId: requiredString(edge.sourceNodeId, 'edge.sourceNodeId'),
      targetNodeId: requiredString(edge.targetNodeId, 'edge.targetNodeId'),
      relationType: optionalString(edge.relationType) || 'depends_on',
      status,
      confidence,
      evidence: Array.isArray(edge.evidence) ? edge.evidence : [],
    };
  });
}

function normalizeLayout(value) {
  if (value == null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw Object.assign(new Error('layout must be an object'), { statusCode: 400 });
  }
  return { ...value };
}

function normalizeView(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw Object.assign(new Error('view must be an object'), { statusCode: 400 });
  }
  const layoutMode = LAYOUT_MODES.has(value.layoutMode) ? value.layoutMode : 'request-flow';
  const layoutDirection = LAYOUT_DIRECTIONS.has(value.layoutDirection) ? value.layoutDirection : 'horizontal';
  return { layoutMode, layoutDirection, showEdgeLabels: value.showEdgeLabels === true };
}

module.exports = {
  EDGE_STATUSES,
  SCHEMA_VERSION,
  emptyGraph,
  normalizeGraph,
  stableNodeId,
};