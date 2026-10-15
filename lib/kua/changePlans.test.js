'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { ApmDatabase } = require('../apm/database');
const { ArchitectureDatabase } = require('../architecture/database');
const { ApplicationRegistryService } = require('./applicationRegistryService');
const { KuaApplicationService } = require('./applicationService');
const { createAgentAccess } = require('./agentAccess');
const { createChangePlanService, PLAN_TTL_MS } = require('./changePlans');

function fixture({ registry: override, collection = null } = {}) {
  let clock = Date.UTC(2026, 9, 9, 12);
  const apmDatabase = new ApmDatabase({ filePath: ':memory:', now: () => clock });
  const architectureDatabase = new ArchitectureDatabase({ filePath: ':memory:' });
  const registry = override?.(new ApplicationRegistryService({ database: apmDatabase, architectureDatabase })) || new ApplicationRegistryService({ database: apmDatabase, architectureDatabase });
  const access = createAgentAccess({ dataDir: null });
  access.set(true);
  const audit = [];
  const plans = createChangePlanService({
    apmDatabase, architectureDatabase, registry, access,
    applications: new KuaApplicationService({ database: apmDatabase, verifier: { verify: async () => ({ status: 'unverified' }) } }),
    audit: (...entry) => audit.push(entry), now: () => clock,
    ...(collection ? { collection } : {}),
  });
  return {
    apmDatabase, plans, audit, access,
    advance: ms => { clock += ms; },
    close() { apmDatabase.close(); architectureDatabase.close(); },
  };
}

const lambda = name => ({ provider: 'aws', type: 'lambda', key: `arn:aws:lambda:us-east-1:111111111111:function:${name}`, arn: `arn:aws:lambda:us-east-1:111111111111:function:${name}`, name });

test('an attach where some resources fail is recorded as partial, per item, and is not applied again', () => {
  const subject = fixture({
    registry: real => Object.assign(real, {
      attachResources(application, inputs, options) {
        const result = ApplicationRegistryService.prototype.attachResources.call(real, application, inputs.filter(input => input.name !== 'broken'), options);
        return { ...result, results: [...result.results, { input: inputs.find(input => input.name === 'broken'), error: 'disk full' }] };
      },
    }),
  });
  try {
    const application = subject.apmDatabase.createApplication({ name: 'Checkout' });
    const plan = subject.plans.preview({ applicationId: application.id, operation: 'resources.attach', input: { resources: [lambda('api'), lambda('broken')] }, actor: 'mcp' });
    const outcome = subject.plans.apply(plan.planId, { confirm: true, actor: 'mcp' });
    assert.equal(outcome.status, 'partial');
    assert.deepEqual(outcome.result.items.map(item => [item.name, item.outcome]), [['api', 'attached'], ['broken', 'failed']]);
    assert.equal(subject.plans.apply(plan.planId, { confirm: true }).replayed, true);
    assert.equal(subject.apmDatabase.listResources(application.id).length, 1);
    assert.equal(subject.audit.length, 1);
  } finally { subject.close(); }
});

test('an expired plan is refused and must be previewed again; a failed apply keeps its error', () => {
  const subject = fixture();
  try {
    const application = subject.apmDatabase.createApplication({ name: 'Checkout' });
    const plan = subject.plans.preview({ applicationId: application.id, operation: 'application.update', input: { team: 'Payments' } });
    subject.advance(PLAN_TTL_MS + 1);
    assert.equal(subject.plans.get(plan.planId).status, 'expired');
    assert.throws(() => subject.plans.apply(plan.planId, { confirm: true }), error => error.code === 'PLAN_EXPIRED' && error.statusCode === 410);
    assert.equal(subject.apmDatabase.getApplication(application.id).team, '');

    const deleted = subject.apmDatabase.createApplication({ name: 'Gone' });
    const orphan = subject.plans.preview({ applicationId: deleted.id, operation: 'application.update', input: { team: 'x' } });
    subject.apmDatabase.deleteApplication(deleted.id);
    assert.throws(() => subject.plans.apply(orphan.planId, { confirm: true }), error => error.code === 'NOT_FOUND');
    assert.deepEqual([subject.plans.get(orphan.planId).status, subject.plans.get(orphan.planId).error.code], ['failed', 'NOT_FOUND']);
  } finally { subject.close(); }
});

test('preview refuses changes that change nothing and links of views the application already has', () => {
  const subject = fixture();
  try {
    const application = subject.apmDatabase.createApplication({ name: 'Checkout', team: 'Payments' });
    assert.throws(() => subject.plans.preview({ applicationId: application.id, operation: 'application.update', input: { team: 'Payments' } }), error => error.code === 'NO_CHANGE');
    assert.throws(() => subject.plans.preview({ applicationId: application.id, operation: 'resources.attach', input: { resources: [] } }), /non-empty array/);
    assert.throws(() => subject.plans.preview({ applicationId: 'missing', operation: 'application.update', input: { team: 'x' } }), error => error.statusCode === 404);
  } finally { subject.close(); }
});

test('attaching to an application without a provider adds the scopes its resources need (#280)', () => {
  const subject = fixture();
  try {
    const application = subject.apmDatabase.createApplication({ name: 'KUA Control Plane' });
    const cloudRun = { provider: 'gcp', type: 'gcp-cloud-run', key: 'projects/ncaicloud/locations/us-central1/services/kua-control-plane', name: 'kua-control-plane', scopeId: 'ncaicloud', location: 'us-central1' };
    const vercel = { provider: 'vercel', type: 'vercel-project', key: 'prj_1', name: 'kuadashboard', scopeId: 'team_1', location: 'global' };
    const workload = { provider: 'kubernetes', type: 'kubernetes', kind: 'Deployment', key: 'dev/web/Deployment/api', name: 'api', kubeContext: 'dev', namespace: 'web' };
    const plan = subject.plans.preview({ applicationId: application.id, operation: 'resources.attach', input: { resources: [cloudRun, vercel, workload, lambda('api')] }, actor: 'mcp' });
    assert.deepEqual(plan.preview.effects.scopes.add.map(scope => [scope.provider, scope.scopeId, scope.location]), [
      ['gcp', 'ncaicloud', 'us-central1'], ['vercel', 'team_1', 'global'], ['aws', '111111111111', 'us-east-1'],
    ], 'Kubernetes needs no scope: it is reached through its context');
    assert.deepEqual(plan.preview.warnings, [], 'resources covered by the scopes to add are not outside the application');

    const applied = subject.plans.apply(plan.planId, { confirm: true, actor: 'mcp' });
    assert.equal(applied.status, 'applied');
    assert.equal(applied.result.scopesAdded.length, 3);
    assert.deepEqual(subject.apmDatabase.listApplicationScopes(application.id).map(scope => scope.provider).sort(), ['aws', 'gcp', 'vercel']);

    // Another resource of a project the application already has adds nothing.
    const job = { ...cloudRun, key: 'projects/ncaicloud/locations/us-central1/services/worker', name: 'worker' };
    const again = subject.plans.preview({ applicationId: application.id, operation: 'resources.attach', input: { resources: [job] }, actor: 'mcp' });
    assert.equal(again.preview.effects.scopes, undefined);
  } finally { subject.close(); }
});

test('an application with its own profile keeps its scopes as they are (#280)', () => {
  const subject = fixture();
  try {
    const application = subject.apmDatabase.createApplication({ name: 'Legacy', profileId: 'local:dev', region: 'us-east-1' });
    const plan = subject.plans.preview({ applicationId: application.id, operation: 'resources.attach', input: { resources: [lambda('api')] }, actor: 'mcp' });
    assert.equal(plan.preview.effects.scopes, undefined);
    assert.deepEqual(plan.preview.warnings, []);
  } finally { subject.close(); }
});

test('agents manage scopes, resources and thresholds through previewed changes (#285)', () => {
  const subject = fixture();
  try {
    const application = subject.apmDatabase.createApplication({ name: 'Orders' });
    const add = subject.plans.preview({ applicationId: application.id, operation: 'scopes.add', input: { provider: 'aws', scopeId: '111111111111', location: 'us-east-1' }, actor: 'mcp' });
    assert.deepEqual(add.preview.effects.scopes.add, [{ provider: 'aws', scopeId: '111111111111', location: 'us-east-1' }]);
    assert.equal(subject.plans.apply(add.planId, { confirm: true, actor: 'mcp' }).status, 'applied');
    assert.throws(() => subject.plans.preview({ applicationId: application.id, operation: 'scopes.add', input: { provider: 'aws', scopeId: '111111111111', location: 'us-east-1' } }), error => error.code === 'NO_CHANGE');

    const created = subject.apmDatabase.attachResource(application.id, lambda('api')).resource;
    const remove = subject.plans.preview({ applicationId: application.id, operation: 'scopes.remove', input: { provider: 'aws', scopeId: '111111111111', location: 'us-east-1' } });
    assert.deepEqual(remove.preview.warnings, [{ kind: 'resources_lose_collection', count: 1 }]);

    const disable = subject.plans.preview({ applicationId: application.id, operation: 'resource.update', input: { resourceId: created.id, enabled: false, logGroup: '/aws/lambda/api' } });
    assert.deepEqual(disable.preview.effects.resource.changes, { enabled: { from: true, to: false }, logGroup: { from: '', to: '/aws/lambda/api' } });
    assert.equal(disable.preview.effects.cost, undefined, 'disabling costs nothing');
    subject.plans.apply(disable.planId, { confirm: true });
    assert.equal(subject.apmDatabase.getResource(created.id).enabled, false);
    const enable = subject.plans.preview({ applicationId: application.id, operation: 'resource.update', input: { resourceId: created.id, enabled: true } });
    assert.equal(enable.preview.effects.cost.perRun.logRequests, 2, 'enabling a Lambda shows what its collection reads');

    const thresholds = subject.plans.preview({ applicationId: application.id, operation: 'thresholds.update', input: { thresholds: { errorRatePercent: 2 } } });
    assert.deepEqual(thresholds.preview.effects.thresholds, { errorRatePercent: { from: 5, to: 2 } });
    subject.plans.apply(thresholds.planId, { confirm: true });
    assert.equal(subject.apmDatabase.getApplication(application.id).thresholds.errorRatePercent, 2);
    assert.throws(() => subject.plans.preview({ applicationId: application.id, operation: 'thresholds.update', input: { thresholds: { errorRatePercent: 500 } } }), error => error.code === 'INVALID');
    assert.throws(() => subject.plans.preview({ applicationId: application.id, operation: 'resource.update', input: { resourceId: 'nope', enabled: true } }), error => error.code === 'RESOURCE_NOT_FOUND');
  } finally { subject.close(); }
});

test('turning collection on and running it show their cost and only happen once approved (#285)', () => {
  const calls = [];
  const collection = { run: id => calls.push(['run', id]), sync: () => calls.push(['sync']), allowScheduled: () => false, intervalMinutes: () => 30 };
  const subject = fixture({ collection });
  try {
    const application = subject.apmDatabase.createApplication({ name: 'Orders' });
    subject.apmDatabase.attachResource(application.id, { provider: 'aws', type: 'ec2', key: 'arn:aws:ec2:us-east-1:111111111111:instance/i-1', arn: 'arn:aws:ec2:us-east-1:111111111111:instance/i-1', name: 'worker' });
    const on = subject.plans.preview({ applicationId: application.id, operation: 'collection.update', input: { pollingEnabled: true }, actor: 'mcp' });
    assert.deepEqual(on.preview.effects.collection.pollingEnabled, { from: false, to: true });
    assert.equal(on.preview.effects.cost.perRun.metrics, 4, 'EC2: 4 CloudWatch metrics per run');
    assert.equal(on.preview.effects.cost.perMonth.runs, 1440);
    assert.deepEqual(on.preview.warnings, [{ kind: 'scheduled_collection_needs_plan', required: 'pro' }]);
    assert.throws(() => subject.plans.apply(on.planId, { confirm: false }), error => error.code === 'CONFIRMATION_REQUIRED');
    assert.equal(subject.apmDatabase.getApplication(application.id).pollingEnabled, false, 'nothing changes without approval');
    subject.plans.apply(on.planId, { confirm: true });
    assert.equal(subject.apmDatabase.getApplication(application.id).pollingEnabled, true);

    const run = subject.plans.preview({ applicationId: application.id, operation: 'collection.run', input: {} });
    assert.ok(run.preview.effects.cost.perRun.usd > 0);
    assert.deepEqual(calls, [['sync']], 'previewing never collects');
    assert.equal(subject.plans.apply(run.planId, { confirm: true }).result.started, true);
    assert.deepEqual(calls, [['sync'], ['run', application.id]]);

    subject.access.set(false);
    const again = subject.plans.preview({ applicationId: application.id, operation: 'collection.run', input: {} });
    assert.throws(() => subject.plans.apply(again.planId, { confirm: true }), error => error.code === 'AGENT_WRITES_DISABLED');
  } finally { subject.close(); }
});

test('dismissing recommendations is a previewed change too (#285)', () => {
  const subject = fixture();
  try {
    const application = subject.apmDatabase.createApplication({ name: 'Orders' });
    const plan = subject.plans.preview({ applicationId: application.id, operation: 'recommendations.dismiss', input: { identityKeys: ['k1', 'k1', 'k2'] } });
    assert.equal(plan.preview.effects.recommendations.dismiss, 2);
    const applied = subject.plans.apply(plan.planId, { confirm: true });
    assert.deepEqual(applied.result.items.map(item => item.outcome), ['dismissed', 'dismissed']);
    assert.deepEqual(subject.apmDatabase.listRecommendationDismissals(application.id).sort(), ['k1', 'k2']);
    assert.throws(() => subject.plans.preview({ applicationId: application.id, operation: 'collection.run', input: {} }), error => error.code === 'UNSUPPORTED');
  } finally { subject.close(); }
});
