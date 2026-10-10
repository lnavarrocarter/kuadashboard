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
 */

const express  = require('express');
const auditLog = require('../lib/auditLog');

const router = express.Router();

// The same filters apply to the list, the stats and the CSV export.
function filtersFrom({ category, level, search, from, to }) {
  return {
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
