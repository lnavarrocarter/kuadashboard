'use strict';
/**
 * lib/kua/kuaAppIo.js
 * A KUA Application in and out of its sanitized KUAAppBundle: export, import
 * as a new application, and apply onto an existing one (sync). Used by the
 * KUApps routes and the sync engine.
 */

const crypto = require('crypto');
const { buildKuaAppBundle, bundleViews } = require('./kuaAppBundle');
const { BUILTIN_PROVIDERS, normalizeScope } = require('./applicationContract');
const { ApplicationRegistryService, canonicalFromApm } = require('./applicationRegistryService');
const { APM_PROVIDERS, APM_RESOURCE_TYPES } = require('../apm/database');
const { PostureStore } = require('../advisor/posture');

const viewContent = view => ({
  project: (({ name, description, automaticEdgeThreshold }) => ({ name, description, automaticEdgeThreshold }))(view.project),
  graph: view.graph?.document || null,
  snapshots: (view.snapshots || []).map(snapshot => ({ name: snapshot.name, description: snapshot.description, document: snapshot.document })),
});

/**
 * What sync compares: the application's details, its project, architecture
 * graph and snapshots. Left out on purpose: the name (each computer may call
 * it differently), the resource registry (local discovery, refreshed by
 * polling) and every timestamp or change-log entry, so polling or exporting
 * again never looks like a change. Additional views, and the scopes of an
 * application without provider, only count when there are some, so the hash
 * of an existing application stays what it was. A legacy application's
 * scopes are derived from its resources on each computer, like the registry.
 */
function contentHash(bundle) {
  const architecture = bundle?.architecture;
  const additionalViews = Array.isArray(bundle?.additionalViews) ? bundle.additionalViews : [];
  const scopes = !bundle?.application?.provider && Array.isArray(bundle?.application?.scopes) ? bundle.application.scopes : [];
  const content = {
    application: (({ provider, region, environment, team, pollingEnabled }) => ({ provider, region, environment, team, pollingEnabled }))(bundle?.application || {}),
    project: architecture?.project ? (({ name, description, automaticEdgeThreshold }) => ({ name, description, automaticEdgeThreshold }))(architecture.project) : null,
    graph: architecture?.graph?.document || null,
    snapshots: (architecture?.snapshots || []).map(snapshot => ({ name: snapshot.name, description: snapshot.description, document: snapshot.document })),
    ...(additionalViews.length ? { additionalViews: additionalViews.map(viewContent) } : {}),
    ...(scopes.length ? {
      scopes: scopes.map(({ provider, scopeId, location, label }) => ({ provider, scopeId, location, label }))
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    } : {}),
    // Only when there are some: applications without acceptances keep the hash they had before.
    ...(bundle?.advisor?.acceptances?.length ? {
      acceptances: bundle.advisor.acceptances
        .map(({ ruleId, resourceKey, kind, reason, author, createdAt, expiresAt }) => ({ ruleId, resourceKey, kind, reason, author, createdAt, expiresAt }))
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    } : {}),
  };
  return crypto.createHash('sha256').update(JSON.stringify(content)).digest('hex');
}

// The fields of an APM resource that make it a member again on another computer.
function apmMembership(resource) {
  if (!resource) return undefined;
  const { provider, type, key, name, arn, kind, service, logGroup, kubeContext, namespace, scopeId, location, enabled, associationSource } = resource;
  return { provider, type, key, name, arn, kind, service, logGroup, kubeContext, namespace, scopeId, location, enabled, associationSource };
}

/**
 * What an import does with each resource of a bundle:
 *   member     - it becomes a resource of the application again (observed, not collected yet)
 *   view       - it comes back with an architecture view
 *   skipped    - it cannot come back here (the reason says why)
 */
function resourcePlan(resource, { viewResourceIds }) {
  const apm = resource.apm;
  const inView = viewResourceIds.has(resource.sourceId);
  if (apm) {
    if (apm.associationSource === 'architecture' && inView) return { action: 'view' };
    const provider = apm.provider || resource.provider;
    if (!APM_RESOURCE_TYPES.has(apm.type)) return { action: 'skipped', reason: 'unsupported_type' };
    if (!APM_PROVIDERS.has(provider)) return { action: 'skipped', reason: 'unsupported_provider' };
    return { action: 'member' };
  }
  if (inView) return { action: 'view' };
  return { action: 'skipped', reason: 'no_source' };
}

// The registry stamps each architecture node with its resource id, so a bundle says which
// resources come back with its views.
function viewResourceIdsOf(views) {
  return new Set(views.flatMap(view => view.graph.document.nodes || []).map(node => node.registryResourceId).filter(Boolean));
}

function memberInput(resource) {
  const { apm } = resource;
  const optional = value => value || undefined;
  return {
    provider: apm.provider || resource.provider,
    type: apm.type,
    key: apm.key,
    name: apm.name,
    arn: optional(apm.arn),
    kind: optional(apm.kind),
    service: apm.service || '',
    logGroup: optional(apm.logGroup),
    kubeContext: optional(apm.kubeContext),
    namespace: optional(apm.namespace),
    scopeId: apm.scopeId || '',
    location: apm.location || '',
    enabled: apm.enabled !== false,
    associationSource: ['manual', 'tags', 'labels', 'deployment'].includes(apm.associationSource) ? apm.associationSource : 'manual',
  };
}

function createKuaAppIo({ database, apmDatabase }) {
  if (!database || !apmDatabase) throw new Error('database and apmDatabase are required');
  // Product Advisor acceptances travel with the application (lib/advisor/posture.js).
  const posture = new PostureStore(apmDatabase.db);
  const registry = new ApplicationRegistryService({ database: apmDatabase, architectureDatabase: database });
  const acceptanceScope = applicationId => `product:${applicationId}`;
  const activeAcceptances = applicationId => posture.list(acceptanceScope(applicationId)).filter(item => !item.expired);
  const projectIdsOf = application => (application.architectureProjectIds?.length
    ? application.architectureProjectIds
    : [application.architectureProjectId].filter(Boolean));

  function exportBundle(application) {
    const views = projectIdsOf(application)
      .map(projectId => database.getProject(projectId))
      .filter(Boolean)
      .map(project => ({
        project,
        graph: database.getGraph(project.id) || { document: { projectId: project.id } },
        snapshots: database.listSnapshots(project.id).map(snapshot => database.getSnapshot(project.id, snapshot.id)),
        changes: database.listChanges(project.id, { limit: 500 }),
      }));
    // Each registry resource that is an APM resource of the application carries how to observe it.
    const apmByResourceId = new Map();
    for (const resource of apmDatabase.listResources(application.id)) {
      try { apmByResourceId.set(canonicalFromApm(application, resource).id, resource); } catch { /* not a registry resource */ }
    }
    return buildKuaAppBundle({
      application,
      scopes: apmDatabase.listApplicationScopes(application.id),
      views,
      resources: apmDatabase.listRegistryResources(application.id)
        .map(resource => ({ ...resource, apm: apmMembership(apmByResourceId.get(resource.id)) })),
      relationships: apmDatabase.listRegistryRelationships(application.id),
      detachments: apmDatabase.listRegistryDetachmentKeys(application.id).map(identityKey => ({ identityKey })),
      syncStatus: apmDatabase.getRegistrySyncStatus(application.id),
      acceptances: activeAcceptances(application.id),
    });
  }

  function availableProjectName(profile, requestedName, taken = new Set()) {
    const base = String(requestedName || 'Imported architecture').trim() || 'Imported architecture';
    const names = new Set([...database.listProjects({ profileId: profile }).map(item => item.name.toLowerCase()), ...taken]);
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

  // A legacy application keeps its unique name per profile; a KUA Application keeps its name
  // (names are not identities, and KUApps warns about duplicates).
  function importedApplicationName(profile, application) {
    return application.provider
      ? availableApplicationName(profile, application.region, application.environment, application.name)
      : application.name;
  }

  /**
   * What importing this bundle would do, without writing anything: the name it gets, scopes
   * to bind, views, which resources come back and which do not, relationships and what was
   * left out of the file. `issues` comes from readKuaAppBundle.
   */
  function previewImport(profile, bundle, { issues = [], contentVersion = 1 } = {}) {
    const application = bundle.application;
    const all = apmDatabase.listApplications();
    const views = bundleViews(bundle);
    const takenNames = new Set();
    const viewPlans = views.map(view => {
      const importAs = availableProjectName(profile, view.project.name, takenNames);
      takenNames.add(importAs.toLowerCase());
      return {
        name: view.project.name, importAs,
        nodes: view.graph.document.nodes?.length || 0,
        edges: view.graph.document.edges?.length || 0,
        snapshots: view.snapshots?.length || 0,
      };
    });
    const scopeKeys = new Set();
    const scopes = (application.scopes || []).map(scope => {
      const normalized = normalizeScope(scope);
      scopeKeys.add(JSON.stringify([normalized.provider, normalized.scopeId.toLowerCase(), normalized.location.toLowerCase()]));
      return { ...scope, supported: BUILTIN_PROVIDERS.includes(normalized.provider) };
    });
    const resources = bundle.registry?.resources || [];
    const viewResourceIds = viewResourceIdsOf(views);
    const membershipsHere = apmDatabase.listRegistryResourceApplications(resources.map(resource => resource.sourceId));
    const names = new Map(all.map(item => [item.id, item.name]));
    const plan = { total: resources.length, members: 0, fromViews: 0, skipped: [], existing: [], outsideScopes: [] };
    for (const resource of resources) {
      const { action, reason } = resourcePlan(resource, { viewResourceIds });
      const summary = { id: resource.sourceId, displayName: resource.displayName, provider: resource.provider, resourceType: resource.resourceType };
      if (action === 'member') plan.members += 1;
      else if (action === 'view') plan.fromViews += 1;
      else plan.skipped.push({ ...summary, reason });
      const applicationIds = membershipsHere.get(resource.sourceId);
      if (applicationIds) plan.existing.push({ ...summary, applications: applicationIds.map(id => ({ id, name: names.get(id) || id })) });
      const scopeKey = JSON.stringify([resource.provider, String(resource.scopeId || '').toLowerCase(), String(resource.location || '').toLowerCase()]);
      if (scopes.length && resource.scopeId && !scopeKeys.has(scopeKey)) plan.outsideScopes.push(summary);
    }
    const relationships = bundle.registry?.relationships || [];
    const byStatus = status => relationships.filter(item => item.status === status).length;
    return {
      contentVersion,
      application: {
        sourceId: application.sourceId || null,
        name: application.name,
        importAs: importedApplicationName(profile, application),
        environment: application.environment,
        team: application.team,
        legacy: application.provider ? { provider: application.provider, region: application.region } : null,
        alreadyHere: !!(application.sourceId && all.some(item => item.id === application.sourceId)),
        sameName: all.filter(item => item.name.toLowerCase() === application.name.toLowerCase() && item.environment === application.environment)
          .map(item => ({ id: item.id, name: item.name, environment: item.environment })),
      },
      scopes,
      views: viewPlans,
      resources: plan,
      relationships: { total: relationships.length, confirmed: byStatus('confirmed'), rejected: byStatus('rejected'), suggested: byStatus('suggested') },
      detachments: bundle.registry?.detachments?.length || 0,
      acceptances: bundle.advisor?.acceptances?.length || 0,
      issues,
    };
  }

  /**
   * A validated bundle as a new application: scopes, every architecture view, resource
   * membership (through the registry service, #150), detachments, relationships the user
   * decided and Advisor acceptances. Nothing is created in the cloud and no collector starts.
   * Rolls back on failure.
   */
  function importBundle(profile, bundle, { reason = 'Imported sanitized KUAAppBundle' } = {}) {
    const projects = [];
    let application = null;
    try {
      const source = bundle.application;
      application = source.provider
        ? apmDatabase.createApplication({
          provider: source.provider,
          profileId: profile,
          region: source.region,
          name: importedApplicationName(profile, source),
          environment: source.environment,
          team: source.team,
          pollingEnabled: source.pollingEnabled,
        })
        : apmDatabase.createApplication({ name: source.name, environment: source.environment, team: source.team });
      for (const scope of source.scopes || []) apmDatabase.addApplicationScope(application.id, normalizeScope(scope));
      posture.replaceFrom(acceptanceScope(application.id), bundle.advisor?.acceptances || [], { by: 'import' });

      const views = bundleViews(bundle);
      const graphs = [];
      let importedSnapshots = 0;
      for (const view of views) {
        const project = database.createProject({
          name: availableProjectName(profile, view.project.name),
          description: view.project.description,
          automaticEdgeThreshold: view.project.automaticEdgeThreshold,
          profileId: profile,
        });
        projects.push(project);
        graphs.push(database.saveGraph(project.id, view.graph.document, {
          expectedRevision: 0,
          change: { type: 'bundle.import', subjectType: 'application', subjectId: application.id, author: profile, reason },
        }));
        for (const snapshot of view.snapshots || []) database.importSnapshot(project.id, snapshot);
        importedSnapshots += view.snapshots?.length || 0;
      }
      for (const project of projects) apmDatabase.updateArchitectureProjectLink(application.id, project.id);

      // Detachments first, so reconciling the views does not attach those resources again.
      for (const detachment of bundle.registry?.detachments || []) apmDatabase.addRegistryDetachment(application.id, detachment);
      const resources = bundle.registry?.resources || [];
      const viewResourceIds = viewResourceIdsOf(views);
      const plans = resources.map(resource => ({ resource, ...resourcePlan(resource, { viewResourceIds }) }));
      const members = plans.filter(item => item.action === 'member');
      const attached = registry.attachResources(apmDatabase.getApplication(application.id), members.map(item => memberInput(item.resource)));
      const skipped = plans.filter(item => item.action === 'skipped')
        .map(({ resource, reason: why }) => ({ id: resource.sourceId, displayName: resource.displayName, reason: why }));
      const apmIdByPortableId = new Map();
      attached.results.forEach((result, index) => {
        if (result.resource) apmIdByPortableId.set(members[index].resource.sourceId, result.resource.id);
        else skipped.push({ id: members[index].resource.sourceId, displayName: members[index].resource.displayName, reason: 'rejected', detail: result.error });
      });

      // Relationships the user drew between observed resources; the ones in a view came back with it.
      let restoredEdges = 0;
      const seen = new Set();
      for (const relationship of bundle.registry?.relationships || []) {
        if (!relationship.evidence?.some(item => item.type === 'apm_edge')) continue;
        const sourceResourceId = apmIdByPortableId.get(relationship.sourceResourceId);
        const targetResourceId = apmIdByPortableId.get(relationship.targetResourceId);
        const key = [sourceResourceId, targetResourceId, relationship.relationType].join('|');
        if (!sourceResourceId || !targetResourceId || seen.has(key)) continue;
        seen.add(key);
        apmDatabase.addEdge(application.id, { sourceResourceId, targetResourceId, relationType: relationship.relationType });
        restoredEdges += 1;
      }
      const result = restoredEdges ? registry.reconcile(apmDatabase.getApplication(application.id)) : attached.registry;

      return {
        application: apmDatabase.getApplication(application.id),
        project: projects[0] || null,
        projects,
        graph: graphs[0] || null,
        importedViews: projects.length,
        importedSnapshots,
        importedRegistryItems: result.resources.length,
        restoredMembers: apmIdByPortableId.size,
        restoredRelationships: result.relationships.length,
        skipped,
      };
    } catch (error) {
      if (application) apmDatabase.deleteApplication(application.id);
      for (const project of projects) database.deleteProject(project.id);
      throw error;
    }
  }

  /**
   * Takes another computer's version: the application's details, its scopes and
   * architecture views. Its name stays (it may differ on purpose here). Views are
   * matched by name, then in order; a view this computer lacks is created.
   * Scopes are only added: a scope removed elsewhere keeps its local binding here.
   */
  function applyBundle(application, bundle, { author = 'sync', reason = 'Synced from another computer' } = {}) {
    apmDatabase.updateApplication(application.id, {
      environment: bundle.application.environment,
      team: bundle.application.team,
      pollingEnabled: bundle.application.pollingEnabled,
    });
    for (const scope of bundle.application.scopes || []) {
      try { apmDatabase.addApplicationScope(application.id, normalizeScope(scope)); } catch { /* an invalid scope is left out */ }
    }
    // The other computer's decisions on Advisor findings (a bundle from an older KUA has none to give).
    if (bundle.advisor) posture.replaceFrom(acceptanceScope(application.id), bundle.advisor.acceptances || [], { by: author });
    const linked = projectIdsOf(application).map(projectId => database.getProject(projectId)).filter(Boolean);
    const profile = application.profileId || linked[0]?.profileId;
    // An import may have renamed a view "Name (imported)"; that is still the same view.
    const baseName = name => String(name || '').replace(/ \(imported(?: \d+)?\)$/i, '').trim().toLowerCase();
    const views = bundleViews(bundle);
    const targets = new Map();
    views.forEach((view, index) => {
      const match = linked.find(candidate => ![...targets.values()].includes(candidate) && baseName(candidate.name) === baseName(view.project.name));
      if (match) targets.set(index, match);
    });
    // Views without a name match take the remaining linked views in order, so no view is created twice.
    const remaining = linked.filter(candidate => ![...targets.values()].includes(candidate));
    views.forEach((_view, index) => { if (!targets.has(index) && remaining.length) targets.set(index, remaining.shift()); });
    views.forEach((view, index) => {
      let project = targets.get(index);
      if (!project) {
        if (!profile) return;
        project = database.createProject({
          name: availableProjectName(profile, view.project.name || application.name),
          description: view.project.description,
          automaticEdgeThreshold: view.project.automaticEdgeThreshold,
          profileId: profile,
        });
        apmDatabase.updateArchitectureProjectLink(application.id, project.id);
      }
      const current = database.getGraph(project.id);
      database.saveGraph(project.id, view.graph.document, {
        expectedRevision: current?.revision || 0,
        change: { type: 'sync.apply', subjectType: 'application', subjectId: application.id, author, reason },
      });
      // Snapshots made on the other computer that this one does not have yet.
      const known = new Set(database.listSnapshots(project.id).map(snapshot => snapshot.name));
      for (const snapshot of view.snapshots || []) {
        if (!known.has(snapshot.name)) database.importSnapshot(project.id, snapshot);
      }
    });
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

  return { exportBundle, previewImport, importBundle, applyBundle, snapshotCurrent, snapshotBundle };
}

module.exports = { createKuaAppIo, contentHash };
