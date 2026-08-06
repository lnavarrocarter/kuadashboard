'use strict';

const {
  CloudWatchLogsClient,
  FilterLogEventsCommand,
} = require('@aws-sdk/client-cloudwatch-logs');
const { resolveAwsConfig } = require('../awsProfileResolver');
const { aggregateLambdaLogEvents } = require('./lambdaLogMetrics');

const SOURCE = 'cloudwatch_logs';
const MAX_PAGES = 2;
const PAGE_LIMIT = 500;
const INITIAL_WINDOW_MS = 30 * 60 * 1000;
const INGESTION_DELAY_MS = 60 * 1000;
const OVERLAP_MS = 2 * 60 * 1000;

class AwsLambdaCollector {
  constructor({
    database,
    configResolver = resolveAwsConfig,
    clientFactory = config => new CloudWatchLogsClient(config),
    now = () => Date.now(),
  }) {
    if (!database) throw new Error('database is required');
    this.database = database;
    this.configResolver = configResolver;
    this.clientFactory = clientFactory;
    this.now = now;
  }

  async collect({ application, resource }) {
    if (!application?.profileId || !application?.region) throw new Error('Application profile and region are required');
    if (resource?.type !== 'lambda') throw new Error('AWS collector only supports Lambda resources');
    const logGroupName = resource.logGroup || `/aws/lambda/${resource.name}`;
    const cursor = this.database.getCursor(resource.id, SOURCE) || {};
    const continuing = !!cursor.nextToken || cursor.state?.pending === true;
    const now = this.now();
    const windowEnd = continuing
      ? cursor.state?.windowEnd
      : Math.max(0, now - INGESTION_DELAY_MS);
    const windowStart = continuing
      ? cursor.state?.windowStart
      : cursor.timestamp == null
        ? Math.max(0, windowEnd - INITIAL_WINDOW_MS)
        : Math.max(0, cursor.timestamp - OVERLAP_MS);
    if (!Number.isFinite(windowStart) || !Number.isFinite(windowEnd)) throw new Error('Invalid collection cursor window');

    const config = await this.configResolver(application.profileId);
    const client = this.clientFactory({ ...config, region: application.region });
    const events = [];
    let nextToken = cursor.nextToken || null;
    let pages = 0;
    let requests = 0;
    let budgetExhausted = false;

    do {
      const reservation = this.database.reserveAwsRequests({
        profileId: application.profileId,
        region: application.region,
        operation: 'FilterLogEvents',
      });
      if (!reservation.allowed) {
        budgetExhausted = true;
        break;
      }

      requests += 1;
      let response;
      try {
        response = await client.send(new FilterLogEventsCommand({
          logGroupName,
          startTime: windowStart,
          endTime: windowEnd,
          limit: PAGE_LIMIT,
          nextToken: nextToken || undefined,
        }));
      } catch (error) {
        error.apmRequestCount = requests;
        throw error;
      }
      pages += 1;
      events.push(...(response.events || []));
      nextToken = response.nextToken || null;
    } while (nextToken && pages < MAX_PAGES);

    const backlog = !!nextToken || budgetExhausted;
    const aggregate = aggregateLambdaLogEvents(events, {
      seenEventIds: cursor.boundaryHashes || [],
      seenRequestIds: cursor.state?.requestIds || [],
    });
    const nextCursor = {
      timestamp: backlog ? cursor.timestamp ?? null : windowEnd,
      nextToken,
      boundaryHashes: aggregate.boundaryEventIds,
      state: {
        requestIds: aggregate.requestIds,
        ...(backlog ? { windowStart, windowEnd, pending: true } : {}),
      },
    };
    this.database.commitMetricBatch(resource.id, SOURCE, aggregate.buckets, nextCursor);

    return {
      status: budgetExhausted ? 'budget_exhausted' : backlog ? 'partial' : 'completed',
      requests,
      pages,
      events: events.length,
      reports: aggregate.buckets
        .filter(bucket => bucket.metricName === 'invocations_observed')
        .reduce((sum, bucket) => sum + bucket.sum, 0),
      backlog,
      budgetExhausted,
    };
  }
}

module.exports = {
  AwsLambdaCollector,
  INGESTION_DELAY_MS,
  MAX_PAGES,
  OVERLAP_MS,
  PAGE_LIMIT,
  SOURCE,
};