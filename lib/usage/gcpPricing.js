'use strict';
/**
 * lib/usage/gcpPricing.js
 * What the billed Google Cloud reads KUA makes cost (#353), recorded in the same ledger as AWS.
 *
 * Only Cloud Monitoring reads are billed: USD 0.50 per million time series returned, after the
 * first million free per billing account each month (since 2025-10-02; at least one series per
 * call; lib/apm/gcpMonitoringCollector.js). KUA cannot see the rest of the billing account's
 * usage, so like AWS free-tier operations the cost is reported as `potentialUsd`.
 * Every other GCP read KUA makes (resource lists, Cloud Logging reads) has no per-call charge.
 */

const MONITORING_READ = {
  service: 'Cloud Monitoring',
  operation: 'timeSeries.list',
  kind: 'gcpMonitoringRead',
  unit: 'time series',
  unitPrice: 0.50 / 1e6,
  freeTier: 'first 1,000,000 time series per month free (whole billing account)',
  docs: 'https://cloud.google.com/stackdriver/pricing',
};

/** One Cloud Monitoring timeSeries.list call that returned `series` time series (at least one is billed). */
function priceMonitoringRead(series) {
  const quantity = Math.max(1, Math.floor(Number(series) || 0));
  const cost = quantity * MONITORING_READ.unitPrice;
  return {
    service: MONITORING_READ.service,
    operation: MONITORING_READ.operation,
    kind: MONITORING_READ.kind,
    unit: MONITORING_READ.unit,
    unitPrice: MONITORING_READ.unitPrice,
    quantity,
    usd: 0,
    potentialUsd: cost,
    freeTier: MONITORING_READ.freeTier,
  };
}

module.exports = { priceMonitoringRead, MONITORING_READ };
