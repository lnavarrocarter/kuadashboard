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
const { createApmRouter } = require('./apm');
const { createArchitectureRouter } = require('./architecture');

async function fixture({ deploymentReader, eksWorkloadReader, topologyReader, processTracer, kubernetesAdapter } = {}) {
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
  }));
  app.use('/api/architecture', createArchitectureRouter({
    database: architectureDatabase,
    apmDatabase: database,
    auditLog: { log(event) { auditEvents.push(event); } },
    kubernetesAdapter,
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

  return {
    auditEvents,
    database,
    architectureDatabase,
    architectureRequest,
    request,
    async close() {
      await new Promise(resolve => server.close(resolve));
      database.close();
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
