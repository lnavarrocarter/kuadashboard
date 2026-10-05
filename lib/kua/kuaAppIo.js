'use strict';
/**
 * lib/kua/kuaAppIo.js
 * A KUA Application in and out of its sanitized KUAAppBundle: export, import
 * as a new application, and apply onto an existing one (sync). Used by the
 * KUApps routes and the sync engine.
 */

const crypto = require('crypto');
const { buildKuaAppBundle } = require('./kuaAppBundle');
const { PostureStore } = require('../advisor/posture');

/**
 * What sync compares: the application's details, its project, architecture
 * graph and snapshots. Left out on purpose: the name (each computer may call
 * it differently), the resource registry (local discovery, refreshed by
 * polling) and every timestamp or change-log entry, so polling or exporting
 * again never looks like a change.
 */
function contentHash(bundle) {
  const architecture = bundle?.architecture;
  const content = {
    application: (({ provider, region, environment, team, pollingEnabled }) => ({ provider, region, environment, team, pollingEnabled }))(bundle?.application || {}),
    project: architecture?.project ? (({ name, description, automaticEdgeThreshold }) => ({ name, description, automaticEdgeThreshold }))(architecture.project) : null,
    graph: architecture?.graph?.document || null,
    snapshots: (architecture?.snapshots || []).map(snapshot => ({ name: snapshot.name, description: snapshot.description, document: snapshot.document })),
    // Only when there are some: applications without acceptances keep the hash they had before.
    ...(bundle?.advisor?.acceptances?.length ? {
      acceptances: bundle.advisor.acceptances
        .map(({ ruleId, resourceKey, kind, reason, author, createdAt, expiresAt }) => ({ ruleId, resourceKey, kind, reason, author, createdAt, expiresAt }))
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    } : {}),
  };
  return crypto.createHash('sha256').update(JSON.stringify(content)).digest('hex');
}

function createKuaAppIo({ database, apmDatabase }) {
  if (!database || !apmDatabase) throw new Error('database and apmDatabase are required');
  // Product Advisor acceptances travel with the application (lib/advisor/posture.js).
  const posture = new PostureStore(apmDatabase.db);
  const acceptanceScope = applicationId => `product:${applicationId}`;
  const activeAcceptances = applicationId => posture.list(acceptanceScope(applicationId)).filter(item => !item.expired);

  function exportBundle(application) {
    const project = application.architectureProjectId ? database.getProject(application.architectureProjectId) : null;
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
      acceptances: activeAcceptances(application.id),
    });
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

  /** A validated bundle as a new application of this profile; rolls back on failure. */
  function importBundle(profile, bundle, { reason = 'Imported sanitized KUAAppBundle' } = {}) {
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
      posture.replaceFrom(acceptanceScope(application.id), bundle.advisor?.acceptances || [], { by: 'import' });
      if (!project) return { application, project: null, graph: null, importedSnapshots: 0, importedRegistryItems: 0 };
      const graph = database.saveGraph(project.id, bundle.architecture.graph.document, {
        expectedRevision: 0,
        change: { type: 'bundle.import', subjectType: 'application', subjectId: application.id, author: profile, reason },
      });
      for (const snapshot of bundle.architecture.snapshots || []) database.importSnapshot(project.id, snapshot);
      apmDatabase.updateArchitectureProjectLink(application.id, project.id);
      return {
        application: apmDatabase.getApplication(application.id),
        project,
        graph,
        importedSnapshots: bundle.architecture.snapshots?.length || 0,
        importedRegistryItems: 0,
        note: 'Registry metadata is retained in the bundle for cloud sync; local import restores the application and architecture only.',
      };
    } catch (error) {
      if (application) apmDatabase.deleteApplication(application.id);
      if (project) database.deleteProject(project.id);
      throw error;
    }
  }

  /**
   * Takes another computer's version: the application's details and its
   * architecture graph. Its name stays (it may differ on purpose here).
   */
  function applyBundle(application, bundle, { author = 'sync', reason = 'Synced from another computer' } = {}) {
    apmDatabase.updateApplication(application.id, {
      environment: bundle.application.environment,
      team: bundle.application.team,
      pollingEnabled: bundle.application.pollingEnabled,
    });
    // The other computer's decisions on Advisor findings (a bundle from an older KUA has none to give).
    if (bundle.advisor) posture.replaceFrom(acceptanceScope(application.id), bundle.advisor.acceptances || [], { by: author });
    const document = bundle.architecture?.graph?.document;
    if (document) {
      let projectId = application.architectureProjectId;
      if (!projectId) {
        const project = database.createProject({
          name: availableProjectName(application.profileId, bundle.architecture.project?.name || application.name),
          description: bundle.architecture.project?.description,
          automaticEdgeThreshold: bundle.architecture.project?.automaticEdgeThreshold,
          profileId: application.profileId,
        });
        projectId = project.id;
        apmDatabase.updateArchitectureProjectLink(application.id, projectId);
      }
      const current = database.getGraph(projectId);
      database.saveGraph(projectId, document, {
        expectedRevision: current?.revision || 0,
        change: { type: 'sync.apply', subjectType: 'application', subjectId: application.id, author, reason },
      });
      // Snapshots made on the other computer that this one does not have yet.
      const known = new Set(database.listSnapshots(projectId).map(snapshot => snapshot.name));
      for (const snapshot of bundle.architecture.snapshots || []) {
        if (!known.has(snapshot.name)) database.importSnapshot(projectId, snapshot);
      }
    }
    return apmDatabase.getApplication(application.id);
  }

  /** Keeps the current architecture as a snapshot (before another version replaces it). */
  function snapshotCurrent(application, name) {
    if (!application.architectureProjectId) return null;
    return database.createSnapshot(application.architectureProjectId, { name, description: 'Kept by KUA sync' });
  }

  /** Keeps a bundle's architecture as a snapshot of this application (the version not chosen). */
  function snapshotBundle(application, bundle, name) {
    const document = bundle.architecture?.graph?.document;
    if (!application.architectureProjectId || !document) return null;
    return database.importSnapshot(application.architectureProjectId, { name, description: 'Kept by KUA sync', version: 0, sourceRevision: 0, document });
  }

  return { exportBundle, importBundle, applyBundle, snapshotCurrent, snapshotBundle };
}

module.exports = { createKuaAppIo, contentHash };
