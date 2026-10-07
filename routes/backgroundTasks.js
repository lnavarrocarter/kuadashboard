'use strict';

const express = require('express');

function createBackgroundTasksRouter({ registry }) {
  if (!registry || typeof registry.snapshot !== 'function') throw new TypeError('A background task registry is required');
  const router = express.Router();
  router.get('/', (_req, res) => res.json(registry.snapshot()));
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