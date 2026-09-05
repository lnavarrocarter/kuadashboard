'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createGcpDiscoveryReader } = require('./gcpDiscoveryReader');
const { createVercelDiscoveryReader } = require('./vercelDiscoveryReader');

test('GCP reader returns Cloud Run and Cloud Functions as architecture resources', async () => {
  const reader = createGcpDiscoveryReader({
    resolveAuth: async () => ({ auth: 'auth', projectId: 'orders-project' }),
    createRunClient: async () => ({ async listServices() { return [[{ name: 'projects/orders-project/locations/us-central1/services/api', uri: 'https://api.run.app', reconciling: false }]]; } }),
    fetchJson: async () => ({ functions: [{ name: 'projects/orders-project/locations/europe-west1/functions/worker', buildConfig: { runtime: 'nodejs22' }, state: 'ACTIVE' }] }),
  });

  const preview = await reader.preview({ profileId: 'gcp-profile' });
  assert.deepEqual(preview.nodes.map(node => [node.resourceType, node.name, node.region]), [
    ['gcp-cloud-run', 'api', 'us-central1'],
    ['gcp-function', 'worker', 'europe-west1'],
  ]);
  assert.equal(preview.scope.projectId, 'orders-project');
});

test('Vercel reader keeps project nodes and deployment evidence in the preview', async () => {
  const calls = [];
  const reader = createVercelDiscoveryReader({
    resolveAuth: async () => ({ token: 'token', teamId: 'team-a' }),
    fetchJson: async path => {
      calls.push(path);
      if (path.includes('/v10/projects')) return { projects: [{ id: 'project-a', name: 'web', framework: 'nextjs', resourceConfig: { functionDefaultRegions: ['iad1'] } }] };
      return { deployments: [{ uid: 'deployment-a', name: 'web', url: 'web.vercel.app', readyState: 'READY', target: 'production' }] };
    },
  });

  const preview = await reader.preview({ profileId: 'vercel-profile' });
  assert.equal(preview.nodes[0].resourceType, 'vercel-project');
  assert.equal(preview.nodes[0].deployments[0].id, 'deployment-a');
  assert.equal(preview.estimate.deployments, 1);
  assert.equal(calls.length, 2);
  assert.ok(calls[1].includes('projectId=project-a'));
});
