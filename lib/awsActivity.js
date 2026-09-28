'use strict';

// Per-resource activity for the AWS tables: executions of the last 24h from
// CloudWatch metrics and whether each resource's logs can be read.

const { classifyAwsError, buildAccessRequest } = require('./awsAccess');

const DAY_MS = 86400 * 1000;
const QUERIES_PER_CALL = 500;   // GetMetricData limit
const CONCURRENCY = 8;
const LAMBDA_NAME_RE = /^[A-Za-z0-9_-]{1,140}$/;
const LOG_GROUP_RE = /^[.\-_/#A-Za-z0-9]{1,512}$/;
const SFN_ARN_RE = /^arn:aws[a-z-]*:states:[a-z0-9-]+:\d{12}:stateMachine:[A-Za-z0-9_-]{1,80}$/;

function defaultSdk(pkg) {
  return require(`@aws-sdk/${pkg}`);
}

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  }));
  return results;
}

/** Validates the function list the client sends (names and optional custom log groups). */
function validLambdaFunctions(functions) {
  if (!Array.isArray(functions) || functions.length > 2000) return null;
  const out = [];
  for (const fn of functions) {
    if (!fn || !LAMBDA_NAME_RE.test(fn.name || '')) return null;
    const logGroup = fn.logGroup || `/aws/lambda/${fn.name}`;
    if (!LOG_GROUP_RE.test(logGroup)) return null;
    out.push({ name: fn.name, logGroup });
  }
  return out;
}

function validStateMachines(machines) {
  if (!Array.isArray(machines) || machines.length > 2000) return null;
  return machines.every(m => m && SFN_ARN_RE.test(m.arn || '')) ? machines.map(m => ({ arn: m.arn })) : null;
}

/**
 * Sums the last 24h of metrics per resource. `metricsFor(item)` returns
 * { key: { namespace, metricName, dimensions } }; queries are batched 500 per call.
 */
async function sumMetrics(client, commands, items, metricsFor, now) {
  const queries = [];
  const owners = new Map();
  items.forEach((item, i) => {
    Object.entries(metricsFor(item)).forEach(([key, metric], k) => {
      const id = `q${i}_${k}`;
      owners.set(id, { index: i, key });
      queries.push({ Id: id, MetricStat: { Metric: { Namespace: metric.namespace, MetricName: metric.metricName, Dimensions: metric.dimensions }, Period: 3600, Stat: 'Sum' }, ReturnData: true });
    });
  });
  const totals = items.map(() => ({}));
  const batches = [];
  for (let offset = 0; offset < queries.length; offset += QUERIES_PER_CALL) batches.push(queries.slice(offset, offset + QUERIES_PER_CALL));
  // Batches are independent, so they run in parallel.
  await Promise.all(batches.map(async batch => {
    let token;
    do {
      const response = await client.send(new commands.GetMetricDataCommand({
        StartTime: new Date(now - DAY_MS), EndTime: new Date(now), MetricDataQueries: batch, NextToken: token,
      }));
      for (const result of response.MetricDataResults || []) {
        const owner = owners.get(result.Id);
        if (!owner) continue;
        const sum = (result.Values || []).reduce((total, v) => total + v, 0);
        totals[owner.index][owner.key] = Math.round((totals[owner.index][owner.key] || 0) + sum);
      }
      token = response.NextToken;
    } while (token);
  }));
  return totals;
}

function logStatus(group) {
  if (!group) return 'missing';
  return group.storedBytes > 0 ? 'ok' : 'empty';
}

/**
 * Log group of each function: the default /aws/lambda/ groups are listed in
 * bulk (one prefix, paginated); custom groups (LoggingConfig) one by one.
 */
async function lambdaLogGroups(client, commands, functions) {
  const found = new Map();
  let token;
  do {
    const response = await client.send(new commands.DescribeLogGroupsCommand({ logGroupNamePrefix: '/aws/lambda/', nextToken: token }));
    (response.logGroups || []).forEach(group => found.set(group.logGroupName, group));
    token = response.nextToken;
  } while (token);
  const custom = [...new Set(functions.map(fn => fn.logGroup).filter(name => !name.startsWith('/aws/lambda/')))];
  await mapWithConcurrency(custom, CONCURRENCY, async name => {
    const response = await client.send(new commands.DescribeLogGroupsCommand({ logGroupNamePrefix: name, limit: 5 }));
    const group = (response.logGroups || []).find(g => g.logGroupName === name);
    if (group) found.set(name, group);
  });
  return found;
}

/**
 * Lambda table activity: invocations and errors of the last 24h, and the
 * state of each function's log group ('ok', 'empty', 'missing' or 'unknown').
 */
async function lambdaActivity(cfg, functions, { sdk = defaultSdk, now = Date.now() } = {}) {
  const cw = sdk('client-cloudwatch');
  const logs = sdk('client-cloudwatch-logs');
  const metricsFor = fn => {
    const dimensions = [{ Name: 'FunctionName', Value: fn.name }];
    return {
      invocations: { namespace: 'AWS/Lambda', metricName: 'Invocations', dimensions },
      errors: { namespace: 'AWS/Lambda', metricName: 'Errors', dimensions },
    };
  };
  const [metrics, groups] = await Promise.all([
    settle(sumMetrics(new cw.CloudWatchClient(cfg), cw, functions, metricsFor, now)),
    settle(lambdaLogGroups(new logs.CloudWatchLogsClient(cfg), logs, functions)),
  ]);
  const result = {};
  functions.forEach((fn, i) => {
    const group = groups.ok ? groups.value.get(fn.logGroup) : null;
    result[fn.name] = {
      invocations: metrics.ok ? (metrics.value[i].invocations || 0) : null,
      errors: metrics.ok ? (metrics.value[i].errors || 0) : null,
      logGroup: fn.logGroup,
      logStatus: groups.ok ? logStatus(group) : 'unknown',
      storedBytes: group?.storedBytes ?? null,
      retentionInDays: group?.retentionInDays ?? null,
    };
  });
  return {
    windowHours: 24,
    functions: result,
    metricsError: metrics.ok ? null : failure(metrics.error, 'POST /lambda/activity'),
    logsError: groups.ok ? null : failure(groups.error, 'POST /lambda/activity'),
  };
}

function logGroupNameFromArn(arn = '') {
  const match = String(arn).match(/:log-group:(.+?)(?::\*)?$/);
  return match ? match[1] : null;
}

/**
 * Step Functions table activity: executions of the last 24h from CloudWatch
 * (works for Express machines, unlike ListExecutions) and logging settings.
 */
async function stepFunctionsActivity(cfg, machines, { sdk = defaultSdk, now = Date.now() } = {}) {
  const cw = sdk('client-cloudwatch');
  const sfn = sdk('client-sfn');
  const metricsFor = machine => {
    const dimensions = [{ Name: 'StateMachineArn', Value: machine.arn }];
    const metric = metricName => ({ namespace: 'AWS/States', metricName, dimensions });
    return { started: metric('ExecutionsStarted'), succeeded: metric('ExecutionsSucceeded'), failed: metric('ExecutionsFailed'), timedOut: metric('ExecutionsTimedOut'), aborted: metric('ExecutionsAborted') };
  };
  const sfnClient = new sfn.SFNClient(cfg);
  const [metrics, logging] = await Promise.all([
    settle(sumMetrics(new cw.CloudWatchClient(cfg), cw, machines, metricsFor, now)),
    settle(mapWithConcurrency(machines, CONCURRENCY, async machine => {
      const described = await sfnClient.send(new sfn.DescribeStateMachineCommand({ stateMachineArn: machine.arn }));
      const config = described.loggingConfiguration || {};
      const arn = config.destinations?.[0]?.cloudWatchLogsLogGroup?.logGroupArn || null;
      return { level: config.level || 'OFF', includeExecutionData: !!config.includeExecutionData, logGroup: logGroupNameFromArn(arn) };
    })),
  ]);
  const result = {};
  machines.forEach((machine, i) => {
    result[machine.arn] = {
      executions: metrics.ok ? { started: 0, succeeded: 0, failed: 0, timedOut: 0, aborted: 0, ...metrics.value[i] } : null,
      logging: logging.ok ? logging.value[i] : null,
    };
  });
  return {
    windowHours: 24,
    stateMachines: result,
    metricsError: metrics.ok ? null : failure(metrics.error, 'POST /stepfunctions/activity'),
    loggingError: logging.ok ? null : failure(logging.error, 'POST /stepfunctions/activity'),
  };
}

async function settle(promise) {
  try { return { ok: true, value: await promise }; } catch (error) { return { ok: false, error }; }
}

function failure(error, route) {
  const classified = classifyAwsError(error);
  return { error: classified, access: buildAccessRequest({ error: classified, route }) };
}

module.exports = {
  validLambdaFunctions,
  validStateMachines,
  logGroupNameFromArn,
  lambdaActivity,
  stepFunctionsActivity,
};
