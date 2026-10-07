'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createKmsReader } = require('./gcpKms');

test('discovers and paginates concrete locations and their key rings with routing headers', async () => {
  const requests = [];
  const reader = createKmsReader(async (url, auth, method, body, headers) => {
    requests.push({ url, headers });
    const parsed = new URL(url);
    const next = parsed.searchParams.get('pageToken');
    if (parsed.pathname.endsWith('/locations')) return next
      ? { locations: [{ name: 'projects/p/locations/us-central1' }] }
      : { locations: [{ name: 'projects/p/locations/global' }], nextPageToken: 'locations-next' };
    if (parsed.pathname.includes('/global/')) return next
      ? { keyRings: [{ name: 'projects/p/locations/global/keyRings/b' }] }
      : { keyRings: [{ name: 'projects/p/locations/global/keyRings/a' }], nextPageToken: 'rings-next' };
    return { keyRings: [] };
  }, { projectId: 'p' });
  assert.deepEqual((await reader.keyRings()).map(r => r.name), ['projects/p/locations/global/keyRings/a', 'projects/p/locations/global/keyRings/b']);
  assert.equal(requests.length, 5);
  assert.ok(requests.every(r => !r.url.includes('/locations/-/')));
  assert.equal(requests[0].headers['x-goog-request-params'], 'name=projects%2Fp');
  assert.ok(requests.some(r => r.headers['x-goog-request-params'] === 'parent=projects%2Fp%2Flocations%2Fus-central1'));
});

test('paginates keys with the key ring as routing parent', async () => {
  const requests = [];
  const reader = createKmsReader(async (url, auth, method, body, headers) => {
    requests.push({ url, headers });
    return requests.length === 1 ? { cryptoKeys: [{ name: 'a' }], nextPageToken: 'next' } : { cryptoKeys: [{ name: 'b' }] };
  }, { projectId: 'p' });
  assert.deepEqual(await reader.keys('global', 'ring'), [{ name: 'a' }, { name: 'b' }]);
  assert.equal(requests[0].headers['x-goog-request-params'], 'parent=projects%2Fp%2Flocations%2Fglobal%2FkeyRings%2Fring');
  assert.ok(requests[1].url.includes('pageToken=next'));
});

test('propagates permission failures instead of reporting an empty list', async () => {
  const reader = createKmsReader(async () => { throw new Error('permission denied'); }, { projectId: 'p' });
  await assert.rejects(reader.keyRings(), /permission denied/);
});
