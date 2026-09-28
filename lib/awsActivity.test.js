'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validLambdaFunctions, validStateMachines, logGroupNameFromArn, lambdaActivity, stepFunctionsActivity } = require('./awsActivity');

const NOW = Date.parse('2026-09-28T12:00:00Z');

function fakeSdk(handler) {
  return () => new Proxy({}, {
    get(_, name) {
      if (typeof name !== 'string') return undefined;
      if (name.endsWith('Client')) return class { send(command) { return handler(command.name, command.input); } };
      return class { constructor(input) { this.name = name; this.input = input; } };
    },
  });
}

test('validLambdaFunctions accepts names and log groups, defaulting the group', () => {
  assert.deepEqual(validLambdaFunctions([{ name: 'api' }, { name: 'job', logGroup: '/custom/group' }]), [
    { name: 'api', logGroup: '/aws/lambda/api' },
    { name: 'job', logGroup: '/custom/group' },
  ]);
  assert.equal(validLambdaFunctions([{ name: 'bad name' }]), null);
  assert.equal(validLambdaFunctions([{ name: 'x', logGroup: 'arn:aws:logs:x' }]), null);
  assert.equal(validLambdaFunctions('nope'), null);
});

test('validStateMachines only accepts state machine ARNs', () => {
  assert.deepEqual(validStateMachines([{ arn: 'arn:aws:states:us-east-1:123456789012:stateMachine:Flow_1' }]), [{ arn: 'arn:aws:states:us-east-1:123456789012:stateMachine:Flow_1' }]);
  assert.equal(validStateMachines([{ arn: 'arn:aws:lambda:us-east-1:123456789012:function:x' }]), null);
});

test('logGroupNameFromArn reads the group from a logging destination', () => {
  assert.equal(logGroupNameFromArn('arn:aws:logs:us-east-1:1:log-group:/aws/vendedlogs/states/Flow-Logs:*'), '/aws/vendedlogs/states/Flow-Logs');
  assert.equal(logGroupNameFromArn(null), null);
});

test('lambdaActivity sums 24h invocations/errors and classifies log groups', async () => {
  const describe = [];
  const sdk = fakeSdk(async (name, input) => {
    if (name === 'GetMetricDataCommand') {
      assert.equal(input.StartTime.getTime(), NOW - 86400000);
      return { MetricDataResults: [
        { Id: 'q0_0', Values: [10, 5] }, { Id: 'q0_1', Values: [1] },
        { Id: 'q1_0', Values: [] }, { Id: 'q1_1', Values: [] },
      ] };
    }
    if (name === 'DescribeLogGroupsCommand') {
      describe.push(input.logGroupNamePrefix);
      if (input.logGroupNamePrefix === '/aws/lambda/') {
        return input.nextToken
          ? { logGroups: [{ logGroupName: '/aws/lambda/idle', storedBytes: 0 }] }
          : { logGroups: [{ logGroupName: '/aws/lambda/api', storedBytes: 2048, retentionInDays: 14 }], nextToken: 'p2' };
      }
      return { logGroups: [{ logGroupName: '/custom/job', storedBytes: 10 }] };
    }
    throw new Error(name);
  });
  const out = await lambdaActivity({}, [
    { name: 'api', logGroup: '/aws/lambda/api' },
    { name: 'job', logGroup: '/custom/job' },
    { name: 'idle', logGroup: '/aws/lambda/idle' },
    { name: 'gone', logGroup: '/aws/lambda/gone' },
  ], { sdk, now: NOW });
  assert.deepEqual(out.functions.api, { invocations: 15, errors: 1, logGroup: '/aws/lambda/api', logStatus: 'ok', storedBytes: 2048, retentionInDays: 14 });
  assert.equal(out.functions.job.logStatus, 'ok');
  assert.equal(out.functions.idle.logStatus, 'empty');
  assert.equal(out.functions.gone.logStatus, 'missing');
  assert.equal(out.functions.gone.invocations, 0);
  assert.deepEqual(describe, ['/aws/lambda/', '/aws/lambda/', '/custom/job']);
  assert.equal(out.metricsError, null);
});

test('lambdaActivity degrades metrics and logs separately, with access requests', async () => {
  const sdk = fakeSdk(async name => {
    if (name === 'GetMetricDataCommand') return { MetricDataResults: [] };
    throw Object.assign(new Error('User: arn:aws:iam::1:user/dev is not authorized to perform: logs:DescribeLogGroups on resource: *'), { name: 'AccessDeniedException' });
  });
  const out = await lambdaActivity({}, [{ name: 'api', logGroup: '/aws/lambda/api' }], { sdk, now: NOW });
  assert.equal(out.functions.api.logStatus, 'unknown');
  assert.equal(out.functions.api.invocations, 0);
  assert.equal(out.logsError.error.action, 'logs:DescribeLogGroups');
  assert.equal(out.logsError.access.failedAction, 'logs:DescribeLogGroups');
});

test('lambdaActivity batches metric queries 500 per call, in parallel', async () => {
  let calls = 0;
  let inFlight = 0;
  let peak = 0;
  const sdk = fakeSdk(async (name, input) => {
    if (name === 'DescribeLogGroupsCommand') return { logGroups: [] };
    calls += 1;
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    assert.ok(input.MetricDataQueries.length <= 500);
    await new Promise(resolve => setTimeout(resolve, 5));
    inFlight -= 1;
    return { MetricDataResults: [] };
  });
  const functions = Array.from({ length: 300 }, (_, i) => ({ name: `fn${i}`, logGroup: `/aws/lambda/fn${i}` }));
  await lambdaActivity({}, functions, { sdk, now: NOW });
  assert.equal(calls, 2);
  assert.equal(peak, 2);
});

test('stepFunctionsActivity reads 24h executions and logging settings', async () => {
  const arn = 'arn:aws:states:us-east-1:1:stateMachine:Flow';
  const sdk = fakeSdk(async (name, input) => {
    if (name === 'GetMetricDataCommand') {
      const ids = input.MetricDataQueries.map(q => `${q.Id}:${q.MetricStat.Metric.MetricName}`);
      assert.deepEqual(ids, ['q0_0:ExecutionsStarted', 'q0_1:ExecutionsSucceeded', 'q0_2:ExecutionsFailed', 'q0_3:ExecutionsTimedOut', 'q0_4:ExecutionsAborted']);
      return { MetricDataResults: [{ Id: 'q0_0', Values: [6, 4] }, { Id: 'q0_2', Values: [3] }] };
    }
    if (name === 'DescribeStateMachineCommand') {
      assert.equal(input.stateMachineArn, arn);
      return { loggingConfiguration: { level: 'ERROR', includeExecutionData: false, destinations: [{ cloudWatchLogsLogGroup: { logGroupArn: 'arn:aws:logs:us-east-1:1:log-group:/aws/vendedlogs/states/Flow:*' } }] } };
    }
    throw new Error(name);
  });
  const out = await stepFunctionsActivity({}, [{ arn }], { sdk, now: NOW });
  assert.deepEqual(out.stateMachines[arn], {
    executions: { started: 10, succeeded: 0, failed: 3, timedOut: 0, aborted: 0 },
    logging: { level: 'ERROR', includeExecutionData: false, logGroup: '/aws/vendedlogs/states/Flow' },
  });
});

test('stepFunctionsActivity reports machines without logging as OFF', async () => {
  const arn = 'arn:aws:states:us-east-1:1:stateMachine:Quiet';
  const sdk = fakeSdk(async name => (name === 'GetMetricDataCommand' ? { MetricDataResults: [] } : {}));
  const out = await stepFunctionsActivity({}, [{ arn }], { sdk, now: NOW });
  assert.deepEqual(out.stateMachines[arn].logging, { level: 'OFF', includeExecutionData: false, logGroup: null });
});
