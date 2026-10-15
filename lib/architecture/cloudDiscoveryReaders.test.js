'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createGcpDiscoveryReader } = require('./gcpDiscoveryReader');
const { createVercelDiscoveryReader } = require('./vercelDiscoveryReader');

const P = 'orders-project';
const ITEMS = [
  { type: 'gcp-cloud-run', name: 'api', key: `projects/${P}/locations/us-central1/services/api`, location: 'us-central1', labels: { app: 'orders', 'goog-terraform-provisioned': 'true' }, details: { uri: 'https://api.run.app' } },
  { type: 'gcp-compute-instance', name: 'worker', key: `projects/${P}/zones/us-central1-a/instances/worker`, location: 'us-central1-a', labels: { app: 'orders' }, details: {} },
  { type: 'gcp-disk', name: 'worker-boot', key: `projects/${P}/zones/us-central1-a/disks/worker-boot`, location: 'us-central1-a', labels: {}, details: { attachedTo: ['worker'] } },
  { type: 'gcp-pubsub-topic', name: 'events', key: `projects/${P}/topics/events`, location: 'global', labels: { app: 'billing' }, details: {} },
  { type: 'gcp-pubsub-subscription', name: 'events-worker', key: `projects/${P}/subscriptions/events-worker`, location: 'global', labels: {}, details: { topic: 'events' } },
  { type: 'gcp-bucket', name: 'invoices', key: 'projects/_/buckets/invoices', location: 'us', labels: {}, details: {} },
];
const fakeCatalog = { async list() { return { project: P, items: ITEMS, failures: [{ type: 'gcp-sql', code: 'api_disabled' }], nextCursor: null }; } };
// Infrastructure Manager: one location, one deployment managing the API, the bucket and a service account.
const infraFetch = async url => {
  if (url.includes('/locations?')) return { locations: [{ name: `projects/${P}/locations/us-central1`, locationId: 'us-central1' }] };
  if (url.includes('/deployments?')) return { deployments: [{ name: `projects/${P}/locations/us-central1/deployments/orders-stack`, state: 'ACTIVE', latestRevision: `projects/${P}/locations/us-central1/deployments/orders-stack/revisions/r-3` }] };
  if (url.includes('/revisions/r-3/resources')) return { resources: [
    { terraformInfo: { address: 'google_cloud_run_v2_service.api', type: 'google_cloud_run_v2_service' }, caiAssets: { 'run.googleapis.com/Service': { fullResourceName: `//run.googleapis.com/projects/${P}/locations/us-central1/services/api` } } },
    { terraformInfo: { address: 'google_storage_bucket.invoices', type: 'google_storage_bucket' }, caiAssets: { 'storage.googleapis.com/Bucket': { fullResourceName: '//storage.googleapis.com/invoices' } } },
    { terraformInfo: { address: 'google_service_account.api', type: 'google_service_account' }, caiAssets: {} },
  ] };
  throw new Error(`unexpected ${url}`);
};
const gcpReader = () => createGcpDiscoveryReader({ resolveAuth: async () => ({ projectId: P }), fetchJson: infraFetch, catalog: fakeCatalog });

test('GCP reader draws every catalog type, with the disk → VM and subscription → topic relationships', async () => {
  const preview = await gcpReader().preview({ profileId: 'gcp-profile' });
  assert.equal(preview.nodes.length, 6);
  assert.equal(preview.scope.projectId, P);
  assert.deepEqual(preview.relationships.map(edge => edge.relationType).sort(), ['attached_to', 'subscribes_to']);
  assert.deepEqual(preview.failures, [{ source: 'gcp-sql', code: 'api_disabled' }]);
  assert.deepEqual(preview.nodes.find(node => node.name === 'api').labels, { app: 'orders', 'goog-terraform-provisioned': 'true' });
});

test('GCP preview limited to an Infrastructure Manager deployment, like a CloudFormation stack', async () => {
  const preview = await gcpReader().preview({ profileId: 'gcp-profile', deployments: ['orders-stack'] });
  assert.deepEqual(preview.nodes.map(node => node.name).sort(), ['api', 'invoices']);
  assert.deepEqual(preview.unmapped, [{ deployment: 'orders-stack', address: 'google_service_account.api', terraformType: 'google_service_account' }]);
  await assert.rejects(gcpReader().preview({ profileId: 'gcp-profile', deployments: ['nope'] }), error => error.code === 'DEPLOYMENT_NOT_FOUND');
});

test('GCP preview limited to labels, and the groups list deployments and labels with counts', async () => {
  const byLabel = await gcpReader().preview({ profileId: 'gcp-profile', labels: ['app=orders'] });
  assert.deepEqual(byLabel.nodes.map(node => node.name).sort(), ['api', 'worker']);
  const byKey = await gcpReader().preview({ profileId: 'gcp-profile', labels: ['goog-terraform-provisioned'] });
  assert.deepEqual(byKey.nodes.map(node => node.name), ['api']);
  const groups = await gcpReader().groups({ profileId: 'gcp-profile' });
  assert.equal(groups.infraManager, 'available');
  assert.deepEqual(groups.deployments.map(item => [item.name, item.location]), [['orders-stack', 'us-central1']]);
  assert.deepEqual(groups.labels[0], { key: 'app', value: 'orders', count: 2 });
});

test('a project without Infrastructure Manager still lists its labels', async () => {
  const disabled = Object.assign(new Error('Infrastructure Manager API has not been used in project 1 before or it is disabled'), { code: 403 });
  const reader = createGcpDiscoveryReader({ resolveAuth: async () => ({ projectId: P }), fetchJson: async () => { throw disabled; }, catalog: fakeCatalog });
  const groups = await reader.groups({ profileId: 'gcp-profile' });
  assert.deepEqual([groups.infraManager, groups.deployments.length, groups.labels.length > 0], ['api_disabled', 0, true]);
  const { catalogKeyOf } = require('./gcpInfraManager');
  assert.equal(catalogKeyOf(`//compute.googleapis.com/projects/${P}/zones/z/instances/vm`), `projects/${P}/zones/z/instances/vm`);
  assert.equal(catalogKeyOf('//storage.googleapis.com/invoices'), 'projects/_/buckets/invoices');
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
