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

  return { fetchEntries };
}

module.exports = { createGcpLogsBroker };
