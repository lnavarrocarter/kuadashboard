'use strict';

const { aggregateLambdaLogEvents } = require('./lambdaLogMetrics');

const OPPORTUNISTIC_SOURCE = 'cloudwatch_logs_opportunistic';
const CLOUDWATCH_SOURCE = 'cloudwatch_metrics_opportunistic';
const KUBERNETES_SOURCE = 'metrics.k8s.io_opportunistic';
const BUCKET_MS = 30 * 60 * 1000;
const CLOUDWATCH_METRICS = {
  Invocations: { metricName: 'invocations_cloudwatch', unit: 'count', aggregation: 'sum' },
  Errors: { metricName: 'errors_cloudwatch', unit: 'count', aggregation: 'sum' },
  Duration: { metricName: 'duration_cloudwatch_ms', unit: 'ms', aggregation: 'average' },
  Throttles: { metricName: 'throttles_cloudwatch', unit: 'count', aggregation: 'sum' },
  ConcurrentExecutions: { metricName: 'concurrency_cloudwatch', unit: 'count', aggregation: 'maximum' },
};

function matchesLambda(resource, functionName, logGroupName) {
  if (resource.type !== 'lambda' || !resource.enabled) return false;
  return resource.name === functionName || (!!resource.logGroup && resource.logGroup === logGroupName);
}

function matchesKubernetes(resource, kubeContext, namespace, resourceType, name) {
  if (resource.type !== 'kubernetes' || !resource.enabled) return false;
  const expectedType = `${String(resource.kind || '').toLowerCase()}s`;
  return resource.kubeContext === kubeContext &&
    (resource.namespace || 'default') === (namespace || 'default') &&
    expectedType === String(resourceType || '').toLowerCase() &&
    resource.name === name;
}

function captureLambdaLogEvents({ database, profileId, region, functionName, logGroupName, events = [] }) {
  if (!database || !profileId || !region || !functionName || !Array.isArray(events)) return [];
  const results = [];

  for (const application of database.listApplications({ profileId, region })) {
    const resources = database.listResources(application.id, { enabledOnly: true })
      .filter(resource => matchesLambda(resource, functionName, logGroupName));
    if (!resources.length) continue;

    const runId = database.startCollectionRun({
      applicationId: application.id,
      profileId,
      region,
      trigger: 'opportunistic',
    });
    let reports = 0;

    try {
      for (const resource of resources) {
        const cursor = database.getCursor(resource.id, OPPORTUNISTIC_SOURCE) || {};
        const aggregate = aggregateLambdaLogEvents(events, {
          seenEventIds: cursor.boundaryHashes || [],
          seenRequestIds: cursor.state?.requestIds || [],
          quality: 'partial',
        });
        const timestamp = events.reduce((latest, event) => {
          const current = Number(event.timestamp);
          return Number.isFinite(current) ? Math.max(latest, current) : latest;
        }, cursor.timestamp || 0);
        database.commitMetricBatch(resource.id, OPPORTUNISTIC_SOURCE, aggregate.buckets, {
          timestamp,
          nextToken: null,
          boundaryHashes: aggregate.boundaryEventIds,
          state: { requestIds: aggregate.requestIds },
        });
        reports += aggregate.buckets
          .filter(bucket => bucket.metricName === 'invocations_observed')
          .reduce((total, bucket) => total + bucket.sum, 0);
      }
      database.finishCollectionRun(runId, { status: 'completed', requestCount: 0, backlog: false });
      results.push({ applicationId: application.id, resources: resources.length, reports });
    } catch (error) {
      database.finishCollectionRun(runId, {
        status: 'failed',
        requestCount: 0,
        backlog: false,
        errorCode: error.name || 'opportunistic_capture_failed',
        errorMessage: error.message,
      });
      throw error;
    }
  }

  return results;
}

function aggregateCloudWatchMetrics(metrics) {
  const buckets = new Map();
  for (const [sourceName, definition] of Object.entries(CLOUDWATCH_METRICS)) {
    for (const point of metrics?.[sourceName] || []) {
      const timestamp = new Date(point.t).getTime();
      const value = Number(point.v);
      if (!Number.isFinite(timestamp) || !Number.isFinite(value)) continue;
      const key = `${Math.floor(timestamp / BUCKET_MS) * BUCKET_MS}\u0000${sourceName}`;
      const bucket = buckets.get(key) || {
        bucketStart: Math.floor(timestamp / BUCKET_MS) * BUCKET_MS,
        ...definition,
        values: [],
      };
      bucket.values.push(value);
      buckets.set(key, bucket);
    }
  }
  return [...buckets.values()].map(bucket => {
    const sum = bucket.values.reduce((total, value) => total + value, 0);
    const maximum = Math.max(...bucket.values);
    const minimum = Math.min(...bucket.values);
    if (bucket.aggregation === 'maximum') {
      return { ...bucket, count: 1, sum: maximum, min: minimum, max: maximum, last: bucket.values.at(-1) };
    }
    return { ...bucket, count: bucket.values.length, sum, min: minimum, max: maximum, last: bucket.values.at(-1) };
  });
}

function captureLambdaCloudWatchMetrics({ database, profileId, region, functionName, logGroupName, metrics }) {
  if (!database || !profileId || !region || !functionName) return [];
  const buckets = aggregateCloudWatchMetrics(metrics);
  if (!buckets.length) return [];
  const results = [];

  for (const application of database.listApplications({ profileId, region })) {
    const resources = database.listResources(application.id, { enabledOnly: true })
      .filter(resource => matchesLambda(resource, functionName, logGroupName));
    if (!resources.length) continue;

    const runId = database.startCollectionRun({
      applicationId: application.id,
      profileId,
      region,
      trigger: 'opportunistic',
    });
    try {
      for (const resource of resources) {
        for (const bucket of buckets) {
          database.upsertMetricBucket({
            resourceId: resource.id,
            bucketStart: bucket.bucketStart,
            metricName: bucket.metricName,
            unit: bucket.unit,
            count: bucket.count,
            sum: bucket.sum,
            min: bucket.min,
            max: bucket.max,
            last: bucket.last,
            source: CLOUDWATCH_SOURCE,
            quality: 'partial',
          });
        }
      }
      database.finishCollectionRun(runId, { status: 'completed', requestCount: 0, backlog: false });
      results.push({ applicationId: application.id, resources: resources.length, buckets: buckets.length });
    } catch (error) {
      database.finishCollectionRun(runId, {
        status: 'failed', requestCount: 0, backlog: false,
        errorCode: error.name || 'opportunistic_capture_failed', errorMessage: error.message,
      });
      throw error;
    }
  }
  return results;
}

function captureKubernetesMetrics({
  database,
  kubeContext,
  namespace,
  resourceType,
  name,
  metrics,
  now = () => Date.now(),
}) {
  if (!database || !kubeContext || !resourceType || !name || metrics?.source !== 'metrics.k8s.io') return [];
  const measuredAt = new Date(metrics.timestamp).getTime();
  const timestamp = Number.isFinite(measuredAt) ? measuredAt : now();
  const bucketStart = Math.floor(timestamp / BUCKET_MS) * BUCKET_MS;
  const values = [
    { metricName: 'cpu_cores', unit: 'cores', value: Number(metrics.cpu?.cores) },
    { metricName: 'memory_bytes', unit: 'bytes', value: Number(metrics.memory?.bytes) },
  ].filter(metric => Number.isFinite(metric.value));
  if (!values.length) return [];
  const results = [];

  for (const application of database.listApplications()) {
    const resources = database.listResources(application.id, { enabledOnly: true })
      .filter(resource => matchesKubernetes(resource, kubeContext, namespace, resourceType, name));
    if (!resources.length) continue;

    const runId = database.startCollectionRun({
      applicationId: application.id,
      profileId: application.profileId,
      region: application.region,
      trigger: 'opportunistic',
    });
    try {
      for (const resource of resources) {
        for (const metric of values) {
          database.upsertMetricBucket({
            resourceId: resource.id,
            bucketStart,
            metricName: metric.metricName,
            unit: metric.unit,
            count: 1,
            sum: metric.value,
            min: metric.value,
            max: metric.value,
            last: metric.value,
            source: KUBERNETES_SOURCE,
            quality: 'partial',
          });
        }
      }
      database.finishCollectionRun(runId, { status: 'completed', requestCount: 0, backlog: false });
      results.push({ applicationId: application.id, resources: resources.length, buckets: values.length });
    } catch (error) {
      database.finishCollectionRun(runId, {
        status: 'failed', requestCount: 0, backlog: false,
        errorCode: error.name || 'opportunistic_capture_failed', errorMessage: error.message,
      });
      throw error;
    }
  }

  return results;
}

module.exports = {
  captureKubernetesMetrics,
  captureLambdaCloudWatchMetrics,
  captureLambdaLogEvents,
  CLOUDWATCH_SOURCE,
  KUBERNETES_SOURCE,
  OPPORTUNISTIC_SOURCE,
};