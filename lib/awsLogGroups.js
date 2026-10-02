'use strict';
/**
 * lib/awsLogGroups.js
 * CloudWatch Logs inventory: which log groups exist, what produces them (an
 * AWS service or a machine running the CloudWatch agent) and whether a copy
 * of them lives in S3 (export tasks, subscription filters, CloudTrail trails
 * and VPC flow logs that write to buckets).
 *
 * All calls are Describe/List APIs: no per-GB charge. Reading archived objects
 * from S3 is a GET request ($0.0004 / 1,000) plus data transfer out.
 */

const zlib = require('zlib');

const INSTANCE_ID_RE = /\bi-[0-9a-f]{8}(?:[0-9a-f]{9})?\b/;

// Prefix → service. Order matters: the first match wins.
const AWS_PREFIXES = [
  ['/aws/lambda/', 'lambda'],
  ['/aws/ecs/', 'ecs'],
  ['/ecs/', 'ecs'],
  ['/aws/eks/', 'eks'],
  ['/aws/containerinsights/', 'eks'],
  ['/aws/rds/', 'rds'],
  ['/aws/apigateway/', 'apigw'],
  ['API-Gateway-Execution-Logs_', 'apigw'],
  ['/aws/vendedlogs/states/', 'stepfn'],
  ['/aws/states/', 'stepfn'],
  ['/aws/events/', 'eventbridge'],
  ['/aws/codebuild/', 'codebuild'],
  ['/aws/glue/', 'glue'],
  ['/aws-glue/', 'glue'],
  ['/aws/lex/', 'lex'],
  ['/aws/bedrock', 'bedrock'],
  ['/aws/cloudtrail', 'cloudtrail'],
  ['aws-cloudtrail-logs', 'cloudtrail'],
  ['/aws/vpc/', 'vpc'],
  ['/aws/route53', 'route53'],
  ['/aws/ssm/', 'ssm'],
  ['/aws/elasticbeanstalk/', 'elasticbeanstalk'],
  ['/aws/sns/', 'sns'],
  ['sns/', 'sns'],
  ['/aws/', 'aws'],
];

// Names the CloudWatch agent and common EC2 setups use.
const MACHINE_HINTS = [/^\/var\/log\//, /^\/ec2\//i, /\bec2\b/i, /syslog|messages|secure|auth\.log|dmesg/i, /cloud-init/i, /^windows|eventlog|\bIIS\b/i, /\/opt\//];

function classifyLogGroup(name) {
  const value = String(name || '');
  for (const [prefix, service] of AWS_PREFIXES) {
    if (value.startsWith(prefix)) {
      const resource = value.slice(prefix.length).split('/').filter(Boolean)[0] || null;
      return { kind: 'aws', service, resource };
    }
  }
  if (INSTANCE_ID_RE.test(value) || MACHINE_HINTS.some(re => re.test(value))) {
    return { kind: 'machine', service: 'ec2', resource: value.match(INSTANCE_ID_RE)?.[0] || null };
  }
  return { kind: 'custom', service: null, resource: null };
}

function normalizeLogGroup(group) {
  const name = group.logGroupName;
  return {
    name,
    arn: group.arn || null,
    storedBytes: group.storedBytes ?? 0,
    retentionInDays: group.retentionInDays ?? null,
    creationTime: group.creationTime ?? null,
    kmsKeyId: group.kmsKeyId || null,
    logGroupClass: group.logGroupClass || 'STANDARD',
    metricFilterCount: group.metricFilterCount ?? 0,
    ...classifyLogGroup(name),
  };
}

async function listLogGroups(client, { DescribeLogGroupsCommand }, { maxPages = 40, prefix } = {}) {
  const groups = [];
  let nextToken;
  let pages = 0;
  do {
    const response = await client.send(new DescribeLogGroupsCommand({ nextToken, limit: 50, ...(prefix ? { logGroupNamePrefix: prefix } : {}) }));
    groups.push(...(response.logGroups || []).map(normalizeLogGroup));
    nextToken = response.nextToken;
    pages += 1;
  } while (nextToken && pages < maxPages);
  return { groups, truncated: !!nextToken };
}

/** Most recent streams of a group, with the EC2 instance each one names (agent default). */
async function listLogStreams(client, { DescribeLogStreamsCommand }, logGroupName, { limit = 50 } = {}) {
  const response = await client.send(new DescribeLogStreamsCommand({ logGroupName, orderBy: 'LastEventTime', descending: true, limit }));
  const streams = (response.logStreams || []).map(stream => ({
    name: stream.logStreamName,
    lastEventTime: stream.lastEventTimestamp ?? null,
    firstEventTime: stream.firstEventTimestamp ?? null,
    creationTime: stream.creationTime ?? null,
    instanceId: String(stream.logStreamName || '').match(INSTANCE_ID_RE)?.[0] || null,
  }));
  return { streams, instances: [...new Set(streams.map(s => s.instanceId).filter(Boolean))], more: !!response.nextToken };
}

function normalizeExportTask(task) {
  return {
    taskId: task.taskId,
    taskName: task.taskName || null,
    logGroup: task.logGroupName,
    from: task.from ?? null,
    to: task.to ?? null,
    bucket: task.destination || null,
    prefix: task.destinationPrefix || 'exportedlogs',
    status: task.status?.code || 'UNKNOWN',
    statusMessage: task.status?.message || null,
    createdAt: task.executionInfo?.creationTime ?? null,
    completedAt: task.executionInfo?.completionTime ?? null,
  };
}

async function listExportTasks(client, { DescribeExportTasksCommand }, { maxPages = 10 } = {}) {
  const tasks = [];
  let nextToken;
  let pages = 0;
  do {
    const response = await client.send(new DescribeExportTasksCommand({ nextToken, limit: 50 }));
    tasks.push(...(response.exportTasks || []).map(normalizeExportTask));
    nextToken = response.nextToken;
    pages += 1;
  } while (nextToken && pages < maxPages);
  return tasks.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

function destinationKind(arn) {
  const service = String(arn || '').split(':')[2];
  return { firehose: 'firehose', kinesis: 'kinesis', lambda: 'lambda', logs: 'logs' }[service] || 'other';
}

/** Subscription filters of many groups, a few at a time. */
async function listSubscriptions(client, { DescribeSubscriptionFiltersCommand }, groupNames, { concurrency = 5 } = {}) {
  const result = {};
  const queue = [...groupNames];
  async function worker() {
    while (queue.length) {
      const logGroupName = queue.shift();
      try {
        const response = await client.send(new DescribeSubscriptionFiltersCommand({ logGroupName }));
        const filters = (response.subscriptionFilters || []).map(f => ({
          name: f.filterName, destinationArn: f.destinationArn, kind: destinationKind(f.destinationArn), pattern: f.filterPattern || '',
        }));
        if (filters.length) result[logGroupName] = filters;
      } catch (err) {
        if (err.name !== 'ResourceNotFoundException') result[logGroupName] = { error: err.message };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  return result;
}

/**
 * Per group: how (and whether) its logs are copied out of CloudWatch.
 *  - continuous: a subscription filter streams them (Firehose/Kinesis usually to S3)
 *  - export: one or more export tasks wrote them to S3
 *  - none: no copy; with a retention set, events are lost when they expire
 */
function buildBackupCoverage(groups, { exportTasks = [], subscriptions = {} } = {}) {
  const exportsByGroup = new Map();
  for (const task of exportTasks) {
    if (!exportsByGroup.has(task.logGroup)) exportsByGroup.set(task.logGroup, []);
    exportsByGroup.get(task.logGroup).push(task);
  }
  return groups.map(group => {
    const tasks = exportsByGroup.get(group.name) || [];
    const completed = tasks.filter(t => t.status === 'COMPLETED');
    const lastExport = completed.reduce((best, t) => (!best || (t.to || 0) > (best.to || 0) ? t : best), null);
    const subs = Array.isArray(subscriptions[group.name]) ? subscriptions[group.name] : [];
    const streaming = subs.filter(s => s.kind === 'firehose' || s.kind === 'kinesis');
    const method = streaming.length ? 'continuous' : (completed.length ? 'export' : 'none');
    let risk = null;
    if (method === 'none' && group.retentionInDays) risk = 'expires';
    else if (method === 'export' && group.retentionInDays && lastExport?.to && Date.now() - lastExport.to > group.retentionInDays * 86400000) risk = 'gap';
    return {
      name: group.name, kind: group.kind, service: group.service, storedBytes: group.storedBytes, retentionInDays: group.retentionInDays,
      method, risk,
      subscriptions: subs,
      subscriptionError: subscriptions[group.name]?.error || null,
      exports: tasks.length,
      lastExport: lastExport ? { taskId: lastExport.taskId, from: lastExport.from, to: lastExport.to, bucket: lastExport.bucket, prefix: lastExport.prefix, completedAt: lastExport.completedAt } : null,
    };
  });
}

/** Other services that write their logs straight to S3 buckets. */
async function listS3LogSources(cfg, { sdk }) {
  const sources = [];
  const errors = [];
  try {
    const { CloudTrailClient, DescribeTrailsCommand } = sdk('client-cloudtrail');
    const response = await new CloudTrailClient(cfg).send(new DescribeTrailsCommand({ includeShadowTrails: false }));
    for (const trail of response.trailList || []) {
      if (!trail.S3BucketName) continue;
      sources.push({
        type: 'cloudtrail', name: trail.Name, bucket: trail.S3BucketName,
        prefix: `${trail.S3KeyPrefix ? `${trail.S3KeyPrefix}/` : ''}AWSLogs/`,
        multiRegion: !!trail.IsMultiRegionTrail, logGroup: trail.CloudWatchLogsLogGroupArn ? trail.CloudWatchLogsLogGroupArn.split(':log-group:')[1]?.replace(/:\*$/, '') : null,
      });
    }
  } catch (err) { errors.push({ source: 'cloudtrail', error: err.message, name: err.name }); }
  try {
    const { EC2Client, DescribeFlowLogsCommand } = sdk('client-ec2');
    const response = await new EC2Client(cfg).send(new DescribeFlowLogsCommand({ MaxResults: 200 }));
    for (const flow of response.FlowLogs || []) {
      if (flow.LogDestinationType !== 's3' || !flow.LogDestination) continue;
      const [bucket, ...rest] = flow.LogDestination.replace(/^arn:[^:]+:s3:::/, '').split('/');
      sources.push({ type: 'vpcflow', name: flow.FlowLogId, resource: flow.ResourceId, bucket, prefix: rest.length ? `${rest.join('/')}/` : 'AWSLogs/', status: flow.FlowLogStatus });
    }
  } catch (err) { errors.push({ source: 'vpcflow', error: err.message, name: err.name }); }
  return { sources, errors };
}

const MAX_ARCHIVE_BYTES = 10 * 1024 * 1024;
const MAX_ARCHIVE_TEXT = 2 * 1024 * 1024;

/** Decompresses gzip until `limit` bytes of output; the rest is not inflated. */
function gunzipPrefix(buffer, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let done = false;
    const gunzip = zlib.createGunzip();
    const finish = truncated => {
      if (done) return;
      done = true;
      gunzip.destroy();
      resolve({ data: Buffer.concat(chunks), truncated });
    };
    gunzip.on('data', chunk => {
      chunks.push(chunk);
      size += chunk.length;
      if (size > limit) finish(true);
    });
    gunzip.on('end', () => finish(false));
    gunzip.on('error', err => (done ? null : (chunks.length ? finish(true) : reject(err))));
    gunzip.end(buffer);
  });
}

/**
 * Text of an archived log object. Export tasks and most S3 log sources write
 * gzip files; they are decompressed here (up to 2 MB of text is returned).
 */
async function decodeArchive(buffer, key = '') {
  const gzip = buffer.length > 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;
  const { data, truncated } = gzip ? await gunzipPrefix(buffer, MAX_ARCHIVE_TEXT) : { data: buffer, truncated: false };
  return {
    text: data.subarray(0, MAX_ARCHIVE_TEXT).toString('utf8'),
    gzip,
    truncated: truncated || data.length > MAX_ARCHIVE_TEXT,
    json: /\.json(\.gz)?$/i.test(key),
  };
}

module.exports = {
  INSTANCE_ID_RE, MAX_ARCHIVE_BYTES,
  classifyLogGroup, normalizeLogGroup, listLogGroups, listLogStreams,
  listExportTasks, listSubscriptions, buildBackupCoverage, listS3LogSources, decodeArchive,
};
