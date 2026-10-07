'use strict';

const { createGcpLogsBroker } = require('./gcpLogsBroker');
const { createVercelLogsBroker } = require('./vercelLogsBroker');

const GCP_MAX_PAGES_PER_SYNC = 5;
const GCP_PAGE_SIZE = 1000;

class ProviderLogPageCommand {
  constructor(input) { this.input = input; }
}

function parseProviderLogGroup(logGroup) {
  const parts = String(logGroup || '').split(':');
  if (parts[0] === 'gcp' && parts.length === 5 && ['cloudrun', 'function'].includes(parts[1])) {
    return { provider: 'gcp', kind: parts[1], project: decodeURIComponent(parts[2]), region: decodeURIComponent(parts[3]), name: decodeURIComponent(parts[4]) };
  }
  if (parts[0] === 'vercel' && parts[1] === 'project' && parts.length === 3) {
    return { provider: 'vercel', projectId: decodeURIComponent(parts[2]) };
  }
  return null;
}

function estimateLogSyncRequests(provider) {
  if (provider === 'gcp') return GCP_MAX_PAGES_PER_SYNC;
  if (provider === 'vercel') return 2;
  return null;
}

function createLogProviderSync({ cache, gcpBroker = createGcpLogsBroker(), vercelBroker = createVercelLogsBroker() }) {
  return async function syncProviderLogGroup({ profileId, region, logGroup, latestOnly = false }) {
    const target = { profileId, region, logGroup };
    const parsed = parseProviderLogGroup(logGroup);
    if (!parsed) throw Object.assign(new Error('Unsupported provider log group'), { $metadata: { httpStatusCode: 400 } });

    if (parsed.provider === 'gcp') {
      const client = {
        send: command => gcpBroker.fetchCachePage({
          profileId, project: parsed.project, kind: parsed.kind, region: parsed.region, name: parsed.name,
          startTime: command.input.startTime, endTime: command.input.endTime,
          pageToken: command.input.nextToken, pageSize: GCP_PAGE_SIZE,
        }),
      };
      return cache.syncGroup({ ...target, client, FilterLogEventsCommand: ProviderLogPageCommand, maxPages: GCP_MAX_PAGES_PER_SYNC, latestOnly });
    }

    let truncated = false;
    const client = {
      send: async command => {
        const page = await vercelBroker.runtimeLogs({
          profileId, projectId: parsed.projectId, startTime: command.input.startTime, endTime: command.input.endTime,
        });
        truncated ||= page.truncated;
        return { events: page.events, ...(page.truncated ? { nextToken: 'runtime-log-response-capped' } : {}) };
      },
    };
    const result = await cache.syncGroup({ ...target, client, FilterLogEventsCommand: ProviderLogPageCommand, maxPages: 1, latestOnly: true });
    return { ...result, truncated };
  };
}

module.exports = {
  createLogProviderSync, parseProviderLogGroup, estimateLogSyncRequests,
  GCP_MAX_PAGES_PER_SYNC, GCP_PAGE_SIZE,
};