'use strict';

const crypto = require('crypto');
const { createAwsDeploymentReader } = require('../apm/awsDeploymentReader');
const { createAwsTemplateRelationshipReader } = require('./awsTemplateRelationshipReader');
const { stableNodeId } = require('./graphModel');

const MAX_IMPORT_NODES = 500;

function requiredString(value, field) {
  const normalized = String(value || '').trim();
  if (!normalized) throw Object.assign(new Error(`${field} is required`), { statusCode: 400 });
  return normalized;
}

function sourceId(accountId, region, stackName) {
  return `aws:cloudformation:${accountId}:${region}:${stackName}`;
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
  const nodes = resources.map(resource => {
    const nativeId = resource.arn || resource.key;
    const source = sourceId(accountId, region, resource.stackName);
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
      sourceId: source,
      manual: false,
      evidence: [{
        type: 'cloudformation_resource',
        sourceId: source,
        values: [resource.stackName, resource.logicalId, resource.kind].filter(Boolean),
      }],
    };
  });
  const nodesByLogicalId = new Map(nodes.map(node => [`${node.stackName}:${node.logicalId}`, node]));
  const relationshipSuggestions = relationships.flatMap(relationship => {
    const source = nodesByLogicalId.get(`${relationship.stackName}:${relationship.sourceLogicalId}`);
    const target = nodesByLogicalId.get(`${relationship.stackName}:${relationship.targetLogicalId}`);
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
  return {
    scope,
    sources,
    nodes,
    relationshipSuggestions,
    relationshipAnalysis: {
      status: failures.length ? 'partial' : 'complete',
      supportedEvidence: ['cloudformation_reference', 'asl_reference'],
      failures,
    },
    estimate,
  };
}

class ArchitectureAwsDiscoveryService {
  constructor({
    deploymentReader = createAwsDeploymentReader(),
    relationshipReader = createAwsTemplateRelationshipReader(),
    graphService,
  } = {}) {
    if (!graphService) throw new Error('graphService is required');
    this.deploymentReader = deploymentReader;
    this.relationshipReader = relationshipReader;
    this.graphService = graphService;
  }

  listDeployments(input) {
    return this.deploymentReader.listDeployments(input);
  }

  async preview({ profileId, region, accountId, stackNames }) {
    const [result, analysis] = await Promise.all([
      this.deploymentReader.preview({ profileId, region, stackNames }),
      this.relationshipReader.analyze({ profileId, region, stackNames }),
    ]);
    return normalizePreview({
      profileId, region, accountId, stackNames, resources: result.resources,
      relationships: analysis.relationships, failures: analysis.failures,
      estimate: { ...result.estimate, awsRequests: result.estimate.awsRequests + analysis.requests },
    });
  }

  async importSelection(projectId, input) {
    const selectedNodeIds = [...new Set(input.selectedNodeIds || [])];
    if (!selectedNodeIds.length || selectedNodeIds.length > MAX_IMPORT_NODES) {
      throw Object.assign(new Error(`Select between 1 and ${MAX_IMPORT_NODES} resources`), { statusCode: 400 });
    }
    const preview = await this.preview(input);
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

module.exports = { ArchitectureAwsDiscoveryService, normalizePreview };