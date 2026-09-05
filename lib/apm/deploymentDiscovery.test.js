'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { deploymentResources, ecsServiceResource } = require('./deploymentDiscovery');

test('normalizes deployable AWS resources without retaining stack metadata', () => {
  const resources = deploymentResources('delivery-app', [
    { LogicalResourceId: 'EmailFn', ResourceType: 'AWS::Lambda::Function', PhysicalResourceId: 'EmailDispatcherFunction' },
    { LogicalResourceId: 'ServerlessFn', ResourceType: 'AWS::Serverless::Function', PhysicalResourceId: 'ServerlessDispatcherFunction' },
    { LogicalResourceId: 'EmailQueue', ResourceType: 'AWS::SQS::Queue', PhysicalResourceId: 'https://sqs.us-east-1.amazonaws.com/123/EmailDispatcherQueue' },
    { LogicalResourceId: 'EmailRule', ResourceType: 'AWS::Events::Rule', PhysicalResourceId: 'Autoatencion|EmailRule' },
    { LogicalResourceId: 'Policy', ResourceType: 'AWS::SQS::QueuePolicy', PhysicalResourceId: 'policy-id' },
  ]);

  assert.deepEqual(resources.map(resource => [resource.type, resource.name, resource.service]), [
    ['lambda', 'EmailDispatcherFunction', ''],
    ['lambda', 'ServerlessDispatcherFunction', ''],
    ['sqs', 'EmailDispatcherQueue', ''],
    ['eventbridge', 'EmailRule', 'Autoatencion'],
  ]);
  assert.equal(resources[0].collectable, true);
  assert.equal(resources[1].collectable, true);
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

test('normalizes every CloudFormation resource for Architecture without changing APM defaults', () => {
  const summaries = [
    { LogicalResourceId: 'Data', ResourceType: 'AWS::S3::Bucket', PhysicalResourceId: 'orders-data' },
    { LogicalResourceId: 'DataPolicy', ResourceType: 'AWS::S3::BucketPolicy', PhysicalResourceId: 'orders-data-policy' },
    { LogicalResourceId: 'WorkerRole', ResourceType: 'AWS::IAM::Role', PhysicalResourceId: 'orders-worker-role' },
    { LogicalResourceId: 'WorkerPolicy', ResourceType: 'AWS::IAM::Policy', PhysicalResourceId: 'orders-worker-policy' },
    { LogicalResourceId: 'GetOrders', ResourceType: 'AWS::ApiGateway::Method', PhysicalResourceId: 'abc123' },
    { LogicalResourceId: 'PostOrders', ResourceType: 'AWS::ApiGatewayV2::Route', PhysicalResourceId: 'route123' },
    { LogicalResourceId: 'OrdersIntegration', ResourceType: 'AWS::ApiGatewayV2::Integration', PhysicalResourceId: 'integration123' },
    { LogicalResourceId: 'SharedDependencies', ResourceType: 'AWS::Lambda::LayerVersion', PhysicalResourceId: 'arn:aws:lambda:us-east-1:123:layer:orders-dependencies:1' },
    { LogicalResourceId: 'TransformJob', ResourceType: 'AWS::Glue::Job' },
  ];

  assert.deepEqual(deploymentResources('orders', summaries).map(resource => resource.type), []);
  const resources = deploymentResources('orders', summaries, { includeAllResources: true });
  assert.deepEqual(resources.map(resource => [resource.type, resource.name]), [
    ['s3', 'orders-data'],
    ['policy', 'orders-data-policy'],
    ['iam', 'orders-worker-role'],
    ['iam-policy', 'orders-worker-policy'],
    ['api-route', 'abc123'],
    ['api-route', 'route123'],
    ['api-integration', 'integration123'],
    ['layer', 'orders-dependencies'],
    ['glue', 'TransformJob'],
  ]);
  assert.equal(resources[7].service, 'v1');
  assert.equal(resources[8].key, 'AWS::Glue::Job:orders/TransformJob');
});
