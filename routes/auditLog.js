'use strict';
/**
 * routes/auditLog.js
 * REST API for the audit log.
 *
 * Base path: /api/audit
 *
 * GET  /logs         → one page of entries and the number of matches
 *                      (filters: category, level, search, from, to; paging: limit, offset)
 * DELETE /logs       → clear all entries
 * GET  /logs/export  → download the matching entries as CSV
 * GET  /stats        → counters per category and level of the matching entries
 * GET  /verify       → integrity of the chain of entries (lib/auditLog.js verify)
 * GET  /settings     → retention and forwarding status (never the token)
 * PUT  /settings     → { retentionDays?, forward?: { enabled?, url?, token? } }
 * POST /forward/test → sends a test event to the destination
 */

const express  = require('express');
const auditLog = require('../lib/auditLog');

const router = express.Router();

// External copy of the log (Team plan): every new entry is queued for the destination.
const forwarder = require('../lib/auditForwarder').createAuditForwarder({
  settings: {
    get: () => auditLog.getSettings().forward,
    save: forward => auditLog.saveSettings({ forward }),
  },
});
auditLog.onEntry(entry => forwarder.enqueue(entry));
forwarder.start();

function sendError(res, err) {
  res.status(err.statusCode || 500).json({
    error: err.message,
    ...(err.code ? { code: err.code } : {}),
    ...(err.required ? { required: err.required } : {}),
    ...(err.feature ? { feature: err.feature } : {}),
  });
}

function settingsResponse() {
  return { retentionDays: auditLog.getSettings().retentionDays, forward: forwarder.status() };
}

// The same filters apply to the list, the stats and the CSV export.
function filtersFrom({ category, level, search, from, to, actor }) {
  return {
    actor:    ['ui', 'mcp', 'system'].includes(actor) ? actor : undefined,
    category: category || undefined,
    level:    level    || undefined,
    search:   search   || undefined,
    from:     from     || undefined,
    to:       to       || undefined,
  };
}

// ─── GET /logs ────────────────────────────────────────────────────────────────

router.get('/logs', (req, res) => {
  try {
    const { limit, offset } = req.query;
    res.json(auditLog.queryLogs({
      ...filtersFrom(req.query),
      limit:  limit  ? parseInt(limit, 10)  : 200,
      offset: offset ? parseInt(offset, 10) : 0,
    }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /logs/export ─────────────────────────────────────────────────────────

router.get('/logs/export', (req, res) => {
  try {
    const csv = auditLog.exportCsv(filtersFrom(req.query));
    const filename = `kuadashboard-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    res
      .set('Content-Type', 'text/csv; charset=utf-8')
      .set('Content-Disposition', `attachment; filename="${filename}"`)
      .send(csv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /stats ───────────────────────────────────────────────────────────────

router.get('/stats', (req, res) => {
  try {
    res.json(auditLog.getStats(filtersFrom(req.query)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Integrity, retention and forwarding ─────────────────────────────────────

router.get('/verify', (_req, res) => {
  try { res.json(auditLog.verify()); } catch (err) { sendError(res, err); }
});

router.get('/settings', (_req, res) => res.json(settingsResponse()));

router.put('/settings', (req, res) => {
  try {
    const { retentionDays, forward } = req.body || {};
    if (retentionDays !== undefined) auditLog.saveSettings({ retentionDays });
    if (forward) forwarder.configure(forward);
    if (retentionDays !== undefined || forward) {
      auditLog.log({ category: 'system', action: 'audit.settings.changed', level: 'warning', details: { retentionDays: retentionDays ?? null, forwarding: forward ? { enabled: forward.enabled ?? null, url: forward.url ?? null, token: forward.token === undefined ? 'unchanged' : 'changed' } : null } });
    }
    res.json(settingsResponse());
  } catch (err) { sendError(res, err); }
});

router.post('/forward/test', async (_req, res) => {
  try { res.json(await forwarder.test()); } catch (err) { sendError(res, { ...err, message: err.message, statusCode: err.statusCode || 502 }); }
});

// ─── DELETE /logs ─────────────────────────────────────────────────────────────

router.delete('/logs', (req, res) => {
  try {
    auditLog.clearLogs();
    // Log the clear action itself (starts fresh)
    auditLog.log({ category: 'system', action: 'Audit log cleared', level: 'warning' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
