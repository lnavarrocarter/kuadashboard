'use strict';

const express = require('express');

function createBackgroundTasksRouter({ registry, history = null }) {
  if (!registry || typeof registry.snapshot !== 'function') throw new TypeError('A background task registry is required');
  const router = express.Router();
  router.get('/', (_req, res) => res.json(registry.snapshot()));
  // Finished runs of the last days (lib/taskHistory.js, #351).
  router.get('/history', (req, res) => {
    if (!history) return res.json({ runs: [], summary24h: { runs: 0, completed: 0, failed: 0, cancelled: 0 }, retentionDays: 0, maxRuns: 0 });
    try {
      res.json(history.list({
        outcome: typeof req.query.outcome === 'string' ? req.query.outcome : null,
        q: typeof req.query.q === 'string' ? req.query.q : '',
        limit: req.query.limit,
      }));
    } catch (error) {
      res.status(500).json({ error: error.message, code: 'TASK_HISTORY_FAILED' });
    }
  });
  router.post('/:id/:action', async (req, res) => {
    try {
      res.json(await registry.control(req.params.id, req.params.action));
    } catch (error) {
      res.status(error.statusCode || 500).json({ error: error.message, code: error.code || 'TASK_CONTROL_FAILED' });
    }
  });
  return router;
}

module.exports = { createBackgroundTasksRouter };