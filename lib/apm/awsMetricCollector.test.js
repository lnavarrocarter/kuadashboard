'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { AwsMetricCollector, ec2InstanceId, metricPlan, s3BucketName } = require('./awsMetricCollector');

function fixture({ reservationAllowed = true, results = [] } = {}) {
  const commits = [];
  const reservations = [];
  const commands = [];
  const database = {
    getCursor() { return null; },
    reserveAwsRequests(input) {
      reservations.push(input);
      return { allowed: reservationAllowed };
    },
    commitMetricBatch(...args) { commits.push(args); },
  };
  const collector = new AwsMetricCollector({
    database,
    now: () => Date.UTC(2026, 7, 4, 12, 0),
    configResolver: async profileId => ({ credentials: `credentials:${profileId}` }),
    clientFactory(config) {
      assert.equal(config.region, 'us-east-1');
      return {
        async send(command) {
          commands.push(command);
          return { MetricDataResults: results };
        },
      };
    },
  });
  return { collector, commits, reservations, commands };
}

const application = { profileId: 'local:dev', region: 'us-east-1' };

test('resolves the instance and bucket a resource points at, however it was discovered', () => {
  assert.equal(ec2InstanceId({ arn: 'arn:aws:ec2:us-east-1:123:instance/i-0abc' }), 'i-0abc');
  assert.equal(ec2InstanceId({ instanceId: 'i-0def' }), 'i-0def');
  assert.equal(ec2InstanceId({ name: 'i-0aaa' }), 'i-0aaa');
  // A security group is also an "ec2" resource but has no instance to measure.
  assert.equal(ec2InstanceId({ name: 'sg-0123' }), '');
  assert.equal(s3BucketName({ arn: 'arn:aws:s3:::orders-bucket' }), 'orders-bucket');
  assert.equal(s3BucketName({ name: 'orders-bucket' }), 'orders-bucket');
});

test('never bills CloudWatch for a resource type or shape it cannot measure', async () => {
  assert.equal(metricPlan({ type: 'iam', name: 'role' }), null);
  assert.equal(metricPlan({ type: 'ec2', name: 'sg-0123' }), null);

  const subject = fixture();
  const result = await subject.collector.collect({
    application, resource: { id: 'sg-1', type: 'ec2', name: 'sg-0123' },
  });

  assert.deepEqual(result, { status: 'topology_only', requests: 0, backlog: false });
  assert.equal(subject.reservations.length, 0, 'budget must not be reserved for something never requested');
  assert.equal(subject.commands.length, 0);
});

test('reads EC2 metrics with one billable request covering every metric of the instance', async () => {
  const timestamp = Date.UTC(2026, 7, 4, 11, 30);
  const subject = fixture({ results: [
    { Id: 'cpu', Timestamps: [new Date(timestamp)], Values: [42.5] },
    { Id: 'netin', Timestamps: [new Date(timestamp)], Values: [2048] },
  ] });

  const result = await subject.collector.collect({
    application, resource: { id: 'ec2-1', type: 'ec2', name: 'worker', arn: 'arn:aws:ec2:us-east-1:123:instance/i-0abc' },
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.requests, 1, 'CloudWatch bills per request, so all metrics travel in one call');
  assert.equal(subject.reservations[0].operation, 'GetMetricData');
  const [resourceId, source, buckets] = subject.commits[0];
  assert.equal(resourceId, 'ec2-1');
  assert.equal(source, 'cloudwatch');
  assert.equal(buckets.find(bucket => bucket.metricName === 'cpu_percent').sum, 42.5);
  assert.equal(buckets.find(bucket => bucket.metricName === 'network_in_bytes').sum, 2048);
  const queries = subject.commands[0].input.MetricDataQueries;
  assert.equal(queries[0].MetricStat.Metric.Namespace, 'AWS/EC2');
  assert.deepEqual(queries[0].MetricStat.Metric.Dimensions, [{ Name: 'InstanceId', Value: 'i-0abc' }]);
});

test('asks S3 for daily storage metrics, which is the only rate they are published at', async () => {
  const subject = fixture({ results: [] });
  await subject.collector.collect({
    application, resource: { id: 's3-1', type: 's3', name: 'orders-bucket', arn: 'arn:aws:s3:::orders-bucket' },
  });

  const queries = subject.commands[0].input.MetricDataQueries;
  assert.equal(queries[0].MetricStat.Period, 86400);
  assert.deepEqual(queries[0].MetricStat.Metric.Dimensions, [
    { Name: 'BucketName', Value: 'orders-bucket' },
    { Name: 'StorageType', Value: 'StandardStorage' },
  ]);
});

test('reserves the budget before spending it, and stops when it is exhausted', async () => {
  const subject = fixture({ reservationAllowed: false });
  const result = await subject.collector.collect({
    application, resource: { id: 'ec2-1', type: 'ec2', arn: 'arn:aws:ec2:us-east-1:123:instance/i-0abc' },
  });

  assert.equal(result.status, 'budget_exhausted');
  assert.equal(result.requests, 0);
  assert.equal(subject.commands.length, 0, 'no AWS call may happen once the budget is exhausted');
});

test('reports the spent request when CloudWatch fails, so the budget stays honest', async () => {
  const subject = fixture();
  subject.collector.clientFactory = () => ({
    async send() { throw Object.assign(new Error('Throttled'), { name: 'ThrottlingException' }); },
  });

  await assert.rejects(
    subject.collector.collect({
      application, resource: { id: 'ec2-1', type: 'ec2', arn: 'arn:aws:ec2:us-east-1:123:instance/i-0abc' },
    }),
    error => error.name === 'ThrottlingException' && error.apmRequestCount === 1,
  );
});
