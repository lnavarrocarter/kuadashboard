'use strict';

const crypto = require('crypto');
const { createAwsDeploymentReader } = require('../apm/awsDeploymentReader');
const { createAwsRegionalInventoryReader, resourceIdentity } = require('./awsRegionalInventoryReader');
const { createAwsTemplateRelationshipReader } = require('./awsTemplateRelationshipReader');
const { stableNodeId } = require('./graphModel');

const MAX_IMPORT_NODES = 500;
const PREVIEW_TTL_MS = 5 * 60 * 1000;

function previewCacheKey({ profileId, region, stackNames }) {
  return JSON.stringify([
    String(profileId || ''),
    String(region || ''),
    [...new Set(stackNames || [])].sort(),
  ]);
}

function requiredString(value, field) {
  const normalized = String(value || '').trim();
  if (!normalized) throw Object.assign(new Error(`${field} is required`), { statusCode: 400 });
  return normalized;
}

function sourceId(accountId, region, stackName) {
  return `aws:cloudformation:${accountId}:${region}:${stackName}`;
}

function inventorySourceId(accountId, region) {
  return `aws:inventory:${accountId}:${region}`;
}

function scopeId(accountId, region) {
  return `aws:${accountId}:${region}`;
}

function normalizePreview({ profileId, region, accountId, stackNames, resources, relationships = [], failures = [], estimate }) {
  profileId = requiredString(profileId, 'profileId');
  region = requiredString(region, 'region');
  accountId = requiredString(accountId, 'accountId');
  if (!/^\d{12}$/.test(accountId)) {
    throw Object.assign(new Error('accountId must contain 12 digits'), { statusCode: 400 });
  }
  const selectedStacks = [...new Set((stackNames || []).map(value => requiredString(value, 'stackName')))];
  const scope = {
    id: scopeId(accountId, region), provider: 'aws', profileId, accountId, region,
  };
  const sources = selectedStacks.map(stackName => ({
    id: sourceId(accountId, region, stackName),
    type: 'cloudformation',
    provider: 'aws',
    accountId,
    region,
    name: stackName,
    readOnly: true,
  }));
  if (resources.some(resource => resource.sourceType === 'inventory')) {
    sources.push({
      id: inventorySourceId(accountId, region),
      type: 'aws_inventory',
      provider: 'aws',
      accountId,
      region,
      name: 'Regional AWS inventory',
      readOnly: true,
    });
  }
  const nodes = resources.map(resource => {
    const nativeId = resource.identity || resource.arn || resource.key;
    const inventory = resource.sourceType === 'inventory';
    const source = inventory
      ? inventorySourceId(accountId, region)
      : sourceId(accountId, region, resource.stackName);
    return {
      id: stableNodeId({ provider: 'aws', accountId, region, resourceType: resource.kind, nativeId }),
      name: resource.name,
      provider: 'aws',
      accountId,
      region,
      resourceType: resource.type,
      kind: resource.kind,
      nativeId,
      arn: resource.arn || null,
      stackName: resource.stackName,
      logicalId: resource.logicalId,
      discoveryKey: resource.identity || resource.key,
      sourceId: source,
      manual: false,
      evidence: [{
        type: inventory ? 'aws_inventory' : 'cloudformation_resource',
        sourceId: source,
        values: [resource.stackName, resource.logicalId, resource.kind, resource.arn].filter(Boolean),
      }],
    };
  });
  const nodesByLogicalId = new Map(nodes.map(node => [`${node.stackName}:${node.logicalId}`, node]));
  const nodesByDiscoveryKey = new Map(nodes.map(node => [node.discoveryKey, node]));
  const relationshipSuggestions = relationships.flatMap(relationship => {
    const source = relationship.sourceKey
      ? nodesByDiscoveryKey.get(relationship.sourceKey)
      : nodesByLogicalId.get(`${relationship.stackName}:${relationship.sourceLogicalId}`);
    const target = relationship.targetKey
      ? nodesByDiscoveryKey.get(relationship.targetKey)
      : nodesByLogicalId.get(`${relationship.stackName}:${relationship.targetLogicalId}`);
    if (!source || !target) return [];
    const identity = `${source.id}:${target.id}:${relationship.relationType}`;
    return [{
      id: `suggested:${crypto.createHash('sha256').update(identity).digest('hex').slice(0, 16)}`,
      sourceNodeId: source.id,
      targetNodeId: target.id,
      relationType: relationship.relationType,
      status: 'suggested',
      confidence: relationship.confidence,
      evidence: relationship.evidence,
    }];
  });
  const applicationCandidates = identifyApplications(nodes, relationshipSuggestions);
  return {
    scope,
    sources,
    nodes,
    applicationCandidates,
    relationshipSuggestions,
    relationshipAnalysis: {
      status: failures.length ? 'partial' : 'complete',
      supportedEvidence: [
        'cloudformation_reference',
        'aws_inventory',
        'eventbridge_target',
        'lambda_event_source_mapping',
        'asl_reference',
      ],
      failures,
    },
    estimate,
  };
}

function identifyApplications(nodes, edges) {
  const nodesById = new Map(nodes.map(node => [node.id, node]));
  const adjacency = new Map(nodes.map(node => [node.id, new Set()]));
  for (const edge of edges) {
    if (!nodesById.has(edge.sourceNodeId) || !nodesById.has(edge.targetNodeId)) continue;
    adjacency.get(edge.sourceNodeId).add(edge.targetNodeId);
    adjacency.get(edge.targetNodeId).add(edge.sourceNodeId);
  }
  const visited = new Set();
  const candidates = [];
  for (const node of nodes) {
    if (visited.has(node.id) || adjacency.get(node.id).size === 0) continue;
    const nodeIds = [];
    const queue = [node.id];
    visited.add(node.id);
    while (queue.length) {
      const current = queue.shift();
      nodeIds.push(current);
      for (const related of adjacency.get(current)) {
        if (visited.has(related)) continue;
        visited.add(related);
        queue.push(related);
      }
    }
    if (nodeIds.length < 2) continue;
    const selected = new Set(nodeIds);
    const relationships = edges.filter(edge => selected.has(edge.sourceNodeId) && selected.has(edge.targetNodeId));
    const hub = nodeIds
      .map(id => nodesById.get(id))
      .sort((left, right) => adjacency.get(right.id).size - adjacency.get(left.id).size || left.name.localeCompare(right.name))[0];
    const identity = nodeIds.slice().sort().join(':');
    const resourceTypes = Object.entries(nodeIds.reduce((counts, id) => {
      const type = nodesById.get(id).resourceType;
      counts[type] = (counts[type] || 0) + 1;
      return counts;
    }, {})).map(([type, count]) => ({ type, count }));
    const entrypoints = nodeIds
      .map(id => nodesById.get(id))
      .filter(item => item.resourceType === 'eventbridge' || item.resourceType === 'stepfunctions')
      .map(item => ({ id: item.id, name: item.name, type: item.resourceType }));
    candidates.push({
      id: `application:${crypto.createHash('sha256').update(identity).digest('hex').slice(0, 16)}`,
      name: `${hub.name} application`,
      nodeIds,
      resourceCount: nodeIds.length,
      relationshipCount: relationships.length,
      confidence: relationships.reduce((sum, edge) => sum + edge.confidence, 0) / relationships.length,
      resourceTypes,
      entrypoints,
    });
  }
  return candidates.sort((left, right) => right.resourceCount - left.resourceCount || left.name.localeCompare(right.name));
}

class ArchitectureAwsDiscoveryService {
  constructor({
    deploymentReader = createAwsDeploymentReader(),
    inventoryReader = createAwsRegionalInventoryReader(),
    relationshipReader = createAwsTemplateRelationshipReader(),
    graphService,
    now = Date.now,
  } = {}) {
    if (!graphService) throw new Error('graphService is required');
    this.deploymentReader = deploymentReader;
    this.inventoryReader = inventoryReader;
    this.relationshipReader = relationshipReader;
    this.graphService = graphService;
    this.now = now;
    this.previewCache = new Map();
  }

  listDeployments(input) {
    return this.deploymentReader.listDeployments(input);
  }

  async preview({ profileId, region, accountId, stackNames }) {
    const selectedStacks = [...new Set(stackNames || [])];
    const [result, analysis, inventory] = await Promise.all([
      selectedStacks.length
        ? this.deploymentReader.preview({ profileId, region, stackNames: selectedStacks })
        : { resources: [], estimate: { awsRequests: 0, kubernetesRequests: 0 } },
      selectedStacks.length
        ? this.relationshipReader.analyze({ profileId, region, stackNames: selectedStacks })
        : { relationships: [], failures: [], requests: 0 },
      this.inventoryReader.analyze({ profileId, region }),
    ]);
    const resources = mergeResources(inventory.resources, result.resources);
    const preview = normalizePreview({
      profileId,
      region,
      accountId: accountId || inventory.accountId,
      stackNames: selectedStacks,
      resources,
      relationships: [...analysis.relationships, ...inventory.relationships],
      failures: [...analysis.failures, ...inventory.failures],
      estimate: {
        ...result.estimate,
        awsRequests: result.estimate.awsRequests + analysis.requests + inventory.requests,
        truncated: inventory.truncated,
      },
    });
    this.previewCache.set(previewCacheKey({ profileId, region, stackNames: selectedStacks }), {
      createdAt: this.now(),
      preview,
    });
    return preview;
  }

  async importSelection(projectId, input) {
    const selectedNodeIds = [...new Set(input.selectedNodeIds || [])];
    if (!selectedNodeIds.length || selectedNodeIds.length > MAX_IMPORT_NODES) {
      throw Object.assign(new Error(`Select between 1 and ${MAX_IMPORT_NODES} resources`), { statusCode: 400 });
    }
    const cached = this.previewCache.get(previewCacheKey(input));
    const preview = cached && this.now() - cached.createdAt <= PREVIEW_TTL_MS
      ? cached.preview
      : await this.preview(input);
    const selected = new Set(selectedNodeIds);
    const nodes = preview.nodes.filter(node => selected.has(node.id));
    if (nodes.length !== selected.size) {
      throw Object.assign(new Error('One or more selected resources are no longer available'), { statusCode: 409 });
    }
    const sourceIds = new Set(nodes.map(node => node.sourceId));
    const nodeIds = new Set(nodes.map(node => node.id));
    const threshold = input.automaticEdgeThreshold == null ? 0.85 : Number(input.automaticEdgeThreshold);
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
      throw Object.assign(new Error('automaticEdgeThreshold must be between 0 and 1'), { statusCode: 400 });
    }
    const edges = preview.relationshipSuggestions
      .filter(edge => nodeIds.has(edge.sourceNodeId) && nodeIds.has(edge.targetNodeId))
      .map(edge => ({
        ...edge,
        status: edge.confidence >= threshold ? 'automatic' : 'suggested',
        automaticEdgeThreshold: threshold,
      }));
    return this.graphService.applyOperation(projectId, {
      type: 'discovery.import',
      value: {
        scopes: [preview.scope],
        sources: preview.sources.filter(source => sourceIds.has(source.id)),
        nodes,
        edges,
      },
    }, {
      expectedRevision: input.expectedRevision,
      author: input.author,
      reason: input.reason || `Import ${nodes.length} AWS resources`,
    });
  }
}

function mergeResources(...collections) {
  const resources = new Map();
  for (const collection of collections) {
    for (const resource of collection || []) {
      const identity = resourceIdentity(resource.type, resource.name, resource.arn, resource.service);
      const existing = resources.get(identity);
      resources.set(identity, existing ? {
        ...existing,
        ...resource,
        identity,
        arn: resource.arn || existing.arn || null,
        sourceType: resource.stackName ? 'cloudformation' : resource.sourceType || existing.sourceType,
      } : { ...resource, identity });
    }
  }
  return [...resources.values()];
}

module.exports = {
  ArchitectureAwsDiscoveryService,
  identifyApplications,
  mergeResources,
  normalizePreview,
  PREVIEW_TTL_MS,
  previewCacheKey,
};