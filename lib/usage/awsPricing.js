'use strict';
/**
 * lib/usage/awsPricing.js
 * What one AWS SDK call made by KUA costs, from the command and its
 * input/output. Only operations with a usage price are priced; every other
 * read KUA makes is free (Describe/List/Get control-plane calls).
 *
 * Prices are AWS public list prices in USD for us-east-1 (most regions match;
 * a few charge slightly more). They are estimates of KUA's own usage, not a
 * bill: free tiers apply per account and KUA cannot see the rest of the
 * account's usage, so free-tier operations report what they would cost
 * beyond the free tier as `potentialUsd`.
 */

const GB = 1024 ** 3;
const TB = 1024 ** 4;

// unitPrice is per unit (metric, GB, request…) so the UI can show quantity × unitPrice = usd.
const PRICES = {
  getMetricData: { service: 'CloudWatch', operation: 'GetMetricData', unit: 'metric', unitPrice: 0.01 / 1000, docs: 'https://aws.amazon.com/cloudwatch/pricing/' },
  getMetricStatistics: { service: 'CloudWatch', operation: 'GetMetricStatistics', unit: 'request', unitPrice: 0.01 / 1000, freeTier: 'first 1,000,000 API requests per month free', docs: 'https://aws.amazon.com/cloudwatch/pricing/' },
  logsInsights: { service: 'CloudWatch Logs', operation: 'Logs Insights query', unit: 'GB scanned', unitPrice: 0.005, docs: 'https://aws.amazon.com/cloudwatch/pricing/' },
  filterLogEvents: { service: 'CloudWatch Logs', operation: 'FilterLogEvents (download)', unit: 'GB', unitPrice: 0.09, freeTier: 'no request charge; data transfer out: first 100 GB per month free (whole account)', docs: 'https://aws.amazon.com/ec2/pricing/on-demand/#Data_Transfer' },
  costExplorer: { service: 'Cost Explorer', operation: 'API request', unit: 'request', unitPrice: 0.01, docs: 'https://aws.amazon.com/aws-cost-management/aws-cost-explorer/pricing/' },
  athena: { service: 'Athena', operation: 'Query', unit: 'TB scanned', unitPrice: 5, minimumBytes: 10 * 1024 * 1024, docs: 'https://aws.amazon.com/athena/pricing/' },
  lexText: { service: 'Lex', operation: 'RecognizeText', unit: 'request', unitPrice: 0.00075, docs: 'https://aws.amazon.com/lex/pricing/' },
};

const COST_EXPLORER_PRICED = new Set([
  'GetCostAndUsageCommand', 'GetCostAndUsageWithResourcesCommand', 'GetCostForecastCommand', 'GetUsageForecastCommand',
  'GetDimensionValuesCommand', 'GetTagsCommand', 'GetCostCategoriesCommand', 'GetReservationUtilizationCommand',
  'GetSavingsPlansUtilizationCommand', 'GetRightsizingRecommendationCommand',
]);

function entry(kind, quantity, extra = {}) {
  const price = PRICES[kind];
  const cost = quantity * price.unitPrice;
  return {
    kind,
    service: price.service,
    operation: price.operation,
    unit: price.unit,
    unitPrice: price.unitPrice,
    quantity,
    usd: price.freeTier ? 0 : cost,
    potentialUsd: price.freeTier ? cost : 0,
    freeTier: price.freeTier || null,
    ...extra,
  };
}

/** Approximate bytes of the events of a FilterLogEvents page as sent over the wire. */
function eventBytes(events = []) {
  let bytes = 0;
  for (const event of events) bytes += Buffer.byteLength(String(event.message || '')) + 120; // ids, stream name, timestamps
  return bytes;
}

/**
 * Price of one call, or null when it is free.
 * @param command  SDK command instance (constructor name + input)
 * @param output   SDK response
 * @param seen     Set of ids already priced (queries priced once, when they complete)
 */
function priceCall(command, output, seen = new Set()) {
  const name = command?.constructor?.name;
  const input = command?.input || {};
  switch (name) {
    case 'GetMetricDataCommand': {
      // Billed per metric requested; math expressions are not metrics.
      const metrics = (input.MetricDataQueries || []).filter(query => query.MetricStat).length;
      return metrics ? entry('getMetricData', metrics) : null;
    }
    case 'GetMetricStatisticsCommand':
      return entry('getMetricStatistics', 1);
    case 'GetQueryResultsCommand': {
      // CloudWatch Logs Insights (Athena's command has the same name but QueryExecutionId).
      if (input.QueryExecutionId) return null;
      if (output?.status !== 'Complete' || !input.queryId || seen.has(input.queryId)) return null;
      seen.add(input.queryId);
      const bytes = Number(output.statistics?.bytesScanned || 0);
      return entry('logsInsights', bytes / GB, { bytes, ref: input.queryId });
    }
    case 'FilterLogEventsCommand': {
      const bytes = eventBytes(output?.events);
      return bytes ? entry('filterLogEvents', bytes / GB, { bytes, ref: input.logGroupName || input.logGroupIdentifier || null }) : null;
    }
    case 'GetQueryExecutionCommand': {
      const execution = output?.QueryExecution;
      if (!execution || execution.Status?.State !== 'SUCCEEDED' || seen.has(execution.QueryExecutionId)) return null;
      seen.add(execution.QueryExecutionId);
      const scanned = Number(execution.Statistics?.DataScannedInBytes || 0);
      const bytes = Math.max(scanned, PRICES.athena.minimumBytes);
      return entry('athena', bytes / TB, { bytes: scanned, ref: execution.QueryExecutionId });
    }
    case 'RecognizeTextCommand':
      return entry('lexText', 1);
    default:
      if (COST_EXPLORER_PRICED.has(name)) return entry('costExplorer', 1, { ref: name.replace(/Command$/, '') });
      return null;
  }
}

module.exports = { priceCall, PRICES, eventBytes };
