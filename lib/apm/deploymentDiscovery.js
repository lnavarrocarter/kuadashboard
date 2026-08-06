'use strict';

const RESOURCE_TYPES = Object.freeze({
  'AWS::Lambda::Function': 'lambda',
  'AWS::SQS::Queue': 'sqs',
  'AWS::Events::Rule': 'eventbridge',
  'AWS::StepFunctions::StateMachine': 'stepfunctions',
  'AWS::ECS::Cluster': 'ecs',
  'AWS::ECS::Service': 'ecs',
});

function lastSegment(value) {
  const segment = String(value || '').split('/').filter(Boolean).pop() || '';
  return segment.startsWith('arn:') ? segment.split(':').pop() : segment;
}

function physicalIdentity(summary) {
  const physicalId = String(summary.PhysicalResourceId || '').trim();
  if (summary.ResourceType === 'AWS::Events::Rule') {
    const [busName = 'default', ruleName = physicalId] = physicalId.includes('|')
      ? physicalId.split('|', 2)
      : ['default', physicalId];
    return { name: ruleName, service: busName, arn: null };
  }
  if (summary.ResourceType === 'AWS::SQS::Queue') {
    return { name: lastSegment(physicalId), service: '', arn: physicalId.startsWith('arn:') ? physicalId : null };
  }
  if (summary.ResourceType === 'AWS::ECS::Service') {
    const parts = physicalId.split('/').filter(Boolean);
    return {
      name: parts.at(-1) || physicalId,
      service: parts.length > 1 ? parts.at(-2) : '',
      arn: physicalId.startsWith('arn:') ? physicalId : null,
    };
  }
  return {
    name: lastSegment(physicalId),
    service: '',
    arn: physicalId.startsWith('arn:') ? physicalId : null,
  };
}

function deploymentResource(stackName, summary) {
  const type = RESOURCE_TYPES[summary.ResourceType];
  const physicalId = String(summary.PhysicalResourceId || '').trim();
  if (!type || !physicalId) return null;
  const identity = physicalIdentity(summary);
  return {
    type,
    key: `${summary.ResourceType}:${physicalId}`,
    arn: identity.arn,
    name: identity.name,
    service: identity.service,
    kind: summary.ResourceType,
    stackName,
    logicalId: String(summary.LogicalResourceId || ''),
    associationSource: 'deployment',
    collectable: type === 'lambda',
  };
}

function deploymentResources(stackName, summaries = []) {
  return summaries.map(summary => deploymentResource(stackName, summary)).filter(Boolean);
}

function ecsServiceResource(stackName, clusterName, service) {
  const arn = String(service.serviceArn || '').trim();
  const name = String(service.serviceName || lastSegment(arn)).trim();
  if (!name) return null;
  return {
    type: 'ecs',
    key: arn || `AWS::ECS::Service:${clusterName}/${name}`,
    arn: arn || null,
    name,
    service: clusterName,
    kind: 'AWS::ECS::Service',
    stackName,
    logicalId: '',
    associationSource: 'deployment',
    collectable: false,
  };
}

module.exports = { RESOURCE_TYPES, deploymentResource, deploymentResources, ecsServiceResource };