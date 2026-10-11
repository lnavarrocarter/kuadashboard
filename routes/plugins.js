'use strict';
/**
 * routes/plugins.js
 * /api/plugins: first-party plugins and whether each is on for this computer (#193).
 *
 *   GET /        { plugins: [{ manifest, active, status }] }
 *   PUT /:id     { active: boolean } → the plugin
 */

const express = require('express');

function createPluginsRouter({ registry, auditLog } = {}) {
  if (!registry) throw new Error('registry is required');
  const router = express.Router();
  const fail = (res, error) => res.status(error.statusCode || 500).json({ error: error.message, code: error.code });

  router.get('/', async (_req, res) => {
    try { res.json({ plugins: await registry.list() }); } catch (error) { fail(res, error); }
  });

  router.put('/:id', async (req, res) => {
    try {
      const plugin = await registry.setActive(req.params.id, req.body?.active);
      auditLog?.log({ category: 'kua', action: plugin.active ? 'Plugin turned on' : 'Plugin turned off', resource: plugin.manifest.name, context: 'plugins', details: { pluginId: plugin.manifest.id } });
      res.json(plugin);
    } catch (error) { fail(res, error); }
  });

  return router;
}

module.exports = { createPluginsRouter };
