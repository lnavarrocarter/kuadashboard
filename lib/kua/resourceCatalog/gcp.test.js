'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createGcpResourceCatalog, typesForName } = require('./gcp');

const PROJECT = 'ncaicloud';

// Fake GCP REST: the first route whose pattern matches the URL answers (an Error is thrown).
function catalog(routes) {
  const urls = [];
  const forgotten = [];
  const subject = createGcpResourceCatalog({
    resolveAuth: async () => ({ projectId: PROJECT }),
    fetchApi: async url => {
      urls.push(url);
      const match = routes.find(([pattern]) => pattern.test(url));
      if (!match) return {};
      if (match[1] instanceof Error) throw match[1];
      return typeof match[1] === 'function' ? match[1](url) : match[1];
    },
    forgetRejectedToken: (profileId, error) => forgotten.push([profileId, error.code]),
  });
  return { subject, urls, forgotten };
}

test('lists VMs, disks, Cloud SQL and buckets with their full resource name and location (#282)', async () => {
  const { subject } = catalog([
    [/aggregated\/instances/, { items: { 'zones/us-central1-a': { instances: [{ name: 'api', zone: `projects/${PROJECT}/zones/us-central1-a`, status: 'RUNNING', machineType: 'zones/us-central1-a/machineTypes/e2-small', disks: [{ source: `projects/${PROJECT}/zones/us-central1-a/disks/api-boot` }] }] }, 'zones/europe-west1-b': {} } }],
    [/aggregated\/disks/, { items: { 'zones/us-central1-a': { disks: [{ name: 'api-boot', zone: `projects/${PROJECT}/zones/us-central1-a`, sizeGb: '20', type: 'zones/us-central1-a/diskTypes/pd-balanced', users: [`projects/${PROJECT}/zones/us-central1-a/instances/api`] }] }, 'regions/us-central1': { disks: [{ name: 'shared', region: `projects/${PROJECT}/regions/us-central1`, sizeGb: '100' }] } } }],
    [/sqladmin/, { items: [{ name: 'orders-db', region: 'us-central1', databaseVersion: 'POSTGRES_15', state: 'RUNNABLE' }] }],
    [/storage\/v1\/b/, { items: [{ name: 'invoices', location: 'US-CENTRAL1', storageClass: 'STANDARD' }] }],
  ]);
  const result = await subject.list({ profileId: 'local:ncaicloud', types: ['gcp-compute-instance', 'gcp-disk', 'gcp-sql', 'gcp-bucket'] });
  assert.equal(result.project, PROJECT);
  const keys = result.items.map(item => [item.type, item.key, item.location]);
  assert.deepEqual(keys, [
    ['gcp-compute-instance', `projects/${PROJECT}/zones/us-central1-a/instances/api`, 'us-central1-a'],
    ['gcp-disk', `projects/${PROJECT}/zones/us-central1-a/disks/api-boot`, 'us-central1-a'],
    ['gcp-disk', `projects/${PROJECT}/regions/us-central1/disks/shared`, 'us-central1'],
    ['gcp-sql', `projects/${PROJECT}/instances/orders-db`, 'us-central1'],
    ['gcp-bucket', 'projects/_/buckets/invoices', 'us-central1'],
  ]);
  const disk = result.items.find(item => item.name === 'api-boot');
  assert.deepEqual([disk.details.sizeGb, disk.details.diskType, disk.details.attachedTo], [20, 'pd-balanced', ['api']]);
  assert.deepEqual(result.items[0].attach, { provider: 'gcp', type: 'gcp-compute-instance', key: `projects/${PROJECT}/zones/us-central1-a/instances/api`, name: 'api', scopeId: PROJECT, location: 'us-central1-a' });
});

test('a disabled API is reported without hiding the other types, and a rejected token is dropped (#282)', async () => {
  const disabled = Object.assign(new Error('{"error":{"message":"Cloud SQL Admin API has not been used in project 1 before or it is disabled"}}'), { code: 403 });
  const expired = Object.assign(new Error('Request had invalid authentication credentials'), { code: 401 });
  const { subject, forgotten } = catalog([
    [/sqladmin/, disabled],
    [/redis/, expired],
    [/pubsub.*topics/, { topics: [{ name: `projects/${PROJECT}/topics/orders` }] }],
  ]);
  const result = await subject.list({ profileId: 'local:ncaicloud', types: ['gcp-sql', 'gcp-memorystore', 'gcp-pubsub-topic'] });
  assert.deepEqual(result.items.map(item => item.key), [`projects/${PROJECT}/topics/orders`]);
  assert.deepEqual(result.failures.sort((a, b) => a.type.localeCompare(b.type)), [{ type: 'gcp-memorystore', code: 'credentials' }, { type: 'gcp-sql', code: 'api_disabled' }]);
  assert.ok(forgotten.some(([profileId, code]) => profileId === 'local:ncaicloud' && code === 401));
});

test('a full resource name resolves only through the types it can be (#282)', async () => {
  const { subject, urls } = catalog([
    [/run\.googleapis\.com\/v2\/.*\/services/, { services: [{ name: `projects/${PROJECT}/locations/us-central1/services/kua-control-plane`, uri: 'https://kua' }] }],
  ]);
  const found = await subject.list({ profileId: 'local:ncaicloud', name: `//run.googleapis.com/projects/${PROJECT}/locations/us-central1/services/kua-control-plane` });
  assert.equal(found.found, true);
  assert.equal(found.items[0].details.uri, 'https://kua');
  assert.ok(urls.every(url => url.includes('run.googleapis.com')), 'only Cloud Run is read');
  await assert.rejects(subject.list({ profileId: 'local:ncaicloud', name: 'projects/x/somethingElse/y' }), error => error.code === 'UNSUPPORTED_NAME');
  assert.deepEqual(typesForName(`projects/${PROJECT}/locations/us-central1/jobs/nightly`), ['gcp-cloud-run-job', 'gcp-scheduler-job']);
  assert.deepEqual(typesForName(`projects/${PROJECT}/instances/orders-db`), ['gcp-sql']);
});
