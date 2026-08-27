'use strict';

const crypto = require('crypto');
const { createAwsDeploymentReader } = require('../apm/awsDeploymentReader');
const { createAwsRegionalInventoryReader, resourceIdentity } = require('./awsRegionalInventoryReader');
const { createAwsTemplateRelationshipReader } = require('./awsTemplateRelationshipReader');
const { createAwsLambdaCodeReader } = require('./awsLambdaCodeReader');
const { discoveryIdentityKeys } = require('./graphService');
const { stableNodeId } = require('./graphModel');

const MAX_IMPORT_NODES = 500;
const PREVIEW_TTL_MS = 5 * 60 * 1000;
const REGIONALLY_IDENTIFIED_TYPES = new Set(['lambda', 'eventbridge', 'stepfunctions', 'sqs', 'ecs', 's3']);
const HIDDEN_SUPPORT_KINDS = new Set(['AWS::Lambda::Permission']);

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

function sourceId(accountId, region, stackName) {
  return `aws:cloudformation:${accountId}:${region}:${stackName}`;
}

function inventorySourceId(accountId, region) {
  return `aws:inventory:${accountId}:${region}`;
}

function scopeId(accountId, region) {
  return `aws:${accountId}:${region}`;
}

function normalizePreview({ profileId, region, accountId, stackNames, resources, relationships = [], failures = [], externalReferences = [], estimate }) {
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
  const visibleResources = resources.filter(resource => !HIDDEN_SUPPORT_KINDS.has(resource.kind));
  const nodes = visibleResources.map(resource => {
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
  const permissionEvidenceByTarget = new Map();
  for (const relationship of relationships) {
    if (relationship.relationType !== 'authorizes' || !HIDDEN_SUPPORT_KINDS.has(
      resources.find(resource => resource.stackName === relationship.stackName && resource.logicalId === relationship.sourceLogicalId)?.kind,
    )) continue;
    const key = `${relationship.stackName}:${relationship.targetLogicalId}`;
    const evidence = permissionEvidenceByTarget.get(key) || [];
    evidence.push({ type: 'lambda_permission', logicalId: relationship.sourceLogicalId, values: [relationship.sourceLogicalId] });
    permissionEvidenceByTarget.set(key, evidence);
  }
  const relationshipSuggestions = relationships.flatMap(relationship => {
    const source = relationship.sourceKey
      ? nodesByDiscoveryKey.get(relationship.sourceKey)
      : nodesByLogicalId.get(`${relationship.stackName}:${relationship.sourceLogicalId}`);
    const target = relationship.targetKey
      ? nodesByDiscoveryKey.get(relationship.targetKey)
      : nodesByLogicalId.get(`${relationship.stackName}:${relationship.targetLogicalId}`);
    if (!source || !target) return [];
    const identity = `${source.id}:${target.id}:${relationship.relationType}`;
    const permissionEvidence = relationship.relationType === 'routes_to'
      ? permissionEvidenceByTarget.get(`${target.stackName}:${target.logicalId}`) || []
      : [];
    return [{
      id: `suggested:${crypto.createHash('sha256').update(identity).digest('hex').slice(0, 16)}`,
      sourceNodeId: source.id,
      targetNodeId: target.id,
      relationType: relationship.relationType,
      status: 'suggested',
      confidence: relationship.confidence,
      evidence: [...relationship.evidence, ...permissionEvidence],
    }];
  });
  const applicationCandidates = identifyApplications(nodes, relationshipSuggestions);
  const crossStackReferences = externalReferences.map(reference => ({
    sourceNodeId: nodesByLogicalId.get(`${reference.stackName}:${reference.sourceLogicalId}`)?.id || null,
    stackName: reference.stackName,
    exportName: reference.exportName,
  })).filter(reference => reference.sourceNodeId);
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
        'lambda_environment_variable',
        'iam_role_policy',
        'lambda_code_reference',
        'sns_subscription',
      ],
      crossStackReferences,
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

function comparableNode(node) {
  return {
    name: node.name,
    provider: node.provider,
    accountId: node.accountId,
    region: node.region,
    resourceType: node.resourceType,
    kind: node.kind,
    nativeId: node.nativeId,
    arn: node.arn || null,
    stackName: node.stackName || '',
    logicalId: node.logicalId || '',
    discoveryKey: node.discoveryKey || '',
    sourceId: node.sourceId || '',
    evidence: node.evidence || [],
  };
}

function comparableEdge(edge) {
  return {
    sourceNodeId: edge.sourceNodeId,
    targetNodeId: edge.targetNodeId,
    relationType: edge.relationType || 'depends_on',
    confidence: edge.confidence == null ? 0 : edge.confidence,
    evidence: edge.evidence || [],
  };
}

function edgeKey(edge) {
  return `${edge.sourceNodeId}:${edge.targetNodeId}:${edge.relationType || 'depends_on'}`;
}

function buildExistingIdentityIndex(nodes) {
  const index = new Map();
  for (const node of nodes) {
    for (const key of discoveryIdentityKeys(node)) {
      if (!index.has(key)) index.set(key, node);
    }
  }
  return index;
}

function summarizeSyncPreview({ graph, preview, threshold = 0.85 }) {
  const selectedSourceIds = new Set(preview.sources.map(source => source.id));
  const existingIdentity = buildExistingIdentityIndex(graph.nodes);
  const matchedExistingIds = new Set();
  const previewToExistingId = new Map();
  const resources = { new: [], changed: [], unchanged: [], missing: [], stale: [], manual: [] };

  for (const node of preview.nodes) {
    const existing = discoveryIdentityKeys(node).map(key => existingIdentity.get(key)).find(Boolean);
    if (!existing) {
      resources.new.push({ node });
      continue;
    }
    matchedExistingIds.add(existing.id);
    previewToExistingId.set(node.id, existing.id);
    const normalized = { ...node, id: existing.id };
    if (sameValue(comparableNode(existing), comparableNode(normalized))) resources.unchanged.push({ node: existing, preview: node });
    else resources.changed.push({ node: existing, preview: node });
  }

  for (const node of graph.nodes) {
    if (node.manual || !node.sourceId) {
      resources.manual.push({ node });
      continue;
    }
    if (!selectedSourceIds.has(node.sourceId) || matchedExistingIds.has(node.id)) continue;
    if (node.syncState === 'stale' || node.status === 'stale') resources.stale.push({ node });
    else resources.missing.push({ node });
  }

  const previewEdges = preview.relationshipSuggestions.map(edge => ({
    ...edge,
    sourceNodeId: previewToExistingId.get(edge.sourceNodeId) || edge.sourceNodeId,
    targetNodeId: previewToExistingId.get(edge.targetNodeId) || edge.targetNodeId,
    status: edge.confidence >= threshold ? 'automatic' : 'suggested',
    automaticEdgeThreshold: threshold,
  }));
  const existingByKey = new Map(graph.edges.map(edge => [edgeKey(edge), edge]));
  const previewEdgeKeys = new Set();
  const relationships = { new: [], reinforced: [], unchanged: [], missingEvidence: [], rejected: [], manual: [] };

  for (const edge of previewEdges) {
    const key = edgeKey(edge);
    previewEdgeKeys.add(key);
    const existing = existingByKey.get(key);
    if (!existing) {
      relationships.new.push({ edge });
      continue;
    }
    if (existing.status === 'rejected') relationships.rejected.push({ edge: existing, preview: edge });
    else if (existing.status === 'manual') relationships.manual.push({ edge: existing, preview: edge });
    else if (sameValue(comparableEdge(existing), comparableEdge(edge))) relationships.unchanged.push({ edge: existing, preview: edge });
    else relationships.reinforced.push({ edge: existing, preview: edge });
  }

  const sourceScopedNodeIds = new Set(graph.nodes
    .filter(node => selectedSourceIds.has(node.sourceId))
    .map(node => node.id));
  for (const edge of graph.edges) {
    if (edge.status === 'manual' || edge.status === 'rejected') continue;
    if (!sourceScopedNodeIds.has(edge.sourceNodeId) || !sourceScopedNodeIds.has(edge.targetNodeId)) continue;
    if (!previewEdgeKeys.has(edgeKey(edge))) relationships.missingEvidence.push({ edge });
  }

  const resourceCounts = Object.fromEntries(Object.entries(resources).map(([key, value]) => [key, value.length]));
  const relationshipCounts = Object.fromEntries(Object.entries(relationships).map(([key, value]) => [key, value.length]));
  return {
    scope: preview.scope,
    sources: preview.sources,
    generatedAt: new Date().toISOString(),
    resources,
    relationships,
    summary: {
      resources: resourceCounts,
      relationships: relationshipCounts,
      changeCount: resourceCounts.new + resourceCounts.changed + resourceCounts.missing + resourceCounts.stale +
        relationshipCounts.new + relationshipCounts.reinforced + relationshipCounts.missingEvidence,
    },
    relationshipAnalysis: preview.relationshipAnalysis,
    estimate: preview.estimate,
  };
}

class ArchitectureAwsDiscoveryService {
  constructor({
    deploymentReader = createAwsDeploymentReader({ includeAllResources: true }),
    inventoryReader = createAwsRegionalInventoryReader({ codeReader: createAwsLambdaCodeReader() }),
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

  async preview({ profileId, region, accountId, stackNames, lambdaCodeAnalysisNames, projectId }) {
    const selectedStacks = [...new Set(stackNames || [])];
    const useRegionalInventory = selectedStacks.length === 0;
    const [result, analysis, inventory] = await Promise.all([
      selectedStacks.length
        ? this.deploymentReader.preview({ profileId, region, stackNames: selectedStacks })
        : { resources: [], estimate: { awsRequests: 0, kubernetesRequests: 0 } },
      selectedStacks.length
        ? this.relationshipReader.analyze({ profileId, region, stackNames: selectedStacks })
        : { relationships: [], failures: [], requests: 0 },
      useRegionalInventory
        ? this.inventoryReader.analyze({ profileId, region, lambdaCodeAnalysisNames })
        : { accountId: '', resources: [], relationships: [], failures: [], requests: 0, truncated: false },
    ]);
    const resources = selectedStacks.length
      ? mergeResources(result.resources)
      : mergeResources(inventory.resources);
    const preview = normalizePreview({
      profileId,
      region,
      accountId: accountId || result.accountId || inventory.accountId || resources.map(resource => String(resource.arn || '').split(':')[4] || '')
        .find(value => /^\d{12}$/.test(value)),
      stackNames: selectedStacks,
      resources,
      relationships: selectedStacks.length ? analysis.relationships : inventory.relationships,
      failures: selectedStacks.length ? analysis.failures : inventory.failures,
      externalReferences: selectedStacks.length ? analysis.externalReferences : [],
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
    this.markExistingNodes(preview, projectId);
    return preview;
  }

  // Lets the discovery panel show which preview resources are already part of the project's graph,
  // instead of silently letting the user re-select and re-import something that's already there.
  markExistingNodes(preview, projectId) {
    const graph = projectId ? this.graphService.database.getGraph(projectId) : null;
    if (!graph) {
      for (const node of preview.nodes) { node.alreadyInGraph = false; node.existingNodeId = null; }
      return;
    }
    const existingIdentity = buildExistingIdentityIndex(graph.document.nodes);
    for (const node of preview.nodes) {
      const existing = discoveryIdentityKeys(node).map(key => existingIdentity.get(key)).find(Boolean);
      node.alreadyInGraph = !!existing;
      node.existingNodeId = existing?.id || null;
    }
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
        retiredNodeKinds: [...HIDDEN_SUPPORT_KINDS],
      },
    }, {
      expectedRevision: input.expectedRevision,
      author: input.author,
      reason: input.reason || `Import ${nodes.length} AWS resources`,
    });
  }

  async previewSync(projectId, input) {
    const current = this.graphService.database.getGraph(projectId);
    if (!current) throw Object.assign(new Error('Architecture project not found'), { statusCode: 404 });
    const cached = this.previewCache.get(previewCacheKey(input));
    const preview = cached && this.now() - cached.createdAt <= PREVIEW_TTL_MS
      ? cached.preview
      : await this.preview(input);
    const threshold = input.automaticEdgeThreshold == null ? 0.85 : Number(input.automaticEdgeThreshold);
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
      throw Object.assign(new Error('automaticEdgeThreshold must be between 0 and 1'), { statusCode: 400 });
    }
    return summarizeSyncPreview({ graph: current.document, preview, threshold });
  }

  async applySync(projectId, input) {
    const cached = this.previewCache.get(previewCacheKey(input));
    const preview = cached && this.now() - cached.createdAt <= PREVIEW_TTL_MS
      ? cached.preview
      : await this.preview(input);
    const threshold = input.automaticEdgeThreshold == null ? 0.85 : Number(input.automaticEdgeThreshold);
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
      throw Object.assign(new Error('automaticEdgeThreshold must be between 0 and 1'), { statusCode: 400 });
    }
    const syncedAt = new Date(this.now()).toISOString();
    const sources = preview.sources.map(source => ({
      ...source,
      sync: { lastSuccessfulAt: syncedAt, selectedStackNames: preview.sources.filter(item => item.type === 'cloudformation').map(item => item.name) },
    }));
    const edges = preview.relationshipSuggestions.map(edge => ({
      ...edge,
      status: edge.confidence >= threshold ? 'automatic' : 'suggested',
      automaticEdgeThreshold: threshold,
    }));
    return this.graphService.applyOperation(projectId, {
      type: 'discovery.sync',
      value: {
        scopes: [preview.scope],
        sources,
        nodes: preview.nodes,
        edges,
        retiredNodeKinds: [...HIDDEN_SUPPORT_KINDS],
        syncedAt,
      },
    }, {
      expectedRevision: input.expectedRevision,
      author: input.author,
      reason: input.reason || `Synchronize ${preview.nodes.length} AWS resources`,
    });
  }
}

function mergeResources(...collections) {
  const resources = new Map();
  for (const collection of collections) {
    for (const resource of collection || []) {
      const identity = resource.stackName && !REGIONALLY_IDENTIFIED_TYPES.has(resource.type)
        ? resource.key
        : resourceIdentity(resource.type, resource.name, resource.arn, resource.service);
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
  summarizeSyncPreview,
  PREVIEW_TTL_MS,
  previewCacheKey,
};
