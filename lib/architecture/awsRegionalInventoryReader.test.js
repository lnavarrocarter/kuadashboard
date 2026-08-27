'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createAwsRegionalInventoryReader } = require('./awsRegionalInventoryReader');

test('identifies a connected AWS application from regional inventory and definitions', async () => {
  const accountId = '123456789012';
  const region = 'us-east-1';
  const workerArn = `arn:aws:lambda:${region}:${accountId}:function:orders-worker`;
  const queueArn = `arn:aws:sqs:${region}:${accountId}:orders-queue`;
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
      ListEventSourceMappingsCommand: {
        EventSourceMappings: [{
          UUID: 'mapping-1', State: 'Enabled', BatchSize: 10,
          EventSourceArn: queueArn, FunctionArn: workerArn,
        }],
      },
    }),
    eventBridgeFactory: () => client({
      ListEventBusesCommand: { EventBuses: [{ Name: 'default' }] },
      ListRulesCommand: { Rules: [{
        Name: 'orders-created', Arn: ruleArn, State: 'ENABLED',
        EventPattern: JSON.stringify({ source: ['orders'] }),
      }] },
      ListTargetsByRuleCommand: { Targets: [
        { Id: 'queue', Arn: queueArn },
        { Id: 'workflow', Arn: workflowArn },
      ] },
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
    'orders-created', 'orders-queue', 'orders-worker', 'orders-workflow',
  ]);
  assert.deepEqual(result.relationships.map(relationship => relationship.relationType).sort(), [
    'invokes', 'triggers', 'triggers', 'triggers',
  ]);
  assert.deepEqual(result.relationships.map(relationship => relationship.evidence[0].type).sort(), [
    'asl_reference', 'eventbridge_target', 'eventbridge_target', 'lambda_event_source_mapping',
  ]);
  const eventEvidence = result.relationships
    .flatMap(relationship => relationship.evidence)
    .find(evidence => evidence.type === 'eventbridge_target');
  assert.equal(eventEvidence.eventPattern, JSON.stringify({ source: ['orders'] }));
  assert.equal(result.requests, calls.length);
  assert.deepEqual(calls, [
    'ListFunctionsCommand', 'ListEventSourceMappingsCommand',
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

test('infers Lambda references to SQS/DynamoDB/S3 from environment variables without downloading or running the function', async () => {
  const accountId = '123456789012';
  const region = 'us-east-1';
  const dispatcherArn = `arn:aws:lambda:${region}:${accountId}:function:dispatcher`;
  const queueArn = `arn:aws:sqs:${region}:${accountId}:dispatch-queue`;
  const tableArn = `arn:aws:dynamodb:${region}:${accountId}:table/dispatch-jobs`;
  const client = responses => ({ async send(command) { return responses[command.constructor.name] || {}; } });
  const reader = createAwsRegionalInventoryReader({
    configResolver: async () => ({}),
    lambdaFactory: () => client({
      ListFunctionsCommand: {
        Functions: [{
          FunctionName: 'dispatcher',
          FunctionArn: dispatcherArn,
          Environment: {
            Variables: {
              QUEUE_URL: `https://sqs.${region}.amazonaws.com/${accountId}/dispatch-queue`,
              JOBS_TABLE_ARN: tableArn,
              LOG_LEVEL: 'debug',
              API_KEY: 'super-secret-value',
            },
          },
        }],
      },
    }),
    eventBridgeFactory: () => client({ ListEventBusesCommand: { EventBuses: [] } }),
    sfnFactory: () => client({ ListStateMachinesCommand: { stateMachines: [] } }),
  });

  const result = await reader.analyze({ profileId: 'local:dev', region });

  assert.deepEqual(result.resources.map(resource => resource.name).sort(), [
    'dispatch-jobs', 'dispatch-queue', 'dispatcher',
  ]);
  assert.equal(result.resources.find(resource => resource.name === 'dispatch-queue').kind, 'AWS::SQS::Queue');
  assert.equal(result.resources.find(resource => resource.name === 'dispatch-jobs').kind, 'AWS::DynamoDB::Table');
  assert.deepEqual(result.relationships.map(relationship => relationship.relationType).sort(), ['references', 'references']);
  const evidenceKeys = result.relationships.map(relationship => relationship.evidence[0].key).sort();
  assert.deepEqual(evidenceKeys, ['JOBS_TABLE_ARN', 'QUEUE_URL']);
  const evidenceValues = result.relationships.flatMap(relationship => relationship.evidence.map(evidence => evidence.value));
  assert.ok(!evidenceValues.includes('super-secret-value'), 'plain secret values must never be copied into evidence');
});

test('ignores environment variables that do not resolve to a known AWS resource reference', async () => {
  const { referenceFromEnvValue } = require('./awsRegionalInventoryReader');
  assert.equal(referenceFromEnvValue('super-secret-value'), null);
  assert.equal(referenceFromEnvValue(''), null);
  assert.equal(referenceFromEnvValue(undefined), null);
  assert.deepEqual(referenceFromEnvValue('arn:aws:s3:::my-bucket/prefix'), { type: 's3', name: 'my-bucket', arn: 'arn:aws:s3:::my-bucket/prefix' });
});

test('infers Lambda capability references from its execution role policies without executing anything', async () => {
  const accountId = '123456789012';
  const region = 'us-east-1';
  const dispatcherArn = `arn:aws:lambda:${region}:${accountId}:function:dispatcher`;
  const roleArn = `arn:aws:iam::${accountId}:role/dispatcher-role`;
  const managedPolicyArn = `arn:aws:iam::${accountId}:policy/dispatcher-sqs-policy`;
  const client = responses => ({ async send(command) { return responses[command.constructor.name] || {}; } });
  const inlineDocument = encodeURIComponent(JSON.stringify({
    Statement: [{
      Effect: 'Allow',
      Action: ['dynamodb:PutItem'],
      Resource: `arn:aws:dynamodb:${region}:${accountId}:table/dispatch-jobs`,
    }],
  }));
  const managedDocument = encodeURIComponent(JSON.stringify({
    Statement: [
      { Effect: 'Allow', Action: ['sqs:SendMessage'], Resource: `arn:aws:sqs:${region}:${accountId}:dispatch-queue` },
      { Effect: 'Deny', Action: ['sqs:DeleteQueue'], Resource: '*' },
      { Effect: 'Allow', Action: ['s3:GetObject'], Resource: '*' },
    ],
  }));
  const reader = createAwsRegionalInventoryReader({
    configResolver: async () => ({}),
    lambdaFactory: () => client({
      ListFunctionsCommand: { Functions: [{ FunctionName: 'dispatcher', FunctionArn: dispatcherArn, Role: roleArn }] },
    }),
    eventBridgeFactory: () => client({ ListEventBusesCommand: { EventBuses: [] } }),
    sfnFactory: () => client({ ListStateMachinesCommand: { stateMachines: [] } }),
    iamFactory: () => client({
      ListAttachedRolePoliciesCommand: { AttachedPolicies: [{ PolicyName: 'dispatcher-sqs-policy', PolicyArn: managedPolicyArn }] },
      GetPolicyCommand: { Policy: { DefaultVersionId: 'v1' } },
      GetPolicyVersionCommand: { PolicyVersion: { Document: managedDocument } },
      ListRolePoliciesCommand: { PolicyNames: ['inline-dynamodb-access'] },
      GetRolePolicyCommand: { PolicyDocument: inlineDocument },
    }),
  });

  const result = await reader.analyze({ profileId: 'local:dev', region });

  assert.deepEqual(result.resources.map(resource => resource.name).sort(), [
    'dispatch-jobs', 'dispatch-queue', 'dispatcher',
  ]);
  assert.deepEqual(result.relationships.map(relationship => relationship.relationType).sort(), ['accesses', 'accesses']);
  const evidence = result.relationships.flatMap(relationship => relationship.evidence);
  assert.deepEqual(evidence.map(item => item.type).sort(), ['iam_role_policy', 'iam_role_policy']);
  // 'Deny' statements and wildcard '*' resources must never be turned into a relationship
  assert.ok(!evidence.some(item => item.actions.includes('sqs:DeleteQueue')));
  assert.ok(!evidence.some(item => item.actions.includes('s3:GetObject')));
});

test('only runs Lambda static code analysis for functions explicitly opted in via lambdaCodeAnalysisNames', async () => {
  const region = 'us-east-1';
  const client = responses => ({ async send(command) { return responses[command.constructor.name] || {}; } });
  let analyzedFunctionNames = [];
  const codeReader = {
    async analyze({ functionName }) {
      analyzedFunctionNames.push(functionName);
      return {
        references: [{ type: 'sqs', name: 'dispatch-queue', arn: null, files: ['index.js'] }],
        sdkClients: ['sqs'],
      };
    },
  };
  const reader = createAwsRegionalInventoryReader({
    configResolver: async () => ({}),
    lambdaFactory: () => client({
      ListFunctionsCommand: {
        Functions: [
          { FunctionName: 'dispatcher', FunctionArn: `arn:aws:lambda:${region}:123456789012:function:dispatcher` },
          { FunctionName: 'other-fn', FunctionArn: `arn:aws:lambda:${region}:123456789012:function:other-fn` },
        ],
      },
    }),
    eventBridgeFactory: () => client({ ListEventBusesCommand: { EventBuses: [] } }),
    sfnFactory: () => client({ ListStateMachinesCommand: { stateMachines: [] } }),
    codeReader,
  });

  const result = await reader.analyze({ profileId: 'local:dev', region, lambdaCodeAnalysisNames: ['dispatcher'] });

  assert.deepEqual(analyzedFunctionNames, ['dispatcher']);
  assert.deepEqual(result.relationships.map(relationship => relationship.relationType), ['references']);
  assert.equal(result.relationships[0].evidence[0].type, 'lambda_code_reference');
});

test('never runs static code analysis when no codeReader is configured, even if names are provided', async () => {
  const region = 'us-east-1';
  const client = responses => ({ async send(command) { return responses[command.constructor.name] || {}; } });
  const reader = createAwsRegionalInventoryReader({
    configResolver: async () => ({}),
    lambdaFactory: () => client({
      ListFunctionsCommand: { Functions: [{ FunctionName: 'dispatcher', FunctionArn: `arn:aws:lambda:${region}:123456789012:function:dispatcher` }] },
    }),
    eventBridgeFactory: () => client({ ListEventBusesCommand: { EventBuses: [] } }),
    sfnFactory: () => client({ ListStateMachinesCommand: { stateMachines: [] } }),
  });

  const result = await reader.analyze({ profileId: 'local:dev', region, lambdaCodeAnalysisNames: ['dispatcher'] });

  assert.deepEqual(result.relationships, []);
});