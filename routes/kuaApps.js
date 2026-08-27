'use strict';

const express = require('express');
const { buildKuaAppBundle, validateKuaAppBundle } = require('../lib/kua/kuaAppBundle');

function createKuaAppsRouter({ database, apmDatabase, auditLog } = {}) {
  if (!database || !apmDatabase) throw new Error('database and apmDatabase are required');
  const router = express.Router();

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

  function exportBundle(application) {
    const project = application.architectureProjectId
      ? database.getProject(application.architectureProjectId)
      : null;
    const graph = project ? database.getGraph(project.id) : null;
    return buildKuaAppBundle({
      application,
      project,
      graph: graph || { document: { projectId: 'no-architecture' } },
      snapshots: project ? database.listSnapshots(project.id).map(snapshot => database.getSnapshot(project.id, snapshot.id)) : [],
      changes: project ? database.listChanges(project.id, { limit: 500 }) : [],
      resources: apmDatabase.listRegistryResources(application.id),
      relationships: apmDatabase.listRegistryRelationships(application.id),
      syncStatus: apmDatabase.getRegistrySyncStatus(application.id),
    });
  }

  function handleError(res, error) {
    const status = error.statusCode || (/UNIQUE constraint failed/.test(error.message) ? 409 : 500);
    res.status(status).json({ error: error.message || 'Internal server error' });
  }

  function availableProjectName(profile, requestedName) {
    const base = String(requestedName || 'Imported architecture').trim() || 'Imported architecture';
    const names = new Set(database.listProjects({ profileId: profile }).map(item => item.name.toLowerCase()));
    if (!names.has(base.toLowerCase())) return base;
    for (let index = 1; index < 10000; index += 1) {
      const candidate = `${base} (imported${index === 1 ? '' : ` ${index}`})`;
      if (!names.has(candidate.toLowerCase())) return candidate;
    }
    throw Object.assign(new Error('Unable to create a unique imported project name'), { statusCode: 409 });
  }

  function availableApplicationName(profile, region, environment, requestedName) {
    const base = String(requestedName || 'Imported KUA Application').trim() || 'Imported KUA Application';
    const applications = apmDatabase.listApplications({ profileId: profile, region });
    const exists = candidate => applications.some(application =>
      application.name.toLowerCase() === candidate.toLowerCase() && application.environment === environment);
    if (!exists(base)) return base;
    for (let index = 1; index < 10000; index += 1) {
      const candidate = `${base} (imported${index === 1 ? '' : ` ${index}`})`;
      if (!exists(candidate)) return candidate;
    }
    throw Object.assign(new Error('Unable to create a unique imported application name'), { statusCode: 409 });
  }

  router.get('/:applicationId/export', (req, res) => {
    const application = scopedApplication(req, res);
    if (!application) return;
    try {
      const bundle = exportBundle(application);
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

    let project = null;
    let application = null;
    try {
      if (bundle.architecture?.project) {
        project = database.createProject({
          name: availableProjectName(profile, bundle.architecture.project.name),
          description: bundle.architecture.project.description,
          automaticEdgeThreshold: bundle.architecture.project.automaticEdgeThreshold,
          profileId: profile,
        });
      }
      application = apmDatabase.createApplication({
        provider: bundle.application.provider,
        profileId: profile,
        region: bundle.application.region,
        name: availableApplicationName(profile, bundle.application.region, bundle.application.environment, bundle.application.name),
        environment: bundle.application.environment,
        team: bundle.application.team,
        pollingEnabled: bundle.application.pollingEnabled,
      });
      if (project) {
        let graph = database.saveGraph(project.id, bundle.architecture.graph.document, {
          expectedRevision: 0,
          change: {
            type: 'bundle.import',
            subjectType: 'application',
            subjectId: application.id,
            author: profile,
            reason: 'Imported sanitized KUAAppBundle',
          },
        });
        for (const snapshot of bundle.architecture.snapshots || []) {
          database.importSnapshot(project.id, snapshot);
        }
        apmDatabase.updateArchitectureProjectLink(application.id, project.id);
        application = apmDatabase.getApplication(application.id);
        res.status(201).json({
          application,
          project,
          graph,
          importedSnapshots: bundle.architecture.snapshots?.length || 0,
          importedRegistryItems: 0,
          note: 'Registry metadata is retained in the bundle for cloud sync; local import restores the application and architecture only.',
        });
        auditLog?.log({
          category: 'kua', action: 'KUAAppBundle imported', resource: application.name,
          context: profile, details: { applicationId: application.id, projectId: project.id },
        });
        return;
      }
      res.status(201).json({ application, project: null, graph: null, importedSnapshots: 0, importedRegistryItems: 0 });
    } catch (error) {
      if (application) apmDatabase.deleteApplication(application.id);
      if (project) database.deleteProject(project.id);
      handleError(res, error);
    }
  });

  return router;
}

module.exports = { createKuaAppsRouter };
