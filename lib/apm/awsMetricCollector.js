'use strict';

const { CloudWatchClient, GetMetricDataCommand } = require('@aws-sdk/client-cloudwatch');
const { resolveAwsConfig } = require('../awsProfileResolver');
const { BUCKET_MS } = require('./lambdaLogMetrics');

const SOURCE = 'cloudwatch';
const PERIOD_SECONDS = 300;
const INITIAL_WINDOW_MS = 60 * 60 * 1000;
// CloudWatch bills GetMetricData per metric requested, so each resource is one call covering all of
// its metrics, and the window never reaches further back than this.
const MAX_WINDOW_MS = 24 * 60 * 60 * 1000;
// S3 storage metrics are only published once a day, so a 5-minute window would always be empty.
const DAILY_PERIOD_SECONDS = 86400;
const S3_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

const EC2_METRICS = [
  { id: 'cpu', metricName: 'CPUUtilization', stat: 'Average', metric: 'cpu_percent', unit: 'percent' },
  { id: 'netin', metricName: 'NetworkIn', stat: 'Sum', metric: 'network_in_bytes', unit: 'bytes' },
  { id: 'netout', metricName: 'NetworkOut', stat: 'Sum', metric: 'network_out_bytes', unit: 'bytes' },
  { id: 'status', metricName: 'StatusCheckFailed', stat: 'Maximum', metric: 'status_check_failed', unit: 'count' },
];

const S3_METRICS = [
  {
    id: 'size',
    metricName: 'BucketSizeBytes',
    stat: 'Average',
    metric: 'storage_bytes',
    unit: 'bytes',
    dimensions: [{ Name: 'StorageType', Value: 'StandardStorage' }],
  },
  {
    id: 'objects',
    metricName: 'NumberOfObjects',
    stat: 'Average',
    metric: 'object_count',
    unit: 'count',
    dimensions: [{ Name: 'StorageType', Value: 'AllStorageTypes' }],
  },
];

function ec2InstanceId(resource) {
  if (resource.instanceId) return String(resource.instanceId);
  const fromArn = /instance\/(i-[0-9a-f]+)/i.exec(String(resource.arn || ''));
  if (fromArn) return fromArn[1];
  return /^i-[0-9a-f]+$/i.test(String(resource.name || '')) ? String(resource.name) : '';
}

function s3BucketName(resource) {
  const fromArn = String(resource.arn || '').split(':::')[1];
  return (fromArn || resource.name || '').split('/')[0];
}

// What to ask CloudWatch for, per resource type. Anything absent has no CloudWatch namespace worth
// billing for and is reported as inventory only.
function metricPlan(resource) {
  if (resource.type === 'ec2') {
    const instanceId = ec2InstanceId(resource);
    if (!instanceId) return null;
    return {
      namespace: 'AWS/EC2',
      dimensions: [{ Name: 'InstanceId', Value: instanceId }],
      metrics: EC2_METRICS,
      periodSeconds: PERIOD_SECONDS,
      windowMs: INITIAL_WINDOW_MS,
    };
  }
  if (resource.type === 's3') {
    const bucket = s3BucketName(resource);
    if (!bucket) return null;
    return {
      namespace: 'AWS/S3',
      dimensions: [{ Name: 'BucketName', Value: bucket }],
      metrics: S3_METRICS,
      periodSeconds: DAILY_PERIOD_SECONDS,
      windowMs: S3_WINDOW_MS,
    };
  }
  return null;
}

function bucketsFromResults(results, plan) {
  const byId = new Map(plan.metrics.map(metric => [metric.id, metric]));
  const buckets = [];
  for (const result of results || []) {
    const definition = byId.get(result.Id);
    if (!definition) continue;
    const timestamps = result.Timestamps || [];
    const values = result.Values || [];
    for (let index = 0; index < timestamps.length; index += 1) {
      const value = Number(values[index]);
      if (!Number.isFinite(value)) continue;
      const bucketStart = Math.floor(new Date(timestamps[index]).getTime() / BUCKET_MS) * BUCKET_MS;
      buckets.push({
        bucketStart,
        metricName: definition.metric,
        unit: definition.unit,
        count: 1,
        sum: value,
        min: value,
        max: value,
        last: value,
        quality: 'full',
      });
    }
  }
  return buckets;
}

class AwsMetricCollector {
  constructor({
    database,
    configResolver = resolveAwsConfig,
    clientFactory = config => new CloudWatchClient(config),
    now = () => Date.now(),
  }) {
    if (!database) throw new Error('database is required');
    this.database = database;
    this.configResolver = configResolver;
    this.clientFactory = clientFactory;
    this.now = now;
  }

  supports(resource) {
    return !!metricPlan(resource || {});
  }

  async collect({ application, resource }) {
    if (!application?.profileId || !application?.region) throw new Error('Application profile and region are required');
    const plan = metricPlan(resource || {});
    if (!plan) return { status: 'topology_only', requests: 0, backlog: false };

    const reservation = this.database.reserveAwsRequests({
      profileId: application.profileId,
      region: application.region,
      operation: 'GetMetricData',
    });
    if (!reservation.allowed) return { status: 'budget_exhausted', requests: 0, backlog: true, budgetExhausted: true };

    const cursor = this.database.getCursor(resource.id, SOURCE) || {};
    const end = this.now();
    const start = Math.max(
      cursor.timestamp ? Number(cursor.timestamp) : end - plan.windowMs,
      end - MAX_WINDOW_MS,
    );
    const client = this.clientFactory({ ...await this.configResolver(application.profileId), region: application.region });

    let response;
    try {
      response = await client.send(new GetMetricDataCommand({
        StartTime: new Date(start),
        EndTime: new Date(end),
        ScanBy: 'TimestampAscending',
        MetricDataQueries: plan.metrics.map(metric => ({
          Id: metric.id,
          MetricStat: {
            Metric: {
              Namespace: plan.namespace,
              MetricName: metric.metricName,
              Dimensions: [...plan.dimensions, ...(metric.dimensions || [])],
            },
            Period: plan.periodSeconds,
            Stat: metric.stat,
          },
        })),
      }));
    } catch (error) {
      error.apmRequestCount = 1;
      throw error;
    }

    const buckets = bucketsFromResults(response.MetricDataResults, plan);
    this.database.commitMetricBatch(resource.id, SOURCE, buckets, { timestamp: end, state: {} });
    return {
      status: 'completed',
      requests: 1,
      backlog: false,
      metrics: buckets.length,
    };
  }
}

module.exports = {
  AwsMetricCollector,
  DAILY_PERIOD_SECONDS,
  PERIOD_SECONDS,
  SOURCE,
  ec2InstanceId,
  metricPlan,
  s3BucketName,
};
