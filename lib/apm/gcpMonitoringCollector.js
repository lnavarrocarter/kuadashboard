'use strict';
/**
 * lib/apm/gcpMonitoringCollector.js
 * Signals of GCP resources from Cloud Monitoring (#286): Cloud Run requests, 5xx and p95 latency,
 * Cloud SQL CPU, disk and connections, and Compute Engine VM CPU.
 *
 * Cost: Cloud Monitoring bills read API calls by time series returned, USD 0.50 per million after
 * the first million free per billing account each month (since 2025-10-02; at least one series per
 * call). Every query here is reduced to a single series, so a run costs one series per metric.
 */

const { BUCKET_MS } = require('./lambdaLogMetrics');

const SOURCE = 'cloud-monitoring';
const PERIOD_SECONDS = 300;
const INITIAL_WINDOW_MS = 60 * 60 * 1000;
const MAX_WINDOW_MS = 24 * 60 * 60 * 1000;

const last = value => String(value || '').split('/').filter(Boolean).pop() || '';
const projectOf = resource => String(resource.key || '').match(/^projects\/([^/]+)\//)?.[1] || resource.scopeId || '';

/** What to ask Cloud Monitoring for, per resource type; null when the type has no plan. */
function gcpPlan(resource = {}) {
  const project = projectOf(resource);
  const name = last(resource.key) || resource.name;
  if (!project || !name) return null;
  switch (resource.type) {
    case 'gcp-cloud-run': {
      const base = `resource.type="cloud_run_revision" AND resource.labels.service_name="${name}"`;
      return { project, metrics: [
        { id: 'requests', filter: `${base} AND metric.type="run.googleapis.com/request_count"`, aligner: 'ALIGN_SUM', reducer: 'REDUCE_SUM', metric: 'gcp_run_requests', unit: 'count' },
        { id: 'errors5xx', filter: `${base} AND metric.type="run.googleapis.com/request_count" AND metric.labels.response_code_class="5xx"`, aligner: 'ALIGN_SUM', reducer: 'REDUCE_SUM', metric: 'gcp_run_5xx', unit: 'count' },
        { id: 'latencyP95', filter: `${base} AND metric.type="run.googleapis.com/request_latencies"`, aligner: 'ALIGN_PERCENTILE_95', reducer: 'REDUCE_MAX', metric: 'gcp_run_latency_p95_ms', unit: 'milliseconds' },
      ] };
    }
    case 'gcp-sql': {
      const base = `resource.type="cloudsql_database" AND resource.labels.database_id="${project}:${name}"`;
      return { project, metrics: [
        { id: 'cpu', filter: `${base} AND metric.type="cloudsql.googleapis.com/database/cpu/utilization"`, aligner: 'ALIGN_MEAN', reducer: 'REDUCE_MEAN', metric: 'gcp_sql_cpu_percent', unit: 'percent', scale: 100 },
        { id: 'disk', filter: `${base} AND metric.type="cloudsql.googleapis.com/database/disk/utilization"`, aligner: 'ALIGN_MEAN', reducer: 'REDUCE_MEAN', metric: 'gcp_sql_disk_percent', unit: 'percent', scale: 100 },
        { id: 'connections', filter: `${base} AND metric.type="cloudsql.googleapis.com/database/network/connections"`, aligner: 'ALIGN_MEAN', reducer: 'REDUCE_SUM', metric: 'gcp_sql_connections', unit: 'count' },
      ] };
    }
    case 'gcp-compute-instance':
      return { project, metrics: [
        { id: 'cpu', filter: `resource.type="gce_instance" AND metric.type="compute.googleapis.com/instance/cpu/utilization" AND metric.labels.instance_name="${name}"`, aligner: 'ALIGN_MEAN', reducer: 'REDUCE_MEAN', metric: 'gcp_vm_cpu_percent', unit: 'percent', scale: 100 },
      ] };
    default:
      return null;
  }
}

function pointValue(point) {
  const value = point?.value || {};
  if (value.doubleValue !== undefined) return Number(value.doubleValue);
  if (value.int64Value !== undefined) return Number(value.int64Value);
  return NaN;
}

class GcpMonitoringCollector {
  constructor({
    database,
    resolveAuth = profileId => require('../../routes/gcp').resolveGcpAuth(profileId),
    fetchApi = (...args) => require('../../routes/gcp').gcpFetch(...args),
    now = () => Date.now(),
  }) {
    if (!database) throw new Error('database is required');
    this.database = database;
    this.resolveAuth = resolveAuth;
    this.fetchApi = fetchApi;
    this.now = now;
  }

  supports(resource) {
    return !!gcpPlan(resource || {});
  }

  async collect({ application, resource }) {
    const plan = gcpPlan(resource || {});
    if (!plan) return { status: 'topology_only', requests: 0, backlog: false };
    if (!application?.profileId) throw Object.assign(new Error('No GCP profile reaches this resource'), { code: 'scope_unbound' });
    const authCtx = await this.resolveAuth(application.profileId);
    const cursor = this.database.getCursor(resource.id, SOURCE) || {};
    const end = this.now();
    const start = Math.max(cursor.timestamp ? Number(cursor.timestamp) : end - INITIAL_WINDOW_MS, end - MAX_WINDOW_MS);
    const buckets = [];
    let requests = 0;
    for (const metric of plan.metrics) {
      const url = new URL(`https://monitoring.googleapis.com/v3/projects/${plan.project}/timeSeries`);
      url.searchParams.set('filter', metric.filter);
      url.searchParams.set('interval.startTime', new Date(start).toISOString());
      url.searchParams.set('interval.endTime', new Date(end).toISOString());
      url.searchParams.set('aggregation.alignmentPeriod', `${PERIOD_SECONDS}s`);
      url.searchParams.set('aggregation.perSeriesAligner', metric.aligner);
      // One series per query: the call costs exactly one time series.
      url.searchParams.set('aggregation.crossSeriesReducer', metric.reducer);
      let data;
      try {
        data = await this.fetchApi(url.toString(), authCtx);
      } catch (error) {
        error.apmRequestCount = requests + 1;
        throw error;
      }
      requests += 1;
      for (const series of data?.timeSeries || []) {
        for (const point of series.points || []) {
          const raw = pointValue(point);
          if (!Number.isFinite(raw)) continue;
          const value = raw * (metric.scale || 1);
          const at = Date.parse(point.interval?.endTime || point.interval?.startTime || '');
          if (!Number.isFinite(at)) continue;
          buckets.push({ bucketStart: Math.floor(at / BUCKET_MS) * BUCKET_MS, metricName: metric.metric, unit: metric.unit, count: 1, sum: value, min: value, max: value, last: value, quality: 'full' });
        }
      }
    }
    this.database.commitMetricBatch(resource.id, SOURCE, buckets, { timestamp: end, state: {} });
    return { status: 'completed', requests, backlog: false, metrics: buckets.length };
  }
}

module.exports = { GcpMonitoringCollector, gcpPlan, SOURCE };
