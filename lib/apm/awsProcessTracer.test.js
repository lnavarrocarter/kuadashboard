'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createAwsProcessTracer } = require('./awsProcessTracer');

test('finds a request in execution input and returns sanitized timeline', async () => {
  const reader = createAwsProcessTracer({
    configResolver: async () => ({}),
    clientFactory: () => ({ async send(command) {
      if (command.constructor.name === 'ListExecutionsCommand') return { executions: [{ executionArn: 'arn:execution:one' }] };
      if (command.constructor.name === 'DescribeExecutionCommand') return {
        executionArn: 'arn:execution:one', stateMachineArn: 'arn:state:flow', status: 'SUCCEEDED',
        input: '{"requestId":"req-123","secret":"hidden"}', startDate: new Date('2026-08-11T10:00:00Z'), stopDate: new Date('2026-08-11T10:00:01Z'),
      };
      return { events: [{ id: 1, type: 'ExecutionStarted' }, { id: 2, type: 'ExecutionSucceeded' }] };
    } }),
  });
  const result = await reader.trace({
    application: { profileId: 'local:prod', region: 'us-east-1' },
    resources: [{ type: 'stepfunctions', arn: 'arn:state:flow', enabled: true }], requestId: 'req-123',
  });
  assert.equal(result.traces.length, 1);
  assert.deepEqual(result.traces[0].matchPaths, ['$.requestId']);
  assert.equal(result.traces[0].inputShape.secret, 'string');
  assert.equal(JSON.stringify(result).includes('hidden'), false);
});

test('reserves budget before every AWS read and stops before a rejected request', async () => {
  let sent = 0;
  let reservations = 0;
  const reader = createAwsProcessTracer({
    configResolver: async () => ({}),
    clientFactory: () => ({ async send() { sent += 1; return { executions: [] }; } }),
  });
  await assert.rejects(() => reader.trace({
    application: { profileId: 'local:prod', region: 'us-east-1' },
    resources: [{ type: 'stepfunctions', arn: 'arn:state:flow', enabled: true }],
    requestId: 'req-123',
    database: { reserveAwsRequests() { reservations += 1; return { allowed: false }; } },
  }), error => error.code === 'budget_exhausted' && error.statusCode === 429);
  assert.equal(reservations, 1);
  assert.equal(sent, 0);
});

test('traces the latest execution from an associated Step Function ARN', async () => {
  const commands = [];
  let historyInput;
  const reader = createAwsProcessTracer({
    configResolver: async () => ({}),
    clientFactory: () => ({ async send(command) {
      commands.push(command.constructor.name);
      if (command.constructor.name === 'ListExecutionsCommand') return { executions: [{ executionArn: 'arn:execution:latest' }] };
      if (command.constructor.name === 'DescribeExecutionCommand') return {
        executionArn: 'arn:execution:latest', stateMachineArn: 'arn:aws:states:us-east-1:123:stateMachine:orders',
        status: 'SUCCEEDED', input: '{}', startDate: new Date('2026-08-11T10:00:00Z'), stopDate: new Date('2026-08-11T10:00:01Z'),
      };
      historyInput = command.input;
      return { events: [{ id: 1, type: 'ExecutionSucceeded', executionSucceededEventDetails: { output: '{"token":"private","result":"ok"}' } }] };
    } }),
  });
  const result = await reader.trace({
    application: { profileId: 'local:prod', region: 'us-east-1' },
    resources: [{ type: 'stepfunctions', arn: 'arn:aws:states:us-east-1:123:stateMachine:orders', enabled: true }],
    stateMachineArn: 'arn:aws:states:us-east-1:123:stateMachine:orders',
    includeData: true,
  });
  assert.deepEqual(commands, ['ListExecutionsCommand', 'DescribeExecutionCommand', 'GetExecutionHistoryCommand']);
  assert.equal(result.traces[0].executionArn, 'arn:execution:latest');
  assert.equal(result.availableExecutions.length, 1);
  assert.equal(result.traces[0].timeline[0].data.response.token, '[redacted]');
  assert.equal(historyInput.includeExecutionData, true);
});

test('accepts an execution from an associated Step Function alias', async () => {
  const reader = createAwsProcessTracer({
    configResolver: async () => ({}),
    clientFactory: () => ({ async send(command) {
      if (command.constructor.name === 'DescribeExecutionCommand') return {
        executionArn: 'arn:execution:alias',
        stateMachineArn: 'arn:aws:states:us-east-1:123:stateMachine:orders:PROD',
        status: 'RUNNING', input: '{}', startDate: new Date('2026-08-11T10:00:00Z'),
      };
      return { events: [] };
    } }),
  });
  const result = await reader.trace({
    application: { profileId: 'local:prod', region: 'us-east-1' },
    resources: [{ type: 'stepfunctions', arn: 'arn:aws:states:us-east-1:123:stateMachine:orders', enabled: true }],
    executionArn: 'arn:execution:alias',
  });
  assert.equal(result.traces.length, 1);
});