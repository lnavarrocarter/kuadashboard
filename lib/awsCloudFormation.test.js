'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  STACK_REF_RE, statusGroup, listStacks, stackDetail, stackEvents, stackTemplate, startDriftDetection, driftResult, rootCause,
} = require('./awsCloudFormation');

class Command { constructor(input) { this.input = input; } }
const commands = {
  DescribeStacksCommand: class extends Command { get kind() { return 'DescribeStacks'; } },
  ListStackResourcesCommand: class extends Command { get kind() { return 'ListStackResources'; } },
  DescribeStackEventsCommand: class extends Command { get kind() { return 'DescribeStackEvents'; } },
  GetTemplateCommand: class extends Command { get kind() { return 'GetTemplate'; } },
  DetectStackDriftCommand: class extends Command { get kind() { return 'DetectStackDrift'; } },
  DescribeStackDriftDetectionStatusCommand: class extends Command { get kind() { return 'DriftStatus'; } },
  DescribeStackResourceDriftsCommand: class extends Command { get kind() { return 'ResourceDrifts'; } },
};

function fakeClient(handlers) {
  const calls = [];
  return { calls, async send(command) { calls.push([command.kind, command.input]); return handlers[command.kind](command.input, calls.length); } };
}

const ARN = 'arn:aws:cloudformation:us-east-1:111111111111:stack/orders-api/12345678-1234-1234-1234-123456789012';

test('stack references accept names and stack ARNs only', () => {
  assert.ok(STACK_REF_RE.test('orders-api'));
  assert.ok(STACK_REF_RE.test(ARN));
  assert.ok(!STACK_REF_RE.test('1-starts-with-digit'));
  assert.ok(!STACK_REF_RE.test('a b'));
});

test('statusGroup groups CloudFormation statuses', () => {
  assert.equal(statusGroup('CREATE_COMPLETE'), 'ok');
  assert.equal(statusGroup('UPDATE_IN_PROGRESS'), 'progress');
  assert.equal(statusGroup('UPDATE_ROLLBACK_IN_PROGRESS'), 'progress');
  assert.equal(statusGroup('UPDATE_ROLLBACK_COMPLETE'), 'rollback');
  assert.equal(statusGroup('ROLLBACK_FAILED'), 'rollback');
  assert.equal(statusGroup('CREATE_FAILED'), 'failed');
  assert.equal(statusGroup('REVIEW_IN_PROGRESS'), 'review');
});

test('listStacks pages through DescribeStacks and counts status groups', async () => {
  const client = fakeClient({
    DescribeStacks: input => (input.NextToken
      ? { Stacks: [{ StackId: 'b', StackName: 'agentcore-runtime', StackStatus: 'UPDATE_ROLLBACK_COMPLETE' }] }
      : {
        Stacks: [{
          StackId: ARN, StackName: 'orders-api', StackStatus: 'CREATE_COMPLETE', EnableTerminationProtection: true,
          Parameters: [{ ParameterKey: 'Env', ParameterValue: 'prod' }, { ParameterKey: 'Ami', ParameterValue: '/aws/ami', ResolvedValue: 'ami-123' }],
          Outputs: [{ OutputKey: 'Url', OutputValue: 'https://x', ExportName: 'orders-url' }],
          Tags: [{ Key: 'team', Value: 'core' }], DriftInformation: { StackDriftStatus: 'DRIFTED' },
        }],
        NextToken: 'n',
      }),
  });
  const result = await listStacks(client, commands);
  assert.deepEqual(result.counts, { ok: 1, rollback: 1 });
  const [orders, agentcore] = result.stacks;
  assert.equal(orders.terminationProtection, true);
  assert.equal(orders.drift.status, 'DRIFTED');
  assert.deepEqual(orders.parameters[1], { key: 'Ami', value: 'ami-123', resolvedFrom: '/aws/ami' });
  assert.equal(orders.outputs[0].exportName, 'orders-url');
  assert.deepEqual(orders.tags, { team: 'core' });
  assert.equal(agentcore.isAgentCore, true);
});

test('stackDetail links resources to KUA tabs', async () => {
  const client = fakeClient({
    DescribeStacks: () => ({ Stacks: [{ StackId: ARN, StackName: 'orders-api', StackStatus: 'UPDATE_COMPLETE' }] }),
    ListStackResources: () => ({ StackResourceSummaries: [
      { LogicalResourceId: 'Fn', PhysicalResourceId: 'orders-api-Fn-ABC', ResourceType: 'AWS::Lambda::Function', ResourceStatus: 'UPDATE_COMPLETE', DriftInformation: { StackResourceDriftStatus: 'MODIFIED' } },
      { LogicalResourceId: 'Queue', PhysicalResourceId: 'https://sqs.us-east-1.amazonaws.com/111111111111/orders-q', ResourceType: 'AWS::SQS::Queue', ResourceStatus: 'CREATE_COMPLETE' },
      { LogicalResourceId: 'Role', PhysicalResourceId: 'orders-role', ResourceType: 'AWS::IAM::Role', ResourceStatus: 'CREATE_COMPLETE' },
    ] }),
  });
  const detail = await stackDetail(client, commands, 'orders-api');
  assert.equal(client.calls[1][1].StackName, ARN, 'resources are listed by stack id');
  const byId = Object.fromEntries(detail.resources.map(r => [r.logicalId, r]));
  assert.deepEqual([byId.Fn.kuaTab, byId.Fn.kuaName, byId.Fn.drift], ['lambda', 'orders-api-Fn-ABC', 'MODIFIED']);
  assert.deepEqual([byId.Queue.kuaTab, byId.Queue.kuaName], ['sqs', 'orders-q']);
  assert.equal(byId.Role.kuaTab, null);
  assert.equal(detail.byType['AWS::Lambda::Function'], 1);
});

test('rootCause finds the first real failure of the latest operation', () => {
  const t = n => Date.UTC(2026, 9, 1, 12, 0, n);
  const events = [
    { timestamp: t(0), logicalId: 'orders-api', type: 'AWS::CloudFormation::Stack', status: 'CREATE_COMPLETE' },
    { timestamp: t(10), logicalId: 'orders-api', type: 'AWS::CloudFormation::Stack', status: 'UPDATE_IN_PROGRESS' },
    { timestamp: t(12), logicalId: 'Table', type: 'AWS::DynamoDB::Table', status: 'UPDATE_FAILED', reason: 'Resource handler returned message: "Table already exists"' },
    { timestamp: t(13), logicalId: 'Fn', type: 'AWS::Lambda::Function', status: 'UPDATE_FAILED', reason: 'Resource update cancelled' },
    { timestamp: t(14), logicalId: 'orders-api', type: 'AWS::CloudFormation::Stack', status: 'UPDATE_ROLLBACK_IN_PROGRESS', reason: 'The following resource(s) failed to update: [Table]' },
    { timestamp: t(20), logicalId: 'orders-api', type: 'AWS::CloudFormation::Stack', status: 'UPDATE_ROLLBACK_COMPLETE' },
  ];
  assert.equal(rootCause(events, 'orders-api').logicalId, 'Table');
  assert.equal(rootCause(events.slice(0, 2), 'orders-api'), null);
});

test('stackEvents, template and drift detection', async () => {
  const client = fakeClient({
    DescribeStackEvents: () => ({ StackEvents: [
      { EventId: '1', Timestamp: new Date(1000), LogicalResourceId: 's', ResourceType: 'AWS::CloudFormation::Stack', ResourceStatus: 'CREATE_IN_PROGRESS' },
      { EventId: '2', Timestamp: new Date(2000), LogicalResourceId: 'Bucket', ResourceType: 'AWS::S3::Bucket', ResourceStatus: 'CREATE_FAILED', ResourceStatusReason: 'already exists' },
    ] }),
    GetTemplate: () => ({ TemplateBody: 'AWSTemplateFormatVersion: "2010-09-09"\nResources: {}' }),
    DetectStackDrift: () => ({ StackDriftDetectionId: 'abc' }),
    DriftStatus: (input, n) => (n === 4
      ? { DetectionStatus: 'DETECTION_IN_PROGRESS' }
      : { DetectionStatus: 'DETECTION_COMPLETE', StackDriftStatus: 'DRIFTED', DriftedStackResourceCount: 1 }),
    ResourceDrifts: input => {
      assert.deepEqual(input.StackResourceDriftStatusFilters, ['MODIFIED', 'DELETED']);
      return { StackResourceDrifts: [{ LogicalResourceId: 'Fn', ResourceType: 'AWS::Lambda::Function', StackResourceDriftStatus: 'MODIFIED',
        PropertyDifferences: [{ PropertyPath: '/MemorySize', ExpectedValue: '128', ActualValue: '512', DifferenceType: 'NOT_EQUAL' }] }] };
    },
  });
  const events = await stackEvents(client, commands, 's', { stackName: 's' });
  assert.equal(events.events[0].id, '2', 'newest first');
  assert.equal(events.rootCause.logicalId, 'Bucket');
  const template = await stackTemplate(client, commands, 's');
  assert.equal(template.format, 'yaml');
  assert.equal(client.calls.at(-1)[1].TemplateStage, 'Original');
  assert.deepEqual(await startDriftDetection(client, commands, 's'), { detectionId: 'abc' });
  const running = await driftResult(client, commands, 's', 'abc');
  assert.deepEqual([running.detectionStatus, running.resources], ['DETECTION_IN_PROGRESS', []]);
  const done = await driftResult(client, commands, 's', 'abc');
  assert.equal(done.stackDriftStatus, 'DRIFTED');
  assert.deepEqual(done.resources[0].differences[0], { path: '/MemorySize', expected: '128', actual: '512', type: 'NOT_EQUAL' });
});
