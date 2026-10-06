'use strict';

const express = require('express');

function createBackgroundTasksRouter({ registry }) {
  if (!registry || typeof registry.snapshot !== 'function') throw new TypeError('A background task registry is required');
  const router = express.Router();
  router.get('/', (_req, res) => res.json(registry.snapshot()));
  return router;
}

module.exports = { createBackgroundTasksRouter };