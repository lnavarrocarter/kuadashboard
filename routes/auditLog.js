'use strict';
/**
 * routes/auditLog.js
 * REST API for the audit log.
 *
 * Base path: /api/audit
 *
 * GET  /logs         → list entries (filters: limit, category, level, search, from, to)
 * DELETE /logs       → clear all entries
 * GET  /logs/export  → download as CSV
 * GET  /stats        → summary counters per category and level
 */

const express  = require('express');
const auditLog = require('../lib/auditLog');

const router = express.Router();

// ─── GET /logs ────────────────────────────────────────────────────────────────

router.get('/logs', (req, res) => {
  try {
    const { limit, category, level, search, from, to } = req.query;
    const entries = auditLog.getLogs({
      limit:    limit    ? parseInt(limit, 10) : 200,
      category: category || undefined,
      level:    level    || undefined,
      search:   search   || undefined,
      from:     from     || undefined,
      to:       to       || undefined,
    });
    res.json({ entries, total: entries.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /logs/export ─────────────────────────────────────────────────────────

router.get('/logs/export', (req, res) => {
  try {
    const csv = auditLog.exportCsv();
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
    const entries = auditLog.getLogs({ limit: 5000 });
    const byCategory = {};
    const byLevel    = {};
    for (const e of entries) {
      byCategory[e.category] = (byCategory[e.category] || 0) + 1;
      byLevel[e.level]       = (byLevel[e.level]       || 0) + 1;
    }
    res.json({ total: entries.length, byCategory, byLevel });
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
