'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const express = require('express');
const { ApmDatabase } = require('../lib/apm/database');
const { ArchitectureDatabase } = require('../lib/architecture/database');
const { normalizeScope } = require('../lib/kua/applicationContract');
const { createApmRouter } = require('./apm');
const { createArchitectureRouter } = require('./architecture');
const { createLogCache } = require('../lib/awsLogCache');
const { ApplicationRegistryService } = require('../lib/kua/applicationRegistryService');
const { PostureStore } = require('../lib/advisor/posture');
const { buildReport, check } = require('../lib/advisor/core');

async function fixture({ deploymentReader, eksWorkloadReader, topologyReader, processTracer, kubernetesAdapter } = {}) {
  // In-memory log cache: tests never touch the user's data directory.
  const logCache = createLogCache({ dataDir: ':memory:' });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kua-apm-api-'));
  const database = new ApmDatabase({
    filePath: path.join(directory, 'apm.sqlite3'),
    now: () => Date.UTC(2026, 7, 4, 12),
  });
  const architectureDatabase = new ArchitectureDatabase({ filePath: ':memory:' });
  const auditEvents = [];
  const scheduler = {
    async collectApplication(applicationId) {
      return {
        skipped: false,
        run: {
          id: 'run-manual', applicationId, status: 'completed', requestCount: 1, backlog: false,
        },
        resources: [],
      };
    },
  };
  const app = express();
  app.use(express.json());
  app.use('/api/observability/aws', createApmRouter({
    database,
    architectureDatabase,
    scheduler,
    auditLog: { log(event) { auditEvents.push(event); } },
    deploymentReader,
    eksWorkloadReader,
    topologyReader,
    processTracer,
    kubernetesAdapter,
    logCache: () => logCache,
  }));
  // Applications without a provider are read through the generic routes (#149, #166).
  app.use('/api/observability/generic', createApmRouter({
    database,
    architectureDatabase,
    scheduler,
    provider: 'generic',
    logCache: () => logCache,
  }));
  app.use('/api/architecture', createArchitectureRouter({
    database: architectureDatabase,
    apmDatabase: database,
    auditLog: { log(event) { auditEvents.push(event); } },
    kubernetesAdapter,
    logCache: () => logCache,
  }));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/observability/aws`;
  const architectureBaseUrl = `http://127.0.0.1:${server.address().port}/api/architecture`;

  async function request(relativePath, { profile = 'local:dev', method = 'GET', body } = {}) {
    const response = await fetch(`${baseUrl}${relativePath}`, {
      method,
      headers: {
        'X-Profile-Id': profile,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }

  async function genericRequest(relativePath, { profile = 'local', method = 'GET', body } = {}) {
    const response = await fetch(`${baseUrl.replace('/aws', '/generic')}${relativePath}`, {
      method,
      headers: { 'X-Profile-Id': profile, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }

  async function architectureRequest(relativePath, { profile = 'local:dev', method = 'GET', body } = {}) {
    const response = await fetch(`${architectureBaseUrl}${relativePath}`, {
      method,
      headers: {
        'X-Profile-Id': profile,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }

  async function architectureCatalogRequest(relativePath) {
    const response = await fetch(`${architectureBaseUrl}${relativePath}`);
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }

  return {
    genericRequest,
    auditEvents,
    database,
    logCache,
    architectureDatabase,
    architectureRequest,
    architectureCatalogRequest,
    request,
    async close() {
      await new Promise(resolve => server.close(resolve));
      database.close();
      logCache.close();
      architectureDatabase.close();
      fs.rmSync(directory, { recursive: true, force: true });
    },
  };
}

test('API scopes applications, resources, topology and collection by profile', async () => {
  const subject = await fixture();
  try {
    const created = await subject.request('/applications', {
      method: 'POST',
      body: { name: 'orders', region: 'us-east-1', environment: 'dev' },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.profileId, 'local:dev');
    const applicationId = created.body.id;

    const usageBeforeCandidates = subject.database.getApiUsage('local:dev').total;
    const candidates = await subject.request('/candidates', {
      method: 'POST',
      body: {
        application: { name: 'payments api', environment: 'dev' },
        resources: [
          { type: 'lambda', name: 'orders-worker', tags: { Application: 'orders' } },
          { type: 'lambda', name: 'payments-api-handler' },
        ],
      },
    });
    assert.equal(candidates.status, 200);
    assert.deepEqual(candidates.body.estimate, { awsRequests: 0, kubernetesRequests: 0 });
    assert.equal(candidates.body.candidates[0].status, 'matched');
    assert.equal(candidates.body.candidates[1].status, 'suggested');
    assert.equal(subject.database.listResources(applicationId).length, 0);
    assert.equal(subject.database.getApiUsage('local:dev').total, usageBeforeCandidates);

    const hidden = await subject.request(`/applications/${applicationId}`, { profile: 'local:other' });
    assert.equal(hidden.status, 404);

    const added = await subject.request(`/applications/${applicationId}/resources`, {
      method: 'POST',
      body: {
        type: 'lambda', key: 'arn:orders', arn: 'arn:orders', name: 'orders',
        logGroup: '/aws/lambda/orders', associationSource: 'tags',
        metadata: { Application: 'orders', privateTag: 'not-a-secret-but-not-audited' },
      },
    });
    assert.equal(added.status, 201);

    const topology = await subject.request(`/applications/${applicationId}/topology`);
    assert.equal(topology.body.resources.length, 1);
    assert.deepEqual(topology.body.edges, []);

    const defaultThresholds = await subject.request(`/applications/${applicationId}/thresholds`);
    assert.equal(defaultThresholds.body.errorRatePercent, 5);
    const updatedThresholds = await subject.request(`/applications/${applicationId}/thresholds`, {
      method: 'PATCH',
      body: { errorRatePercent: 2.5, restartDelta: null },
    });
    assert.equal(updatedThresholds.body.errorRatePercent, 2.5);
    assert.equal(updatedThresholds.body.restartDelta, null);
    const invalidThresholds = await subject.request(`/applications/${applicationId}/thresholds`, {
      method: 'PATCH',
      body: { readyPodsPercent: 101 },
    });
    assert.equal(invalidThresholds.status, 400);

    const overview = await subject.request(`/applications/${applicationId}/overview`);
    assert.equal(overview.body.health.status, 'unknown');

    const forecast = await subject.request(`/applications/${applicationId}/forecast`);
    assert.deepEqual(forecast.body, {
      lambdaCount: 1,
      cadenceMinutes: 30,
      monthlyRequestsExpected: 1440,
      monthlyRequestsMaximum: 2880,
      localMonthlyLimit: 100000,
    });

    const collection = await subject.request(`/applications/${applicationId}/collect-now`, { method: 'POST' });
    assert.equal(collection.status, 200);
    assert.equal(collection.body.run.status, 'completed');
    assert.equal(JSON.stringify(subject.auditEvents).includes('privateTag'), false);
  } finally {
    await subject.close();
  }
});

test('API requires X-Profile-Id and derives profile ownership from the header', async () => {
  const subject = await fixture();
  try {
    const response = await fetch('http://127.0.0.1/').catch(() => null);
    assert.equal(response, null);
    const missing = await fetch(`${await (async () => {
      const result = subject.request('/applications', { profile: '' });
      return result;
    })()}`).catch(() => null);
    assert.equal(missing, null);
    const result = await subject.request('/applications', { profile: '' });
    assert.equal(result.status, 400);
  } finally {
    await subject.close();
  }
});

test('deployment routes pass the profile scope and preserve explicit stack selection', async () => {
  const calls = [];
  const subject = await fixture({
    deploymentReader: {
      async listDeployments(input) {
        calls.push(['list', input]);
        return {
          scope: { ...input, accountId: '073746111526' },
          estimate: { awsRequests: 1, kubernetesRequests: 0 },
          deployments: [{ id: 'stack-1', name: 'orders', status: 'UPDATE_COMPLETE' }],
        };
      },
      async preview(input) {
        calls.push(['preview', input]);
        return {
          estimate: { awsRequests: 1, kubernetesRequests: 0 },
          resources: [{ type: 'sqs', key: 'queue-1', name: 'orders', associationSource: 'deployment' }],
        };
      },
    },
  });
  try {
    const deployments = await subject.request('/deployments?region=us-west-2');
    assert.equal(deployments.status, 200);
    assert.equal(deployments.body.scope.accountId, '073746111526');

    const resources = await subject.request('/deployment-resources', {
      method: 'POST',
      body: { region: 'us-west-2', stackNames: ['orders'] },
    });
    assert.equal(resources.status, 200);
    assert.equal(resources.body.resources[0].associationSource, 'deployment');
    assert.deepEqual(calls, [
      ['list', { profileId: 'local:dev', region: 'us-west-2' }],
      ['preview', { profileId: 'local:dev', region: 'us-west-2', stackNames: ['orders'] }],
    ]);
  } finally {
    await subject.close();
  }
});

test('EKS discovery returns an explicit workload preview', async () => {
  const calls = [];
  const subject = await fixture({
    eksWorkloadReader: {
      async listWorkloads() {
        calls.push('list');
        return {
          estimate: { awsRequests: 0, kubernetesRequests: 3 },
          contexts: ['arn:aws:eks:us-east-1:123:cluster/dev'],
          workloads: [{
            key: 'arn:aws:eks:us-east-1:123:cluster/dev/orders/Deployment/api',
            context: 'arn:aws:eks:us-east-1:123:cluster/dev',
            namespace: 'orders',
            kind: 'Deployment',
            name: 'api',
          }],
        };
      },
    },
  });
  try {
    const result = await subject.request('/eks-workloads');
    assert.equal(result.status, 200);
    assert.equal(result.body.workloads[0].name, 'api');
    assert.deepEqual(result.body.estimate, { awsRequests: 0, kubernetesRequests: 3 });
    assert.deepEqual(calls, ['list']);
  } finally {
    await subject.close();
  }
});

test('cloud topology analysis is explicit and never confirms ASL suggestions automatically', async () => {
  const calls = [];
  const subject = await fixture({
    topologyReader: {
      async analyze(input) {
        calls.push(input);
        return {
          requests: 1,
          unresolvedReferences: [],
          failedResources: [],
          suggestions: [{
            sourceResourceId: 'flow', targetResourceId: 'worker', relationType: 'invokes',
            confidence: 1, confirmed: false,
            evidence: [{ type: 'asl_reference', values: ['Invoke worker', 'orders-worker'] }],
          }],
        };
      },
    },
  });
  try {
    const application = await subject.request('/applications', {
      method: 'POST', body: { name: 'orders', region: 'us-east-1' },
    });
    for (const resource of [
      { id: 'flow', type: 'stepfunctions', key: 'flow', name: 'orders-flow', arn: 'arn:flow', associationSource: 'manual' },
      { id: 'worker', type: 'lambda', key: 'worker', name: 'orders-worker', arn: 'arn:worker', associationSource: 'manual' },
      { id: 'kube', type: 'kubernetes', key: 'orders-eks/orders/Deployment/api', kubeContext: 'orders-eks', namespace: 'orders', kind: 'Deployment', name: 'api', associationSource: 'manual' },
    ]) {
      await subject.request(`/applications/${application.body.id}/resources`, { method: 'POST', body: resource });
    }

    const analysis = await subject.request(`/applications/${application.body.id}/topology/analyze-cloud`, { method: 'POST' });

    assert.equal(analysis.status, 200);
    assert.equal(analysis.body.analysis.suggestions[0].confirmed, false);
    assert.equal(analysis.body.analysis.cloudScan.requests, 1);
    assert.equal(analysis.body.analysis.cloudScan.suggestions[0].relationType, 'invokes');
    assert.equal(subject.database.listEdges(application.body.id).length, 0);
    assert.equal(calls[0].application.profileId, 'local:dev');
    assert.deepEqual(calls[0].resources.map(resource => resource.id).sort(), ['flow', 'worker']);
    assert.equal(analysis.body.resources.some(resource => resource.id === 'kube'), true);
  } finally {
    await subject.close();
  }
});

test('process trace is scoped, explicit and does not persist topology changes', async () => {
  const calls = [];
  const subject = await fixture({
    processTracer: {
      async trace(input) {
        calls.push(input);
        return {
          requests: 3, searchedFlows: 1, inspectedExecutions: 1,
          traces: [{ executionArn: 'arn:execution:one', matchPaths: ['$.requestId'], inputShape: { requestId: 'string' }, timeline: [] }],
        };
      },
    },
  });
  try {
    const application = await subject.request('/applications', {
      method: 'POST', body: { name: 'orders', region: 'us-east-1' },
    });
    await subject.request(`/applications/${application.body.id}/resources`, {
      method: 'POST',
      body: { type: 'stepfunctions', key: 'orders-flow', name: 'orders-flow', arn: 'arn:flow', associationSource: 'manual' },
    });

    const result = await subject.request(`/applications/${application.body.id}/process-traces`, {
      method: 'POST', body: { requestId: 'req-123', includeData: true },
    });

    assert.equal(result.status, 200);
    assert.deepEqual(result.body.traces[0].matchPaths, ['$.requestId']);
    assert.equal(calls[0].application.profileId, 'local:dev');
    assert.equal(calls[0].resources.length, 1);
    assert.equal(calls[0].requestId, 'req-123');
    assert.equal(calls[0].includeData, true);
    assert.equal(subject.database.listEdges(application.body.id).length, 0);
    assert.equal(subject.database.listResources(application.body.id).length, 1);
  } finally {
    await subject.close();
  }
});

test('API links an application to a profile-scoped Architecture project without moving resources', async () => {
  const subject = await fixture();
  try {
    const application = await subject.request('/applications', {
      method: 'POST', body: { name: 'orders', region: 'us-east-1' },
    });
    await subject.request(`/applications/${application.body.id}/resources`, {
      method: 'POST',
      body: { type: 'lambda', key: 'arn:aws:lambda:us-east-1:123:function:orders', arn: 'arn:aws:lambda:us-east-1:123:function:orders', name: 'orders', associationSource: 'manual' },
    });
    const project = subject.architectureDatabase.createProject({ profileId: 'local:dev', name: 'orders-architecture' });
    subject.architectureDatabase.saveGraph(project.id, {
      projectId: project.id,
      nodes: [{ id: 'aws:orders', name: 'orders', provider: 'aws', arn: 'arn:aws:lambda:us-east-1:123:function:orders' }],
    }, { expectedRevision: 0 });
    const foreignProject = subject.architectureDatabase.createProject({ profileId: 'local:other', name: 'other-architecture' });

    const rejected = await subject.request(`/applications/${application.body.id}/architecture-link`, {
      method: 'PATCH', body: { projectId: foreignProject.id },
    });
    assert.equal(rejected.status, 404);

    const linked = await subject.request(`/applications/${application.body.id}/architecture-link`, {
      method: 'PATCH', body: { projectId: project.id },
    });
    assert.equal(linked.status, 200);
    assert.equal(linked.body.application.architectureProjectId, project.id);
    assert.equal(linked.body.resources.matched.length, 1);
    assert.deepEqual(linked.body.resources.unmatched, []);

    const unlinked = await subject.request(`/applications/${application.body.id}/architecture-link`, { method: 'DELETE' });
    assert.equal(unlinked.status, 200);
    assert.equal(unlinked.body.architectureProjectId, null);
    assert.equal(subject.architectureDatabase.getProject(project.id).id, project.id);

    const created = await subject.request(`/applications/${application.body.id}/architecture-link/project`, { method: 'POST' });
    assert.equal(created.status, 201);
    assert.equal(created.body.project.profileId, 'local:dev');
    assert.equal(created.body.application.architectureProjectId, created.body.project.id);
    assert.equal(created.body.graph.revision, 1);
    assert.equal(created.body.graph.document.nodes.length, 1);
    assert.equal(created.body.graph.document.nodes[0].sourceId, `apm:application:${application.body.id}`);
  } finally {
    await subject.close();
  }
});

test('API reconciles linked resources and relationships into one shared registry', async () => {
  const subject = await fixture();
  try {
    const application = await subject.request('/applications', {
      method: 'POST', body: { name: 'checkout', region: 'us-east-1' },
    });
    const applicationId = application.body.id;
    const lambda = await subject.request(`/applications/${applicationId}/resources`, {
      method: 'POST',
      body: { type: 'lambda', key: 'arn:aws:lambda:us-east-1:123:function:checkout', arn: 'arn:aws:lambda:us-east-1:123:function:checkout', name: 'checkout', associationSource: 'manual' },
    });
    const queue = await subject.request(`/applications/${applicationId}/resources`, {
      method: 'POST',
      body: { type: 'sqs', key: 'arn:aws:sqs:us-east-1:123:checkout', arn: 'arn:aws:sqs:us-east-1:123:checkout', name: 'checkout', associationSource: 'manual' },
    });
    await subject.request(`/applications/${applicationId}/edges`, {
      method: 'POST', body: { sourceResourceId: lambda.body.id, targetResourceId: queue.body.id, relationType: 'depends_on' },
    });
    subject.database.upsertMetricBucket({
      resourceId: lambda.body.id, bucketStart: 1000, metricName: 'invocations_observed', sum: 4, count: 1, source: 'test',
    });
    const project = subject.architectureDatabase.createProject({ profileId: 'local:dev', name: 'checkout-architecture' });
    subject.architectureDatabase.saveGraph(project.id, {
      projectId: project.id,
      nodes: [
        { id: 'node:lambda', name: 'checkout', provider: 'aws', accountId: '123', region: 'us-east-1', resourceType: 'lambda', arn: 'arn:aws:lambda:us-east-1:123:function:checkout' },
        { id: 'node:queue', name: 'checkout', provider: 'aws', accountId: '123', region: 'us-east-1', resourceType: 'sqs', arn: 'arn:aws:sqs:us-east-1:123:checkout' },
        { id: 'node:architecture-worker', name: 'checkout-worker', provider: 'aws', accountId: '123', region: 'us-east-1', resourceType: 'lambda', arn: 'arn:aws:lambda:us-east-1:123:function:checkout-worker' },
      ],
      edges: [{ id: 'edge:checkout', sourceNodeId: 'node:lambda', targetNodeId: 'node:queue', relationType: 'depends_on', status: 'automatic' }],
    }, { expectedRevision: 0 });
    subject.database.updateArchitectureProjectLink(applicationId, project.id);

    const reconciled = await subject.request(`/applications/${applicationId}/registry/reconcile`, { method: 'POST' });
    assert.equal(reconciled.status, 200);
    assert.equal(reconciled.body.resources.length, 3);
    assert.equal(reconciled.body.relationships.length, 1);
    const graph = subject.architectureDatabase.getGraph(project.id);
    assert.ok(graph.document.nodes.every(node => node.registryResourceId));
    assert.ok(graph.document.edges[0].registryRelationshipId);
    assert.equal(subject.database.getOverview(applicationId, { from: 0, to: 2000 }).metrics[0].sum, 4);
    assert.deepEqual(subject.database.listResources(applicationId).map(resource => resource.name).sort(), [
      'checkout', 'checkout', 'checkout-worker',
    ]);
    assert.equal(subject.database.listResources(applicationId).find(resource => resource.name === 'checkout-worker').associationSource, 'architecture');
  } finally {
    await subject.close();
  }
});

test('API treats attaching the same resource twice as an idempotent retry', async () => {
  const subject = await fixture();
  try {
    const application = await subject.request('/applications', {
      method: 'POST', body: { name: 'orders', region: 'us-east-1' },
    });
    const path = `/applications/${application.body.id}/resources`;
    const resource = {
      type: 'lambda', key: 'arn:aws:lambda:us-east-1:123:function:orders',
      arn: 'arn:aws:lambda:us-east-1:123:function:orders', name: 'orders-api', associationSource: 'manual',
    };

    const first = await subject.request(path, { method: 'POST', body: resource });
    const retry = await subject.request(path, { method: 'POST', body: resource });

    assert.equal(first.status, 201);
    assert.equal(retry.status, 200);
    assert.equal(retry.body.id, first.body.id);
    assert.equal(subject.database.listResources(application.body.id).length, 1);
    assert.equal(subject.database.listRegistryResources(application.body.id).length, 1);
  } finally {
    await subject.close();
  }
});

test('resource attach, update and detach enforce application revisions', async () => {
  const subject = await fixture();
  try {
    const application = await subject.request('/applications', {
      method: 'POST', body: { name: 'orders', region: 'us-east-1' },
    });
    const resourcePath = `/applications/${application.body.id}/resources`;
    const attached = await subject.request(resourcePath, {
      method: 'POST',
      body: {
        type: 'lambda', key: 'arn:aws:lambda:us-east-1:123:function:orders',
        arn: 'arn:aws:lambda:us-east-1:123:function:orders', name: 'orders-api', expectedRevision: 0,
      },
    });
    assert.equal(attached.status, 201);

    const staleUpdate = await subject.request(`${resourcePath}/${attached.body.id}`, {
      method: 'PATCH', body: { name: 'stale-name', expectedRevision: 0 },
    });
    assert.equal(staleUpdate.status, 409);
    assert.equal(staleUpdate.body.code, 'REVISION_CONFLICT');
    assert.equal(staleUpdate.body.revision, 1);
    assert.equal(subject.database.getResource(attached.body.id).name, 'orders-api');

    const updated = await subject.request(`${resourcePath}/${attached.body.id}`, {
      method: 'PATCH', body: { name: 'orders-api-v2', expectedRevision: 1 },
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.name, 'orders-api-v2');

    const detached = await subject.request(`${resourcePath}/${attached.body.id}?expectedRevision=2`, { method: 'DELETE' });
    assert.equal(detached.status, 204);
    assert.equal(subject.database.getResource(attached.body.id), null);
    assert.equal(subject.database.getApplication(application.body.id).revision, 3);
  } finally {
    await subject.close();
  }
});

test('resource attach records a partial projection failure and succeeds on reconciliation retry', async () => {
  const subject = await fixture();
  try {
    const application = await subject.request('/applications', {
      method: 'POST', body: { name: 'orders', region: 'us-east-1' },
    });
    const project = subject.architectureDatabase.createProject({ profileId: 'local:dev', name: 'orders-architecture' });
    subject.database.updateArchitectureProjectLink(application.body.id, project.id);
    const originalSaveGraph = subject.architectureDatabase.saveGraph.bind(subject.architectureDatabase);
    subject.architectureDatabase.saveGraph = () => { throw new Error('simulated projection failure'); };

    const attached = await subject.request(`/applications/${application.body.id}/resources`, {
      method: 'POST',
      body: {
        type: 'lambda', key: 'arn:aws:lambda:us-east-1:123:function:orders',
        arn: 'arn:aws:lambda:us-east-1:123:function:orders', name: 'orders-api',
      },
    });
    assert.equal(attached.status, 500);
    assert.equal(subject.database.listResources(application.body.id).length, 1);
    assert.equal(subject.database.getRegistrySyncStatus(application.body.id).lastError, 'simulated projection failure');

    subject.architectureDatabase.saveGraph = originalSaveGraph;
    const retried = await subject.request(`/applications/${application.body.id}/registry/reconcile`, { method: 'POST' });
    assert.equal(retried.status, 200);
    assert.equal(retried.body.syncStatus.lastError, null);
    assert.deepEqual(retried.body.resources[0].sources.sort(), ['apm_resource', 'architecture_node']);
  } finally {
    await subject.close();
  }
});

test('detaching a resource preserves its Architecture node without restoring application membership', async () => {
  const subject = await fixture();
  try {
    const application = await subject.request('/applications', {
      method: 'POST', body: { name: 'orders', region: 'us-east-1' },
    });
    const project = subject.architectureDatabase.createProject({ profileId: 'local:dev', name: 'orders-architecture' });
    subject.database.updateArchitectureProjectLink(application.body.id, project.id);
    const resourcePath = `/applications/${application.body.id}/resources`;
    const payload = {
      type: 'lambda', key: 'arn:aws:lambda:us-east-1:123:function:orders',
      arn: 'arn:aws:lambda:us-east-1:123:function:orders', name: 'orders-api',
    };
    const attached = await subject.request(resourcePath, { method: 'POST', body: payload });
    assert.equal(attached.status, 201);
    assert.equal(subject.database.listRegistryResources(application.body.id).length, 1);
    const graph = subject.architectureDatabase.getGraph(project.id);
    subject.architectureDatabase.saveGraph(project.id, {
      ...graph.document,
      nodes: [...graph.document.nodes, {
        id: 'orders-queue', name: 'orders-queue', provider: 'aws', resourceType: 'sqs',
        nativeId: 'arn:aws:sqs:us-east-1:123:orders', arn: 'arn:aws:sqs:us-east-1:123:orders',
        accountId: '123', region: 'us-east-1',
      }],
      edges: [{
        id: 'orders-depends-on-queue', sourceNodeId: graph.document.nodes[0].id,
        targetNodeId: 'orders-queue', relationType: 'depends_on', status: 'manual', decision: 'accepted',
      }],
    }, { expectedRevision: graph.revision });
    await subject.request(`/applications/${application.body.id}/registry/reconcile`, { method: 'POST' });

    const detached = await subject.request(`${resourcePath}/${attached.body.id}`, { method: 'DELETE' });
    assert.equal(detached.status, 204);
    assert.equal(subject.database.getResource(attached.body.id), null);
    const remainingRegistryResources = subject.database.listRegistryResources(application.body.id);
    assert.equal(remainingRegistryResources.length, 1);
    assert.equal(remainingRegistryResources[0].displayName, 'orders-queue');
    const graphAfterDetach = subject.architectureDatabase.getGraph(project.id).document;
    assert.equal(graphAfterDetach.nodes.length, 2, 'detaching membership must not remove the diagram node');
    const detachedNode = graphAfterDetach.nodes.find(node => node.id === `apm-resource:${attached.body.id}`);
    assert.ok(detachedNode);
    assert.equal(detachedNode.registryResourceId, undefined);
    assert.equal(graphAfterDetach.edges[0].status, 'manual');
    assert.equal(graphAfterDetach.edges[0].decision, 'accepted');
    assert.equal(graphAfterDetach.edges[0].registryRelationshipId, undefined);

    const repeatedDetach = await subject.request(`${resourcePath}/${attached.body.id}`, { method: 'DELETE' });
    assert.equal(repeatedDetach.status, 204);

    const reattached = await subject.request(resourcePath, { method: 'POST', body: payload });
    assert.equal(reattached.status, 201);
    assert.equal(subject.database.listRegistryResources(application.body.id).length, 2);
    assert.equal(subject.architectureDatabase.getGraph(project.id).document.nodes.length, 2);
  } finally {
    await subject.close();
  }
});

test('Architecture lets a verified scope profile create and list projects for a providerless application', async () => {
  const subject = await fixture();
  try {
    const application = subject.database.createApplication({ name: 'Checkout' });
    const scope = normalizeScope({ provider: 'aws', scopeId: '123456789012', location: 'us-east-1' });
    subject.database.addApplicationScope(application.id, scope);
    subject.database.setScopeBinding(application.id, scope.key, {
      profileId: 'local:dev', status: 'verified', verifiedIdentity: '123456789012',
    });

    const visibleApplications = await subject.architectureRequest('/applications');
    assert.equal(visibleApplications.status, 200);
    assert.ok(visibleApplications.body.some(item => item.id === application.id));

    const created = await subject.architectureRequest('/projects', {
      method: 'POST', body: { name: 'Checkout view', applicationId: application.id },
    });
    assert.equal(created.status, 201);
    const linkedProjects = await subject.architectureRequest(`/projects?applicationId=${application.id}`);
    assert.deepEqual(linkedProjects.body.map(project => project.id), [created.body.id]);
    const linkedApplications = await subject.architectureRequest(`/projects/${created.body.id}/applications`);
    assert.ok(linkedApplications.body.some(item => item.id === application.id));

    const addedNode = await subject.architectureRequest(`/projects/${created.body.id}/operations`, {
      method: 'POST',
      body: {
        expectedRevision: 0,
        operation: {
          type: 'node.upsert',
          value: {
            id: 'checkout-lambda', name: 'checkout', provider: 'aws', resourceType: 'lambda',
            nativeId: 'arn:aws:lambda:us-east-1:123456789012:function:checkout',
            arn: 'arn:aws:lambda:us-east-1:123456789012:function:checkout',
            accountId: '123456789012', region: 'us-east-1',
          },
        },
      },
    });
    assert.equal(addedNode.status, 200);
    assert.equal(subject.database.listRegistryResources(application.id).length, 1);
    assert.deepEqual(subject.database.listRegistryResources(application.id)[0].sources.sort(), ['apm_resource', 'architecture_node']);
  } finally {
    await subject.close();
  }
});

test('API resolves a Kubernetes workload to one shared registry resource whether observed via APM or discovered by Architecture', async () => {
  const subject = await fixture();
  try {
    const application = await subject.request('/applications', {
      method: 'POST', body: { name: 'orders', region: 'us-east-1' },
    });
    const applicationId = application.body.id;
    await subject.request(`/applications/${applicationId}/resources`, {
      method: 'POST',
      body: {
        type: 'kubernetes', key: 'orders-eks/orders/Deployment/authv1', kubeContext: 'orders-eks',
        namespace: 'orders', kind: 'Deployment', name: 'authv1', associationSource: 'manual',
      },
    });
    const project = subject.architectureDatabase.createProject({ profileId: 'local:dev', name: 'orders-architecture' });
    subject.architectureDatabase.saveGraph(project.id, {
      projectId: project.id,
      nodes: [{
        id: 'kubernetes:deploy-authv1', name: 'authv1', provider: 'kubernetes', resourceType: 'deployment', kind: 'Deployment',
        kubeContext: 'orders-eks', namespace: 'orders', nativeId: 'uid-1234',
        discoveryKey: 'orders-eks/orders/Deployment/authv1',
      }],
      edges: [],
    }, { expectedRevision: 0 });
    subject.database.updateArchitectureProjectLink(applicationId, project.id);

    const reconciled = await subject.request(`/applications/${applicationId}/registry/reconcile`, { method: 'POST' });
    assert.equal(reconciled.status, 200);

    const apmResources = subject.database.listResources(applicationId);
    assert.equal(apmResources.length, 1, 'the manually observed and Architecture-discovered workload must not duplicate');
    assert.equal(apmResources[0].associationSource, 'manual');

    const registryResources = subject.database.listRegistryResources(applicationId);
    assert.equal(registryResources.length, 1);
    assert.deepEqual(registryResources[0].sources.sort(), ['apm_resource', 'architecture_node']);
  } finally {
    await subject.close();
  }
});

test('API lets Observability accept a discovered relationship without opening Architecture', async () => {
  const subject = await fixture();
  try {
    const application = await subject.request('/applications', {
      method: 'POST', body: { name: 'orders', region: 'us-east-1' },
    });
    const applicationId = application.body.id;
    const project = subject.architectureDatabase.createProject({ profileId: 'local:dev', name: 'orders-architecture' });
    subject.architectureDatabase.saveGraph(project.id, {
      projectId: project.id,
      nodes: [
        { id: 'k8s:svc', name: 'api', provider: 'kubernetes', resourceType: 'service', kind: 'Service', kubeContext: 'eks', namespace: 'orders', nativeId: 'uid-svc' },
        { id: 'k8s:pod', name: 'api-1', provider: 'kubernetes', resourceType: 'pod', kind: 'Pod', kubeContext: 'eks', namespace: 'orders', nativeId: 'uid-pod' },
      ],
      // Inferred from naming, so it stays pending review rather than being auto-confirmed.
      edges: [{ id: 'edge-1', sourceNodeId: 'k8s:svc', targetNodeId: 'k8s:pod', relationType: 'calls', status: 'suggested', confidence: 0.75 }],
    }, { expectedRevision: 0 });
    subject.database.updateArchitectureProjectLink(applicationId, project.id);
    await subject.request(`/applications/${applicationId}/registry/reconcile`, { method: 'POST' });

    const registry = await subject.request(`/applications/${applicationId}/registry`);
    const pending = registry.body.relationships.find(item => item.divergent);
    assert.ok(pending, 'the suggested relationship must be listed as pending review');
    // The review table needs to name both ends; the registry rows only store ids.
    assert.equal(pending.sourceName, 'api');
    assert.equal(pending.targetName, 'api-1');

    const reviewed = await subject.request(`/applications/${applicationId}/registry/relationships/${pending.id}/review`, {
      method: 'POST', body: { decision: 'accept' },
    });
    assert.equal(reviewed.status, 200);
    assert.equal(reviewed.body.syncStatus.divergentRelationshipCount, 0);

    // Accepting from Observability must be the same decision the Architecture canvas records.
    const edge = subject.architectureDatabase.getGraph(project.id).document.edges[0];
    assert.equal(edge.status, 'manual');
    assert.equal(edge.decision, 'accepted');
  } finally {
    await subject.close();
  }
});

test('reconciling auto-confirms declared relationships already in the graph, without re-importing', async () => {
  const subject = await fixture();
  try {
    const application = await subject.request('/applications', {
      method: 'POST', body: { name: 'orders', region: 'us-east-1' },
    });
    const applicationId = application.body.id;
    const project = subject.architectureDatabase.createProject({ profileId: 'local:dev', name: 'orders-architecture' });
    subject.architectureDatabase.saveGraph(project.id, {
      projectId: project.id,
      nodes: [
        { id: 'k8s:ing', name: 'public', provider: 'kubernetes', resourceType: 'ingress', kind: 'Ingress', kubeContext: 'eks', namespace: 'orders', nativeId: 'uid-ing' },
        { id: 'k8s:svc', name: 'api', provider: 'kubernetes', resourceType: 'service', kind: 'Service', kubeContext: 'eks', namespace: 'orders', nativeId: 'uid-svc' },
        { id: 'k8s:pod', name: 'api-1', provider: 'kubernetes', resourceType: 'pod', kind: 'Pod', kubeContext: 'eks', namespace: 'orders', nativeId: 'uid-pod' },
      ],
      edges: [
        // The Ingress declares this Service in its own spec: a fact, not a guess.
        { id: 'edge-declared', sourceNodeId: 'k8s:ing', targetNodeId: 'k8s:svc', relationType: 'routes_to', status: 'suggested', confidence: 1 },
        // Inferred from a name found in an environment variable.
        { id: 'edge-inferred', sourceNodeId: 'k8s:svc', targetNodeId: 'k8s:pod', relationType: 'calls', status: 'suggested', confidence: 0.75 },
      ],
    }, { expectedRevision: 0 });
    subject.database.updateArchitectureProjectLink(applicationId, project.id);

    const reconciled = await subject.request(`/applications/${applicationId}/registry/reconcile`, { method: 'POST' });
    assert.equal(reconciled.status, 200);
    assert.equal(reconciled.body.syncStatus.divergentRelationshipCount, 1, 'only the inferred relationship still needs review');

    const edges = subject.architectureDatabase.getGraph(project.id).document.edges;
    assert.equal(edges.find(edge => edge.id === 'edge-declared').status, 'automatic');
    assert.equal(edges.find(edge => edge.id === 'edge-inferred').status, 'suggested');
  } finally {
    await subject.close();
  }
});

test('API annotates registry resources and relationships with correlatable/divergent flags', async () => {
  const subject = await fixture();
  try {
    const application = await subject.request('/applications', {
      method: 'POST', body: { name: 'orders', region: 'us-east-1' },
    });
    const applicationId = application.body.id;
    // No linked Architecture project: a correlatable type (lambda) observed only by APM has nothing
    // to correlate against, so it must show up as genuinely divergent.
    await subject.request(`/applications/${applicationId}/resources`, {
      method: 'POST',
      body: { type: 'lambda', key: 'arn:aws:lambda:us-east-1:123:function:worker', arn: 'arn:aws:lambda:us-east-1:123:function:worker', name: 'worker', associationSource: 'manual' },
    });

    const registry = await subject.request(`/applications/${applicationId}/registry`);
    assert.equal(registry.status, 200);
    const lambdaResource = registry.body.resources.find(resource => resource.resourceType === 'lambda');
    assert.equal(lambdaResource.correlatable, true);
    assert.equal(lambdaResource.divergent, true);
  } finally {
    await subject.close();
  }
});

test('API seeds Architecture with Kubernetes kinds and reconciles later APM membership automatically', async () => {
  const subject = await fixture();
  try {
    const application = await subject.request('/applications', {
      method: 'POST', body: { name: 'orders-kubernetes', region: 'us-east-1' },
    });
    const applicationId = application.body.id;
    await subject.request(`/applications/${applicationId}/resources`, {
      method: 'POST',
      body: { type: 'kubernetes', key: 'orders-eks/orders/Deployment/api', kubeContext: 'orders-eks', namespace: 'orders', kind: 'Deployment', name: 'api', associationSource: 'manual' },
    });
    const created = await subject.request(`/applications/${applicationId}/architecture-link/project`, { method: 'POST' });
    assert.equal(created.status, 201);
    assert.equal(created.body.graph.document.nodes[0].resourceType, 'deployment');
    assert.equal(created.body.graph.document.nodes[0].kubeContext, 'orders-eks');

    const added = await subject.request(`/applications/${applicationId}/resources`, {
      method: 'POST',
      body: { type: 'kubernetes', key: 'orders-eks/orders/Service/api', kubeContext: 'orders-eks', namespace: 'orders', kind: 'Service', name: 'api', associationSource: 'manual' },
    });
    assert.equal(added.status, 201);
    assert.equal(subject.database.listRegistryResources(applicationId).length, 2);
  } finally {
    await subject.close();
  }
});

test('APM changes automatically project compatible resources into an existing Architecture view', async () => {
  const subject = await fixture();
  try {
    const application = await subject.request('/applications', {
      method: 'POST', body: { name: 'serverless', region: 'us-east-1' },
    });
    const project = await subject.architectureRequest('/projects', {
      method: 'POST', body: { name: 'serverless-architecture' },
    });
    const linked = await subject.request(`/applications/${application.body.id}/architecture-link`, {
      method: 'PATCH', body: { projectId: project.body.id },
    });
    assert.equal(linked.status, 200);

    const added = await subject.request(`/applications/${application.body.id}/resources`, {
      method: 'POST',
      body: {
        type: 'lambda', key: 'arn:aws:lambda:us-east-1:123456789012:function:serverless',
        arn: 'arn:aws:lambda:us-east-1:123456789012:function:serverless', name: 'serverless',
        associationSource: 'manual',
      },
    });
    assert.equal(added.status, 201);
    const graph = await subject.architectureRequest(`/projects/${project.body.id}/graph`);
    assert.equal(graph.body.document.nodes.length, 1);
    assert.equal(graph.body.document.nodes[0].resourceType, 'lambda');
    assert.equal(graph.body.document.nodes[0].arn, added.body.arn);
  } finally {
    await subject.close();
  }
});

test('Architecture changes automatically project observable resources into the linked APM application', async () => {
  const subject = await fixture();
  try {
    const application = await subject.request('/applications', {
      method: 'POST', body: { name: 'platform', region: 'us-east-1' },
    });
    const project = await subject.architectureRequest('/projects', {
      method: 'POST', body: { name: 'platform-architecture', applicationId: application.body.id },
    });
    assert.equal(project.status, 201);

    const updated = await subject.architectureRequest(`/projects/${project.body.id}/operations`, {
      method: 'POST',
      body: {
        expectedRevision: 0,
        operation: {
          type: 'node.upsert',
          value: {
            id: 'kube:platform-api', name: 'platform-api', provider: 'kubernetes',
            resourceType: 'deployment', kind: 'Deployment', nativeId: 'eks-dev/platform/Deployment/platform-api',
            kubeContext: 'eks-dev', namespace: 'platform',
          },
        },
      },
    });
    assert.equal(updated.status, 200);

    const resources = subject.database.listResources(application.body.id);
    assert.equal(resources.length, 1);
    assert.deepEqual(resources[0], {
      ...resources[0], type: 'kubernetes', kind: 'Deployment', name: 'platform-api',
      associationSource: 'architecture', kubeContext: 'eks-dev', namespace: 'platform',
    });
  } finally {
    await subject.close();
  }
});

test('Architecture reconciles legacy AWS nodes without an explicit provider', async () => {
  const subject = await fixture();
  try {
    const application = await subject.request('/applications', {
      method: 'POST', body: { name: 'syn agent-call', provider: 'aws', region: 'us-east-1' },
    });
    const project = await subject.architectureRequest('/projects', {
      method: 'POST', body: { name: 'syn-agent-call-architecture', applicationId: application.body.id },
    });
    assert.equal(project.status, 201);

    const updated = await subject.architectureRequest(`/projects/${project.body.id}/operations`, {
      method: 'POST',
      body: {
        expectedRevision: 0,
        operation: {
          type: 'node.upsert',
          value: {
            id: 'aws:agent-call', name: 'agent-call', resourceType: 'lambda',
            arn: 'arn:aws:lambda:us-east-1:123456789012:function:agent-call',
          },
        },
      },
    });
    assert.equal(updated.status, 200);

    const resources = subject.database.listResources(application.body.id);
    assert.equal(resources.length, 1);
    assert.equal(resources[0].provider, 'aws');
    assert.equal(resources[0].type, 'lambda');
    assert.equal(resources[0].name, 'agent-call');
    assert.equal(subject.database.listRegistryResources(application.body.id).length, 1);
  } finally {
    await subject.close();
  }
});

test('Architecture loads and creates the linked project by KUA Application context', async () => {
  const subject = await fixture();
  try {
    const application = await subject.request('/applications', {
      method: 'POST', body: { name: 'application-first', environment: 'prod', team: 'platform', region: 'us-east-1' },
    });
    const applicationId = application.body.id;

    const catalog = await subject.architectureRequest('/applications');
    assert.equal(catalog.status, 200);
    assert.deepEqual(catalog.body.map(item => item.id), [applicationId]);

    const before = await subject.architectureRequest(`/projects?applicationId=${applicationId}`);
    assert.equal(before.status, 200);
    assert.deepEqual(before.body, []);

    const created = await subject.architectureRequest('/projects', {
      method: 'POST', body: { applicationId, name: 'application-first-architecture' },
    });
    assert.equal(created.status, 201);
    assert.equal(subject.database.getApplication(applicationId).architectureProjectId, created.body.id);

    const after = await subject.architectureRequest(`/projects?applicationId=${applicationId}`);
    assert.deepEqual(after.body.map(project => project.id), [created.body.id]);
    const linked = await subject.architectureRequest(`/projects/${created.body.id}/application`);
    assert.equal(linked.body.application.id, applicationId);
    assert.equal(linked.body.application.team, 'platform');
  } finally {
    await subject.close();
  }
});

test('Architecture exposes a cross-provider application catalog before profile selection', async () => {
  const subject = await fixture();
  try {
    const awsApplication = await subject.request('/applications', {
      method: 'POST', body: { name: 'aws-app', region: 'us-east-1' },
    });
    const kubeApplication = subject.database.createApplication({
      provider: 'kubernetes', profileId: 'local:kube', name: 'kube-app', region: 'cluster',
    });

    const catalog = await subject.architectureCatalogRequest('/applications/catalog');
    assert.equal(catalog.status, 200);
    assert.deepEqual(catalog.body.map(item => item.id), [awsApplication.body.id, kubeApplication.id]);
    assert.deepEqual(catalog.body.map(item => item.provider), ['aws', 'kubernetes']);
  } finally {
    await subject.close();
  }
});

test('API returns a read-only profile-scoped Kubernetes adapter preview', async () => {
  const calls = [];
  const subject = await fixture({
    kubernetesAdapter: {
      async preview(input) {
        calls.push(input);
        return {
          sources: [{ id: 'kubernetes:context:dev', context: 'dev' }],
          nodes: [{ id: 'kubernetes:pod', nativeId: 'pod-uid' }],
          relationships: [], health: [{ context: 'dev', status: 'healthy' }], capabilities: [], failures: [],
        };
      },
    },
  });
  try {
    const application = await subject.request('/applications', {
      method: 'POST', body: { name: 'orders', region: 'us-east-1' },
    });
    const preview = await subject.request(`/applications/${application.body.id}/discovery/kubernetes/preview`, {
      method: 'POST', body: { contexts: ['dev'], namespaces: ['orders'] },
    });
    assert.equal(preview.status, 200);
    assert.equal(preview.body.profileId, 'local:dev');
    assert.equal(preview.body.sources[0].profileId, 'local:dev');
    assert.deepEqual(calls, [{ provider: 'aws', contexts: ['dev'], namespaces: ['orders'] }]);
    assert.equal(subject.database.listResources(application.body.id).length, 0);
  } finally {
    await subject.close();
  }
});

test('API lists Kubernetes contexts before a targeted preview', async () => {
  const subject = await fixture({
    kubernetesAdapter: { listContexts: ({ provider }) => [{ id: `${provider}-cluster`, name: 'orders-eks' }] },
  });
  try {
    const application = await subject.request('/applications', { method: 'POST', body: { name: 'orders', region: 'us-east-1' } });
    const contexts = await subject.request(`/applications/${application.body.id}/discovery/kubernetes/contexts`);
    assert.equal(contexts.status, 200);
    assert.deepEqual(contexts.body.contexts, [{ id: 'aws-cluster', name: 'orders-eks' }]);
  } finally {
    await subject.close();
  }
});

test('cached log groups feed the intelligent topology with observed findings and reviewable suggestions', async () => {
  const subject = await fixture();
  try {
    const application = await subject.request('/applications', { method: 'POST', body: { name: 'orders', region: 'us-east-1' } });
    const applicationId = application.body.id;
    for (const body of [
      { type: 'lambda', key: 'arn:aws:lambda:us-east-1:111111111111:function:orders-api', arn: 'arn:aws:lambda:us-east-1:111111111111:function:orders-api', name: 'orders-api', associationSource: 'manual' },
      { type: 'sqs', key: 'arn:aws:sqs:us-east-1:111111111111:orders-queue', arn: 'arn:aws:sqs:us-east-1:111111111111:orders-queue', name: 'orders-queue', associationSource: 'manual' },
      { type: 'lambda', key: 'arn:aws:lambda:us-east-1:111111111111:function:billing', arn: 'arn:aws:lambda:us-east-1:111111111111:function:billing', name: 'billing', associationSource: 'manual' },
    ]) assert.equal((await subject.request(`/applications/${applicationId}/resources`, { method: 'POST', body })).status, 201);

    const now = Date.now();
    const scope = { profileId: 'local:dev', region: 'us-east-1', logGroup: '/aws/lambda/orders-api' };
    subject.logCache.enable(scope);
    await subject.logCache.ingest({ ...scope, events: [
      ...[1, 2, 3, 4].map(i => ({ eventId: `e${i}`, timestamp: now - i * 60000, message: `ERROR timeout sending to https://sqs.us-east-1.amazonaws.com/111111111111/orders-queue after ${i}000 ms token=abc${i}` })),
      { eventId: 'ok', timestamp: now - 1000, message: 'INFO processed order' },
    ] });

    const topology = await subject.request(`/applications/${applicationId}/topology`);
    assert.equal(topology.status, 200);
    const { analysis } = topology.body;
    const codes = analysis.findings.map(finding => finding.code);
    assert.ok(codes.includes('log_error_rate_high'));
    assert.ok(codes.includes('log_recurring_errors'));
    assert.ok(codes.includes('log_failure_keywords'));
    assert.ok(codes.includes('logs_not_cached'), 'billing has no cached logs');
    const signal = analysis.logs.signals[0];
    assert.equal(signal.last24h.events, 5);
    assert.equal(signal.last24h.errors, 4);
    assert.doesNotMatch(signal.recurringErrors[0].sample, /abc1/, 'samples are sanitized');
    const queue = topology.body.resources.find(resource => resource.name === 'orders-queue');
    const suggestion = analysis.suggestions.find(item => item.targetResourceId === queue.id);
    assert.equal(suggestion.relationType, 'sends_to');
    assert.equal(suggestion.confirmed, false);
    assert.equal(suggestion.evidence[0].type, 'observed_log_reference');
    assert.deepEqual(topology.body.edges, [], 'observed evidence never creates edges');
  } finally {
    await subject.close();
  }
});

test('a CloudFormation stack links to an application once and is found from the stack', async () => {
  const previews = [];
  const deploymentReader = {
    async listDeployments() { return { stacks: [] }; },
    async preview({ stackNames, region }) {
      previews.push({ stackNames, region });
      return { resources: [
        { type: 'lambda', key: 'arn:aws:lambda:us-east-1:111111111111:function:orders-fn', arn: 'arn:aws:lambda:us-east-1:111111111111:function:orders-fn', name: 'orders-fn', service: '', kind: 'AWS::Lambda::Function', stackName: 'orders' },
        { type: 'sqs', key: 'arn:aws:sqs:us-east-1:111111111111:orders-q', arn: 'arn:aws:sqs:us-east-1:111111111111:orders-q', name: 'orders-q', service: '', kind: 'AWS::SQS::Queue', stackName: 'orders' },
      ] };
    },
  };
  const subject = await fixture({ deploymentReader });
  try {
    const application = await subject.request('/applications', { method: 'POST', body: { name: 'orders', region: 'us-east-1' } });
    const id = application.body.id;
    const first = await subject.request(`/applications/${id}/link-stack`, { method: 'POST', body: { stackName: 'orders', region: 'us-east-1' } });
    assert.equal(first.status, 200);
    assert.equal(first.body.added, 2);
    assert.equal(subject.database.listResources(id).find(r => r.name === 'orders-fn').logGroup, '/aws/lambda/orders-fn');
    const again = await subject.request(`/applications/${id}/link-stack`, { method: 'POST', body: { stackName: 'orders', region: 'us-east-1' } });
    assert.deepEqual([again.body.added, again.body.alreadyLinked], [0, 2]);
    assert.equal(subject.database.listResources(id).length, 2);

    const links = await subject.request('/stack-applications?stackName=orders&region=us-east-1');
    assert.equal(links.body.linkable, 2);
    assert.deepEqual(links.body.applications.map(a => [a.name, a.matched]), [['orders', 2]]);
    assert.equal((await subject.request('/stack-applications?stackName=1bad')).status, 400);
    assert.ok(subject.auditEvents.some(event => event.action === 'CloudFormation stack linked'));
  } finally {
    await subject.close();
  }
});

test('API returns the product advisor of an application, scoped by profile', async () => {
  const subject = await fixture();
  try {
    const created = await subject.request('/applications', {
      method: 'POST',
      body: { name: 'checkout', region: 'us-east-1', environment: 'production' },
    });
    // Free plan: only the counts of the Advisor (it is a Pro feature). Set explicitly:
    // without KUA_PLAN the plan would come from the account linked on this computer.
    const previousPlan = process.env.KUA_PLAN;
    process.env.KUA_PLAN = 'free';
    const locked = await subject.architectureRequest(`/applications/${created.body.id}/advisor`);
    assert.equal(locked.status, 200);
    assert.equal(locked.body.locked, true);
    assert.equal(locked.body.required, 'pro');
    assert.deepEqual(locked.body.findings, []);
    assert.ok(locked.body.totals.findings >= 5);

    process.env.KUA_PLAN = 'pro';
    let advisor;
    try {
      advisor = await subject.architectureRequest(`/applications/${created.body.id}/advisor`);
    } finally {
      if (previousPlan === undefined) delete process.env.KUA_PLAN; else process.env.KUA_PLAN = previousPlan;
    }
    assert.equal(advisor.status, 200);
    assert.deepEqual(advisor.body.categories, ['product']);
    const ids = advisor.body.findings.map(finding => finding.id);
    for (const id of ['product.no_owner', 'product.no_staging', 'product.no_resources', 'product.default_slos', 'product.no_architecture']) {
      assert.ok(ids.includes(id), `expected ${id}`);
    }
    const otherProfile = await subject.architectureRequest(`/applications/${created.body.id}/advisor`, { profile: 'local:other' });
    assert.equal(otherProfile.status, 404);
  } finally {
    await subject.close();
  }
});

test('product advisor reads cached AWS and Kubernetes logs from each resource scope', async () => {
  const subject = await fixture();
  try {
    const application = subject.database.createApplication({ name: 'checkout', environment: 'production', thresholds: { errorRatePercent: 2 } });
    const awsScope = normalizeScope({ provider: 'aws', scopeId: '111111111111', location: 'us-east-1' });
    const kubeScope = normalizeScope({ provider: 'kubernetes', scopeId: 'orders-prod' });
    subject.database.addApplicationScope(application.id, awsScope);
    subject.database.addApplicationScope(application.id, kubeScope);
    subject.database.setScopeBinding(application.id, awsScope.key, { profileId: 'aws:production', status: 'verified' });
    subject.database.setScopeBinding(application.id, kubeScope.key, { profileId: 'kube:production', status: 'verified' });
    subject.database.addResource(application.id, {
      type: 'lambda', key: 'arn:aws:lambda:us-east-1:111111111111:function:checkout-api',
      arn: 'arn:aws:lambda:us-east-1:111111111111:function:checkout-api', name: 'checkout-api',
    });
    subject.database.addResource(application.id, {
      type: 'kubernetes', key: 'orders-prod/payments/deployment/orders-worker',
      kubeContext: 'orders-prod', namespace: 'payments', kind: 'Deployment', name: 'orders-worker',
    });
    new ApplicationRegistryService({ database: subject.database, architectureDatabase: subject.architectureDatabase }).reconcile(application);
    new PostureStore(subject.database.db).cacheLatest('aws:aws:production:us-east-1', buildReport([
      check({ id: 'aws.public_ip', category: 'security', severity: 'high' }, [
        { kind: 'Lambda', name: 'checkout-api', detail: 'public endpoint' },
        { kind: 'Lambda', name: 'unregistered-function' },
      ]),
    ], { now: Date.now() }));

    const now = Date.now();
    const groups = [
      { profileId: 'aws:production', region: 'us-east-1', logGroup: '/aws/lambda/checkout-api' },
      { profileId: 'k8s:orders-prod', region: 'payments', logGroup: 'payments/deployments/orders-worker' },
    ];
    for (const scope of groups) {
      subject.logCache.enable(scope);
      await subject.logCache.ingest({ ...scope, events: [
        ...[1, 2, 3, 4].map(index => ({ eventId: `${scope.profileId}-${index}`, timestamp: now - index * 1000, message: 'ERROR timeout processing checkout' })),
        { eventId: `${scope.profileId}-ok`, timestamp: now - 500, message: 'INFO checkout completed' },
      ] });
      await subject.logCache.syncGroup({
        ...scope,
        client: { async send() { return { events: [] }; } },
        FilterLogEventsCommand: class { constructor(input) { this.input = input; } },
      });
    }

    const history = await subject.genericRequest(`/applications/${application.id}/log-series?from=${now - 24 * 60 * 60 * 1000}&to=${now}`);
    assert.equal(history.status, 200);
    assert.equal(history.body.coverage.sources.length, 2);
    assert.ok(history.body.points.some(point => point.errorRatePercent === 80));

    const overview = await subject.genericRequest(`/applications/${application.id}/overview`);
    assert.equal(overview.body.health.status, 'degraded');
    assert.ok(overview.body.health.signals.some(signal => signal.metric === 'logErrorRatePercent'));

    const advisor = await subject.architectureRequest(`/applications/${application.id}/advisor`, { profile: 'aws:production' });
    assert.equal(advisor.status, 200);
    const highRate = advisor.body.findings.find(finding => finding.id === 'product.resource_log_rate_high');
    assert.deepEqual(highRate.resources.map(resource => resource.name).sort(), ['checkout-api', 'orders-worker']);
    const recurring = advisor.body.findings.find(finding => finding.id === 'product.resource_recurring_log_errors');
    assert.deepEqual(recurring.resources.map(resource => resource.name).sort(), ['checkout-api', 'orders-worker']);
    const breached = advisor.body.findings.find(finding => finding.id === 'product.slo_breached');
    assert.ok(breached?.resources.some(resource => resource.name === 'Log error rate' && resource.detail === '80 vs ≤ 5'), JSON.stringify(breached));
    assert.ok(advisor.body.errorBudget.objectives.some(objective => objective.source === 'logs' && objective.burnRate > 1));
    assert.deepEqual(advisor.body.technical.findings[0].resources.map(resource => resource.name), ['checkout-api']);
    assert.equal(advisor.body.technical.dora.available, false);
    assert.ok(advisor.body.recommendations.some(item => item.id === 'error_budget_and_technical_risk'));
  } finally {
    await subject.close();
  }
});

test('an application without provider is read through the generic routes by local or a verified scope profile', async () => {
  const { normalizeScope } = require('../lib/kua/applicationContract');
  const subject = await fixture();
  try {
    const application = subject.database.createApplication({ name: 'App360', environment: 'dev' });
    const kube = normalizeScope({ provider: 'kubernetes', scopeId: 'desarrollo' });
    subject.database.addApplicationScope(application.id, kube);
    subject.database.setScopeBinding(application.id, kube.key, { profileId: 'arn:aws:eks:us-east-1:073746111526:cluster/EKS130-360-Dev', status: 'verified' });
    subject.database.addResource(application.id, { type: 'kubernetes', key: 'desarrollo/api/deployment/api', kubeContext: 'arn:aws:eks:us-east-1:073746111526:cluster/EKS130-360-Dev', namespace: 'api', kind: 'Deployment', name: 'api' });

    const listed = await subject.genericRequest('/applications');
    assert.ok(listed.body.some(item => item.id === application.id));
    assert.equal((await subject.genericRequest(`/applications/${application.id}/topology`)).body.resources.length, 1);
    assert.equal((await subject.genericRequest(`/applications/${application.id}/registry`, { profile: 'arn:aws:eks:us-east-1:073746111526:cluster/EKS130-360-Dev' })).status, 200);
    assert.equal((await subject.genericRequest(`/applications/${application.id}/topology`, { profile: 'local:someone-else' })).status, 404);
    assert.equal((await subject.request(`/applications/${application.id}/topology`, { profile: 'local' })).status, 404, 'the AWS routes do not serve it');
    const collected = await subject.genericRequest(`/applications/${application.id}/collect-now`, { method: 'POST' });
    assert.equal(collected.status, 200);
  } finally { await subject.close(); }
});
