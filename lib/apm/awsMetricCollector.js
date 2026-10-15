'use strict';

const { lazyModule } = require('../lazyModule');
const cloudwatchSdk = lazyModule('@aws-sdk/client-cloudwatch');
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

// #286: one GetMetricData call per resource, a few metrics each (USD 0.01 per 1,000 metrics).
const SQS_METRICS = [
  { id: 'visible', metricName: 'ApproximateNumberOfMessagesVisible', stat: 'Maximum', metric: 'sqs_messages_visible', unit: 'count' },
  { id: 'oldest', metricName: 'ApproximateAgeOfOldestMessage', stat: 'Maximum', metric: 'sqs_oldest_message_age_seconds', unit: 'seconds' },
  { id: 'sent', metricName: 'NumberOfMessagesSent', stat: 'Sum', metric: 'sqs_messages_sent', unit: 'count' },
];
const SNS_METRICS = [
  { id: 'published', metricName: 'NumberOfMessagesPublished', stat: 'Sum', metric: 'sns_messages_published', unit: 'count' },
  { id: 'failed', metricName: 'NumberOfNotificationsFailed', stat: 'Sum', metric: 'sns_notifications_failed', unit: 'count' },
];
const DYNAMODB_METRICS = [
  { id: 'rcu', metricName: 'ConsumedReadCapacityUnits', stat: 'Sum', metric: 'dynamodb_consumed_read_units', unit: 'count' },
  { id: 'wcu', metricName: 'ConsumedWriteCapacityUnits', stat: 'Sum', metric: 'dynamodb_consumed_write_units', unit: 'count' },
  { id: 'readThrottles', metricName: 'ReadThrottleEvents', stat: 'Sum', metric: 'dynamodb_read_throttle_events', unit: 'count' },
  { id: 'writeThrottles', metricName: 'WriteThrottleEvents', stat: 'Sum', metric: 'dynamodb_write_throttle_events', unit: 'count' },
];
const STATES_METRICS = [
  { id: 'started', metricName: 'ExecutionsStarted', stat: 'Sum', metric: 'sfn_executions_started', unit: 'count' },
  { id: 'failed', metricName: 'ExecutionsFailed', stat: 'Sum', metric: 'sfn_executions_failed', unit: 'count' },
  { id: 'duration', metricName: 'ExecutionTime', stat: 'Average', metric: 'sfn_execution_time_ms', unit: 'milliseconds' },
];
const RDS_METRICS = [
  { id: 'cpu', metricName: 'CPUUtilization', stat: 'Average', metric: 'rds_cpu_percent', unit: 'percent' },
  { id: 'connections', metricName: 'DatabaseConnections', stat: 'Average', metric: 'rds_connections', unit: 'count' },
  { id: 'freeStorage', metricName: 'FreeStorageSpace', stat: 'Minimum', metric: 'rds_free_storage_bytes', unit: 'bytes' },
];
const REST_API_METRICS = [
  { id: 'requests', metricName: 'Count', stat: 'Sum', metric: 'apigw_requests', unit: 'count' },
  { id: 'errors5xx', metricName: '5XXError', stat: 'Sum', metric: 'apigw_5xx_errors', unit: 'count' },
  { id: 'latency', metricName: 'Latency', stat: 'Average', metric: 'apigw_latency_ms', unit: 'milliseconds' },
];
const HTTP_API_METRICS = [
  { id: 'requests', metricName: 'Count', stat: 'Sum', metric: 'apigw_requests', unit: 'count' },
  { id: 'errors5xx', metricName: '5xx', stat: 'Sum', metric: 'apigw_5xx_errors', unit: 'count' },
  { id: 'latency', metricName: 'Latency', stat: 'Average', metric: 'apigw_latency_ms', unit: 'milliseconds' },
];
// Reputation is per account and region in CloudWatch, not per identity.
const SES_METRICS = [
  { id: 'bounce', metricName: 'Reputation.BounceRate', stat: 'Average', metric: 'ses_bounce_rate', unit: 'ratio' },
  { id: 'complaint', metricName: 'Reputation.ComplaintRate', stat: 'Average', metric: 'ses_complaint_rate', unit: 'ratio' },
];
const EBS_METRICS = [
  { id: 'queue', metricName: 'VolumeQueueLength', stat: 'Average', metric: 'ebs_queue_length', unit: 'count' },
  { id: 'burst', metricName: 'BurstBalance', stat: 'Minimum', metric: 'ebs_burst_balance_percent', unit: 'percent' },
];

const arnTail = resource => String(resource.arn || resource.key || '').split(':').slice(5).join(':');
const arnName = resource => {
  const tail = arnTail(resource);
  return tail ? tail.split(/[/:]/).pop() : String(resource.name || '');
};
const plan = (namespace, dimensions, metrics) => ({ namespace, dimensions, metrics, periodSeconds: PERIOD_SECONDS, windowMs: INITIAL_WINDOW_MS });

/** The CloudWatch plan of the types added by #286, or null. */
function servicePlan(resource) {
  switch (resource.type) {
    case 'sqs': {
      const name = arnName(resource);
      return name ? plan('AWS/SQS', [{ Name: 'QueueName', Value: name }], SQS_METRICS) : null;
    }
    case 'sns': {
      const name = arnName(resource);
      return name ? plan('AWS/SNS', [{ Name: 'TopicName', Value: name }], SNS_METRICS) : null;
    }
    case 'dynamodb': {
      const match = /^table\/([^/]+)/.exec(arnTail(resource));
      const name = match ? match[1] : '';
      return name ? plan('AWS/DynamoDB', [{ Name: 'TableName', Value: name }], DYNAMODB_METRICS) : null;
    }
    case 'stepfunctions': {
      const arn = String(resource.arn || '');
      return /:stateMachine:/.test(arn) ? plan('AWS/States', [{ Name: 'StateMachineArn', Value: arn }], STATES_METRICS) : null;
    }
    case 'rds': {
      const match = /^db:(.+)$/.exec(arnTail(resource));
      return match ? plan('AWS/RDS', [{ Name: 'DBInstanceIdentifier', Value: match[1] }], RDS_METRICS) : null;
    }
    case 'apigateway': {
      const tail = arnTail(resource);
      const rest = /^\/restapis\/([^/]+)/.exec(tail);
      const http = /^\/apis\/([^/]+)/.exec(tail);
      // REST APIs are dimensioned by name in CloudWatch, HTTP and WebSocket APIs by id.
      if (rest && resource.name) return plan('AWS/ApiGateway', [{ Name: 'ApiName', Value: resource.name }], REST_API_METRICS);
      if (http) return plan('AWS/ApiGateway', [{ Name: 'ApiId', Value: http[1] }], HTTP_API_METRICS);
      return null;
    }
    case 'ses':
      return /^identity\//.test(arnTail(resource)) ? plan('AWS/SES', [], SES_METRICS) : null;
    case 'ebs-volume': {
      const match = /^volume\/(vol-[0-9a-f]+)/.exec(arnTail(resource));
      return match ? plan('AWS/EBS', [{ Name: 'VolumeId', Value: match[1] }], EBS_METRICS) : null;
    }
    default:
      return null;
  }
}

function loadBalancerIdentity(resource) {
  const arn = String(resource.arn || resource.key || '');
  const match = /:loadbalancer\/(app|net)\/([^/]+)\/([^/]+)$/.exec(arn);
  if (!match) return null;
  return { type: match[1], dimension: `${match[1]}/${match[2]}/${match[3]}` };
}

function targetGroupDimension(targetGroup) {
  const arn = String(typeof targetGroup === 'string' ? targetGroup : targetGroup?.arn || '');
  const match = /:targetgroup\/([^/]+\/[^/]+)$/.exec(arn);
  return match ? `targetgroup/${match[1]}` : '';
}

function loadBalancerMetrics(type, targetGroups) {
  const metrics = type === 'app' ? [
    { id: 'requests', metricName: 'RequestCount', stat: 'Sum', metric: 'elb_request_count', unit: 'count' },
    { id: 'target5xx', metricName: 'HTTPCode_Target_5XX_Count', stat: 'Sum', metric: 'elb_target_5xx_count', unit: 'count' },
    { id: 'elb5xx', metricName: 'HTTPCode_ELB_5XX_Count', stat: 'Sum', metric: 'elb_5xx_count', unit: 'count' },
    { id: 'latencyP50', metricName: 'TargetResponseTime', stat: 'p50', metric: 'elb_target_response_time_p50_ms', unit: 'milliseconds', scale: 1000 },
    { id: 'latencyP95', metricName: 'TargetResponseTime', stat: 'p95', metric: 'elb_target_response_time_p95_ms', unit: 'milliseconds', scale: 1000 },
  ] : [
    { id: 'processedBytes', metricName: 'ProcessedBytes', stat: 'Sum', metric: 'nlb_processed_bytes', unit: 'bytes' },
    { id: 'activeFlows', metricName: 'ActiveFlowCount', stat: 'Average', metric: 'nlb_active_flow_count', unit: 'count' },
    { id: 'newFlows', metricName: 'NewFlowCount', stat: 'Sum', metric: 'nlb_new_flow_count', unit: 'count' },
    { id: 'targetResets', metricName: 'TCP_Target_Reset_Count', stat: 'Sum', metric: 'nlb_tcp_target_reset_count', unit: 'count' },
  ];

  for (const [index, targetGroup] of targetGroups.entries()) {
    const dimension = targetGroupDimension(targetGroup);
    if (!dimension) continue;
    const groupName = dimension.split('/')[1].toLowerCase().replace(/[^a-z0-9]+/g, '_');
    metrics.push({
      id: `healthy${index}`,
      metricName: 'HealthyHostCount',
      stat: 'Average',
      metric: `elb_healthy_host_count_${groupName || index}`,
      unit: 'count',
      dimensions: [{ Name: 'TargetGroup', Value: dimension }],
    });
    if (type === 'app') {
      metrics.push({
        id: `unhealthy${index}`,
        metricName: 'UnHealthyHostCount',
        stat: 'Average',
        metric: `elb_unhealthy_host_count_${groupName || index}`,
        unit: 'count',
        dimensions: [{ Name: 'TargetGroup', Value: dimension }],
      });
    }
  }
  return metrics;
}

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
  if (resource.type === 'elb') {
    const identity = loadBalancerIdentity(resource);
    if (!identity) return null;
    return {
      namespace: identity.type === 'app' ? 'AWS/ApplicationELB' : 'AWS/NetworkELB',
      dimensions: [{ Name: 'LoadBalancer', Value: identity.dimension }],
      metrics: loadBalancerMetrics(identity.type, resource.metadata?.targetGroups || resource.targetGroups || []),
      periodSeconds: PERIOD_SECONDS,
      windowMs: INITIAL_WINDOW_MS,
    };
  }
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
  return servicePlan(resource);
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
        sum: value * (definition.scale || 1),
        min: value * (definition.scale || 1),
        max: value * (definition.scale || 1),
        last: value * (definition.scale || 1),
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
    clientFactory = config => new cloudwatchSdk.CloudWatchClient(config),
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
      response = await client.send(new cloudwatchSdk.GetMetricDataCommand({
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
  loadBalancerIdentity,
  PERIOD_SECONDS,
  SOURCE,
  ec2InstanceId,
  metricPlan,
  s3BucketName,
};
