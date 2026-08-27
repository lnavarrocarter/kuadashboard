'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const express = require('express');
const { ArchitectureDatabase } = require('../lib/architecture/database');
const { createArchitectureRouter } = require('./architecture');

async function fixture({ deploymentReader, inventoryReader, relationshipReader, kubernetesAdapter } = {}) {
  const database = new ArchitectureDatabase({ filePath: ':memory:' });
  const auditEvents = [];
  const app = express();
  app.use(express.json());
  app.use('/api/architecture', createArchitectureRouter({
    database,
    auditLog: { log(event) { auditEvents.push(event); } },
    deploymentReader,
    inventoryReader: inventoryReader || {
      async analyze() {
        return { accountId: '', resources: [], relationships: [], failures: [], requests: 0, truncated: false };
      },
    },
    relationshipReader,
    kubernetesAdapter,
  }));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/architecture`;

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

  return {
    auditEvents,
    request,
    async close() {
      await new Promise(resolve => server.close(resolve));
      database.close();
    },
  };
}

test('API isolates architecture projects and snapshots by profile', async () => {
  const subject = await fixture();
  try {
    const created = await subject.request('/projects', {
      method: 'POST',
      body: { name: 'orders-platform', description: 'Orders architecture' },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.profileId, 'local:dev');

    const hidden = await subject.request(`/projects/${created.body.id}/graph`, { profile: 'local:other' });
    assert.equal(hidden.status, 404);

    const graph = await subject.request(`/projects/${created.body.id}/graph`, {
      method: 'PUT',
      body: {
        expectedRevision: 0,
        document: {
          projectId: created.body.id,
          nodes: [{ id: 'manual:gateway', name: 'Public API', manual: true }],
        },
      },
    });
    assert.equal(graph.status, 200);
    assert.equal(graph.body.revision, 1);

    const snapshot = await subject.request(`/projects/${created.body.id}/snapshots`, {
      method: 'POST', body: { name: 'Initial design' },
    });
    assert.equal(snapshot.status, 201);
    assert.equal(snapshot.body.document.nodes[0].name, 'Public API');
    assert.equal(subject.auditEvents.every(event => event.category === 'architecture'), true);
  } finally {
    await subject.close();
  }
});

test('API reports revision conflicts without overwriting the graph', async () => {
  const subject = await fixture();
  try {
    const created = await subject.request('/projects', { method: 'POST', body: { name: 'payments' } });
    await subject.request(`/projects/${created.body.id}/graph`, {
      method: 'PUT', body: { expectedRevision: 0, document: { projectId: created.body.id } },
    });
    const conflict = await subject.request(`/projects/${created.body.id}/graph`, {
      method: 'PUT', body: { expectedRevision: 0, document: { projectId: created.body.id } },
    });
    assert.equal(conflict.status, 409);
    assert.match(conflict.body.error, /revision conflict/);
  } finally {
    await subject.close();
  }
});

test('API deletes a profile-scoped project with its graph history', async () => {
  const subject = await fixture();
  try {
    const created = await subject.request('/projects', { method: 'POST', body: { name: 'delete-me' } });
    const projectId = created.body.id;
    await subject.request(`/projects/${projectId}/operations`, {
      method: 'POST',
      body: {
        expectedRevision: 0,
        operation: { type: 'node.upsert', value: { id: 'manual:api', name: 'API', manual: true } },
      },
    });
    await subject.request(`/projects/${projectId}/snapshots`, { method: 'POST', body: { name: 'Before delete' } });

    const deleted = await subject.request(`/projects/${projectId}`, { method: 'DELETE' });
    assert.equal(deleted.status, 204);
    assert.equal(await subject.request(`/projects/${projectId}/graph`).then(result => result.status), 404);
    assert.deepEqual(await subject.request('/projects').then(result => result.body), []);
    assert.equal(subject.auditEvents.at(-1).action, 'Project deleted');
  } finally {
    await subject.close();
  }
});

test('API applies typed operations and exposes diff, revert and change history', async () => {
  const subject = await fixture();
  try {
    const created = await subject.request('/projects', { method: 'POST', body: { name: 'checkout' } });
    const projectId = created.body.id;
    const added = await subject.request(`/projects/${projectId}/operations`, {
      method: 'POST',
      body: {
        expectedRevision: 0,
        reason: 'Initial component',
        operation: { type: 'node.upsert', value: { id: 'manual:api', name: 'Checkout API', manual: true } },
      },
    });
    assert.equal(added.status, 200);
    assert.equal(added.body.revision, 1);
    const baseline = await subject.request(`/projects/${projectId}/snapshots`, {
      method: 'POST', body: { name: 'Baseline' },
    });
    await subject.request(`/projects/${projectId}/operations`, {
      method: 'POST',
      body: {
        expectedRevision: 1,
        operation: { type: 'layout.set', value: { 'manual:api': { x: 120, y: 80 } } },
      },
    });

    const diff = await subject.request(`/projects/${projectId}/snapshots/${baseline.body.id}/diff`);
    assert.equal(diff.status, 200);
    assert.equal(diff.body.diff.changeCount, 1);
    const reverted = await subject.request(`/projects/${projectId}/snapshots/${baseline.body.id}/revert`, {
      method: 'POST', body: { expectedRevision: 2, reason: 'Undo layout experiment' },
    });
    assert.equal(reverted.status, 201);
    assert.equal(reverted.body.graph.revision, 3);
    assert.deepEqual(reverted.body.graph.document.layout, {});

    const changes = await subject.request(`/projects/${projectId}/changes`);
    assert.deepEqual(changes.body.map(change => change.type), [
      'snapshot.revert', 'layout.set', 'node.upsert',
    ]);
    assert.equal(changes.body[2].author, 'local:dev');
  } finally {
    await subject.close();
  }
});

test('API requires an expected revision for typed graph mutations', async () => {
  const subject = await fixture();
  try {
    const created = await subject.request('/projects', { method: 'POST', body: { name: 'guarded' } });
    const result = await subject.request(`/projects/${created.body.id}/operations`, {
      method: 'POST',
      body: { operation: { type: 'node.upsert', value: { id: 'manual:api', name: 'API' } } },
    });
    assert.equal(result.status, 400);
    assert.equal(result.body.error, 'expectedRevision must be a non-negative integer');
  } finally {
    await subject.close();
  }
});

test('API previews AWS resources and imports only the confirmed selection', async () => {
  const calls = [];
  const deploymentReader = {
    async listDeployments(input) {
      calls.push(['list', input]);
      return {
        scope: { profileId: input.profileId, region: input.region, accountId: '123456789012' },
        estimate: { awsRequests: 1, kubernetesRequests: 0 },
        deployments: [{ id: 'stack-id', name: 'orders', status: 'UPDATE_COMPLETE' }],
      };
    },
    async preview(input) {
      calls.push(['preview', input]);
      return {
        estimate: { awsRequests: 1, kubernetesRequests: 0 },
        resources: [
          { type: 'lambda', key: 'AWS::Lambda::Function:worker', arn: null, name: 'worker', kind: 'AWS::Lambda::Function', stackName: 'orders', logicalId: 'Worker' },
          { type: 'sqs', key: 'AWS::SQS::Queue:orders', arn: null, name: 'orders', kind: 'AWS::SQS::Queue', stackName: 'orders', logicalId: 'Queue' },
        ],
      };
    },
  };
  const relationshipReader = {
    async analyze() {
      return {
        requests: 1,
        failures: [],
        relationships: [{
          stackName: 'orders', sourceLogicalId: 'Worker', targetLogicalId: 'Queue',
          relationType: 'depends_on', confidence: 0.95,
          evidence: [{ type: 'cloudformation_reference', path: 'Resources.Worker.Properties.Queue', intrinsic: 'Ref' }],
        }],
      };
    },
  };
  const subject = await fixture({ deploymentReader, relationshipReader });
  try {
    const created = await subject.request('/projects', { method: 'POST', body: { name: 'discovered' } });
    const projectId = created.body.id;
    const catalog = await subject.request(`/projects/${projectId}/discovery/aws/deployments?region=us-west-2`);
    assert.equal(catalog.status, 200);
    assert.equal(catalog.body.deployments[0].name, 'orders');

    const preview = await subject.request(`/projects/${projectId}/discovery/aws/preview`, {
      method: 'POST',
      body: { region: 'us-west-2', accountId: '123456789012', stackNames: ['orders'] },
    });
    assert.equal(preview.status, 200);
    assert.equal(preview.body.nodes.length, 2);
    assert.equal(preview.body.relationshipSuggestions.length, 1);
    assert.equal(preview.body.relationshipSuggestions[0].status, 'suggested');

    const imported = await subject.request(`/projects/${projectId}/discovery/aws/import`, {
      method: 'POST',
      body: {
        region: 'us-west-2', accountId: '123456789012', stackNames: ['orders'],
        selectedNodeIds: preview.body.nodes.map(node => node.id), expectedRevision: 0,
      },
    });
    assert.equal(imported.status, 200);
    assert.equal(imported.body.revision, 1);
    assert.deepEqual(imported.body.document.nodes.map(node => node.name), ['worker', 'orders']);
    assert.equal(imported.body.document.edges.length, 1);
    assert.equal(imported.body.document.edges[0].status, 'automatic');

    const reviewed = await subject.request(`/projects/${projectId}/operations`, {
      method: 'POST',
      body: {
        expectedRevision: 1,
        operation: {
          type: 'edge.review', subjectId: imported.body.document.edges[0].id,
          value: { decision: 'reject' },
        },
      },
    });
    assert.equal(reviewed.status, 200);
    assert.equal(reviewed.body.document.edges[0].status, 'rejected');

    const rediscovered = await subject.request(`/projects/${projectId}/discovery/aws/import`, {
      method: 'POST',
      body: {
        region: 'us-west-2', accountId: '123456789012', stackNames: ['orders'],
        selectedNodeIds: preview.body.nodes.map(node => node.id), expectedRevision: 2,
      },
    });
    assert.equal(rediscovered.status, 200);
    assert.equal(rediscovered.body.document.nodes.length, 2);
    assert.equal(rediscovered.body.document.edges.length, 1);
    assert.equal(rediscovered.body.document.edges[0].status, 'rejected');

    const viewUpdated = await subject.request(`/projects/${projectId}/operations`, {
      method: 'POST',
      body: {
        expectedRevision: 3,
        operation: {
          type: 'view.set',
          value: { layoutMode: 'resource-type', layoutDirection: 'vertical', showEdgeLabels: true },
        },
      },
    });
    assert.equal(viewUpdated.status, 200);
    const reloaded = await subject.request(`/projects/${projectId}/graph`);
    assert.deepEqual(reloaded.body.document.view, {
      layoutMode: 'resource-type', layoutDirection: 'vertical', showEdgeLabels: true,
      providerFilter: 'all', kubeContextFilter: '', namespaceFilter: '',
    });
    assert.equal(calls.filter(([type]) => type === 'preview').length, 1);
  } finally {
    await subject.close();
  }
});

test('API returns AWS sync preview without changing graph revision', async () => {
  const deploymentReader = {
    async listDeployments() { return { scope: { accountId: '123456789012' }, estimate: { awsRequests: 1 }, deployments: [] }; },
    async preview() {
      return {
        estimate: { awsRequests: 1, kubernetesRequests: 0 },
        resources: [
          { type: 'lambda', key: 'AWS::Lambda::Function:worker', arn: null, name: 'worker-v2', kind: 'AWS::Lambda::Function', stackName: 'orders', logicalId: 'Worker' },
          { type: 'sqs', key: 'AWS::SQS::Queue:orders', arn: null, name: 'orders', kind: 'AWS::SQS::Queue', stackName: 'orders', logicalId: 'Queue' },
        ],
      };
    },
  };
  const relationshipReader = { async analyze() { return { requests: 0, failures: [], relationships: [] }; } };
  const subject = await fixture({ deploymentReader, relationshipReader });
  try {
    const created = await subject.request('/projects', { method: 'POST', body: { name: 'sync-http' } });
    const projectId = created.body.id;
    const preview = await subject.request(`/projects/${projectId}/discovery/aws/preview`, {
      method: 'POST', body: { region: 'us-east-1', accountId: '123456789012', stackNames: ['orders'] },
    });
    await subject.request(`/projects/${projectId}/discovery/aws/import`, {
      method: 'POST',
      body: {
        region: 'us-east-1', accountId: '123456789012', stackNames: ['orders'],
        selectedNodeIds: [preview.body.nodes[0].id], expectedRevision: 0,
      },
    });

    const sync = await subject.request(`/projects/${projectId}/discovery/aws/sync-preview`, {
      method: 'POST', body: { region: 'us-east-1', accountId: '123456789012', stackNames: ['orders'] },
    });
    const graph = await subject.request(`/projects/${projectId}/graph`);

    assert.equal(sync.status, 200);
    assert.equal(graph.body.revision, 1);
    assert.equal(sync.body.summary.resources.changed, 0);
    assert.equal(sync.body.summary.resources.new, 1);
    assert.equal(sync.body.summary.resources.missing, 0);
  } finally {
    await subject.close();
  }
});

test('API applies an AWS sync atomically and preserves reviewed relationships', async () => {
  const deploymentReader = {
    async listDeployments() { return { scope: { accountId: '123456789012' }, estimate: { awsRequests: 1 }, deployments: [] }; },
    async preview() {
      return {
        estimate: { awsRequests: 1, kubernetesRequests: 0 },
        resources: [{
          type: 'lambda', key: 'AWS::Lambda::Function:worker', arn: 'arn:aws:lambda:us-east-1:123456789012:function:worker', name: 'worker-v2',
          kind: 'AWS::Lambda::Function', stackName: 'orders', logicalId: 'Worker',
        }],
      };
    },
  };
  const relationshipReader = {
    async analyze() {
      return {
        requests: 0,
        failures: [],
        relationships: [{
          stackName: 'orders', sourceLogicalId: 'Worker', targetLogicalId: 'Queue',
          relationType: 'depends_on', confidence: 0.95, evidence: [],
        }],
      };
    },
  };
  const subject = await fixture({ deploymentReader, relationshipReader });
  try {
    const created = await subject.request('/projects', { method: 'POST', body: { name: 'sync-apply' } });
    const projectId = created.body.id;
    const imported = await subject.request(`/projects/${projectId}/operations`, {
      method: 'POST',
      body: {
        expectedRevision: 0,
        operation: {
          type: 'discovery.import',
          value: {
            scopes: [],
            sources: [{ id: 'aws:cloudformation:123456789012:us-east-1:orders', type: 'cloudformation' }],
            nodes: [
              { id: 'manual:previous-worker', name: 'worker', provider: 'aws', accountId: '123456789012', region: 'us-east-1', kind: 'AWS::Lambda::Function', nativeId: 'worker', arn: 'arn:aws:lambda:us-east-1:123456789012:function:worker', sourceId: 'aws:cloudformation:123456789012:us-east-1:orders' },
              { id: 'aws:missing-queue', name: 'queue', provider: 'aws', accountId: '123456789012', region: 'us-east-1', kind: 'AWS::SQS::Queue', nativeId: 'queue', sourceId: 'aws:cloudformation:123456789012:us-east-1:orders' },
            ],
            edges: [{ id: 'edge:reviewed', sourceNodeId: 'manual:previous-worker', targetNodeId: 'aws:missing-queue', relationType: 'depends_on', status: 'rejected' }],
            retiredNodeKinds: [],
          },
        },
      },
    });
    assert.equal(imported.status, 200);

    const synced = await subject.request(`/projects/${projectId}/discovery/aws/sync-apply`, {
      method: 'POST',
      body: { region: 'us-east-1', accountId: '123456789012', stackNames: ['orders'], expectedRevision: 1 },
    });
    assert.equal(synced.status, 200);
    assert.equal(synced.body.revision, 2);
    assert.equal(synced.body.document.nodes.find(node => node.id === 'manual:previous-worker').name, 'worker-v2');
    assert.equal(synced.body.document.nodes.find(node => node.id === 'aws:missing-queue').syncState, 'stale');
    assert.equal(synced.body.document.edges.find(edge => edge.id === 'edge:reviewed').status, 'rejected');
    assert.ok(synced.body.document.sources[0].sync.lastSuccessfulAt);
    assert.deepEqual(synced.body.document.sources[0].sync.selectedStackNames, ['orders']);

    const conflict = await subject.request(`/projects/${projectId}/discovery/aws/sync-apply`, {
      method: 'POST',
      body: { region: 'us-east-1', accountId: '123456789012', stackNames: ['orders'], expectedRevision: 1 },
    });
    assert.equal(conflict.status, 409);
    assert.equal((await subject.request(`/projects/${projectId}/graph`)).body.revision, 2);
  } finally {
    await subject.close();
  }
});

test('API previews Kubernetes topology only for the selected project profile', async () => {
  const calls = [];
  const subject = await fixture({
    kubernetesAdapter: {
      listContexts: () => [{ id: 'eks-dev', name: 'orders-eks' }],
      async preview(input) {
        calls.push(input);
        return { sources: [{ id: 'kubernetes:context:eks-dev', context: 'eks-dev' }], nodes: [], relationships: [], health: [], capabilities: [], failures: [] };
      },
    },
  });
  try {
    const created = await subject.request('/projects', { method: 'POST', body: { name: 'kubernetes' } });
    const contexts = await subject.request(`/projects/${created.body.id}/discovery/kubernetes/contexts`);
    assert.equal(contexts.status, 200);
    assert.deepEqual(contexts.body.contexts, [{ id: 'eks-dev', name: 'orders-eks' }]);

    const preview = await subject.request(`/projects/${created.body.id}/discovery/kubernetes/preview`, {
      method: 'POST', body: { contexts: ['eks-dev'], namespaces: ['orders'] },
    });
    assert.equal(preview.status, 200);
    assert.equal(preview.body.profileId, 'local:dev');
    assert.equal(preview.body.sources[0].profileId, 'local:dev');
    assert.deepEqual(calls, [{ provider: 'generic', contexts: ['eks-dev'], namespaces: ['orders'] }]);
  } finally {
    await subject.close();
  }
});

test('API marks Kubernetes preview resources already present in the project graph', async () => {
  const existingNode = {
    id: 'kubernetes:existing', provider: 'kubernetes', resourceType: 'deployment', kind: 'Deployment',
    name: 'checkout', nativeId: 'uid-checkout', discoveryKey: 'eks-dev/orders/Deployment/checkout',
    kubeContext: 'eks-dev', namespace: 'orders',
  };
  const newNode = {
    id: 'kubernetes:new', provider: 'kubernetes', resourceType: 'deployment', kind: 'Deployment',
    name: 'billing', nativeId: 'uid-billing', discoveryKey: 'eks-dev/orders/Deployment/billing',
    kubeContext: 'eks-dev', namespace: 'orders',
  };
  const subject = await fixture({
    kubernetesAdapter: {
      listContexts: () => [{ id: 'eks-dev', name: 'orders-eks' }],
      async preview() {
        return { sources: [], nodes: [existingNode, newNode], relationships: [], health: [], capabilities: [], failures: [] };
      },
    },
  });
  try {
    const created = await subject.request('/projects', { method: 'POST', body: { name: 'kubernetes' } });
    await subject.request(`/projects/${created.body.id}/graph`, {
      method: 'PUT',
      body: { expectedRevision: 0, document: { projectId: created.body.id, nodes: [existingNode] } },
    });

    const preview = await subject.request(`/projects/${created.body.id}/discovery/kubernetes/preview`, {
      method: 'POST', body: { contexts: ['eks-dev'] },
    });

    assert.equal(preview.status, 200);
    assert.equal(preview.body.nodes.find(node => node.id === 'kubernetes:existing').alreadyInGraph, true);
    assert.equal(preview.body.nodes.find(node => node.id === 'kubernetes:new').alreadyInGraph, false);
  } finally {
    await subject.close();
  }
});