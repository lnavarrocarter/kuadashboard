'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createAwsDeploymentReader } = require('./awsDeploymentReader');

test('lists active deployments with profile, region, account and read estimate', async () => {
  const configs = [];
  const requests = [];
  const reader = createAwsDeploymentReader({
    configResolver: async profileId => ({ profileId }),
    cloudFormationFactory(config) {
      configs.push(config);
      return {
        async send(command) {
          requests.push(command.input);
          if (!command.input.NextToken) return {
            StackSummaries: [{
              StackId: 'arn:aws:cloudformation:us-east-1:073746111526:stack/orders/id',
              StackName: 'orders',
              StackStatus: 'UPDATE_COMPLETE',
              LastUpdatedTime: new Date('2026-08-04T12:00:00.000Z'),
            }],
            NextToken: 'page-2',
          };
          return {
            StackSummaries: [{
              StackId: 'arn:aws:cloudformation:us-east-1:073746111526:stack/billing/id',
              StackName: 'billing',
              StackStatus: 'CREATE_COMPLETE',
            }],
          };
        },
      };
    },
  });

  const result = await reader.listDeployments({ profileId: 'local:dev', region: 'us-east-1' });

  assert.deepEqual(configs, [{ profileId: 'local:dev', region: 'us-east-1' }]);
  assert.equal(requests.length, 2);
  assert.deepEqual(result.scope, {
    profileId: 'local:dev', region: 'us-east-1', accountId: '073746111526',
  });
  assert.deepEqual(result.deployments.map(deployment => deployment.name), ['billing', 'orders']);
  assert.deepEqual(result.estimate, { awsRequests: 2, kubernetesRequests: 0 });
});

test('previews normalized resources and expands ECS clusters without cloud writes', async () => {
  const cloudFormationRequests = [];
  const ecsRequests = [];
  const reader = createAwsDeploymentReader({
    configResolver: async () => ({ credentials: 'fake' }),
    cloudFormationFactory: () => ({
      async send(command) {
        cloudFormationRequests.push(command.constructor.name);
        return {
          StackResourceSummaries: [
            { LogicalResourceId: 'Worker', ResourceType: 'AWS::Lambda::Function', PhysicalResourceId: 'orders-worker' },
            { LogicalResourceId: 'Queue', ResourceType: 'AWS::SQS::Queue', PhysicalResourceId: 'https://sqs.us-east-1.amazonaws.com/123/orders' },
            { LogicalResourceId: 'Cluster', ResourceType: 'AWS::ECS::Cluster', PhysicalResourceId: 'Orders-Cluster' },
          ],
        };
      },
    }),
    ecsFactory: () => ({
      async send(command) {
        ecsRequests.push(command.constructor.name);
        if (command.constructor.name === 'ListServicesCommand') {
          return { serviceArns: ['arn:aws:ecs:us-east-1:123:service/Orders-Cluster/orders-service'] };
        }
        return { services: [{
          serviceName: 'orders-service',
          serviceArn: 'arn:aws:ecs:us-east-1:123:service/Orders-Cluster/orders-service',
        }] };
      },
    }),
  });

  const result = await reader.preview({
    profileId: 'local:dev', region: 'us-east-1', stackNames: ['orders'],
  });

  assert.deepEqual(cloudFormationRequests, ['ListStackResourcesCommand']);
  assert.deepEqual(ecsRequests, ['ListServicesCommand', 'DescribeServicesCommand']);
  assert.deepEqual(result.resources.map(resource => [resource.type, resource.name]), [
    ['lambda', 'orders-worker'],
    ['sqs', 'orders'],
    ['ecs', 'Orders-Cluster'],
    ['ecs', 'orders-service'],
  ]);
  assert.equal(result.resources.some(resource => 'tags' in resource || 'metadata' in resource), false);
  assert.deepEqual(result.estimate, { awsRequests: 3, kubernetesRequests: 0 });
});

test('rejects empty and oversized deployment selections before creating AWS clients', async () => {
  let resolved = false;
  const reader = createAwsDeploymentReader({
    configResolver: async () => { resolved = true; return {}; },
  });

  await assert.rejects(
    reader.preview({ profileId: 'local:dev', region: 'us-east-1', stackNames: [] }),
    error => error.statusCode === 400,
  );
  await assert.rejects(
    reader.preview({ profileId: 'local:dev', region: 'us-east-1', stackNames: Array(11).fill('stack') }),
    error => error.statusCode === 400,
  );
  assert.equal(resolved, false);
});