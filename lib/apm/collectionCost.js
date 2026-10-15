'use strict';
/**
 * lib/apm/collectionCost.js
 * What collecting an application's signals costs (#285), before anyone turns it on: shown in the
 * preview of an agent's collection change and in the UI.
 *
 *   CloudWatch GetMetricData  USD 0.01 per 1,000 metrics (each metric of each resource, each run)
 *   CloudWatch Logs           FilterLogEvents has no request charge; the events downloaded count as
 *                             data transfer out, USD 0.09 per GB after the account's 100 GB free
 *   Kubernetes                the cluster API, no cloud charge
 *   Cloud Monitoring          USD 0.50 per million time series returned, first million a month free
 *                             per billing account; Glue GetJobRuns has no charge
 * Same list prices as lib/usage/awsPricing.js. An upper bound: a run reads at most MAX_PAGES
 * pages of PAGE_LIMIT events for each Lambda function.
 */

const { metricPlan } = require('./awsMetricCollector');
const { MAX_PAGES, PAGE_LIMIT } = require('./awsCollector');
const { gcpPlan } = require('./gcpMonitoringCollector');

const METRIC_USD = 0.01 / 1000;
// Cloud Monitoring read API: USD 0.50 per million time series returned, after the first million free
// per billing account each month (since 2025-10-02). One series per metric per run here.
const GCP_SERIES_USD = 0.50 / 1e6;
const GCP_FREE_SERIES = 1e6;
const TRANSFER_USD_PER_GB = 0.09;
// A Lambda log event as downloaded, generously rounded up.
const EVENT_BYTES = 1024;
const GB = 1024 ** 3;
const round = value => Math.round(value * 1e6) / 1e6;

function estimateCollectionCost(resources = [], { intervalMinutes = 30 } = {}) {
  const byType = {};
  let metrics = 0;
  let logRequests = 0;
  let logBytes = 0;
  let gcpSeries = 0;
  for (const resource of resources.filter(item => item.enabled !== false)) {
    const plan = resource.type === 'lambda' ? null : metricPlan(resource);
    const resourceMetrics = plan?.metrics?.length || 0;
    const resourceSeries = gcpPlan(resource)?.metrics?.length || 0;
    gcpSeries += resourceSeries;
    const resourceLogRequests = resource.type === 'lambda' ? MAX_PAGES : 0;
    const resourceLogBytes = resource.type === 'lambda' ? MAX_PAGES * PAGE_LIMIT * EVENT_BYTES : 0;
    const entry = byType[resource.type] || (byType[resource.type] = { resources: 0, metrics: 0, logRequests: 0, gcpSeries: 0, billed: false });
    entry.resources += 1;
    entry.metrics += resourceMetrics;
    entry.gcpSeries += resourceSeries;
    entry.billed ||= resourceSeries > 0;
    entry.logRequests += resourceLogRequests;
    entry.billed ||= resourceMetrics > 0 || resourceLogBytes > 0;
    metrics += resourceMetrics;
    logRequests += resourceLogRequests;
    logBytes += resourceLogBytes;
  }
  const runsPerMonth = Math.round((30 * 24 * 60) / Math.max(1, intervalMinutes));
  const perRunUsd = metrics * METRIC_USD + (logBytes / GB) * TRANSFER_USD_PER_GB;
  // GCP: the first million series a month are free for the whole billing account; this shows what
  // the application alone would cost beyond it (`gcpUsdBeyondFree`) and how much of it it uses.
  const gcpMonthSeries = gcpSeries * runsPerMonth;
  return {
    perRun: { metrics, logRequests, maxLogGb: round(logBytes / GB), gcpSeries, usd: round(perRunUsd + gcpSeries * GCP_SERIES_USD) },
    perMonth: {
      runs: runsPerMonth, metrics: metrics * runsPerMonth, usd: round(perRunUsd * runsPerMonth),
      gcpSeries: gcpMonthSeries, gcpFreeShare: round(gcpMonthSeries / GCP_FREE_SERIES), gcpUsdBeyondFree: round(gcpMonthSeries * GCP_SERIES_USD),
    },
    byType,
    prices: {
      getMetricData: 'USD 0.01 per 1,000 metrics',
      filterLogEvents: 'no request charge; data transfer out USD 0.09 per GB after 100 GB free per month (whole account)',
      kubernetes: 'no cloud charge',
      cloudMonitoring: 'USD 0.50 per million time series returned, first 1 million per month free (whole billing account)',
      glue: 'GetJobRuns, no charge',
    },
    note: 'Upper bound at list prices (us-east-1). Disabled resources are not collected.',
  };
}

module.exports = { estimateCollectionCost };
