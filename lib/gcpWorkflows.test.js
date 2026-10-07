'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { mapWorkflow, listWorkflows } = require('./gcpWorkflows');
test('extracts the workflow region for definition, executions and logs', () => {
  assert.deepEqual(mapWorkflow({ name: 'projects/p/locations/us-central1/workflows/backup', state: 'ACTIVE' }), {
    name: 'backup', location: 'us-central1', state: 'ACTIVE', description: '', created: undefined, updated: undefined, serviceAccount: '', labels: {},
  });
});
test('discovers concrete regions and reads all workflow pages', async () => {
  const requests = [];
  const rows = await listWorkflows(async (url, auth, method, body, headers) => {
    requests.push({ url, headers });
    if (new URL(url).pathname.endsWith('/locations')) return { locations: [{ name: 'projects/p/locations/us-central1' }] };
    return url.includes('pageToken=next') ? { workflows: [{ name: 'second' }] } : { workflows: [{ name: 'first' }], nextPageToken: 'next' };
  }, { projectId: 'p' });
  assert.deepEqual(rows, [{ name: 'first' }, { name: 'second' }]);
  assert.equal(requests.length, 3);
  assert.equal(requests[1].headers['x-goog-request-params'], 'parent=projects%2Fp%2Flocations%2Fus-central1');
  assert.ok(requests.every(r => !r.url.includes('/locations/-/')));
});
test('preserves the disabled API error', async () => {
  await assert.rejects(listWorkflows(async () => { throw Object.assign(new Error('SERVICE_DISABLED'), { code: 403 }); }, { projectId: 'p' }), e => e.code === 403 && e.message === 'SERVICE_DISABLED');
});
