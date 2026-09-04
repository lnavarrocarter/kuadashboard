'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { ArchitectureCloudDiscoveryService } = require('./cloudDiscoveryService');

function graphService() {
  const state = { document: { nodes: [{ id: 'existing', provider: 'gcp', accountId: 'project-a', region: 'us-central1', resourceType: 'gcp-cloud-run', nativeId: 'projects/project-a/locations/us-central1/services/orders' }] } };
  return {
    database: { getGraph() { return state; } },
    get operation() { return state.operation; },
    applyOperation(projectId, operation, options) {
      state.operation = { projectId, operation, options };
      return { revision: 1, document: { nodes: operation.value.nodes, edges: operation.value.edges } };
    },
  };
}

test('cloud discovery marks existing nodes and imports only confirmed resources atomically', async () => {
  const service = graphService();
  const discovery = new ArchitectureCloudDiscoveryService({
    provider: 'gcp', graphService: service,
    reader: { async preview() { return {
      scope: { id: 'gcp:project-a', provider: 'gcp', projectId: 'project-a' },
      sources: [{ id: 'gcp:project:project-a', provider: 'gcp' }],
      nodes: [
        { id: 'run', name: 'orders', provider: 'gcp', accountId: 'project-a', region: 'us-central1', resourceType: 'gcp-cloud-run', nativeId: 'projects/project-a/locations/us-central1/services/orders' },
        { id: 'fn', name: 'worker', provider: 'gcp', accountId: 'project-a', region: 'us-central1', resourceType: 'gcp-function', nativeId: 'projects/project-a/locations/us-central1/functions/worker' },
      ],
      relationships: [{ id: 'edge', sourceNodeId: 'run', targetNodeId: 'fn', relationType: 'invokes' }],
    }; } },
  });

  const preview = await discovery.preview({ profileId: 'profile-a', projectId: 'project-a' });
  assert.equal(preview.nodes[0].alreadyInGraph, true);
  assert.equal(preview.nodes[0].existingNodeId, 'existing');
  assert.equal(preview.nodes[1].alreadyInGraph, false);

  await discovery.importSelection('project-a', {
    profileId: 'profile-a', selectedNodeIds: ['fn'], expectedRevision: 4, author: 'profile-a',
  });
  assert.deepEqual(service.operation.operation.value.nodes.map(node => node.id), ['run', 'fn']);
  assert.equal(service.operation.operation.value.edges.length, 1);
  assert.equal(service.operation.options.expectedRevision, 4);
});
