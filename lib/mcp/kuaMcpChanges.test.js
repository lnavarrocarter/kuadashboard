'use strict';
// KUApps changes from agents (#155) end to end: MCP tools → KUApps routes → domain services.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { ArchitectureDatabase } = require('../architecture/database');
const { ApmDatabase } = require('../apm/database');
const { createAgentAccess } = require('../kua/agentAccess');
const { createKuaAppsRouter } = require('../../routes/kuaApps');

const LAMBDA = 'arn:aws:lambda:us-east-1:111111111111:function:api';
const QUEUE = 'arn:aws:sqs:us-east-1:111111111111:orders';

async function fixture() {
  const database = new ArchitectureDatabase({ filePath: ':memory:' });
  const apmDatabase = new ApmDatabase({ filePath: ':memory:' });
  const agentAccess = createAgentAccess({ dataDir: null });
  const audit = [];
  const app = express();
  app.use(express.json());
  app.use('/api/kua-apps', createKuaAppsRouter({ database, apmDatabase, agentAccess, auditLog: { log: entry => audit.push(entry) } }));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const { createKuaMcp, httpRequest } = await import('./kuaMcp.mjs');
  const mcp = createKuaMcp({ request: httpRequest(base), version: '9.9.9' });
  const call = async (name, args) => {
    const result = await mcp.callTool(name, args);
    const text = result.content.map(item => item.text).join('\n');
    return result.isError ? { error: text } : JSON.parse(text);
  };
  // The KUApps UI, writing directly (not through a plan).
  const ui = (path, method, body) => fetch(`${base}/api/kua-apps${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(response => response.json());
  return {
    database, apmDatabase, agentAccess, audit, call, ui, mcp,
    async close() { await new Promise(resolve => server.close(resolve)); database.close(); apmDatabase.close(); },
  };
}

const lambda = { provider: 'aws', type: 'lambda', key: LAMBDA, arn: LAMBDA, name: 'api' };

test('a change is previewed without writing, refused until the user allows agent writes, and applied once (#155)', async () => {
  const subject = await fixture();
  try {
    const created = subject.apmDatabase.createApplication({ name: 'Checkout' });
    const preview = await subject.call('preview_application_change', { application: 'Checkout', operation: 'resources.attach', input: { resources: [lambda] } });
    assert.match(preview.planId, /^plan_/);
    assert.equal(preview.status, 'planned');
    assert.equal(preview.agentWrites, false);
    assert.match(preview.next, /Allow agents to change KUApps/);
    assert.deepEqual(preview.preview.effects.attach.map(item => [item.name, item.state]), [['api', 'new']]);
    assert.equal(preview.preview.effects.collection, 'unchanged');
    assert.equal(subject.apmDatabase.getApplication(created.id).revision, created.revision, 'a preview writes nothing');

    const refused = await subject.call('apply_application_change', { planId: preview.planId, confirm: true });
    assert.match(refused.error, /403 \(AGENT_WRITES_DISABLED\)/);
    assert.match((await subject.call('apply_application_change', { planId: preview.planId, confirm: false })).error, /only after the user approved/);
    // The service checks it too: the client's confirm flag is not trusted to be sent.
    const direct = await subject.ui(`/changes/${preview.planId}/apply`, 'POST', {});
    assert.equal(direct.code, 'CONFIRMATION_REQUIRED');

    subject.agentAccess.set(true);
    const applied = await subject.call('apply_application_change', { planId: preview.planId, confirm: true });
    assert.equal(applied.status, 'applied');
    assert.deepEqual(applied.result.items, [{ name: 'api', outcome: 'attached' }]);
    assert.equal(applied.result.revisionAfter, subject.apmDatabase.getApplication(created.id).revision);

    // Same plan again: the recorded outcome, nothing written twice.
    const again = await subject.call('apply_application_change', { planId: preview.planId, confirm: true });
    assert.equal(again.replayed, true);
    assert.equal(again.result.revisionAfter, applied.result.revisionAfter);
    assert.equal(subject.apmDatabase.listResources(created.id).length, 1);

    const audited = subject.audit.filter(entry => entry.context === 'mcp');
    assert.equal(audited.length, 1);
    assert.deepEqual(Object.keys(audited[0].details).sort(), ['actor', 'applicationId', 'operation', 'planId', 'revisionAfter', 'revisionBefore', 'status']);
    assert.equal(audited[0].details.actor, 'mcp');
    assert.doesNotMatch(JSON.stringify(audited), new RegExp(LAMBDA));
  } finally { await subject.close(); }
});

test('a plan made against an older revision is refused unchanged with the current revision (#155)', async () => {
  const subject = await fixture();
  try {
    subject.agentAccess.set(true);
    const created = subject.apmDatabase.createApplication({ name: 'Checkout', team: 'Payments' });
    const preview = await subject.call('preview_application_change', { application: created.id, operation: 'application.update', input: { team: 'Platform' } });
    assert.deepEqual(preview.preview.effects.update, { team: { from: 'Payments', to: 'Platform' } });

    const edited = await subject.ui(`/applications/${created.id}`, 'PATCH', { environment: 'production' });
    const conflict = await subject.call('apply_application_change', { planId: preview.planId, confirm: true });
    assert.match(conflict.error, new RegExp(`409 \\(REVISION_CONFLICT, current revision ${edited.revision}\\)`));
    assert.equal(subject.apmDatabase.getApplication(created.id).team, 'Payments');
    const state = await subject.call('get_application_change', { planId: preview.planId });
    assert.equal(state.status, 'conflict');
    assert.equal(state.currentRevision, edited.revision);
    // Still refused later: a conflicted plan is not applied by retrying it.
    assert.equal((await subject.call('apply_application_change', { planId: preview.planId, confirm: true })).replayed, true);
    assert.equal(subject.apmDatabase.getApplication(created.id).team, 'Payments');
  } finally { await subject.close(); }
});

test('a lost apply response is read back instead of applied again (#155)', async () => {
  const subject = await fixture();
  try {
    subject.agentAccess.set(true);
    const preview = await subject.call('preview_application_change', { operation: 'application.create', input: { name: 'Billing', scopes: [{ provider: 'kubernetes', scopeId: 'prod' }] } });
    // The apply reached KUA but its response never reached the agent.
    await subject.ui(`/changes/${preview.planId}/apply`, 'POST', { confirm: true });
    const state = await subject.call('get_application_change', { planId: preview.planId });
    assert.equal(state.status, 'applied');
    assert.ok(state.applicationId);
    assert.equal((await subject.call('apply_application_change', { planId: preview.planId, confirm: true })).replayed, true);
    assert.equal(subject.apmDatabase.listApplications().filter(item => item.name === 'Billing').length, 1);
  } finally { await subject.close(); }
});

test('detach and unlink only change the application: no cloud delete, the view and its project stay (#155)', async () => {
  const subject = await fixture();
  try {
    subject.agentAccess.set(true);
    const created = subject.apmDatabase.createApplication({ name: 'Checkout' });
    const project = subject.database.createProject({ name: 'Checkout map', profileId: 'local:dev' });
    const attach = await subject.call('preview_application_change', { application: created.id, operation: 'resources.attach', input: { resources: [lambda, { provider: 'aws', type: 'sqs', key: QUEUE, arn: QUEUE, name: 'orders' }] } });
    await subject.call('apply_application_change', { planId: attach.planId, confirm: true });
    const link = await subject.call('preview_application_change', { application: created.id, operation: 'view.link', input: { projectId: project.id } });
    await subject.call('apply_application_change', { planId: link.planId, confirm: true });

    const [queue] = (await subject.call('list_application_resources', { application: created.id, provider: 'aws' })).resources.filter(item => item.name === 'orders');
    const detach = await subject.call('preview_application_change', { application: created.id, operation: 'resources.detach', input: { resourceIds: [queue.id] } });
    assert.equal(detach.preview.effects.cloud, 'unchanged');
    const detached = await subject.call('apply_application_change', { planId: detach.planId, confirm: true });
    assert.deepEqual(detached.result.items, [{ resourceId: queue.id, outcome: 'detached' }]);
    const names = (await subject.call('list_application_resources', { application: created.id })).resources.map(item => item.name);
    assert.deepEqual(names, ['api']);

    const unlink = await subject.call('preview_application_change', { application: created.id, operation: 'view.unlink', input: { projectId: project.id } });
    await subject.call('apply_application_change', { planId: unlink.planId, confirm: true });
    assert.deepEqual(subject.apmDatabase.getApplication(created.id).architectureProjectIds, []);
    assert.ok(subject.database.getProject(project.id), 'the view itself is kept');

    // No tool can delete infrastructure or an application.
    const { result } = await subject.mcp.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    assert.deepEqual(result.tools.filter(tool => /delete|destroy|remove/i.test(tool.name)), []);
  } finally { await subject.close(); }
});

test('a resource is never accepted by name alone, and unknown or foreign subjects are refused at preview (#155)', async () => {
  const subject = await fixture();
  try {
    const created = subject.apmDatabase.createApplication({ name: 'Checkout' });
    const other = subject.apmDatabase.createApplication({ name: 'Billing' });
    const preview = input => subject.call('preview_application_change', { application: created.id, operation: 'resources.attach', input });
    assert.match((await preview({ resources: [{ provider: 'aws', type: 'lambda', key: 'api', name: 'api' }] })).error, /IDENTITY_REQUIRED.*needs an ARN or "scopeId"/);
    assert.match((await preview({ resources: [{ provider: 'kubernetes', type: 'kubernetes', key: 'payments/deployment/api', name: 'api' }] })).error, /needs "kubeContext"/);
    assert.match((await preview({ resources: [{ name: 'api' }] })).error, /unsupported provider/);

    const theirs = subject.apmDatabase.attachResource(other.id, lambda).resource;
    const foreign = await subject.call('preview_application_change', { application: created.id, operation: 'resources.detach', input: { resourceIds: [theirs.id] } });
    assert.match(foreign.error, /RESOURCE_NOT_FOUND/);
    assert.match((await subject.call('preview_application_change', { application: created.id, operation: 'view.unlink', input: { projectId: 'nope' } })).error, /VIEW_NOT_FOUND/);
    assert.match((await subject.call('preview_application_change', { application: created.id, operation: 'resources.delete', input: {} })).error, /"operation" must be one of/);
    assert.match((await subject.call('get_application_change', { planId: 'plan_missing' })).error, /PLAN_NOT_FOUND/);
  } finally { await subject.close(); }
});
