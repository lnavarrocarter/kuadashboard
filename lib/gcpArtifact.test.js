'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { mapRepository } = require('./gcpArtifact');
const { listArtifactRepositories } = require('./gcpLocations');

test('lists concrete locations and every page instead of locations/-', async () => {
  const urls = [];
  const { items } = await listArtifactRepositories(async url => {
    urls.push(url);
    const path = new URL(url).pathname;
    if (path.endsWith('/locations')) return { locations: [{ name: 'projects/p/locations/us-central1', locationId: 'us-central1' }, { name: 'projects/p/locations/europe-west1' }] };
    if (path.includes('/us-central1/')) return url.includes('pageToken=n')
      ? { repositories: [{ name: 'projects/p/locations/us-central1/repositories/b' }] }
      : { repositories: [{ name: 'projects/p/locations/us-central1/repositories/a' }], nextPageToken: 'n' };
    return {};
  }, { projectId: 'p' });
  assert.deepEqual(items.map(mapRepository).map(r => `${r.location}/${r.name}`), ['us-central1/a', 'us-central1/b']);
  assert.ok(urls.every(u => !u.includes('/locations/-/')));
  assert.equal(urls.length, 4);
});
