'use strict';
function logMessage(entry) {
  if (entry.textPayload !== undefined) return entry.textPayload;
  if (entry.jsonPayload !== undefined) return JSON.stringify(entry.jsonPayload);
  if (entry.protoPayload !== undefined) return JSON.stringify(entry.protoPayload);
  if (entry.httpRequest) return JSON.stringify(entry.httpRequest);
  return '';
}
function mapLogEntry(entry) {
  return {
    timestamp: entry.timestamp, severity: entry.severity || 'DEFAULT', resource: entry.resource?.type || '',
    logName: entry.logName?.split('/').pop() || '', message: logMessage(entry), labels: entry.labels || {},
  };
}
function loggingRequest(projectId, options, now = Date.now()) {
  const { filter = '', limit = 100, hours = 3, pageToken = '', since, until } = options;
  const invalid = message => { throw Object.assign(new Error(message), { code: 400 }); };
  if (typeof filter !== 'string') invalid('filter must be a string');
  if (typeof pageToken !== 'string') invalid('pageToken must be a string');
  const safeHours = Math.min(Math.max(parseInt(hours) || 3, 1), 168);
  const lower = since || new Date(now - safeHours * 3600000).toISOString();
  const upper = until || new Date(now).toISOString();
  if (typeof lower !== 'string' || typeof upper !== 'string' || !Number.isFinite(Date.parse(lower)) || !Number.isFinite(Date.parse(upper))) invalid('Invalid log time range');
  if (Date.parse(lower) > Date.parse(upper)) invalid('since must precede until');
  if (pageToken && (!since || !until)) invalid('since and until are required for pagination');
  return { since: lower, until: upper, body: {
    resourceNames: [`projects/${projectId}`],
    filter: [filter ? `(${filter})` : '', `timestamp>=${JSON.stringify(lower)}`, `timestamp<=${JSON.stringify(upper)}`].filter(Boolean).join(' AND '),
    orderBy: 'timestamp desc', pageSize: Math.min(Math.max(parseInt(limit) || 100, 1), 500),
    ...(pageToken ? { pageToken } : {}),
  } };
}
module.exports = { mapLogEntry, logMessage, loggingRequest };
