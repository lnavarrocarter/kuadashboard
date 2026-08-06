'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { deploymentResources, ecsServiceResource } = require('./deploymentDiscovery');

test('normalizes deployable AWS resources without retaining stack metadata', () => {
  const resources = deploymentResources('delivery-app', [
    { LogicalResourceId: 'EmailFn', ResourceType: 'AWS::Lambda::Function', PhysicalResourceId: 'EmailDispatcherFunction' },
    { LogicalResourceId: 'EmailQueue', ResourceType: 'AWS::SQS::Queue', PhysicalResourceId: 'https://sqs.us-east-1.amazonaws.com/123/EmailDispatcherQueue' },
    { LogicalResourceId: 'EmailRule', ResourceType: 'AWS::Events::Rule', PhysicalResourceId: 'Autoatencion|EmailRule' },
    { LogicalResourceId: 'Policy', ResourceType: 'AWS::SQS::QueuePolicy', PhysicalResourceId: 'policy-id' },
  ]);

  assert.deepEqual(resources.map(resource => [resource.type, resource.name, resource.service]), [
    ['lambda', 'EmailDispatcherFunction', ''],
    ['sqs', 'EmailDispatcherQueue', ''],
    ['eventbridge', 'EmailRule', 'Autoatencion'],
  ]);
  assert.equal(resources[0].collectable, true);
  assert.equal(resources[1].collectable, false);
  assert.equal(resources.some(resource => 'tags' in resource || 'metadata' in resource), false);
});

test('normalizes ECS service and Step Functions identifiers', () => {
  const resources = deploymentResources('publication', [
    { LogicalResourceId: 'Service', ResourceType: 'AWS::ECS::Service', PhysicalResourceId: 'arn:aws:ecs:us-east-1:123:service/Publicacion-Cluster/publicacion-service' },
    { LogicalResourceId: 'Workflow', ResourceType: 'AWS::StepFunctions::StateMachine', PhysicalResourceId: 'arn:aws:states:us-east-1:123:stateMachine:publication' },
  ]);

  assert.equal(resources[0].name, 'publicacion-service');
  assert.equal(resources[0].service, 'Publicacion-Cluster');
  assert.equal(resources[1].name, 'publication');
  assert.equal(ecsServiceResource('publication', 'Publicacion-Cluster', {
    serviceName: 'publicacion-service',
    serviceArn: 'arn:aws:ecs:us-east-1:123:service/Publicacion-Cluster/publicacion-service',
  }).service, 'Publicacion-Cluster');
});