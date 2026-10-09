'use strict';
// The read-only KUA Application tools (#154) against the real KUApps routes: the MCP server reads
// through the same service and contract as the KUApps UI.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { ArchitectureDatabase } = require('../architecture/database');
const { ApmDatabase } = require('../apm/database');
const { ApplicationRegistryService } = require('../kua/applicationRegistryService');
const { normalizeScope } = require('../kua/applicationContract');
const { createKuaAppsRouter } = require('../../routes/kuaApps');

const NOW = Date.UTC(2026, 9, 9, 12);
const LAMBDA = 'arn:aws:lambda:us-east-1:111111111111:function:api';
const QUEUE = 'arn:aws:sqs:us-east-1:111111111111:orders';

async function fixture() {
  let clock = NOW;
  const database = new ArchitectureDatabase({ filePath: ':memory:' });
  const apmDatabase = new ApmDatabase({ filePath: ':memory:', now: () => clock });
  const registry = new ApplicationRegistryService({ database: apmDatabase, architectureDatabase: database });
  const app = express();
  app.use(express.json());
  app.use('/api/kua-apps', createKuaAppsRouter({ database, apmDatabase, verifier: { verify: async () => ({ status: 'verified', verifiedAt: new Date(NOW).toISOString() }) } }));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { createKuaMcp, httpRequest } = await import('./kuaMcp.mjs');
  const mcp = createKuaMcp({ request: httpRequest(`http://127.0.0.1:${server.address().port}`), version: '9.9.9', now: () => NOW });
  const call = async (name, args) => {
    const result = await mcp.callTool(name, args);
    const text = result.content.map(item => item.text).join('\n');
    return result.isError ? { error: text } : JSON.parse(text);
  };
  return {
    database, apmDatabase, registry, call,
    setClock: time => { clock = time; },
    async close() {
      await new Promise(resolve => server.close(resolve));
      database.close();
      apmDatabase.close();
    },
  };
}

// Checkout: an application without provider, an AWS scope bound to a local profile, a Kubernetes
// scope without one, two views and resources in several signal states.
function checkout(subject) {
  const { apmDatabase, database, registry } = subject;
  const application = apmDatabase.createApplication({ name: 'Checkout', environment: 'production', team: 'Payments' });
  const aws = normalizeScope({ provider: 'aws', scopeId: '111111111111', location: 'us-east-1', label: 'Payments' });
  apmDatabase.addApplicationScope(application.id, aws);
  apmDatabase.addApplicationScope(application.id, normalizeScope({ provider: 'kubernetes', scopeId: 'prod-cluster' }));
  apmDatabase.setScopeBinding(application.id, aws.key, { profileId: 'local:secret-prod', status: 'verified' });

  const views = ['Checkout', 'Checkout data'].map(name => database.createProject({ name, profileId: 'local:secret-prod' }));
  const graph = database.getGraph(views[0].id);
  database.saveGraph(views[0].id, {
    ...graph.document,
    nodes: [
      { id: 'api', name: 'api', provider: 'aws', region: 'us-east-1', accountId: '111111111111', resourceType: 'lambda', arn: LAMBDA, nativeId: LAMBDA },
      { id: 'queue', name: 'orders', provider: 'aws', region: 'us-east-1', accountId: '111111111111', resourceType: 'sqs', arn: QUEUE, nativeId: QUEUE, hidden: true },
    ],
    edges: [{ id: 'api-queue', sourceNodeId: 'api', targetNodeId: 'queue', relationType: 'writes_to', status: 'rejected', decision: 'rejected', confidence: 0.6, evidence: [{ type: 'name_similarity', values: ['raw value'] }] }],
  }, { expectedRevision: graph.revision });
  for (const view of views) apmDatabase.updateArchitectureProjectLink(application.id, view.id);
  registry.attachResource(apmDatabase.getApplication(application.id), {
    provider: 'kubernetes', type: 'kubernetes', kind: 'deployment', key: 'prod-cluster/payments/deployment/worker', kubeContext: 'prod-cluster', namespace: 'payments', name: 'worker',
  });
  registry.reconcile(apmDatabase.getApplication(application.id));
  return { application: apmDatabase.getApplication(application.id), views };
}

test('get_application reads the KUApps contract: scopes with local access, views and signal counts, never a profile (#154)', async () => {
  const subject = await fixture();
  try {
    const { application, views } = checkout(subject);
    const result = await subject.call('get_application', { application: 'checkout' });
    assert.equal(result.id, application.id);
    assert.equal(result.revision, subject.apmDatabase.getApplication(application.id).revision);
    assert.deepEqual(result.scopes.map(scope => [scope.provider, scope.access]).sort(), [['aws', 'verified'], ['kubernetes', 'unbound']]);
    assert.deepEqual(result.views.map(view => view.id).sort(), views.map(view => view.id).sort());
    assert.equal(result.resources.total, 3);
    // Collection of an application without provider starts off; nothing is reported healthy.
    assert.equal(result.resources.bySignalState.current, undefined);
    assert.deepEqual(result.relationships.byStatus, { rejected: 1 });
    assert.ok(result.registryReconciledAt);
    assert.doesNotMatch(JSON.stringify(result), /secret-prod/);
  } finally { await subject.close(); }
});

test('list_application_resources reports identity, scope, sources, signal state and relationships, bounded (#154)', async () => {
  const subject = await fixture();
  try {
    checkout(subject);
    const all = await subject.call('list_application_resources', { application: 'Checkout' });
    assert.equal(all.total, 3);
    assert.equal(all.truncated, false);
    const api = all.resources.find(resource => resource.name === 'api');
    assert.equal(api.nativeIdentifier, LAMBDA);
    assert.deepEqual(api.scope, { scopeId: '111111111111', location: 'us-east-1' });
    assert.deepEqual(api.signals, { state: 'disabled', lastDataAt: null, reason: 'application' });
    assert.deepEqual(api.relationships, [{ direction: 'out', relationType: 'writes_to', status: 'rejected', other: 'orders' }]);
    const worker = all.resources.find(resource => resource.name === 'worker');
    assert.equal(worker.scope.kubeContext, 'prod-cluster');

    const page = await subject.call('list_application_resources', { application: 'Checkout', limit: 1 });
    assert.equal(page.resources.length, 1);
    assert.equal(page.truncated, true);
    assert.equal((await subject.call('list_application_resources', { application: 'Checkout', provider: 'kubernetes' })).total, 1);
    assert.equal((await subject.call('list_application_resources', { application: 'Checkout', state: 'current' })).total, 0);
  } finally { await subject.close(); }
});

test('list_application_resources marks data older than three intervals as stale', async () => {
  const subject = await fixture();
  try {
    const application = subject.apmDatabase.createApplication({ provider: 'aws', profileId: 'local:prod', region: 'us-east-1', name: 'Orders', pollingEnabled: true });
    const { resource } = subject.registry.attachResource(application, { provider: 'aws', type: 'lambda', key: LAMBDA, arn: LAMBDA, name: 'api' });
    // Written a day ago; the route judges freshness at the current time.
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    subject.setClock(dayAgo);
    subject.apmDatabase.upsertMetricBucket({ resourceId: resource.id, bucketStart: dayAgo, metricName: 'Invocations', count: 1, source: 'cloudwatch' });
    const [api] = (await subject.call('list_application_resources', { application: application.id })).resources;
    assert.deepEqual(api.signals, { state: 'stale', lastDataAt: new Date(dayAgo).toISOString() });
  } finally { await subject.close(); }
});

test('get_architecture_graph serves a view of the application with decisions and evidence kinds only (#154)', async () => {
  const subject = await fixture();
  try {
    const { views } = checkout(subject);
    const graph = await subject.call('get_architecture_graph', { application: 'Checkout', view: 'Checkout' });
    assert.equal(graph.view.id, views[0].id);
    assert.ok(graph.view.revision > 0);
    assert.match(graph.note, /not a live read/);
    assert.equal(graph.nodes.find(node => node.id === 'queue').hidden, true);
    assert.ok(graph.nodes.find(node => node.id === 'api').registryResourceId);
    assert.deepEqual(graph.edges.map(edge => [edge.status, edge.decision, edge.evidence]), [['rejected', 'rejected', ['name_similarity']]]);
    assert.doesNotMatch(JSON.stringify(graph), /raw value/);

    const second = await subject.call('get_architecture_graph', { application: 'Checkout', view: views[1].id });
    assert.equal(second.view.name, 'Checkout data');
    const bounded = await subject.call('get_architecture_graph', { application: 'Checkout', limit: 1 });
    assert.deepEqual([bounded.nodes.length, bounded.truncated, bounded.edges.length], [1, true, 0]);
    const unknown = await subject.call('get_architecture_graph', { application: 'Checkout', view: 'Billing' });
    assert.match(unknown.error, /has no view "Billing"\. Its views: /);
  } finally { await subject.close(); }
});

test('the tools never serve another application and explain what to do when nothing matches (#154)', async () => {
  const subject = await fixture();
  try {
    const { application } = checkout(subject);
    const other = subject.apmDatabase.createApplication({ name: 'Billing' });
    const foreign = subject.database.createProject({ name: 'Billing map', profileId: 'local:dev' });
    subject.apmDatabase.updateArchitectureProjectLink(other.id, foreign.id);
    subject.apmDatabase.createApplication({ name: 'Checkout', environment: 'staging' });

    const ambiguous = await subject.call('get_application', { application: 'Checkout' });
    assert.match(ambiguous.error, /Several KUA Applications are named "Checkout"; pass the id: /);
    assert.match((await subject.call('get_application', { application: 'nope' })).error, /No KUA Application "nope"\. Available: /);
    assert.match((await subject.call('get_application', {})).error, /"application" is required/);
    assert.match((await subject.call('get_architecture_graph', { application: other.id, view: application.architectureProjectIds[0] })).error, /has no view/);

    const noViews = subject.apmDatabase.createApplication({ name: 'Empty' });
    assert.match((await subject.call('get_architecture_graph', { application: noViews.id })).error, /has no architecture view/);
    const empty = await subject.call('get_application', { application: noViews.id });
    assert.deepEqual([empty.resources.total, empty.views], [0, []]);
    assert.match(empty.notes.join(' '), /no resources yet/);
  } finally { await subject.close(); }
});
