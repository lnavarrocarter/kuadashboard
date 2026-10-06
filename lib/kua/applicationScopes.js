'use strict';
/**
 * lib/kua/applicationScopes.js
 * Moves stored KUA Applications onto the contract of lib/kua/applicationContract.js
 * (#149) without losing data: legacy applications get their provider scopes and
 * a local binding to the profile they used, the local registry moves to resource
 * identity v2, and a read-only report lists what needs a human decision.
 */

const {
  contractError,
  normalizeApplicationContext,
  portableResourceIdentity,
  text,
} = require('./applicationContract');
const { resourceScopeFromApm } = require('./applicationRegistryService');

/**
 * Maps a legacy APM application (one provider, profile and region) to the
 * contract without losing anything: one scope per provider scope its resources
 * live in, plus its primary scope; scopes of its own provider are bound to its
 * local profile. Bindings are returned apart because they are local-only.
 */
function legacyApplicationContext(application, { resources = [], architectureProjectIds = [] } = {}) {
  if (!application?.id) throw contractError('Legacy application is required');
  const context = normalizeApplicationContext({
    id: application.id,
    name: application.name,
    environment: application.environment,
    team: application.team,
    revision: application.revision,
    scopes: [],
    views: { architectureProjectIds: [application.architectureProjectId, ...(application.architectureProjectIds || []), ...architectureProjectIds].filter(Boolean) },
  });
  // A KUA Application created without a provider has nothing legacy to map.
  if (!application.profileId) return { context, bindings: [] };
  const primaryProvider = text(application.provider || 'aws').toLowerCase();
  const primaryLocation = primaryProvider === 'kubernetes' ? '' : text(application.region);
  const scopeInputs = resources.map(resource => resourceScopeFromApm(application, resource))
    // Without an account or context in its identifiers (no ARN, a global S3 bucket), a resource of
    // the application's own provider lives where its profile reaches: the primary scope.
    .map(scope => (scope.provider === primaryProvider && !scope.scopeId ? { ...scope, location: primaryLocation } : scope));
  // The primary scope only counts when no resource already names its account/context (an AWS
  // application's region alone does not identify an account). "generic" is not a provider a
  // resource lives in, so it only stands as a scope while the application has no resources.
  const coveredByResource = scopeInputs.some(scope => scope.provider === primaryProvider && scope.location === primaryLocation);
  const primaryIsPlaceholder = primaryProvider === 'generic' && scopeInputs.length > 0;
  if (!coveredByResource && !primaryIsPlaceholder) scopeInputs.unshift({ provider: primaryProvider, scopeId: '', location: primaryLocation });
  const withScopes = normalizeApplicationContext({ ...context, scopes: scopeInputs });
  const profileId = text(application.profileId);
  // Only scopes of the application's own provider were reached through its profile; a
  // Kubernetes workload inside an AWS application is reached through its kube context.
  const bindings = withScopes.scopes.filter(scope => scope.provider === primaryProvider).map(scope => ({
    scopeKey: scope.key,
    profileId,
    // An empty scopeId is still a guess: the binding must be verified against the session.
    status: scope.scopeId ? 'migrated' : 'unverified',
  }));
  return { context: withScopes, bindings };
}

class ApplicationScopeService {
  constructor({ database, architectureDatabase, registry = null, log = () => {} }) {
    if (!database || !architectureDatabase) throw new Error('database and architectureDatabase are required');
    this.database = database;
    this.architectureDatabase = architectureDatabase;
    this.registry = registry;
    this.log = log;
  }

  /**
   * Adds the scopes a legacy application's resources live in, and binds its profile
   * where no binding exists yet. Never removes a scope nor replaces a user's binding.
   */
  syncLegacyScopes(application) {
    if (!application?.profileId) return { added: 0 };
    const { context, bindings } = legacyApplicationContext(application, { resources: this.database.listResources(application.id) });
    const existing = this.database.listApplicationScopes(application.id);
    // A pending scope that verification already completed (same provider and location, with
    // its account now known) must not come back.
    const completed = scope => !scope.scopeId && existing.some(item =>
      item.provider === scope.provider && item.location === scope.location && item.scopeId);
    const skipped = new Set(context.scopes.filter(completed).map(scope => scope.key));
    let added = 0;
    for (const scope of context.scopes) {
      if (!skipped.has(scope.key) && this.database.addApplicationScope(application.id, scope)) added += 1;
    }
    for (const binding of bindings.filter(item => !skipped.has(item.scopeKey))) {
      this.database.setScopeBinding(application.id, binding.scopeKey, binding, { onlyIfMissing: true });
    }
    return { added };
  }

  /**
   * Moves the local registry from identity v1 (with the profile) to v2. The registry is
   * derived from APM resources and architecture graphs, so v1 rows are dropped and each
   * application reconciled again; resources that v2 merges are recorded for the report.
   */
  migrateRegistryIdentities() {
    const legacy = this.database.listLegacyRegistryResources();
    if (!legacy.length) return { migrated: false, removed: 0, merged: 0, failed: [] };
    const groups = new Map();
    for (const resource of legacy) {
      let identityKey;
      try { ({ identityKey } = portableResourceIdentity(resource)); } catch { continue; }
      const group = groups.get(identityKey) || { identityKey, mergedCount: 0, applicationIds: new Set() };
      group.mergedCount += 1;
      (resource.applicationIds || []).forEach(id => group.applicationIds.add(id));
      groups.set(identityKey, group);
    }
    const merges = [...groups.values()].filter(group => group.mergedCount > 1)
      .map(group => ({ ...group, applicationIds: [...group.applicationIds].sort() }));
    const removed = this.database.dropLegacyRegistry(merges);
    const failed = [];
    if (this.registry) {
      for (const application of this.database.listApplications()) {
        try { this.registry.reconcile(application); } catch (error) { failed.push({ applicationId: application.id, error: error.message }); }
      }
    }
    return { migrated: true, removed, merged: merges.length, failed };
  }

  /** Runs once per start: both steps are idempotent and safe to repeat. */
  migrate() {
    let scopesAdded = 0;
    for (const application of this.database.listApplications()) {
      try { scopesAdded += this.syncLegacyScopes(application).added; } catch (error) {
        this.log('KUApps scope migration failed', application.id, error.message);
      }
    }
    const registry = this.migrateRegistryIdentities();
    return { scopesAdded, registry };
  }

  /**
   * Read-only findings that need a human decision before applications become
   * provider-less. Each one names the affected ids and a suggested resolution.
   */
  migrationReport() {
    const applications = this.database.listApplications();
    const projects = this.architectureDatabase.listProjects();
    const projectsById = new Map(projects.map(project => [project.id, project]));
    const applicationsByProject = new Map();
    const findings = [];
    const add = (kind, severity, resolution, detail) => findings.push({ kind, severity, resolution, ...detail });

    for (const application of applications) {
      const projectIds = application.architectureProjectIds || [];
      if (!projectIds.length) add('application_without_view', 'info', 'create_or_link_view', { applicationIds: [application.id] });
      for (const projectId of projectIds) {
        const project = projectsById.get(projectId);
        if (!project) {
          add('broken_view_link', 'warning', 'unlink_view', { applicationIds: [application.id], projectIds: [projectId] });
          continue;
        }
        applicationsByProject.set(projectId, [...(applicationsByProject.get(projectId) || []), application.id]);
        // _reconcile skips these projects today, so their nodes never reach the registry.
        if (application.profileId && project.profileId !== application.profileId) {
          add('view_profile_mismatch', 'warning', 'bind_view_scope', { applicationIds: [application.id], projectIds: [projectId] });
        }
      }
      const scopes = this.database.listApplicationScopes(application.id);
      const bindings = new Map(this.database.listScopeBindings(application.id).map(binding => [binding.scopeKey, binding]));
      for (const scope of scopes) {
        const binding = bindings.get(scope.key);
        if (!binding) add('scope_unbound', 'warning', 'bind_profile', { applicationIds: [application.id], scopeKeys: [scope.key], provider: scope.provider });
        else if (binding.status === 'mismatch') add('scope_mismatch', 'error', 'bind_matching_profile', { applicationIds: [application.id], scopeKeys: [scope.key], provider: scope.provider });
        else if (!scope.scopeId || binding.status === 'unverified') add('scope_unverified', 'info', 'verify_scope', { applicationIds: [application.id], scopeKeys: [scope.key], provider: scope.provider });
      }
    }

    for (const project of projects) {
      const linked = applicationsByProject.get(project.id) || [];
      if (!linked.length) add('view_without_application', 'info', 'link_to_application', { projectIds: [project.id] });
      if (linked.length > 1) add('view_shared_by_applications', 'warning', 'review_shared_view', { projectIds: [project.id], applicationIds: linked });
    }

    const byName = new Map();
    for (const application of applications) {
      const key = `${application.name.toLowerCase()}\u0000${application.environment.toLowerCase()}`;
      byName.set(key, [...(byName.get(key) || []), application.id]);
    }
    for (const ids of byName.values()) {
      if (ids.length > 1) add('duplicate_name', 'info', 'rename_optional', { applicationIds: ids });
    }

    for (const merge of this.database.listRegistryIdentityMerges()) {
      add('resource_identities_merged', 'info', 'none', { applicationIds: merge.applicationIds, mergedCount: merge.mergedCount, detectedAt: merge.detectedAt });
    }
    const legacyRegistryRows = this.database.listLegacyRegistryResources().length;
    if (legacyRegistryRows) add('registry_identity_v1', 'warning', 'reconcile', { count: legacyRegistryRows });

    const order = { error: 0, warning: 1, info: 2 };
    findings.sort((a, b) => order[a.severity] - order[b.severity] || a.kind.localeCompare(b.kind));
    return {
      generatedAt: new Date().toISOString(),
      applications: applications.length,
      providerLessApplications: applications.filter(application => !application.profileId).length,
      views: projects.length,
      findings,
    };
  }
}

module.exports = { ApplicationScopeService, legacyApplicationContext };
