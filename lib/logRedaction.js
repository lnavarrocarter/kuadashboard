'use strict';
/**
 * lib/logRedaction.js
 * Secrets never reach the screen from a live log read (#239).
 *
 * The log cache already stores every line sanitized (frontend/src/shared/logSignals.mjs), and
 * signatures, embeddings and agent briefs come from that cache. Live reads did not: the per-resource
 * log routes (Lambda, ECS, EventBridge, GCP, Vercel, CloudWatch live and Insights) and the pod, GCP
 * and Vercel streams sent the raw message. Here the same sanitizer is applied to every log response
 * of the API and to every streamed line, and the response says how many secrets were hidden.
 *
 * This is defensive only: a secret written to a log must still be rotated, and the logging removed
 * at its source. Redacting the viewer does not delete the secret from the provider's storage.
 */

const path = require('node:path');
const { pathToFileURL } = require('node:url');

let signals = null;
const ready = import(pathToFileURL(path.join(__dirname, '..', 'frontend', 'src', 'shared', 'logSignals.mjs')).href)
  .then(module => { signals = module; return module; });

// Findings that are secrets (rotate them); personal data and IPs are redacted or counted, not secrets.
const SECRET_TYPES = new Set(['password', 'token', 'api_key', 'secret', 'authorization', 'bearer', 'aws_key', 'jwt', 'private_key', 'url_credentials']);
// The text of a log entry, whatever the provider calls it.
const TEXT_KEYS = new Set(['message', '@message', 'textPayload', 'text', 'log', 'line', 'data', 'value']);
const PAYLOAD_KEYS = new Set(['jsonPayload', 'payload', 'protoPayload', 'fields']);
const LOG_ARRAYS = new Set(['events', 'entries', 'logs', 'lines', 'rows', 'results', 'items', 'records']);

function newTally() {
  return { secrets: 0, types: {} };
}

function count(tally, findings) {
  for (const [type, n] of Object.entries(findings || {})) {
    if (!SECRET_TYPES.has(type) || !n) continue;
    tally.secrets += n;
    tally.types[type] = (tally.types[type] || 0) + n;
  }
}

/** One line, sanitized; the tally counts the secrets found. */
function redactText(text, tally = newTally()) {
  if (typeof text !== 'string' || !text || !signals) return text;
  const { text: clean, findings } = signals.sanitizeWithFindings(text);
  count(tally, findings);
  // Lines with nothing to hide keep their exact text; redacted ones keep their edges (a streamed
  // chunk ends with its newline).
  if (!Object.keys(findings).some(type => type !== 'ip_address')) return text;
  const [, lead, , tail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(text);
  return `${lead}${clean}${tail}`;
}

// A structured payload names its secrets by property ({ "password": "hunter2" }).
const SECRET_PROPERTY = /(^|[_-])(password|passwd|pwd|secret|token|api[_-]?key|apikey|private[_-]?key|authorization|credentials?)([_-]|$)|^(password|passwd|pwd|secret|token|apikey|authorization)$/i;
const PROPERTY_TYPE = key => (/passw|pwd/i.test(key) ? 'password' : /api[_-]?key|apikey/i.test(key) ? 'api_key' : /token/i.test(key) ? 'token' : /authorization/i.test(key) ? 'authorization' : 'secret');

function redactDeep(value, tally, depth = 0) {
  if (depth > 6 || value == null) return value;
  if (typeof value === 'string') return redactText(value, tally);
  if (Array.isArray(value)) return value.map(item => redactDeep(item, tally, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (SECRET_PROPERTY.test(key) && (typeof item === 'string' || typeof item === 'number') && String(item) && !/^\[redacted\]$/.test(String(item))) {
        count(tally, { [PROPERTY_TYPE(key)]: 1 });
        out[key] = '[redacted]';
      } else out[key] = redactDeep(item, tally, depth + 1);
    }
    return out;
  }
  return value;
}

function redactEntry(entry, tally) {
  if (typeof entry === 'string') return redactText(entry, tally);
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry;
  let changed = null;
  for (const [key, value] of Object.entries(entry)) {
    let next = value;
    if (TEXT_KEYS.has(key) && typeof value === 'string') next = redactText(value, tally);
    else if (PAYLOAD_KEYS.has(key) && value && typeof value === 'object') next = redactDeep(value, tally);
    if (next !== value) (changed ||= { ...entry })[key] = next;
  }
  return changed || entry;
}

/** Redacts the log arrays of an API response body (also nested one level, e.g. { data: { events } }). */
function redactLogPayload(body, tally = newTally(), depth = 0) {
  if (!body || typeof body !== 'object' || depth > 3) return body;
  if (Array.isArray(body)) return body.map(item => (Array.isArray(item) ? item.map(cell => redactEntry(cell, tally)) : redactEntry(item, tally)));
  let out = body;
  for (const [key, value] of Object.entries(body)) {
    let next = value;
    if (LOG_ARRAYS.has(key) && Array.isArray(value)) next = redactLogPayload(value, tally, depth + 1);
    else if (value && typeof value === 'object' && !Array.isArray(value)) next = redactLogPayload(value, tally, depth + 1);
    if (next !== value) {
      if (out === body) out = { ...body };
      out[key] = next;
    }
  }
  return out;
}

// API paths that return log text.
const LOG_PATH = /\/(logs?|log-groups|logging|log-intelligence|serial-output)(\/|$|\?)/i;

/** Express middleware: log responses leave the server sanitized, with the count of hidden secrets. */
function logRedactionMiddleware(req, res, next) {
  if (!LOG_PATH.test(req.originalUrl || req.url || '')) return next();
  const json = res.json.bind(res);
  res.json = body => {
    if (!signals || !body || typeof body !== 'object') return json(body);
    const tally = newTally();
    const clean = redactLogPayload(body, tally);
    if (tally.secrets && !Array.isArray(clean)) return json({ ...clean, redaction: tally });
    if (tally.secrets) res.set('X-KUA-Redacted-Secrets', String(tally.secrets));
    return json(clean);
  };
  if (signals) return next();
  return ready.then(() => next(), () => next());
}

module.exports = { logRedactionMiddleware, ready, redactLogPayload, redactText, SECRET_TYPES };
