'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { AwsGlueCollector, glueJobName } = require('./awsGlueCollector');
const { metricPlan } = require('./awsMetricCollector');
const { signalCapabilities } = require('./signalCapabilities');
const { estimateCollectionCost } = require('./collectionCost');

const JOB = { id: 'r1', type: 'glue', arn: 'arn:aws:glue:us-east-1:111111111111:job/nightly-etl', name: 'nightly-etl' };
const NOW = Date.parse('2026-10-15T12:00:00Z');

function database() {
  const cursors = new Map();
  const batches = [];
  return {
    batches,
    getCursor: id => cursors.get(id) || null,
    commitMetricBatch(id, source, buckets, { timestamp }) { batches.push({ id, source, buckets }); cursors.set(id, { timestamp }); },
  };
}

test('collects the runs of a Glue job since the last collection, with failures and durations (#286)', async () => {
  const db = database();
  const pages = [
    { JobRuns: [
      { StartedOn: new Date(NOW - 60_000), JobRunState: 'RUNNING' },
      { StartedOn: new Date(NOW - 3_600_000), JobRunState: 'FAILED', ExecutionTime: 120 },
    ], NextToken: 'n' },
    { JobRuns: [
      { StartedOn: new Date(NOW - 7_200_000), JobRunState: 'SUCCEEDED', ExecutionTime: 300 },
      { StartedOn: new Date(NOW - 2 * 86_400_000), JobRunState: 'SUCCEEDED', ExecutionTime: 300 },
    ], NextToken: 'older' },
  ];
  const sent = [];
  const collector = new AwsGlueCollector({
    database: db, configResolver: async () => ({}), now: () => NOW,
    clientFactory: () => ({ async send(command) { sent.push(command.input); return pages[sent.length - 1]; } }),
  });
  const result = await collector.collect({ application: { profileId: 'local:dev', region: 'us-east-1' }, resource: JOB });
  assert.deepEqual([result.status, result.requests, result.runs], ['completed', 2, 3], 'stops at runs older than the window');
  assert.equal(sent[0].JobName, 'nightly-etl');
  const total = name => db.batches[0].buckets.filter(bucket => bucket.metricName === name).reduce((sum, bucket) => sum + bucket.sum, 0);
  assert.deepEqual([total('glue_job_runs'), total('glue_job_failed_runs'), total('glue_job_duration_seconds')], [3, 1, 420]);
  assert.equal(db.batches[0].source, 'glue');
});

test('Glue jobs and the CloudWatch types of #286 claim metrics; crawlers do not', () => {
  assert.equal(glueJobName({ arn: 'arn:aws:glue:us-east-1:1:crawler/c' }), '');
  assert.equal(signalCapabilities(JOB).metrics, true);
  assert.equal(signalCapabilities({ type: 'glue', arn: 'arn:aws:glue:us-east-1:1:crawler/c' }).metrics, false);
  for (const resource of [
    { type: 'sqs', arn: 'arn:aws:sqs:us-east-1:1:orders' },
    { type: 'dynamodb', arn: 'arn:aws:dynamodb:us-east-1:1:table/orders' },
    { type: 'rds', arn: 'arn:aws:rds:us-east-1:1:db:main' },
    { type: 'ebs-volume', arn: 'arn:aws:ec2:us-east-1:1:volume/vol-0ab' },
  ]) assert.equal(signalCapabilities(resource).metrics, true, resource.type);
});

test('the plans use the dimension CloudWatch expects for each service, and the cost estimate counts them', () => {
  assert.deepEqual(metricPlan({ type: 'apigateway', arn: 'arn:aws:apigateway:us-east-1::/restapis/abc', name: 'shop' }).dimensions, [{ Name: 'ApiName', Value: 'shop' }]);
  assert.deepEqual(metricPlan({ type: 'apigateway', arn: 'arn:aws:apigateway:us-east-1::/apis/xyz' }).dimensions, [{ Name: 'ApiId', Value: 'xyz' }]);
  assert.deepEqual(metricPlan({ type: 'stepfunctions', arn: 'arn:aws:states:us-east-1:1:stateMachine:o' }).dimensions, [{ Name: 'StateMachineArn', Value: 'arn:aws:states:us-east-1:1:stateMachine:o' }]);
  assert.equal(metricPlan({ type: 'ses', arn: 'arn:aws:ses:us-east-1:1:identity/x.com' }).dimensions.length, 0, 'SES reputation is per account');
  assert.equal(metricPlan({ type: 'eventbridge', arn: 'arn:aws:events:us-east-1:1:rule/r' }), null);
  const cost = estimateCollectionCost([{ type: 'sqs', arn: 'arn:aws:sqs:us-east-1:1:orders' }, { type: 'dynamodb', arn: 'arn:aws:dynamodb:us-east-1:1:table/orders' }, JOB]);
  assert.equal(cost.perRun.metrics, 7, '3 SQS + 4 DynamoDB; Glue runs are free');
});
