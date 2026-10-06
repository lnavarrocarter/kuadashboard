'use strict';
/**
 * lib/kua/applicationService.js
 * KUA Applications as the contract of lib/kua/applicationContract.js (#149):
 * create without provider, edit identity, add/remove portable scopes and bind
 * local profiles to them. The KUApps routes use it, and the MCP tools of #154
 * and #155 must use it too, so UI and agents share one behaviour.
 *
 * Every view keeps the contract fields apart from `local`: bindings and the
 * legacy profile live under `local` and must never be exported or synced.
 */

const { APPLICATION_CONTRACT_VERSION, normalizeApplicationContext, normalizeScope, text } = require('./applicationContract');
const { legacyApplicationContext } = require('./applicationScopes');
const { createScopeVerifier } = require('./scopeVerifier');

function serviceError(message, statusCode, code) {
  return Object.assign(new Error(message), { statusCode, code });
}

class KuaApplicationService {
  constructor({ database, verifier = createScopeVerifier(), audit = () => {} }) {
    if (!database) throw new Error('database is required');
    this.database = database;
    this.verifier = verifier;
    this.audit = audit;
  }

  _application(id) {
    const application = this.database.getApplication(id);
    if (!application) throw serviceError('KUA Application not found', 404, 'NOT_FOUND');
    return application;
  }

  // Optimistic concurrency: a caller that read revision N cannot overwrite a newer change.
  _checkRevision(application, expectedRevision) {
    if (expectedRevision === undefined || expectedRevision === null || expectedRevision === '') return;
    if (Number(expectedRevision) !== application.revision) {
      throw Object.assign(serviceError('The application changed since it was read', 409, 'REVISION_CONFLICT'), { revision: application.revision });
    }
  }

  _scope(application, scopeKey) {
    const scope = this.database.listApplicationScopes(application.id).find(item => item.key === scopeKey);
    if (!scope) throw serviceError('Scope not found', 404, 'SCOPE_NOT_FOUND');
    return scope;
  }

  view(application, { all = null } = {}) {
    const scopes = this.database.listApplicationScopes(application.id);
    const bindings = this.database.listScopeBindings(application.id);
    const bindingByScope = new Map(bindings.map(binding => [binding.scopeKey, binding]));
    const warnings = [];
    for (const scope of scopes) {
      const binding = bindingByScope.get(scope.key);
      if (!binding) warnings.push({ kind: 'scope_unbound', scopeKey: scope.key });
      else if (binding.status === 'mismatch') warnings.push({ kind: 'scope_mismatch', scopeKey: scope.key });
      else if (binding.status !== 'verified') warnings.push({ kind: 'scope_unverified', scopeKey: scope.key });
    }
    const others = (all || this.database.listApplications()).filter(item => item.id !== application.id);
    if (others.some(item => item.name.toLowerCase() === application.name.toLowerCase() && item.environment === application.environment)) {
      warnings.push({ kind: 'duplicate_name' });
    }
    return {
      contractVersion: APPLICATION_CONTRACT_VERSION,
      id: application.id,
      name: application.name,
      environment: application.environment,
      team: application.team,
      revision: application.revision,
      scopes: scopes.map(({ key, provider, scopeId, location, label }) => ({ key, provider, scopeId, location, label })),
      views: { architectureProjectIds: application.architectureProjectIds || [] },
      createdAt: application.createdAt,
      updatedAt: application.updatedAt,
      warnings,
      local: {
        bindings: bindings.map(({ scopeKey, profileId, status, verifiedIdentity, verifiedAt, lastError }) => ({ scopeKey, profileId, status, verifiedIdentity, verifiedAt, lastError })),
        legacy: application.profileId ? { provider: application.provider, profileId: application.profileId, region: application.region } : null,
      },
    };
  }

  list() {
    const all = this.database.listApplications();
    return all.map(application => this.view(application, { all }));
  }

  get(id) {
    return this.view(this._application(id));
  }

  create(input = {}) {
    const context = normalizeApplicationContext({ name: input.name, environment: input.environment, team: input.team, scopes: input.scopes });
    const application = this.database.createApplication({ name: context.name, environment: context.environment, team: context.team });
    for (const scope of context.scopes) this.database.addApplicationScope(application.id, scope);
    this.audit('KUA Application created', application.name, { applicationId: application.id, scopes: context.scopes.length });
    return this.get(application.id);
  }

  update(id, changes = {}, { expectedRevision } = {}) {
    const application = this._application(id);
    this._checkRevision(application, expectedRevision);
    if (changes.name !== undefined && !text(changes.name)) throw serviceError('name is required', 400, 'INVALID');
    this.database.updateApplication(id, {
      name: changes.name === undefined ? undefined : text(changes.name),
      environment: changes.environment === undefined ? undefined : text(changes.environment),
      team: changes.team === undefined ? undefined : text(changes.team),
    });
    this.audit('KUA Application updated', application.name, { applicationId: id });
    return this.get(id);
  }

  /** Deletes the application and its local data; architecture projects and live infrastructure stay. */
  remove(id, { expectedRevision } = {}) {
    const application = this._application(id);
    this._checkRevision(application, expectedRevision);
    this.database.deleteApplication(id);
    this.audit('KUA Application deleted', application.name, { applicationId: id });
    return { id, deleted: true };
  }

  addScope(id, input, { expectedRevision } = {}) {
    const application = this._application(id);
    this._checkRevision(application, expectedRevision);
    const scope = normalizeScope(input);
    const created = this.database.addApplicationScope(id, scope);
    if (created) this.audit('KUA Application scope added', application.name, { applicationId: id, provider: scope.provider });
    return { created, scope, application: this.get(id) };
  }

  removeScope(id, scopeKey, { expectedRevision } = {}) {
    const application = this._application(id);
    this._checkRevision(application, expectedRevision);
    const scope = this._scope(application, scopeKey);
    // Legacy resources would put the scope back on the next reconcile: detach them first (#150).
    const { context } = legacyApplicationContext(application, { resources: this.database.listResources(id) });
    if (application.profileId && this.database.listResources(id).length && context.scopes.some(item => item.key === scopeKey)) {
      throw serviceError('Resources of this application live in this scope', 409, 'SCOPE_IN_USE');
    }
    this.database.removeApplicationScope(id, scopeKey);
    this.audit('KUA Application scope removed', application.name, { applicationId: id, provider: scope.provider });
    return this.get(id);
  }

  /** Binds a local profile to a scope and verifies it; a scope without account is completed. */
  async bindScope(id, scopeKey, profileId) {
    const application = this._application(id);
    const scope = this._scope(application, scopeKey);
    const profile = text(profileId);
    if (!profile) throw serviceError('profileId is required', 400, 'INVALID');
    return this._verifyAndStore(application, scope, profile);
  }

  async verifyScope(id, scopeKey) {
    const application = this._application(id);
    const scope = this._scope(application, scopeKey);
    const binding = this.database.getScopeBinding(id, scopeKey);
    if (!binding) throw serviceError('The scope has no local profile', 409, 'SCOPE_UNBOUND');
    return this._verifyAndStore(application, scope, binding.profileId);
  }

  async _verifyAndStore(application, scope, profileId) {
    const result = await this.verifier.verify(scope, profileId);
    const binding = { profileId, status: result.status, verifiedIdentity: result.verifiedIdentity, verifiedAt: result.verifiedAt, lastError: result.lastError };
    let scopeKey = scope.key;
    if (result.completedScopeId) {
      const completed = normalizeScope({ ...scope, scopeId: result.completedScopeId });
      this.database.completeApplicationScope(application.id, scope.key, completed, binding);
      scopeKey = completed.key;
    } else {
      this.database.setScopeBinding(application.id, scope.key, binding);
    }
    // The profile is local: the audit names the scope and the outcome only.
    this.audit('KUA Application scope bound', application.name, { applicationId: application.id, provider: scope.provider, status: result.status });
    return { scopeKey, status: result.status, application: this.get(application.id) };
  }

  unbindScope(id, scopeKey) {
    const application = this._application(id);
    this._scope(application, scopeKey);
    this.database.removeScopeBinding(id, scopeKey);
    return this.get(id);
  }
}

module.exports = { KuaApplicationService };
