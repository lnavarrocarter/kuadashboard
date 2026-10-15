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
 * Same list prices as lib/usage/awsPricing.js. An upper bound: a run reads at most MAX_PAGES
 * pages of PAGE_LIMIT events for each Lambda function.
 */

const { metricPlan } = require('./awsMetricCollector');
const { MAX_PAGES, PAGE_LIMIT } = require('./awsCollector');

const METRIC_USD = 0.01 / 1000;
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
  for (const resource of resources.filter(item => item.enabled !== false)) {
    const plan = resource.type === 'lambda' ? null : metricPlan(resource);
    const resourceMetrics = plan?.metrics?.length || 0;
    const resourceLogRequests = resource.type === 'lambda' ? MAX_PAGES : 0;
    const resourceLogBytes = resource.type === 'lambda' ? MAX_PAGES * PAGE_LIMIT * EVENT_BYTES : 0;
    const entry = byType[resource.type] || (byType[resource.type] = { resources: 0, metrics: 0, logRequests: 0, billed: false });
    entry.resources += 1;
    entry.metrics += resourceMetrics;
    entry.logRequests += resourceLogRequests;
    entry.billed ||= resourceMetrics > 0 || resourceLogBytes > 0;
    metrics += resourceMetrics;
    logRequests += resourceLogRequests;
    logBytes += resourceLogBytes;
  }
  const runsPerMonth = Math.round((30 * 24 * 60) / Math.max(1, intervalMinutes));
  const perRunUsd = metrics * METRIC_USD + (logBytes / GB) * TRANSFER_USD_PER_GB;
  return {
    perRun: { metrics, logRequests, maxLogGb: round(logBytes / GB), usd: round(perRunUsd) },
    perMonth: { runs: runsPerMonth, metrics: metrics * runsPerMonth, usd: round(perRunUsd * runsPerMonth) },
    byType,
    prices: {
      getMetricData: 'USD 0.01 per 1,000 metrics',
      filterLogEvents: 'no request charge; data transfer out USD 0.09 per GB after 100 GB free per month (whole account)',
      kubernetes: 'no cloud charge',
    },
    note: 'Upper bound at list prices (us-east-1). Disabled resources are not collected.',
  };
}

module.exports = { estimateCollectionCost };
