'use strict';
/**
 * lib/logScanRunner.js
 * The one background scan runner of the shared log cache. Scans live in one
 * table, so a single runner must serve every provider: the client of a scan
 * comes from the source registered for its profile prefix ("k8s:" for
 * Kubernetes, see lib/kubeLogs) and AWS CloudWatch Logs otherwise.
 */

const sources = new Map(); // profile prefix → async (profileId, region) => FilterLogEvents-compatible client
let taskBinding = null;

function registerLogSource(prefix, clientFor) {
  sources.set(prefix, clientFor);
}

function sourceFor(profileId) {
  for (const [prefix, clientFor] of sources) if (String(profileId).startsWith(prefix)) return clientFor;
  return null;
}

function createScanTaskRegistryBinding(registry, getRunner) {
  const handles = new Map();
  const stateFor = status => ({
    queued: 'scheduled', running: 'running', pause_requested: 'pause_requested',
    paused: 'paused', cancellation_requested: 'cancellation_requested', cancelled: 'cancelled',
    done: 'completed', error: 'error', budget: 'error',
  })[status] || 'idle';
  const iso = value => {
    if (value == null) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  };

  function publish(scan) {
    if (!scan) return;
    const taskId = `logs.scan.${scan.id}`;
    const existing = handles.get(scan.id);
    if (scan.removed) {
      existing?.unregister();
      handles.delete(scan.id);
      return;
    }
    let handle = existing;
    if (!handle) {
      const runner = getRunner();
      handle = registry.register({
        id: taskId,
        name: `Log scan #${scan.id}`,
        type: 'scan',
        provider: String(scan.profileId || '').startsWith('k8s:') ? 'kubernetes' : 'aws',
        enabled: false,
        controls: {
          pause: {
            run: () => runner.pause(scan.id),
            available: ({ state }) => ['queued', 'running'].includes(runner.get(scan.id)?.status)
              && !['pause_requested', 'cancellation_requested'].includes(state),
          },
          resume: {
            run: () => runner.resume(scan.id),
            available: ({ state }) => ['paused', 'error', 'budget'].includes(runner.get(scan.id)?.status) && state !== 'scheduled',
          },
          cancel: {
            run: () => runner.cancel(scan.id),
            available: ({ state }) => !['done', 'cancelled'].includes(runner.get(scan.id)?.status) && state !== 'cancellation_requested',
          },
        },
      });
      handles.set(scan.id, handle);
    }
    handle.update({
      state: stateFor(scan.status),
      provider: String(scan.profileId || '').startsWith('k8s:') ? 'kubernetes' : 'aws',
      startedAt: iso(scan.startedAt),
      lastRunAt: iso(scan.startedAt),
      lastFinishedAt: iso(scan.finishedAt),
      nextRunAt: null,
      lastRunStatus: scan.status,
      progress: scan.progress,
      errorCode: scan.status === 'error' ? 'scan_failed' : scan.status === 'budget' ? 'cache_budget' : null,
    });
  }

  return { publish, sync: () => getRunner().list().forEach(publish) };
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
    runner = createScanRunner({ cache: getLogCache(), clientFor: logClientFor, onChange: scan => taskBinding?.publish(scan) });
    runner.init();
  }
  return runner;
}

function attachTaskRegistry(registry) {
  if (!registry || typeof registry.register !== 'function') throw new TypeError('A background task registry is required');
  taskBinding = createScanTaskRegistryBinding(registry, getLogScanRunner);
  taskBinding.sync();
}

module.exports = { getLogScanRunner, registerLogSource, sourceFor, logClientFor, attachTaskRegistry, createScanTaskRegistryBinding };
