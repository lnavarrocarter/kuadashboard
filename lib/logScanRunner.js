'use strict';
/**
 * lib/logScanRunner.js
 * The one background scan runner of the shared log cache. Scans live in one
 * table, so a single runner must serve every provider: the client of a scan
 * comes from the source registered for its profile prefix ("k8s:" for
 * Kubernetes, see lib/kubeLogs) and AWS CloudWatch Logs otherwise.
 */

const sources = new Map(); // profile prefix → async (profileId, region) => FilterLogEvents-compatible client

function registerLogSource(prefix, clientFor) {
  sources.set(prefix, clientFor);
}

function sourceFor(profileId) {
  for (const [prefix, clientFor] of sources) if (String(profileId).startsWith(prefix)) return clientFor;
  return null;
}

/** FilterLogEvents-compatible client of a cache scope: a registered source, or CloudWatch Logs. */
async function logClientFor(profileId, region) {
  const source = sourceFor(profileId);
  if (source) return source(profileId, region);
  const { resolveAwsConfig } = require('./awsProfileResolver');
  const { CloudWatchLogsClient } = require('@aws-sdk/client-cloudwatch-logs');
  return new CloudWatchLogsClient({ ...(await resolveAwsConfig(profileId)), region });
}

let runner = null;
function getLogScanRunner() {
  if (!runner) {
    const { createScanRunner } = require('./awsLogScans');
    const { getLogCache } = require('./awsLogCache');
    runner = createScanRunner({ cache: getLogCache(), clientFor: logClientFor });
    runner.init();
  }
  return runner;
}

module.exports = { getLogScanRunner, registerLogSource, sourceFor, logClientFor };
