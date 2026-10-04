'use strict';

const express = require('express');
const { validateKuaAppBundle } = require('../lib/kua/kuaAppBundle');
const { createKuaAppIo } = require('../lib/kua/kuaAppIo');
const { getAccount } = require('../lib/account/account');

function createKuaAppsRouter({ database, apmDatabase, auditLog, account = getAccount, syncEngine = null, teamEngine = null } = {}) {
  if (!database || !apmDatabase) throw new Error('database and apmDatabase are required');
  const router = express.Router();
  const io = createKuaAppIo({ database, apmDatabase });

  function profileId(req, res) {
    const value = req.get('X-Profile-Id');
    if (!value) res.status(400).json({ error: 'X-Profile-Id header is required' });
    return value;
  }

  function scopedApplication(req, res) {
    const profile = profileId(req, res);
    if (!profile) return null;
    const application = apmDatabase.getApplication(req.params.applicationId);
    if (!application || application.profileId !== profile) {
      res.status(404).json({ error: 'KUA Application not found' });
      return null;
    }
    return application;
  }

  function handleError(res, error) {
    const status = error.statusCode || (/UNIQUE constraint failed/.test(error.message) ? 409 : 500);
    res.status(status).json({ error: error.message || 'Internal server error', ...(error.code ? { code: error.code } : {}) });
  }

  function importInto(res, profile, bundle) {
    try {
      const result = io.importBundle(profile, bundle);
      res.status(201).json(result);
      if (result.project) {
        auditLog?.log({
          category: 'kua', action: 'KUAAppBundle imported', resource: result.application.name,
          context: profile, details: { applicationId: result.application.id, projectId: result.project.id },
        });
      }
    } catch (error) { handleError(res, error); }
  }

  router.get('/:applicationId/export', (req, res) => {
    const application = scopedApplication(req, res);
    if (!application) return;
    try {
      const bundle = io.exportBundle(application);
      const filename = `${application.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'kua-app'}.kuaapp.json`;
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.json(bundle);
    } catch (error) { handleError(res, error); }
  });

  router.post('/import', (req, res) => {
    const profile = profileId(req, res);
    if (!profile) return;
    let bundle;
    try {
      bundle = validateKuaAppBundle(req.body?.bundle || req.body);
    } catch (error) {
      return handleError(res, error);
    }
    importInto(res, profile, bundle);
  });

  // Cloud backups (KUA account, Pro and Team): the same sanitized bundle as the export.
  router.post('/:applicationId/cloud-backup', async (req, res) => {
    const application = scopedApplication(req, res);
    if (!application) return;
    try {
      const backup = await account().backups.create(io.exportBundle(application));
      auditLog?.log({ category: 'kua', action: 'KUAAppBundle backed up to the cloud', resource: application.name, context: application.profileId, details: { applicationId: application.id, backupId: backup.id } });
      res.status(201).json(backup);
    } catch (error) { handleError(res, error); }
  });

  // Restores a cloud backup as a new application of this profile, like an import.
  router.post('/cloud-backups/:backupId/restore', async (req, res) => {
    const profile = profileId(req, res);
    if (!profile) return;
    let bundle;
    try {
      bundle = validateKuaAppBundle(await account().backups.download(req.params.backupId));
    } catch (error) { return handleError(res, error); }
    importInto(res, profile, bundle);
  });

  // ── Sync between the account's computers (lib/sync/syncEngine.js) ─────────
  const engine = () => {
    if (!syncEngine) throw Object.assign(new Error('Sync is not available'), { statusCode: 503 });
    return syncEngine;
  };

  // What syncs in this profile, conflicts to resolve and what other computers have.
  router.get('/sync/status', async (req, res) => {
    const profile = profileId(req, res);
    if (!profile) return;
    try { res.json(await engine().status(profile)); } catch (error) { handleError(res, error); }
  });

  router.post('/sync/now', async (_req, res) => {
    try { res.json(await engine().syncNow()); } catch (error) { handleError(res, error); }
  });

  router.post('/:applicationId/sync', async (req, res) => {
    const application = scopedApplication(req, res);
    if (!application) return;
    try { res.status(201).json(await engine().enable(application)); } catch (error) { handleError(res, error); }
  });

  // ?everywhere=1 also stops it on the other computers (the local copies stay).
  router.delete('/:applicationId/sync', async (req, res) => {
    const application = scopedApplication(req, res);
    if (!application) return;
    try { res.json(await engine().disable(application, { everywhere: req.query.everywhere === '1' })); } catch (error) { handleError(res, error); }
  });

  // { choice: "mine" | "theirs" }: the version not chosen is kept as a snapshot.
  router.post('/:applicationId/sync/resolve', async (req, res) => {
    const application = scopedApplication(req, res);
    if (!application) return;
    const choice = String(req.body?.choice || '');
    if (!['mine', 'theirs'].includes(choice)) return res.status(400).json({ error: 'choice must be mine or theirs' });
    try { res.json(await engine().resolve(application, choice)); } catch (error) { handleError(res, error); }
  });

  // An application synced from another computer, added to this profile.
  router.post('/sync/:syncId/add', async (req, res) => {
    const profile = profileId(req, res);
    if (!profile) return;
    try { res.status(201).json(await engine().add(req.params.syncId, profile)); } catch (error) { handleError(res, error); }
  });

  // ── The team's shared space (Team plan, lib/sync/teamEngine.js) ─────────
  const teamWork = () => {
    if (!teamEngine) throw Object.assign(new Error('Teams are not available'), { statusCode: 503 });
    return teamEngine;
  };

  // The team, this account's role and the items it can see (all of them for owner/admin).
  router.get('/team', async (_req, res) => {
    try {
      const [catalog, team] = await Promise.all([account().team.catalog(), account().team.get()]);
      res.json({ ...catalog, members: team.members || [], seats: team.seats || null, imported: teamWork().importedHere() });
    } catch (error) { handleError(res, error); }
  });

  router.post('/team/refresh', async (_req, res) => {
    try { res.json(await teamWork().pass({ force: true })); } catch (error) { handleError(res, error); }
  });

  router.post('/team/items/:itemId/import', async (req, res) => {
    const profile = profileId(req, res);
    if (!profile) return;
    try {
      const result = await teamWork().importItem(req.params.itemId, profile);
      auditLog?.log({ category: 'kua', action: 'KUA Application imported from the team', resource: result.application.name, context: profile, details: { itemId: req.params.itemId } });
      res.status(201).json(result);
    } catch (error) { handleError(res, error); }
  });

  // Owner/admin: share, access ({ mode: all|only, members }) and backup ({ frequency }).
  router.patch('/team/items/:itemId', async (req, res) => {
    try { res.json(await account().team.update(req.params.itemId, req.body || {})); } catch (error) { handleError(res, error); }
  });

  router.get('/team/items/:itemId/backups', async (req, res) => {
    try { res.json(await account().team.backups(req.params.itemId)); } catch (error) { handleError(res, error); }
  });

  router.post('/team/items/:itemId/backups', async (req, res) => {
    try { res.status(201).json(await account().team.backupNow(req.params.itemId)); } catch (error) { handleError(res, error); }
  });

  router.post('/team/items/:itemId/backups/:backupId/restore', async (req, res) => {
    const profile = profileId(req, res);
    if (!profile) return;
    try { res.status(201).json(await teamWork().restoreBackup(req.params.itemId, req.params.backupId, profile)); } catch (error) { handleError(res, error); }
  });

  router.patch('/team/members/:userId', async (req, res) => {
    try { res.json(await account().team.setPermissions(req.params.userId, req.body?.canImport !== false)); } catch (error) { handleError(res, error); }
  });

  return router;
}

module.exports = { createKuaAppsRouter };
