'use strict';
/**
 * lib/kua/changePlans.js
 * Changes to KUA Applications requested by AI agents (#155), in two steps:
 *
 *   preview  validates the request with the same domain services as the UI, says what would
 *            change and stores it as a plan (the application revision it was made against,
 *            expiring after 15 minutes). Nothing in the application changes.
 *   apply    runs a stored plan, only with an explicit confirmation and only while the user
 *            allows agent writes in KUA. The plan id is the idempotency key: applying it again
 *            returns the recorded outcome instead of writing twice, and get() reads the outcome
 *            after a lost response. A plan made against an older revision is refused unchanged.
 *
 * Nothing here creates, deploys, changes or deletes cloud infrastructure: detaching a resource
 * only takes it out of the application, and unlinking a view keeps the view.
 */

const crypto = require('crypto');
const { normalizeApplicationContext, text } = require('./applicationContract');
const { canonicalFromApm } = require('./applicationRegistryService');
const { APM_PROVIDERS, APM_RESOURCE_TYPES } = require('../apm/database');

const PLAN_TTL_MS = 15 * 60 * 1000;
const MAX_ITEMS = 100;
const OPERATIONS = ['application.create', 'application.update', 'resources.attach', 'resources.detach', 'view.link', 'view.unlink'];
// Resource types whose identifier is unique across accounts and regions.
const GLOBAL_TYPES = new Set(['s3']);

function planError(message, statusCode, code, extra = {}) {
  return Object.assign(new Error(message), { statusCode, code, ...extra });
}

function arnScope(arn) {
  const parts = String(arn || '').split(':');
  return parts[0] === 'arn' ? { scopeId: parts[4] || '', location: parts[3] || '' } : null;
}

// A resource is only accepted with enough identity to find it again: never by name alone.
function resourceInput(raw, index) {
  if (!raw || typeof raw !== 'object') throw planError(`resources[${index}] must be an object`, 400, 'INVALID');
  const input = {
    provider: text(raw.provider).toLowerCase(),
    type: text(raw.type),
    key: text(raw.key),
    name: text(raw.name),
    arn: text(raw.arn) || undefined,
    kind: text(raw.kind) || undefined,
    kubeContext: text(raw.kubeContext) || undefined,
    namespace: text(raw.namespace) || undefined,
    scopeId: text(raw.scopeId),
    location: text(raw.location),
    service: text(raw.service),
    logGroup: text(raw.logGroup) || undefined,
    associationSource: 'manual',
  };
  const where = `resources[${index}]${input.name ? ` (${input.name})` : ''}`;
  if (!APM_PROVIDERS.has(input.provider)) throw planError(`${where}: unsupported provider "${input.provider}"`, 400, 'INVALID');
  if (!APM_RESOURCE_TYPES.has(input.type)) throw planError(`${where}: unsupported resource type "${input.type}"`, 400, 'INVALID');
  if (!input.key || !input.name) throw planError(`${where}: "key" (the native identifier) and "name" are required`, 400, 'INVALID');
  if (input.type === 'kubernetes') {
    if (!input.kubeContext) throw planError(`${where}: a Kubernetes resource needs "kubeContext"`, 400, 'IDENTITY_REQUIRED');
  } else if (!GLOBAL_TYPES.has(input.type)) {
    const fromArn = arnScope(input.arn || input.key);
    if (!fromArn?.scopeId && !input.scopeId) throw planError(`${where}: needs an ARN or "scopeId" (account or project) to identify it`, 400, 'IDENTITY_REQUIRED');
    if (input.provider === 'aws' && !fromArn?.location && !input.location) throw planError(`${where}: needs an ARN or "location" (region) to identify it`, 400, 'IDENTITY_REQUIRED');
  }
  return input;
}

function list(value, field) {
  if (!Array.isArray(value) || !value.length) throw planError(`"${field}" must be a non-empty array`, 400, 'INVALID');
  if (value.length > MAX_ITEMS) throw planError(`"${field}" accepts at most ${MAX_ITEMS} items`, 400, 'INVALID');
  return value;
}

function createChangePlanService({ apmDatabase, architectureDatabase, applications, registry, access, audit = () => {}, now = () => Date.now() }) {
  const viewIdsOf = application => (application.architectureProjectIds?.length
    ? application.architectureProjectIds : [application.architectureProjectId].filter(Boolean));

  function applicationOr404(id) {
    const application = apmDatabase.getApplication(text(id));
    if (!application) throw planError('KUA Application not found', 404, 'NOT_FOUND');
    return application;
  }

  // What each operation would do, computed without writing.
  const previews = {
    'application.create'(_application, input) {
      const context = normalizeApplicationContext({ name: input.name, environment: input.environment, team: input.team, scopes: input.scopes });
      const sameName = apmDatabase.listApplications()
        .filter(item => item.name.toLowerCase() === context.name.toLowerCase() && item.environment === context.environment);
      return {
        input: { name: context.name, environment: context.environment, team: context.team, scopes: context.scopes.map(({ provider, scopeId, location, label }) => ({ provider, scopeId, location, label })) },
        effects: { create: { name: context.name, environment: context.environment, team: context.team, scopes: context.scopes.length } },
        warnings: sameName.length ? [{ kind: 'duplicate_name', applications: sameName.map(item => item.id) }] : [],
      };
    },
    'application.update'(application, input) {
      const changes = {};
      for (const field of ['name', 'environment', 'team']) {
        if (input[field] === undefined) continue;
        const value = text(input[field]);
        if (field === 'name' && !value) throw planError('name cannot be empty', 400, 'INVALID');
        if (value !== (application[field] || '')) changes[field] = { from: application[field] || '', to: value };
      }
      if (!Object.keys(changes).length) throw planError('Nothing to change: pass name, environment or team with a new value', 400, 'NO_CHANGE');
      return { input: Object.fromEntries(Object.entries(changes).map(([field, change]) => [field, change.to])), effects: { update: changes }, warnings: [] };
    },
    'resources.attach'(application, input) {
      const resources = list(input.resources, 'resources').map(resourceInput);
      const members = new Set(apmDatabase.listRegistryResources(application.id).map(resource => resource.id));
      const detached = new Set(apmDatabase.listRegistryDetachmentKeys(application.id));
      const scopes = apmDatabase.listApplicationScopes(application.id);
      const items = resources.map(resource => {
        const canonical = canonicalFromApm(application, resource);
        const insideScopes = !scopes.length || scopes.some(scope => scope.provider === canonical.provider &&
          (!scope.scopeId || !canonical.scopeId || scope.scopeId.toLowerCase() === canonical.scopeId.toLowerCase()));
        return {
          name: resource.name, provider: canonical.provider, resourceType: canonical.resourceType, resourceId: canonical.id,
          scope: { scopeId: canonical.scopeId, location: canonical.location },
          state: members.has(canonical.id) ? 'already_member' : detached.has(canonical.identityKey) ? 'reattach' : 'new',
          ...(insideScopes ? {} : { warning: 'outside_application_scopes' }),
        };
      });
      return {
        input: { resources },
        effects: { attach: items, collection: 'unchanged' },
        warnings: items.some(item => item.warning) ? [{ kind: 'outside_application_scopes', count: items.filter(item => item.warning).length }] : [],
      };
    },
    'resources.detach'(application, input) {
      const ids = [...new Set(list(input.resourceIds, 'resourceIds').map(text))];
      const members = new Map(apmDatabase.listRegistryResources(application.id).map(resource => [resource.id, resource]));
      const missing = ids.filter(id => !members.has(id));
      if (missing.length) throw planError(`Not resources of this application: ${missing.join(', ')} (see list_application_resources)`, 404, 'RESOURCE_NOT_FOUND');
      return {
        input: { resourceIds: ids },
        effects: { detach: ids.map(id => ({ resourceId: id, name: members.get(id).displayName, provider: members.get(id).provider })), cloud: 'unchanged' },
        warnings: [],
      };
    },
    'view.link'(application, input) {
      const projectId = text(input.projectId);
      const project = architectureDatabase.getProject(projectId);
      if (!project) throw planError(`No architecture view "${projectId}"`, 404, 'VIEW_NOT_FOUND');
      if (viewIdsOf(application).includes(projectId)) throw planError(`"${project.name}" is already a view of this application`, 409, 'NO_CHANGE');
      const others = apmDatabase.listApplicationsByArchitectureProjectId(projectId).filter(item => item.id !== application.id);
      return {
        input: { projectId },
        effects: { link: { projectId, name: project.name } },
        warnings: others.length ? [{ kind: 'view_shared_by_applications', applications: others.map(item => item.id) }] : [],
      };
    },
    'view.unlink'(application, input) {
      const projectId = text(input.projectId);
      if (!viewIdsOf(application).includes(projectId)) throw planError(`"${projectId}" is not a view of this application`, 404, 'VIEW_NOT_FOUND');
      return {
        input: { projectId },
        effects: { unlink: { projectId, name: architectureDatabase.getProject(projectId)?.name || projectId }, view: 'kept' },
        warnings: [],
      };
    },
  };

  // The write of each operation. A stale revision was already refused before any of these runs.
  const appliers = {
    'application.create'(_application, input) {
      const created = applications.create(input);
      return { applicationId: created.id, application: created };
    },
    'application.update'(application, input, plan) {
      return { application: applications.update(application.id, input, { expectedRevision: plan.baseRevision }) };
    },
    'resources.attach'(application, input, plan) {
      const { results } = registry.attachResources(application, input.resources, { expectedRevision: plan.baseRevision, clearDetachments: true });
      return {
        items: results.map(result => (result.error
          ? { name: result.input.name, outcome: 'failed', error: result.error }
          : { name: result.input.name, outcome: result.created ? 'attached' : 'already_member' })),
      };
    },
    'resources.detach'(application, input) {
      const items = [];
      for (const resourceId of input.resourceIds) {
        try {
          const current = apmDatabase.getApplication(application.id);
          // The APM resource that makes it a member, if any; otherwise the registry membership itself.
          const member = apmDatabase.listResources(current.id).find(resource => {
            try { return canonicalFromApm(current, resource).id === resourceId; } catch { return false; }
          });
          if (member) registry.detachResource(current, member.id);
          else registry.detachRegistryResource(current, resourceId);
          items.push({ resourceId, outcome: 'detached' });
        } catch (error) {
          items.push({ resourceId, outcome: 'failed', error: error.message });
        }
      }
      return { items };
    },
    'view.link'(application, input) {
      apmDatabase.updateArchitectureProjectLink(application.id, input.projectId);
      registry.reconcile(apmDatabase.getApplication(application.id));
      return { linked: input.projectId };
    },
    'view.unlink'(application, input) {
      apmDatabase.unlinkArchitectureProject(application.id, input.projectId);
      registry.reconcile(apmDatabase.getApplication(application.id));
      return { unlinked: input.projectId, view: 'kept' };
    },
  };

  function describe(plan) {
    const application = plan.applicationId ? apmDatabase.getApplication(plan.applicationId) : null;
    return {
      planId: plan.id,
      operation: plan.operation,
      status: Date.parse(plan.expiresAt) < now() && plan.status === 'planned' ? 'expired' : plan.status,
      applicationId: plan.result?.applicationId || plan.applicationId || null,
      baseRevision: plan.baseRevision,
      currentRevision: application?.revision ?? null,
      preview: plan.preview,
      result: plan.result,
      error: plan.error,
      actor: plan.actor,
      createdAt: plan.createdAt,
      expiresAt: plan.expiresAt,
      appliedAt: plan.appliedAt,
    };
  }

  function preview({ applicationId, operation, input = {}, actor = 'agent' }) {
    if (!OPERATIONS.includes(operation)) throw planError(`Unsupported operation "${operation}". Use one of: ${OPERATIONS.join(', ')}`, 400, 'INVALID');
    const application = operation === 'application.create' ? null : applicationOr404(applicationId);
    const { input: normalized, effects, warnings } = previews[operation](application, input && typeof input === 'object' ? input : {});
    const createdAt = new Date(now()).toISOString();
    const plan = apmDatabase.createChangePlan({
      id: `plan_${crypto.randomUUID()}`,
      applicationId: application?.id || null,
      operation,
      input: normalized,
      preview: { application: application ? { id: application.id, name: application.name } : null, effects, warnings },
      baseRevision: application?.revision ?? null,
      actor,
      createdAt,
      expiresAt: new Date(now() + PLAN_TTL_MS).toISOString(),
    });
    return { ...describe(plan), agentWrites: access.writesEnabled() };
  }

  function get(planId) {
    const plan = apmDatabase.getChangePlan(text(planId));
    if (!plan) throw planError('No change plan with this id', 404, 'PLAN_NOT_FOUND');
    return describe(plan);
  }

  function apply(planId, { confirm = false, actor = 'agent' } = {}) {
    const plan = apmDatabase.getChangePlan(text(planId));
    if (!plan) throw planError('No change plan with this id', 404, 'PLAN_NOT_FOUND');
    // Idempotency: a plan that already ran answers with its recorded outcome.
    if (plan.status !== 'planned') return { ...describe(plan), replayed: true };
    if (confirm !== true) throw planError('Applying needs "confirm": true, after the user approved the preview', 400, 'CONFIRMATION_REQUIRED');
    if (!access.writesEnabled()) {
      throw planError('Agents cannot change KUApps on this computer. The user can allow it in KUA: Connect an AI agent → Allow agents to change KUApps.', 403, 'AGENT_WRITES_DISABLED');
    }
    if (Date.parse(plan.expiresAt) < now()) throw planError('The plan expired: preview the change again', 410, 'PLAN_EXPIRED');

    const application = plan.applicationId ? apmDatabase.getApplication(plan.applicationId) : null;
    if (plan.applicationId && !application) {
      apmDatabase.finishChangePlan(plan.id, { status: 'failed', error: { code: 'NOT_FOUND', message: 'The application was deleted' } });
      throw planError('The application was deleted after the preview', 404, 'NOT_FOUND');
    }
    if (application && application.revision !== plan.baseRevision) {
      apmDatabase.finishChangePlan(plan.id, { status: 'conflict', error: { code: 'REVISION_CONFLICT', message: `The application moved from revision ${plan.baseRevision} to ${application.revision}` } });
      throw planError('The application changed since the preview; nothing was written. Preview the change again.', 409, 'REVISION_CONFLICT', { revision: application.revision });
    }

    let result;
    try {
      result = appliers[plan.operation](application, plan.input, plan);
    } catch (error) {
      apmDatabase.finishChangePlan(plan.id, { status: 'failed', error: { code: error.code || 'FAILED', message: error.message } });
      throw error;
    }
    const failed = (result.items || []).filter(item => item.outcome === 'failed').length;
    const status = failed && failed === result.items.length ? 'failed' : failed ? 'partial' : 'applied';
    const after = apmDatabase.getApplication(result.applicationId || plan.applicationId);
    const recorded = { ...result, application: undefined, revisionAfter: after?.revision ?? null };
    apmDatabase.finishChangePlan(plan.id, { status, result: recorded });
    // Actor, application, operation and revisions: never the resources' payload or a profile.
    audit(`KUApps change applied by an agent (${plan.operation})`, after?.name || plan.applicationId || '', {
      planId: plan.id, operation: plan.operation, actor, applicationId: after?.id || plan.applicationId,
      revisionBefore: plan.baseRevision, revisionAfter: after?.revision ?? null, status,
    });
    return describe(apmDatabase.getChangePlan(plan.id));
  }

  return { preview, apply, get, OPERATIONS };
}

module.exports = { createChangePlanService, OPERATIONS, PLAN_TTL_MS };
