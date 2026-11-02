'use strict';

const express = require('express');

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * The KUApps task coordinator in the background task manager (lib/kua/coordinatorTasks.js, #330):
 * POST /events receives the renderer's batches (this computer only), GET /:applicationId is
 * the drill-down of one application.
 */
function createKuappsCoordinatorRouter({ coordinators }) {
  if (!coordinators || typeof coordinators.ingest !== 'function') throw new TypeError('Coordinator tasks are required');
  const router = express.Router();
  router.post('/events', (req, res) => {
    // The renderer runs on this computer; when KUA listens on another interface, nobody else feeds it.
    if (!LOOPBACK.has(req.socket?.remoteAddress || '')) {
      return res.status(403).json({ error: 'Only this computer can report coordinator events', code: 'LOOPBACK_ONLY' });
    }
    try {
      res.json(coordinators.ingest(req.body));
    } catch (error) {
      res.status(error.statusCode || 500).json({ error: error.message, code: error.code || 'COORDINATOR_EVENTS_FAILED' });
    }
  });
  router.get('/:applicationId', (req, res) => {
    const detail = coordinators.detail(req.params.applicationId);
    if (!detail) return res.status(404).json({ error: 'No coordinator for this application', code: 'COORDINATOR_NOT_FOUND' });
    res.json(detail);
  });
  return router;
}

module.exports = { createKuappsCoordinatorRouter };
