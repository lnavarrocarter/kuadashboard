'use strict';

const { SFNClient, DescribeStateMachineCommand } = require('@aws-sdk/client-sfn');
const { resolveAwsConfig } = require('../awsProfileResolver');
const { extractAslReferences, lastArnSegment } = require('./aslReferences');

function resourceMatchesReference(resource, reference) {
  if (resource.type !== reference.type) return false;
  const identities = [resource.arn, resource.key, resource.name].filter(Boolean).map(value => String(value).toLowerCase());
  return identities.some(identity => identity === reference.arn.toLowerCase() || lastArnSegment(identity).toLowerCase() === reference.name.toLowerCase());
}

function createAwsTopologyReader({
  configResolver = resolveAwsConfig,
  clientFactory = config => new SFNClient(config),
} = {}) {
  return {
    async analyze({ application, resources, edges = [] }) {
      if (application.provider !== 'aws') return { requests: 0, suggestions: [], unresolvedReferences: [] };
      const config = { ...await configResolver(application.profileId), region: application.region };
      const client = clientFactory(config);
      const confirmed = new Set(edges.map(edge => `${edge.sourceResourceId}:${edge.targetResourceId}`));
      const suggestions = [];
      const unresolvedReferences = [];
      const failedResources = [];
      let requests = 0;
      for (const source of resources.filter(resource => resource.type === 'stepfunctions' && resource.enabled && resource.arn)) {
        let response;
        try {
          response = await client.send(new DescribeStateMachineCommand({ stateMachineArn: source.arn }));
          requests += 1;
        } catch (error) {
          failedResources.push({ resourceId: source.id, code: error.name || 'DESCRIBE_FAILED' });
          continue;
        }
        for (const reference of extractAslReferences(response.definition)) {
          const target = resources.find(resource => resource.id !== source.id && resourceMatchesReference(resource, reference));
          if (!target) {
            unresolvedReferences.push({
              sourceResourceId: source.id,
              type: reference.type,
              name: reference.name,
              relationType: reference.relationType,
              statePath: reference.statePath,
              candidate: {
                type: reference.type,
                key: reference.arn,
                arn: reference.arn,
                name: reference.name,
                ...(reference.type === 'lambda' ? { logGroup: `/aws/lambda/${reference.name}` } : {}),
                associationSource: 'manual',
              },
              addable: ['lambda', 'sqs', 'ecs', 'stepfunctions'].includes(reference.type),
            });
            continue;
          }
          if (confirmed.has(`${source.id}:${target.id}`)) continue;
          suggestions.push({
            sourceResourceId: source.id,
            targetResourceId: target.id,
            relationType: reference.relationType,
            confidence: 1,
            confirmed: false,
            evidence: [{ type: 'asl_reference', values: [reference.statePath, reference.name] }],
          });
        }
      }
      const uniqueSuggestions = [...new Map(suggestions.map(item => [
        `${item.sourceResourceId}:${item.targetResourceId}:${item.relationType}`, item,
      ])).values()];
      return { requests, suggestions: uniqueSuggestions, unresolvedReferences, failedResources };
    },
  };
}

module.exports = { createAwsTopologyReader, resourceMatchesReference };