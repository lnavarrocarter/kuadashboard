'use strict';
// GCP read errors, classified so the UI can say what happened instead of
// "API not available" for everything. A 400 must not invite an IAM change and a
// disabled API must not look like an outage; the console link to enable an API
// is only offered when Google says the service is disabled.
//
// Inputs are REST errors from gcpFetch (message = JSON body, code = HTTP status)
// and gRPC errors from the client libraries (numeric code, details, reason).

const GRPC = { 3: 'INVALID_ARGUMENT', 4: 'DEADLINE_EXCEEDED', 5: 'NOT_FOUND', 7: 'PERMISSION_DENIED', 8: 'RESOURCE_EXHAUSTED', 9: 'FAILED_PRECONDITION', 13: 'INTERNAL', 14: 'UNAVAILABLE', 16: 'UNAUTHENTICATED' };
const GRPC_HTTP = { 3: 400, 4: 504, 5: 404, 7: 403, 8: 429, 9: 400, 13: 500, 14: 503, 16: 401 };

function parseBody(message) {
  const text = String(message || '').trim();
  if (!text.startsWith('{')) return null;
  try { return JSON.parse(text)?.error || null; } catch { return null; }
}

function detailOf(body, type) {
  return (body?.details || []).find(d => String(d?.['@type'] || '').endsWith(type)) || null;
}

function firstUrl(text) {
  const m = String(text || '').match(/https:\/\/console\.(?:developers|cloud)\.google\.com\/[^\s"'\\]+/);
  return m ? m[0] : null;
}

function classifyGcpError(err) {
  const rawMessage = String(err?.message || err || '');
  const body = parseBody(rawMessage);
  const grpc = typeof err?.code === 'number' && err.code < 100 ? err.code : null;
  const status = body?.code || (grpc != null ? GRPC_HTTP[grpc] : null) || err?.statusCode || (typeof err?.code === 'number' ? err.code : null) || null;
  const code = body?.status || (grpc != null ? GRPC[grpc] : null) || (typeof err?.code === 'string' ? err.code : null) || null;
  const info = detailOf(body, 'ErrorInfo');
  const reason = info?.reason || err?.reason || null;
  const service = info?.metadata?.service || info?.domain || null;
  const message = (body?.message || rawMessage.replace(/^\d+\s+[A-Z_]+:\s*/, '')).slice(0, 300);
  const text = `${rawMessage} ${reason || ''}`;

  let kind = 'unknown';
  if (reason === 'SERVICE_DISABLED' || /has not been used in project .* or it is disabled|API .* is (?:not enabled|disabled)/i.test(text)) kind = 'api_disabled';
  else if (status === 401 || code === 'UNAUTHENTICATED' || /invalid_grant|token (?:has )?expired|reauth|Request had invalid authentication credentials/i.test(text)) kind = 'auth';
  else if (status === 403 || code === 'PERMISSION_DENIED') kind = 'permission';
  else if (status === 429 || code === 'RESOURCE_EXHAUSTED' || /quota|rate limit/i.test(reason || '')) kind = 'quota';
  else if (status === 404 || code === 'NOT_FOUND') kind = 'not_found';
  else if (status === 400 || code === 'INVALID_ARGUMENT' || code === 'FAILED_PRECONDITION') kind = 'invalid_request';
  else if ([500, 502, 503, 504].includes(status) || ['UNAVAILABLE', 'DEADLINE_EXCEEDED', 'INTERNAL'].includes(code) || /ETIMEDOUT|ECONNRESET|ENOTFOUND|EAI_AGAIN|socket hang up|timeout/i.test(rawMessage)) kind = 'transient';

  const activationUrl = kind === 'api_disabled'
    ? (info?.metadata?.activationUrl || firstUrl(rawMessage))
    : null;
  return { kind, status, code, reason, service, message, activationUrl, raw: rawMessage.slice(0, 2000) };
}

// HTTP status for the KUA response; mirrors the upstream status when known.
function httpStatusFor(info) {
  if (info.status && [400, 401, 403, 404, 409, 429, 503, 504].includes(info.status)) return info.status;
  if (info.kind === 'transient') return 503;
  return 500;
}

module.exports = { classifyGcpError, httpStatusFor };
