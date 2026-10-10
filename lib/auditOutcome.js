'use strict';
/**
 * lib/auditOutcome.js
 * The outcome of every change KUA sends to clouds and clusters, in one place:
 * method and path, HTTP status, duration and whether it succeeded, failed or
 * was refused. The writes are the same ones the read-only mode guards
 * (lib/readOnlyMode.js guardedArea), so a new write endpoint is recorded too.
 * Routes keep their own, more descriptive entries; this one is uniform.
 */

const { guardedArea } = require('./readOnlyMode');

const CATEGORY = { aws: 'aws', gcp: 'gcp', vercel: 'vercel', helm: 'helm', kubernetes: 'kubernetes', console: 'console' };

function outcomeOf(status) {
  if (status < 400) return 'succeeded';
  if (status === 401 || status === 403 || status === 409) return 'refused';
  return 'failed';
}

function createAuditOutcomeMiddleware({ audit, now = () => Date.now() }) {
  return function auditOutcome(req, res, next) {
    const pathname = new URL(req.originalUrl, 'http://localhost').pathname;
    const startedAt = now();
    res.on('finish', () => {
      // A refusal already recorded (read-only mode) is not written twice.
      if (res.locals?.auditRecorded) return;
      const area = guardedArea(req.method, pathname, req.body);
      if (!area) return;
      const outcome = outcomeOf(res.statusCode);
      audit.log({
        category: CATEGORY[area] || 'system',
        action: `operation.${outcome}`,
        resource: `${req.method} ${pathname}`,
        level: outcome === 'succeeded' ? 'info' : 'warning',
        context: req.get?.('X-Profile-Id') || '',
        details: { status: res.statusCode, durationMs: Math.max(0, now() - startedAt), outcome },
      });
    });
    next();
  };
}

module.exports = { createAuditOutcomeMiddleware, outcomeOf };
