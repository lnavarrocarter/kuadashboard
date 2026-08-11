'use strict';

const { nameSimilarity, normalizedNameTokens } = require('./correlation');

const DIRECTIONAL_PAIRS = new Map([
  ['eventbridge:lambda', 'triggers'],
  ['eventbridge:stepfunctions', 'triggers'],
  ['sqs:lambda', 'consumed_by'],
]);

function resourcePairKey(left, right) {
  return [left.id, right.id].sort().join(':');
}

function confirmedPairKeys(edges) {
  return new Set(edges.map(edge => [edge.sourceResourceId, edge.targetResourceId].sort().join(':')));
}

function inferDirection(left, right) {
  const direct = DIRECTIONAL_PAIRS.get(`${left.type}:${right.type}`);
  if (direct) return { source: left, target: right, relationType: direct };
  const reverse = DIRECTIONAL_PAIRS.get(`${right.type}:${left.type}`);
  if (reverse) return { source: right, target: left, relationType: reverse };
  return { source: left, target: right, relationType: 'related_to' };
}

function sharedNameTokens(left, right) {
  const rightTokens = new Set(normalizedNameTokens(right.name));
  return normalizedNameTokens(left.name).filter(token => rightTokens.has(token));
}

function suggestRelationships(resources, edges) {
  const confirmed = confirmedPairKeys(edges);
  const suggestions = [];
  for (let leftIndex = 0; leftIndex < resources.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < resources.length; rightIndex += 1) {
      const left = resources[leftIndex];
      const right = resources[rightIndex];
      if (confirmed.has(resourcePairKey(left, right))) continue;
      const tokens = sharedNameTokens(left, right);
      const similarity = nameSimilarity(left.name, right.name);
      const sameKubernetesScope = left.type === 'kubernetes' && right.type === 'kubernetes' &&
        left.kubeContext && left.kubeContext === right.kubeContext &&
        left.namespace && left.namespace === right.namespace;
      const directional = DIRECTIONAL_PAIRS.has(`${left.type}:${right.type}`) ||
        DIRECTIONAL_PAIRS.has(`${right.type}:${left.type}`);
      if (similarity < 0.5 || !tokens.length) continue;
      const direction = inferDirection(left, right);
      const evidence = [];
      if (tokens.length) evidence.push({ type: 'shared_name_tokens', values: tokens.slice(0, 4) });
      if (sameKubernetesScope) evidence.push({ type: 'same_kubernetes_scope', values: [left.namespace] });
      if (directional) evidence.push({ type: 'compatible_resource_types', values: [left.type, right.type] });
      const confidence = Math.min(0.9, 0.25 + similarity * 0.5 + (directional ? 0.1 : 0) + (sameKubernetesScope ? 0.05 : 0));
      suggestions.push({
        sourceResourceId: direction.source.id,
        targetResourceId: direction.target.id,
        relationType: direction.relationType,
        confidence: Number(confidence.toFixed(2)),
        evidence,
        confirmed: false,
      });
    }
  }
  return suggestions.sort((left, right) => right.confidence - left.confidence).slice(0, 20);
}

function analyzeTopology(application, resources = [], edges = [], cloudEvidence = {}) {
  const enabledResources = resources.filter(resource => resource.enabled);
  const operationalEdges = edges.filter(edge => edge.relationType !== 'related_to');
  const genericEdges = edges.filter(edge => edge.relationType === 'related_to');
  const connectedIds = new Set(edges.flatMap(edge => [edge.sourceResourceId, edge.targetResourceId]));
  const isolatedResources = enabledResources.filter(resource => !connectedIds.has(resource.id));
  const heuristicSuggestions = suggestRelationships(enabledResources, edges);
  const suggestions = [...new Map([
    ...(cloudEvidence.suggestions || []),
    ...heuristicSuggestions,
  ].map(item => [`${item.sourceResourceId}:${item.targetResourceId}:${item.relationType}`, item])).values()];
  const coveragePercent = enabledResources.length
    ? Math.round(((enabledResources.length - isolatedResources.length) / enabledResources.length) * 100)
    : 0;
  const findings = [];
  if (!enabledResources.length) findings.push({ code: 'no_resources', severity: 'critical', resourceIds: [] });
  else if (enabledResources.length > 1 && !edges.length) findings.push({ code: 'no_confirmed_dependencies', severity: 'warning', resourceIds: isolatedResources.map(resource => resource.id) });
  if (isolatedResources.length && edges.length) findings.push({ code: 'isolated_resources', severity: 'warning', resourceIds: isolatedResources.map(resource => resource.id) });
  if (genericEdges.length) findings.push({ code: 'generic_relationships', severity: 'warning', resourceIds: [] });
  if (isolatedResources.some(resource => resource.type === 'lambda') && enabledResources.some(resource => resource.type === 'stepfunctions')) {
    findings.push({ code: 'execution_evidence_required', severity: 'info', resourceIds: isolatedResources.filter(resource => resource.type === 'lambda').map(resource => resource.id) });
  }
  const disabledResources = resources.filter(resource => !resource.enabled);
  if (disabledResources.length) findings.push({ code: 'disabled_resources', severity: 'info', resourceIds: disabledResources.map(resource => resource.id) });
  if (suggestions.length) findings.push({ code: 'dependency_suggestions', severity: 'info', resourceIds: [] });
  if (cloudEvidence.unresolvedReferences?.length) findings.push({ code: 'unresolved_cloud_references', severity: 'info', resourceIds: [] });
  if (cloudEvidence.failedResources?.length) findings.push({ code: 'cloud_scan_partial', severity: 'warning', resourceIds: cloudEvidence.failedResources.map(item => item.resourceId) });

  const score = Math.max(0, Math.min(100,
    (enabledResources.length ? 45 : 0) +
    Math.round(coveragePercent * 0.4) +
    (enabledResources.length === 1 || operationalEdges.length ? 15 : 0) -
    Math.min(20, disabledResources.length * 5)));

  return {
    version: 1,
    engine: 'local-rules',
    applicationId: application?.id || null,
    score,
    coveragePercent,
    counts: {
      resources: resources.length,
      enabledResources: enabledResources.length,
      confirmedDependencies: edges.length,
      operationalDependencies: operationalEdges.length,
      genericRelationships: genericEdges.length,
      isolatedResources: isolatedResources.length,
      suggestions: suggestions.length,
      unresolvedCloudReferences: cloudEvidence.unresolvedReferences?.length || 0,
    },
    findings,
    suggestions,
    cloudScan: cloudEvidence.requests == null ? null : {
      requests: cloudEvidence.requests,
      unresolvedReferences: cloudEvidence.unresolvedReferences || [],
      failedResources: cloudEvidence.failedResources || [],
    },
  };
}

module.exports = { analyzeTopology, suggestRelationships };