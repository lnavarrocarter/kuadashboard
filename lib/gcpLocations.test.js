'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { listSchedulerJobs, listCloudRunJobs, listTaskQueues } = require('./gcpLocations');

function fakeApi(locationsHost) {
  const urls = [];
  const fetchApi = async url => {
    urls.push(url);
    const path = new URL(url).pathname;
    if (path.endsWith('/locations')) return { locations: [{ name: 'projects/p/locations/us-central1', locationId: 'us-central1' }, { name: 'projects/p/locations/europe-west1' }] };
    if (path.includes('/us-central1/')) return { jobs: [{ name: `${path}/a` }], queues: [{ name: `${path}/q` }] };
    return {};
  };
  return { urls, fetchApi, locationsHost };
}

test('Scheduler reads each location instead of locations/-', async () => {
  const api = fakeApi();
  const r = await listSchedulerJobs(api.fetchApi, { projectId: 'p' });
  assert.equal(r.items.length, 1);
  assert.equal(r.partial, false);
  assert.ok(api.urls.every(u => !u.includes('/locations/-/')));
  assert.ok(api.urls.some(u => u.startsWith('https://cloudscheduler.googleapis.com/v1/projects/p/locations/europe-west1/jobs')));
});

test('Cloud Run jobs take locations from v1 and jobs from v2', async () => {
  const api = fakeApi();
  await listCloudRunJobs(api.fetchApi, { projectId: 'p' });
  assert.equal(api.urls[0], 'https://run.googleapis.com/v1/projects/p/locations');
  assert.ok(api.urls.slice(1).every(u => u.startsWith('https://run.googleapis.com/v2/projects/p/locations/')));
});

test('Cloud Tasks queues use the v2 locations list', async () => {
  const api = fakeApi();
  const r = await listTaskQueues(api.fetchApi, { projectId: 'p' });
  assert.equal(api.urls[0], 'https://cloudtasks.googleapis.com/v2/projects/p/locations');
  assert.equal(r.items.length, 1);
});

test('policy-blocked locations are skipped; other failures make the list partial', async () => {
  const denied = Object.assign(new Error(JSON.stringify({ error: { code: 403, status: 'PERMISSION_DENIED', message: "Permission denied on 'locations/me-central2'",
    details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'LOCATION_POLICY_VIOLATED' }] } })), { code: 403 });
  const flaky = Object.assign(new Error('{"error":{"code":503,"status":"UNAVAILABLE","message":"try later"}}'), { code: 503 });
  const fetchApi = async url => {
    const path = new URL(url).pathname;
    if (path.endsWith('/locations')) return { locations: ['us-central1', 'me-central2', 'asia-east1'].map(locationId => ({ locationId })) };
    if (path.includes('/me-central2/')) throw denied;
    if (path.includes('/asia-east1/')) throw flaky;
    return { jobs: [{ name: 'a' }] };
  };
  const r = await listCloudRunJobs(fetchApi, { projectId: 'p' });
  assert.equal(r.items.length, 1);
  assert.deepEqual(r.skippedLocations, ['me-central2']);
  assert.deepEqual(r.failedLocations, ['asia-east1']);
  assert.equal(r.partial, true);
});

test('when every location fails the real error is thrown', async () => {
  const err = Object.assign(new Error('{"error":{"code":403,"status":"PERMISSION_DENIED","message":"no"}}'), { code: 403 });
  await assert.rejects(listSchedulerJobs(async url => {
    if (new URL(url).pathname.endsWith('/locations')) return { locations: [{ locationId: 'us-central1' }] };
    throw err;
  }, { projectId: 'p' }), /PERMISSION_DENIED/);
});
