'use strict';
/**
 * lib/apm/awsGlueCollector.js
 * Signals of a Glue job (#286): its runs since the last collection, how many failed and how long
 * they took, from GetJobRuns. Glue does not charge for GetJobRuns, so nothing is reserved from the
 * monthly request budget. Crawlers and workflows stay topology only.
 */

const { lazyModule } = require('../lazyModule');
const glueSdk = lazyModule('@aws-sdk/client-glue');
const { resolveAwsConfig } = require('../awsProfileResolver');
const { BUCKET_MS } = require('./lambdaLogMetrics');

const SOURCE = 'glue';
const INITIAL_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_PAGES = 4;
const FAILED_STATES = new Set(['FAILED', 'ERROR', 'TIMEOUT']);

/** The job name of a Glue job ARN (arn:aws:glue:region:account:job/name), or ''. */
function glueJobName(resource) {
  const match = /:job\/(.+)$/.exec(String(resource?.arn || resource?.key || ''));
  return match ? match[1] : '';
}

/** One bucket per run start: count, failed and duration (seconds) metrics. */
function bucketsFromRuns(runs) {
  const buckets = [];
  for (const run of runs) {
    const started = new Date(run.StartedOn).getTime();
    if (!Number.isFinite(started)) continue;
    const bucketStart = Math.floor(started / BUCKET_MS) * BUCKET_MS;
    const point = (metricName, unit, value) => ({ bucketStart, metricName, unit, count: 1, sum: value, min: value, max: value, last: value, quality: 'full' });
    buckets.push(point('glue_job_runs', 'count', 1));
    buckets.push(point('glue_job_failed_runs', 'count', FAILED_STATES.has(run.JobRunState) ? 1 : 0));
    if (Number.isFinite(run.ExecutionTime) && run.JobRunState !== 'RUNNING') buckets.push(point('glue_job_duration_seconds', 'seconds', run.ExecutionTime));
  }
  return buckets;
}

class AwsGlueCollector {
  constructor({ database, configResolver = resolveAwsConfig, clientFactory = config => new glueSdk.GlueClient(config), now = () => Date.now() }) {
    if (!database) throw new Error('database is required');
    this.database = database;
    this.configResolver = configResolver;
    this.clientFactory = clientFactory;
    this.now = now;
  }

  supports(resource) {
    return resource?.type === 'glue' && !!glueJobName(resource);
  }

  async collect({ application, resource }) {
    if (!application?.profileId || !application?.region) throw new Error('Application profile and region are required');
    const jobName = glueJobName(resource);
    if (!jobName) return { status: 'topology_only', requests: 0, backlog: false };
    const cursor = this.database.getCursor(resource.id, SOURCE) || {};
    const end = this.now();
    const since = cursor.timestamp ? Number(cursor.timestamp) : end - INITIAL_WINDOW_MS;
    const client = this.clientFactory({ ...await this.configResolver(application.profileId), region: application.region });
    // Runs come newest first: stop once a page reaches runs already collected.
    const runs = [];
    let NextToken;
    let requests = 0;
    let backlog = false;
    do {
      const response = await client.send(new glueSdk.GetJobRunsCommand({ JobName: jobName, NextToken, MaxResults: 100 }));
      requests += 1;
      const page = response.JobRuns || [];
      runs.push(...page.filter(run => new Date(run.StartedOn).getTime() > since));
      const reachedCollected = page.some(run => new Date(run.StartedOn).getTime() <= since);
      NextToken = reachedCollected ? null : response.NextToken;
      if (NextToken && requests >= MAX_PAGES) { backlog = true; break; }
    } while (NextToken);
    const buckets = bucketsFromRuns(runs);
    this.database.commitMetricBatch(resource.id, SOURCE, buckets, { timestamp: end, state: {} });
    return { status: 'completed', requests, backlog, metrics: buckets.length, runs: runs.length };
  }
}

module.exports = { AwsGlueCollector, glueJobName, bucketsFromRuns, SOURCE };
