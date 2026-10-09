'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { ApmDatabase } = require('../apm/database');
const { ArchitectureDatabase } = require('../architecture/database');
const { ApplicationRegistryService } = require('./applicationRegistryService');
const { KuaApplicationService } = require('./applicationService');
const { createAgentAccess } = require('./agentAccess');
const { createChangePlanService, PLAN_TTL_MS } = require('./changePlans');

function fixture({ registry: override } = {}) {
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
