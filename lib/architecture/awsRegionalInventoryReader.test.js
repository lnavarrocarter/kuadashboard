'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createAwsRegionalInventoryReader } = require('./awsRegionalInventoryReader');

test('identifies a connected AWS application from regional inventory and definitions', async () => {
  const accountId = '123456789012';
  const region = 'us-east-1';
  const workerArn = `arn:aws:lambda:${region}:${accountId}:function:orders-worker`;
  const workflowArn = `arn:aws:states:${region}:${accountId}:stateMachine:orders-workflow`;
  const ruleArn = `arn:aws:events:${region}:${accountId}:rule/orders-created`;
  const calls = [];
  const client = responses => ({
    async send(command) {
      calls.push(command.constructor.name);
      return responses[command.constructor.name] || {};
    },
  });
  const reader = createAwsRegionalInventoryReader({
    configResolver: async () => ({}),
    lambdaFactory: () => client({
      ListFunctionsCommand: { Functions: [{ FunctionName: 'orders-worker', FunctionArn: workerArn }] },
    }),
    eventBridgeFactory: () => client({
      ListEventBusesCommand: { EventBuses: [{ Name: 'default' }] },
      ListRulesCommand: { Rules: [{ Name: 'orders-created', Arn: ruleArn }] },
      ListTargetsByRuleCommand: { Targets: [{ Id: 'workflow', Arn: workflowArn }] },
    }),
    sfnFactory: () => client({
      ListStateMachinesCommand: { stateMachines: [{ name: 'orders-workflow', stateMachineArn: workflowArn }] },
      DescribeStateMachineCommand: {
        definition: JSON.stringify({
          StartAt: 'Process order',
          States: {
            'Process order': { Type: 'Task', Resource: workerArn, End: true },
          },
        }),
      },
    }),
  });

  const result = await reader.analyze({ profileId: 'local:dev', region });

  assert.equal(result.accountId, accountId);
  assert.equal(result.failures.length, 0);
  assert.deepEqual(result.resources.map(resource => resource.name).sort(), [
    'orders-created', 'orders-worker', 'orders-workflow',
  ]);
  assert.deepEqual(result.relationships.map(relationship => relationship.relationType).sort(), ['invokes', 'triggers']);
  assert.deepEqual(result.relationships.map(relationship => relationship.evidence[0].type).sort(), [
    'asl_reference', 'eventbridge_target',
  ]);
  assert.equal(result.requests, calls.length);
  assert.deepEqual(calls, [
    'ListFunctionsCommand',
    'ListStateMachinesCommand', 'DescribeStateMachineCommand',
    'ListEventBusesCommand', 'ListRulesCommand', 'ListTargetsByRuleCommand',
  ]);
});

test('stops before AWS when the request budget is exhausted', async () => {
  let sends = 0;
  const reader = createAwsRegionalInventoryReader({
    configResolver: async () => ({}),
    lambdaFactory: () => ({ async send() { sends += 1; return {}; } }),
    eventBridgeFactory: () => ({ async send() { sends += 1; return {}; } }),
    sfnFactory: () => ({ async send() { sends += 1; return {}; } }),
    beforeRequest() {
      throw Object.assign(new Error('AWS request budget exhausted'), { statusCode: 429 });
    },
  });

  await assert.rejects(
    reader.analyze({ profileId: 'local:dev', region: 'us-east-1' }),
    error => error.statusCode === 429,
  );
  assert.equal(sends, 0);
});