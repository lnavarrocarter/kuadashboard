'use strict';

const express = require('express');
const { readKuaAppBundle, validateKuaAppBundle } = require('../lib/kua/kuaAppBundle');
const { createKuaAppIo } = require('../lib/kua/kuaAppIo');
const { ApplicationScopeService } = require('../lib/kua/applicationScopes');
const { KuaApplicationService } = require('../lib/kua/applicationService');
const { ApplicationRegistryService } = require('../lib/kua/applicationRegistryService');
const { createKuaExtensionRegistry } = require('../lib/kua/extensionRegistry');
const { explainRelationship } = require('../lib/kua/relationshipExplainer');
const { resourceSignalStates } = require('../lib/kua/resourceSignalState');
const { signalCapabilities } = require('../lib/apm/signalCapabilities');
const { applicationForResource } = require('../lib/kua/scopeCredentials');
const { canonicalFromApm } = require('../lib/kua/applicationRegistryService');
const { createResourceObserver } = require('../lib/kua/resourceObserver');
const { loadApplicationSignals } = require('../lib/kua/relationshipSignals');
const { getAccount } = require('../lib/account/account');

function createKuaAppsRouter({ database, apmDatabase, auditLog, account = getAccount, syncEngine = null, teamEngine = null, verifier, extensionRegistry, kubeLister, logCache = () => require('../lib/awsLogCache').getLogCache() } = {}) {
  if (!database || !apmDatabase) throw new Error('database and apmDatabase are required');
  const router = express.Router();
  const io = createKuaAppIo({ database, apmDatabase });
  const scopes = new ApplicationScopeService({ database: apmDatabase, architectureDatabase: database });
  const applications = new KuaApplicationService({
    database: apmDatabase,
    ...(verifier ? { verifier } : {}),
    audit: (action, resource, details) => auditLog?.log({ category: 'kua', action, resource, context: 'kuapps', details }),
  });
  const applicationRegistry = new ApplicationRegistryService({ database: apmDatabase, architectureDatabase: database });
  const extensions = extensionRegistry || createKuaExtensionRegistry({ apmDatabase, architectureDatabase: database });

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

  // Export, cloud backup and sync reach a KUA Application without provider from any profile: it
  // has no profile of its own (#149). A legacy application stays scoped to its profile.
  function exportableApplication(req, res) {
    const profile = profileId(req, res);
    if (!profile) return null;
    const application = apmDatabase.getApplication(req.params.applicationId);
    if (!application || (application.profileId && application.profileId !== profile)) {
      res.status(404).json({ error: 'KUA Application not found' });
      return null;
    }
    return application;
  }

  function handleError(res, error) {
    const status = error.statusCode || (/UNIQUE constraint failed/.test(error.message) ? 409 : 500);
    res.status(status).json({
      error: error.message || 'Internal server error',
      ...(error.code ? { code: error.code } : {}),
      ...(error.revision !== undefined ? { revision: error.revision } : {}),
    });
  }

  function importInto(res, profile, bundle) {
    try {
      const result = io.importBundle(profile, bundle);
      res.status(201).json(result);
      auditLog?.log({
        category: 'kua', action: 'KUAAppBundle imported', resource: result.application.name,
        context: profile, details: {
          applicationId: result.application.id, projectIds: result.projects.map(project => project.id),
          restoredMembers: result.restoredMembers, skipped: result.skipped.length,
        },
      });
    } catch (error) { handleError(res, error); }
  }

  // Read-only: what needs a decision before applications drop their legacy provider/profile (#149).
  // It names applications, views and scopes, never profiles.
  router.get('/migration-report', (_req, res) => {
    try { res.json(scopes.migrationReport()); } catch (error) { handleError(res, error); }
  });

  // ── KUA Applications (#149) ────────────────────────────────────────────────
  // Not scoped by X-Profile-Id: an application has no profile of its own. Writes take an
  // optional expectedRevision and answer 409 REVISION_CONFLICT when the application moved.
  // Everything under `local` in a response (bindings, legacy profile) stays on this computer.
  const send = (res, status, work) => {
    try { res.status(status).json(work()); } catch (error) { handleError(res, error); }
  };
  const sendAsync = async (res, status, work) => {
    try { res.status(status).json(await work()); } catch (error) { handleError(res, error); }
  };
  const revisionOf = req => ({ expectedRevision: req.body?.expectedRevision ?? req.query.expectedRevision });

  router.get('/applications', (_req, res) => send(res, 200, () => applications.list()));
  router.post('/applications', (req, res) => send(res, 201, () => applications.create(req.body || {})));
  router.get('/applications/:applicationId', (req, res) => send(res, 200, () => applications.get(req.params.applicationId)));
  router.get('/applications/:applicationId/registry', (req, res) => {
    try {
      const application = apmDatabase.getApplication(req.params.applicationId);
      if (!application) throw Object.assign(new Error('KUA Application not found'), { statusCode: 404 });
      const resources = apmDatabase.listRegistryResources(application.id);
      const resourcesById = new Map(resources.map(resource => [resource.id, resource]));
      const signals = resourceSignalStates({ database: apmDatabase, application, resources });
      res.json({
        resources: resources.map(({ id, provider, scopeId, location, nativeIdentifier, resourceType, displayName, sources, lineage, updatedAt }) => {
          const kubernetesOrigin = lineage.find(item => item.kubeContext || item.namespace) || {};
          const identityParts = String(nativeIdentifier || '').split('/');
          return {
            id, provider, scopeId, location, nativeIdentifier, resourceType, displayName, sources, updatedAt,
            signals: signals.get(id),
            kubeContext: kubernetesOrigin.kubeContext || (provider === 'kubernetes' && identityParts.length >= 4 ? identityParts[0] : ''),
            namespace: kubernetesOrigin.namespace || (provider === 'kubernetes' && identityParts.length >= 4 ? identityParts[1] : ''),
          };
        }),
        relationships: apmDatabase.listRegistryRelationships(application.id).map(relationship => ({
          ...relationship,
          sourceName: resourcesById.get(relationship.sourceResourceId)?.displayName || '',
          targetName: resourcesById.get(relationship.targetResourceId)?.displayName || '',
        })),
        // When the registry was last reconciled: it is derived from APM resources and views.
        syncStatus: apmDatabase.getRegistrySyncStatus(application.id),
      });
    } catch (error) { handleError(res, error); }
  });

  // What can be observed in an application, per resource: its signal state, whether KUA collects
  // metrics or reads logs for it, and the local profile and region that reach it (the verified
  // binding of its scope, or the profile of a legacy application). The Observability view reads
  // logs and metrics with these, never with a profile selected elsewhere in KUA.
  router.get('/applications/:applicationId/observability/resources', (req, res) => send(res, 200, () => {
    const application = applicationOr404(req.params.applicationId);
    const registryResources = apmDatabase.listRegistryResources(application.id);
    const signals = resourceSignalStates({ database: apmDatabase, application, resources: registryResources });
    const resources = apmDatabase.listResources(application.id).map(resource => {
      let registryId = null;
      try { registryId = canonicalFromApm(application, resource).id; } catch { /* not in the registry */ }
      let access;
      try {
        const scoped = applicationForResource(apmDatabase, application, resource);
        access = { profileId: scoped.profileId, region: scoped.region || null };
      } catch (error) {
        access = { error: error.code || 'scope_unbound', message: error.message };
      }
      return {
        id: resource.id, registryId, name: resource.name, provider: resource.provider, type: resource.type, kind: resource.kind || null,
        key: resource.key, arn: resource.arn || null, kubeContext: resource.kubeContext || null, namespace: resource.namespace || null,
        logGroup: resource.logGroup || null, service: resource.service || '', scopeId: resource.scopeId || null, location: resource.location || null,
        enabled: resource.enabled, capabilities: signalCapabilities(resource),
        signals: (registryId && signals.get(registryId)) || { state: 'unsupported', lastDataAt: null, reason: 'type' },
        access,
      };
    });
    // Observable first, then by type and name, so the list reads the same every time.
    const rank = item => (item.capabilities.metrics || item.capabilities.logs ? 0 : 1);
    resources.sort((a, b) => rank(a) - rank(b) || a.type.localeCompare(b.type) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
    return {
      application: {
        id: application.id, name: application.name, revision: application.revision, pollingEnabled: application.pollingEnabled,
        // Where its collection runs: a legacy application's own provider and profile, else "generic".
        collection: application.profileId ? { provider: application.provider, profileId: application.profileId } : { provider: 'generic', profileId: 'local' },
        latestRun: apmDatabase.getLatestCollectionRun(application.id),
      },
      resources,
    };
  }));

  // Resources that no longer exist (#236): since when, and successors found with free reads of
  // the Kubernetes API. Replacing attaches the successor and detaches the missing resource;
  // nothing is replaced automatically and nothing changes in the cluster.
  const observer = createResourceObserver({ database: apmDatabase, registry: applicationRegistry, ...(kubeLister ? { kubeLister } : {}) });
  router.get('/applications/:applicationId/observer', (req, res) => sendAsync(res, 200, () => observer.gone(applicationOr404(req.params.applicationId))));
  router.post('/applications/:applicationId/observer/replace', (req, res) => sendAsync(res, 200, async () => {
    const application = applicationOr404(req.params.applicationId);
    const result = await observer.replace(application, req.body?.resourceId, req.body?.successor, revisionOf(req));
    auditLog?.log({ category: 'kua', action: 'Missing resource replaced by its successor', resource: `${result.replaced} → ${result.by}`, context: 'kuapps', details: { applicationId: application.id } });
    return result;
  }));
  router.post('/applications/:applicationId/observer/ignore', (req, res) => send(res, 200, () =>
    observer.ignore(applicationOr404(req.params.applicationId), req.body?.resourceId)));

  // The metrics KUA collected for one resource of the application, grouped by metric (local data).
  router.get('/applications/:applicationId/observability/resources/:resourceId/metrics', (req, res) => send(res, 200, () => {
    const application = applicationOr404(req.params.applicationId);
    const resource = apmDatabase.getResource(req.params.resourceId);
    if (!resource || resource.applicationId !== application.id) throw Object.assign(new Error('Resource not found'), { statusCode: 404, code: 'RESOURCE_NOT_FOUND' });
    const to = Number(req.query.to) || Date.now();
    const from = Number(req.query.from) || to - 24 * 60 * 60 * 1000;
    const metrics = new Map();
    for (const row of apmDatabase.listResourceMetrics(resource.id, { from, to })) {
      if (!metrics.has(row.metricName)) metrics.set(row.metricName, { name: row.metricName, unit: row.unit, source: row.source, points: [] });
      metrics.get(row.metricName).points.push({ t: row.bucketStart, count: row.count, sum: row.sum, min: row.min, max: row.max, last: row.last, average: row.count ? row.sum / row.count : null, partial: row.quality === 'partial' });
    }
    return { resourceId: resource.id, from, to, capabilities: signalCapabilities(resource), metrics: [...metrics.values()] };
  }));

  // The architecture views of an application (#154). Not scoped by X-Profile-Id: a view is read
  // through the application it belongs to, and a project of another application is never served.
  const applicationOr404 = id => {
    const application = apmDatabase.getApplication(id);
    if (!application) throw Object.assign(new Error('KUA Application not found'), { statusCode: 404, code: 'NOT_FOUND' });
    return application;
  };
  const viewIdsOf = application => application.architectureProjectIds?.length
    ? application.architectureProjectIds : [application.architectureProjectId].filter(Boolean);
  router.get('/applications/:applicationId/views', (req, res) => send(res, 200, () => {
    const application = applicationOr404(req.params.applicationId);
    return viewIdsOf(application).map(projectId => {
      const project = database.getProject(projectId);
      const graph = project ? database.getGraph(projectId) : null;
      // profileId is the local profile that owns the view (KUApps opens the Map with it); the MCP
      // tools do not pass it on.
      return project
        ? { projectId, name: project.name, profileId: project.profileId, revision: graph?.revision ?? 0, updatedAt: graph?.updatedAt || null, nodes: graph?.document?.nodes?.length || 0, edges: graph?.document?.edges?.length || 0 }
        : { projectId, missing: true };
    });
  }));
  router.get('/applications/:applicationId/views/:projectId/graph', (req, res) => send(res, 200, () => {
    const application = applicationOr404(req.params.applicationId);
    if (!viewIdsOf(application).includes(req.params.projectId)) {
      throw Object.assign(new Error('This view does not belong to the application'), { statusCode: 404, code: 'VIEW_NOT_FOUND' });
    }
    const project = database.getProject(req.params.projectId);
    const graph = project ? database.getGraph(project.id) : null;
    if (!graph) throw Object.assign(new Error('The view no longer exists'), { statusCode: 404, code: 'VIEW_NOT_FOUND' });
    return { projectId: project.id, name: project.name, revision: graph.revision, updatedAt: graph.updatedAt || null, document: graph.document };
  }));
  router.delete('/applications/:applicationId/registry/resources/:resourceId', (req, res) => {
    const application = apmDatabase.getApplication(req.params.applicationId);
    if (!application) return res.status(404).json({ error: 'KUA Application not found' });
    try {
      const result = applicationRegistry.detachRegistryResource(application, req.params.resourceId, revisionOf(req));
      auditLog?.log({ category: 'kua', action: 'Resource stopped syncing and removed from application', resource: result.id, context: 'kuapps', details: { applicationId: application.id } });
      res.status(204).end();
    } catch (error) { handleError(res, error); }
  });
  router.get('/applications/:applicationId/extensions', (req, res) => {
    try {
      if (!apmDatabase.getApplication(req.params.applicationId)) throw Object.assign(new Error('KUA Application not found'), { statusCode: 404 });
      res.json({ sources: extensions.listSources() });
    } catch (error) { handleError(res, error); }
  });
  router.get('/applications/:applicationId/evidence', async (req, res) => {
    try {
      const applicationId = req.params.applicationId;
      if (!apmDatabase.getApplication(applicationId)) throw Object.assign(new Error('KUA Application not found'), { statusCode: 404 });
      const resourceIds = apmDatabase.listRegistryResources(applicationId).map(resource => resource.id);
      res.json(await extensions.queryEvidence({ applicationId, resourceIds }));
    } catch (error) { handleError(res, error); }
  });
  router.patch('/applications/:applicationId', (req, res) => send(res, 200, () =>
    applications.update(req.params.applicationId, req.body || {}, revisionOf(req))));
  router.delete('/applications/:applicationId', (req, res) => send(res, 200, () =>
    applications.remove(req.params.applicationId, revisionOf(req))));

  router.post('/applications/:applicationId/scopes', (req, res) => {
    try {
      const result = applications.addScope(req.params.applicationId, req.body || {}, revisionOf(req));
      res.status(result.created ? 201 : 200).json(result);
    } catch (error) { handleError(res, error); }
  });
  router.delete('/applications/:applicationId/scopes/:scopeKey', (req, res) => send(res, 200, () =>
    applications.removeScope(req.params.applicationId, req.params.scopeKey, revisionOf(req))));
  // Binding verifies with free reads only (AWS STS GetCallerIdentity, local GCP/Vercel profile, kube contexts).
  router.put('/applications/:applicationId/scopes/:scopeKey/binding', (req, res) => sendAsync(res, 200, () =>
    applications.bindScope(req.params.applicationId, req.params.scopeKey, req.body?.profileId)));
  router.post('/applications/:applicationId/scopes/:scopeKey/binding/verify', (req, res) => sendAsync(res, 200, () =>
    applications.verifyScope(req.params.applicationId, req.params.scopeKey)));
  router.delete('/applications/:applicationId/scopes/:scopeKey/binding', (req, res) => send(res, 200, () =>
    applications.unbindScope(req.params.applicationId, req.params.scopeKey)));

  // Why a relationship or suggestion exists (#172). Local only: the log cache aggregates of the
  // pair and, when the user enabled it, the local embedding model. No cloud call, nothing changes.
  router.post('/applications/:applicationId/relationships/explain', async (req, res) => {
    try {
      const application = apmDatabase.getApplication(req.params.applicationId);
      if (!application) return res.status(404).json({ error: 'KUA Application not found' });
      const body = req.body || {};
      const cache = application.profileId && application.region ? logCache() : null;
      const lookup = await loadApplicationSignals({ apmDatabase, application, cache });
      const source = lookup.resolve(String(body.sourceResourceId || ''), body.sourceName);
      const target = lookup.resolve(String(body.targetResourceId || ''), body.targetName);
      const signals = lookup.hasSignals ? { source: lookup.signalFor(source), target: lookup.signalFor(target) } : null;
      let semantic = { state: 'unavailable', matches: [] };
      if (cache && signals?.source?.logGroup) {
        try {
          const matches = await cache.searchSignatures({
            profileId: application.profileId, region: application.region, logGroup: signals.source.logGroup,
            query: [target.name, target.type].filter(Boolean).join(' '), limit: 5,
          });
          semantic = { state: 'ready', matches };
        } catch (error) {
          semantic = { state: error.code === 'ML_DISABLED' ? 'disabled' : 'unavailable', matches: [] };
        }
      }
      res.json(explainRelationship({
        relationship: { relationType: body.relationType, status: body.status, confidence: body.confidence, evidence: body.evidence },
        source, target, signals, semantic, thresholds: application.thresholds || {},
      }));
    } catch (error) { handleError(res, error); }
  });

  router.get('/:applicationId/export', (req, res) => {
    const application = exportableApplication(req, res);
    if (!application) return;
    try {
      const bundle = io.exportBundle(application);
      const filename = `${application.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'kua-app'}.kuaapp.json`;
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.json(bundle);
    } catch (error) { handleError(res, error); }
  });

  // What an import would do (#153): nothing is written. The same checks run again on import.
  router.post('/import/preview', (req, res) => {
    const profile = profileId(req, res);
    if (!profile) return;
    try {
      const { bundle, issues, contentVersion } = readKuaAppBundle(req.body?.bundle || req.body);
      res.json(io.previewImport(profile, bundle, { issues, contentVersion }));
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
    const application = exportableApplication(req, res);
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
    const application = exportableApplication(req, res);
    if (!application) return;
    try { res.status(201).json(await engine().enable(application, { profileId: req.get('X-Profile-Id') })); } catch (error) { handleError(res, error); }
  });

  // ?everywhere=1 also stops it on the other computers (the local copies stay).
  router.delete('/:applicationId/sync', async (req, res) => {
    const application = exportableApplication(req, res);
    if (!application) return;
    try { res.json(await engine().disable(application, { everywhere: req.query.everywhere === '1', profileId: req.get('X-Profile-Id') })); } catch (error) { handleError(res, error); }
  });

  // { choice: "mine" | "theirs" }: the version not chosen is kept as a snapshot.
  router.post('/:applicationId/sync/resolve', async (req, res) => {
    const application = exportableApplication(req, res);
    if (!application) return;
    const choice = String(req.body?.choice || '');
    if (!['mine', 'theirs'].includes(choice)) return res.status(400).json({ error: 'choice must be mine or theirs' });
    try { res.json(await engine().resolve(application, choice, { profileId: req.get('X-Profile-Id') })); } catch (error) { handleError(res, error); }
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
