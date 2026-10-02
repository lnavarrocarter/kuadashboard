'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('zlib');
const {
  classifyLogGroup, listLogGroups, listLogStreams, listSubscriptions, buildBackupCoverage, listS3LogSources, decodeArchive,
} = require('./awsLogGroups');

class Command { constructor(input) { this.input = input; } }

test('classifyLogGroup separates AWS services, machines and custom groups', () => {
  assert.deepEqual(classifyLogGroup('/aws/lambda/orders-api'), { kind: 'aws', service: 'lambda', resource: 'orders-api' });
  assert.deepEqual(classifyLogGroup('/ecs/web'), { kind: 'aws', service: 'ecs', resource: 'web' });
  assert.deepEqual(classifyLogGroup('API-Gateway-Execution-Logs_abc123/prod'), { kind: 'aws', service: 'apigw', resource: 'abc123' });
  assert.equal(classifyLogGroup('/aws/vendedlogs/states/flow-Logs').service, 'stepfn');
  assert.deepEqual(classifyLogGroup('/var/log/messages'), { kind: 'machine', service: 'ec2', resource: null });
  assert.deepEqual(classifyLogGroup('app-i-0123456789abcdef0'), { kind: 'machine', service: 'ec2', resource: 'i-0123456789abcdef0' });
  assert.deepEqual(classifyLogGroup('my-app/backend'), { kind: 'custom', service: null, resource: null });
});

test('listLogGroups follows pages and reports truncation', async () => {
  const pages = [
    { logGroups: [{ logGroupName: '/aws/lambda/a', storedBytes: 10, retentionInDays: 14 }], nextToken: 'n' },
    { logGroups: [{ logGroupName: '/var/log/syslog' }], nextToken: 'm' },
  ];
  let call = 0;
  const client = { async send() { return pages[call++]; } };
  const { groups, truncated } = await listLogGroups(client, { DescribeLogGroupsCommand: Command }, { maxPages: 2 });
  assert.equal(groups.length, 2);
  assert.equal(groups[0].service, 'lambda');
  assert.equal(groups[1].kind, 'machine');
  assert.equal(groups[1].storedBytes, 0);
  assert.equal(truncated, true);
});

test('listLogStreams detects the EC2 instances that write to a group', async () => {
  const client = { async send(command) {
    assert.equal(command.input.orderBy, 'LastEventTime');
    return { logStreams: [{ logStreamName: 'i-0aaaaaaaaaaaaaaa1' }, { logStreamName: 'i-0aaaaaaaaaaaaaaa1/app' }, { logStreamName: 'web' }] };
  } };
  const result = await listLogStreams(client, { DescribeLogStreamsCommand: Command }, '/var/log/messages');
  assert.deepEqual(result.instances, ['i-0aaaaaaaaaaaaaaa1']);
  assert.equal(result.streams[2].instanceId, null);
});

test('listSubscriptions keeps groups with filters and per-group errors', async () => {
  const client = { async send(command) {
    const name = command.input.logGroupName;
    if (name === '/b') throw new Error('throttled');
    if (name === '/c') return { subscriptionFilters: [] };
    return { subscriptionFilters: [{ filterName: 'to-s3', destinationArn: 'arn:aws:firehose:us-east-1:1:deliverystream/logs' }] };
  } };
  const result = await listSubscriptions(client, { DescribeSubscriptionFiltersCommand: Command }, ['/a', '/b', '/c']);
  assert.equal(result['/a'][0].kind, 'firehose');
  assert.equal(result['/b'].error, 'throttled');
  assert.equal(result['/c'], undefined);
});

test('buildBackupCoverage marks continuous, exported and unprotected groups', () => {
  const now = Date.now();
  const groups = [
    { name: '/a', retentionInDays: 30 },
    { name: '/b', retentionInDays: 7 },
    { name: '/c', retentionInDays: 7 },
    { name: '/d', retentionInDays: null },
  ];
  const coverage = buildBackupCoverage(groups, {
    subscriptions: { '/a': [{ kind: 'firehose', destinationArn: 'arn:aws:firehose:x' }] },
    exportTasks: [
      { taskId: 't1', logGroup: '/b', status: 'COMPLETED', to: now - 30 * 86400000, bucket: 'bk', prefix: 'exp' },
      { taskId: 't2', logGroup: '/b', status: 'FAILED', to: now },
    ],
  });
  const byName = Object.fromEntries(coverage.map(c => [c.name, c]));
  assert.equal(byName['/a'].method, 'continuous');
  assert.equal(byName['/b'].method, 'export');
  assert.equal(byName['/b'].risk, 'gap');
  assert.equal(byName['/b'].lastExport.taskId, 't1');
  assert.equal(byName['/c'].risk, 'expires');
  assert.equal(byName['/d'].risk, null);
});

test('listS3LogSources lists trails and S3 flow logs and keeps errors per source', async () => {
  class CloudTrailClient { async send() { return { trailList: [{ Name: 'org', S3BucketName: 'trail-bucket', S3KeyPrefix: 'ct', IsMultiRegionTrail: true }] }; } }
  class EC2Client { async send() { throw Object.assign(new Error('denied'), { name: 'AccessDenied' }); } }
  const sdk = pkg => ({ 'client-cloudtrail': { CloudTrailClient, DescribeTrailsCommand: Command }, 'client-ec2': { EC2Client, DescribeFlowLogsCommand: Command } })[pkg];
  const { sources, errors } = await listS3LogSources({}, { sdk });
  assert.deepEqual(sources[0], { type: 'cloudtrail', name: 'org', bucket: 'trail-bucket', prefix: 'ct/AWSLogs/', multiRegion: true, logGroup: null });
  assert.equal(errors[0].source, 'vpcflow');
});

test('decodeArchive inflates gzip exports and caps the text', async () => {
  const gz = zlib.gzipSync(Buffer.from('2026-10-01T00:00:00Z line one\nline two\n'));
  const decoded = await decodeArchive(gz, 'exportedlogs/task/stream/000000.gz');
  assert.equal(decoded.gzip, true);
  assert.equal(decoded.truncated, false);
  assert.match(decoded.text, /line two/);

  const big = zlib.gzipSync(Buffer.alloc(3 * 1024 * 1024, 'a'));
  const capped = await decodeArchive(big, 'x.gz');
  assert.equal(capped.truncated, true);
  assert.equal(capped.text.length, 2 * 1024 * 1024);

  const plain = await decodeArchive(Buffer.from('{"a":1}'), 'x.json');
  assert.deepEqual([plain.gzip, plain.json], [false, true]);
});
