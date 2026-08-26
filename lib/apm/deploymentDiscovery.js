'use strict';

const RESOURCE_TYPES = Object.freeze({
  'AWS::Lambda::Function': 'lambda',
  'AWS::SQS::Queue': 'sqs',
  'AWS::Events::Rule': 'eventbridge',
  'AWS::StepFunctions::StateMachine': 'stepfunctions',
  'AWS::ECS::Cluster': 'ecs',
  'AWS::ECS::Service': 'ecs',
});

const ARCHITECTURE_RESOURCE_TYPES = Object.freeze({
  ...RESOURCE_TYPES,
  'AWS::Lambda::LayerVersion': 'layer',
  'AWS::S3::Bucket': 's3',
  'AWS::S3::BucketPolicy': 'policy',
  'AWS::IAM::Role': 'iam',
  'AWS::IAM::Policy': 'iam-policy',
  'AWS::IAM::ManagedPolicy': 'iam-policy',
  'AWS::Lambda::Permission': 'policy',
  'AWS::SQS::QueuePolicy': 'policy',
  'AWS::SNS::Topic': 'sns',
  'AWS::SNS::TopicPolicy': 'policy',
  'AWS::DynamoDB::Table': 'dynamodb',
  'AWS::ApiGateway::RestApi': 'api',
  'AWS::ApiGateway::Method': 'api-route',
  'AWS::ApiGatewayV2::Api': 'api',
  'AWS::ApiGatewayV2::Route': 'api-route',
  'AWS::ApiGatewayV2::Integration': 'api-integration',
  'AWS::Logs::LogGroup': 'logs',
  'AWS::SecretsManager::Secret': 'secret',
});

function architectureResourceType(resourceType) {
  if (ARCHITECTURE_RESOURCE_TYPES[resourceType]) return ARCHITECTURE_RESOURCE_TYPES[resourceType];
  const match = String(resourceType || '').match(/^AWS::([^:]+)::/);
  return match ? match[1].toLowerCase() : 'cloudformation';
}

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
  if (summary.ResourceType === 'AWS::Lambda::LayerVersion') {
    const parts = physicalId.split(':');
    const layerIndex = parts.indexOf('layer');
    return {
      name: layerIndex >= 0 ? parts[layerIndex + 1] || String(summary.LogicalResourceId || 'Lambda layer') : String(summary.LogicalResourceId || physicalId),
      service: layerIndex >= 0 ? `v${parts[layerIndex + 2] || ''}` : '',
      arn: physicalId.startsWith('arn:') ? physicalId : null,
    };
  }
  return {
    name: lastSegment(physicalId),
    service: '',
    arn: physicalId.startsWith('arn:') ? physicalId : null,
  };
}

function deploymentResource(stackName, summary, { includeAllResources = false } = {}) {
  const type = includeAllResources
    ? architectureResourceType(summary.ResourceType)
    : RESOURCE_TYPES[summary.ResourceType];
  const physicalId = String(summary.PhysicalResourceId || '').trim();
  if (!type || (!physicalId && !includeAllResources)) return null;
  const identity = physicalId
    ? physicalIdentity(summary)
    : { name: String(summary.LogicalResourceId || summary.ResourceType || 'Resource'), service: '', arn: null };
  return {
    type,
    key: `${summary.ResourceType}:${physicalId || `${stackName}/${summary.LogicalResourceId}`}`,
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

function deploymentResources(stackName, summaries = [], options = {}) {
  return summaries.map(summary => deploymentResource(stackName, summary, options)).filter(Boolean);
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

module.exports = {
  ARCHITECTURE_RESOURCE_TYPES,
  RESOURCE_TYPES,
  architectureResourceType,
  deploymentResource,
  deploymentResources,
  ecsServiceResource,
};