'use strict';

// Wraps the exact same Cloud Logging REST call already used by the one-off
// GET /cloudrun/:region/:service/logs route in routes/gcp.js, so a Console session can
// poll it as a tail instead of a single snapshot fetch. No new collection mechanism —
// same auth, same filter shape, same API.

function createGcpLogsBroker({ resolveGcpAuth, gcpFetch } = {}) {
  resolveGcpAuth ||= require('../routes/gcp').resolveGcpAuth;
  gcpFetch ||= require('../routes/gcp').gcpFetch;

  async function fetchEntries({ profileId, project, region, service, sinceTimestamp, pageSize = 200 }) {
    const authCtx = await resolveGcpAuth(profileId);
    const resolvedProject = project || authCtx.projectId;
    if (!resolvedProject) throw Object.assign(new Error('GCP project is required'), { $metadata: { httpStatusCode: 400 } });
    const filter = [
      `resource.type="cloud_run_revision"`,
      `resource.labels.service_name="${service}"`,
      `resource.labels.location="${region}"`,
      `timestamp>"${sinceTimestamp}"`,
    ].join(' AND ');
    const data = await gcpFetch('https://logging.googleapis.com/v2/entries:list', authCtx, 'POST', {
      resourceNames: [`projects/${resolvedProject}`],
      filter,
      orderBy: 'timestamp asc',
      pageSize,
    });
    const entries = (data.entries || []).map(e => ({
      timestamp: e.timestamp,
      severity: e.severity || 'DEFAULT',
      message: e.textPayload || (e.jsonPayload ? JSON.stringify(e.jsonPayload) : ''),
    }));
    const nextSince = entries.length ? entries[entries.length - 1].timestamp : sinceTimestamp;
    return { entries, nextSince };
  }

  async function fetchCachePage({ profileId, project, kind, region, name, startTime, endTime, pageToken, pageSize = 1000 }) {
    const authCtx = await resolveGcpAuth(profileId);
    const projectId = project || authCtx.projectId;
    if (!projectId) throw Object.assign(new Error('GCP project is required'), { $metadata: { httpStatusCode: 400 } });
    const quote = value => String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"');
    const resourceFilter = kind === 'function'
      ? `(resource.type="cloud_run_revision" AND labels."goog-managed-by"="cloudfunctions" AND resource.labels.service_name="${quote(name)}" AND resource.labels.location="${quote(region)}") OR (resource.type="cloud_function" AND resource.labels.function_name="${quote(name)}" AND resource.labels.region="${quote(region)}")`
      : `resource.type="cloud_run_revision" AND resource.labels.service_name="${quote(name)}" AND resource.labels.location="${quote(region)}"`;
    const filter = `(${resourceFilter}) AND timestamp >= "${new Date(startTime).toISOString()}" AND timestamp < "${new Date(endTime).toISOString()}"`;
    const data = await gcpFetch('https://logging.googleapis.com/v2/entries:list', authCtx, 'POST', {
      resourceNames: [`projects/${projectId}`], filter, orderBy: 'timestamp asc',
      pageSize: Math.min(Math.max(1, Number(pageSize) || 1000), 1000), ...(pageToken ? { pageToken } : {}),
    });
    return {
      events: (data.entries || []).map(entry => ({
        timestamp: Date.parse(entry.timestamp),
        eventId: entry.insertId || '',
        logStreamName: entry.logName || '',
        message: entry.textPayload || (entry.jsonPayload ? JSON.stringify(entry.jsonPayload) : entry.protoPayload ? JSON.stringify(entry.protoPayload) : ''),
      })).filter(event => Number.isFinite(event.timestamp)),
      nextToken: data.nextPageToken,
    };
  }

  return { fetchEntries, fetchCachePage };
}

module.exports = { createGcpLogsBroker };
