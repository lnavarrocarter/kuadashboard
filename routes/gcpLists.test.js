'use strict';

// End-to-end check of routes/gcp.js list responses (re-evaluation R02): a list
// that is partial (a region failed, or the page cap was reached) must say so in
// the response instead of becoming a normal, complete-looking array.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');

function stubModule(request, exports) {
  const resolved = require.resolve(request);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

stubModule('../lib/gcloudCli', {
  CONFIG_LIST_ARGS: [],
  createGcloudCli: () => ({
    listConfigs: async () => [{ name: 'test', project: 'p', account: 'a@example.com', isActive: true }],
    getAccessToken: async () => 'token',
  }),
});

const router = require('./gcp');

async function get(path) {
  const app = express();
  app.use('/api/cloud/gcp', router);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    return await new Promise((resolve, reject) => {
      http.get({ port, path, headers: { 'X-Profile-Id': 'local:test' } }, res => {
        let body = '';
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
      }).on('error', reject);
    });
  } finally {
    server.close();
  }
}

const json = (status, body) => ({ ok: status < 400, status, headers: { get: () => null }, text: async () => JSON.stringify(body) });

test('a region that fails makes the Artifact Registry list partial and names it', async t => {
  const realFetch = global.fetch;
  t.mock.method(global, 'fetch', async (url, opts) => {
    if (!String(url).includes('googleapis.com')) return realFetch(url, opts);
    const path = new URL(url).pathname;
    if (path.endsWith('/locations')) return json(200, { locations: [{ locationId: 'us-central1' }, { locationId: 'europe-west1' }] });
    if (path.includes('/us-central1/')) return json(200, { repositories: [{ name: 'projects/p/locations/us-central1/repositories/app', format: 'DOCKER' }] });
    return json(503, { error: { code: 503, status: 'UNAVAILABLE', message: 'try later' } });
  });
  const res = await get('/api/cloud/gcp/artifact-registry');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.items.map(r => r.name), ['app']);
  assert.equal(res.body.partial, true);
  assert.deepEqual(res.body.failedLocations, ['europe-west1']);
});

test('a list that reaches the page cap is reported partial (Pub/Sub topics)', async t => {
  const realFetch = global.fetch;
  let page = 0;
  t.mock.method(global, 'fetch', async (url, opts) => {
    if (!String(url).includes('googleapis.com')) return realFetch(url, opts);
    page += 1;
    return json(200, { topics: [{ name: `projects/p/topics/t${page}` }], nextPageToken: `n${page}` });
  });
  const res = await get('/api/cloud/gcp/pubsub/topics');
  assert.equal(res.status, 200);
  assert.equal(res.body.items.length, 20);
  assert.equal(res.body.partial, true);
});

test('a complete list is not partial', async t => {
  const realFetch = global.fetch;
  t.mock.method(global, 'fetch', async (url, opts) => {
    if (!String(url).includes('googleapis.com')) return realFetch(url, opts);
    return json(200, { items: [{ name: 'b1', iamConfiguration: { publicAccessPrevention: 'enforced' } }] });
  });
  const res = await get('/api/cloud/gcp/storage/buckets');
  assert.equal(res.status, 200);
  assert.equal(res.body.items[0].name, 'b1');
  assert.equal(res.body.partial, false);
  assert.deepEqual(res.body.failedLocations, []);
});
