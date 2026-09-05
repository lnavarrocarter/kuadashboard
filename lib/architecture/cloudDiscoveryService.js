'use strict';

const crypto = require('crypto');
const { discoveryIdentityKeys } = require('./graphService');

const PREVIEW_TTL_MS = 5 * 60 * 1000;

function requiredString(value, field) {
  const normalized = String(value || '').trim();
  if (!normalized) throw Object.assign(new Error(`${field} is required`), { statusCode: 400 });
  return normalized;
}

function cacheKey({ projectId, profileId }) {
  return `${projectId}:${profileId}`;
}

function stableNodeId({ provider, scopeId, location, resourceType, nativeId }) {
  const identity = [provider, scopeId, location, resourceType, nativeId].map(value => requiredString(value, 'resource identity').toLowerCase()).join('/');
  return `${provider}:${crypto.createHash('sha256').update(identity).digest('hex').slice(0, 20)}`;
}

function buildExistingIdentityIndex(nodes = []) {
  const index = new Map();
  for (const node of nodes) {
    for (const key of discoveryIdentityKeys(node)) index.set(key, node);
  }
  return index;
}

function markExistingNodes(preview, graph) {
  const existing = buildExistingIdentityIndex(graph?.document?.nodes || []);
  for (const node of preview.nodes) {
    const match = discoveryIdentityKeys(node).map(key => existing.get(key)).find(Boolean);
    node.alreadyInGraph = !!match;
    node.existingNodeId = match?.id || null;
  }
}

class ArchitectureCloudDiscoveryService {
  constructor({ provider, reader, graphService, now = Date.now } = {}) {
    this.provider = requiredString(provider, 'provider');
    if (!reader || typeof reader.preview !== 'function') throw new Error('reader.preview is required');
    if (!graphService) throw new Error('graphService is required');
    this.reader = reader;
    this.graphService = graphService;
    this.now = now;
    this.previewCache = new Map();
  }

  async preview({ profileId, projectId }) {
    profileId = requiredString(profileId, 'profileId');
    projectId = requiredString(projectId, 'projectId');
    const preview = await this.reader.preview({ profileId });
    if (!preview || !Array.isArray(preview.nodes) || !Array.isArray(preview.sources)) {
      throw Object.assign(new Error(`${this.provider} discovery returned an invalid preview`), { statusCode: 502 });
    }
    const result = {
      ...preview,
      provider: this.provider,
      projectId,
      profileId,
      nodes: preview.nodes.slice(0, 500),
      relationships: Array.isArray(preview.relationships) ? preview.relationships.slice(0, 500) : [],
      failures: Array.isArray(preview.failures) ? preview.failures : [],
      estimate: preview.estimate || { requests: 0 },
    };
    markExistingNodes(result, this.graphService.database.getGraph(projectId));
    this.previewCache.set(cacheKey({ projectId, profileId }), { createdAt: this.now(), preview: result });
    return result;
  }

  async importSelection(projectId, { profileId, selectedNodeIds, expectedRevision, author, reason }) {
    projectId = requiredString(projectId, 'projectId');
    profileId = requiredString(profileId, 'profileId');
    const cached = this.previewCache.get(cacheKey({ projectId, profileId }));
    if (!cached || this.now() - cached.createdAt > PREVIEW_TTL_MS) {
      throw Object.assign(new Error(`${this.provider} discovery preview expired; run preview again`), { statusCode: 409 });
    }
    const selected = new Set((selectedNodeIds || []).map(String));
    const preview = cached.preview;
    if (!preview.nodes.some(node => selected.has(node.id))) {
      throw Object.assign(new Error('At least one discovered resource must be selected'), { statusCode: 400 });
    }
    const nodes = preview.nodes.filter(node => selected.has(node.id) || node.alreadyInGraph);
    const nodeIds = new Set(nodes.map(node => node.id));
    const edges = preview.relationships.filter(edge => nodeIds.has(edge.sourceNodeId) && nodeIds.has(edge.targetNodeId));
    const importedCount = nodes.filter(node => selected.has(node.id)).length;
    return this.graphService.applyOperation(projectId, {
      type: 'discovery.import',
      value: {
        scopes: [preview.scope],
        sources: preview.sources,
        nodes,
        edges,
        retiredNodeKinds: [],
      },
    }, {
      expectedRevision,
      author,
      reason: reason || `Import ${importedCount} ${this.provider} resources`,
    });
  }
}

module.exports = { ArchitectureCloudDiscoveryService, stableNodeId, PREVIEW_TTL_MS };
