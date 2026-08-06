'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { KubeResponseCache } = require('./kubeResponseCache');

test('reports fresh and stale cache entries using their TTL', () => {
  const cache = new KubeResponseCache({ freshMs: 100, staleMs: 300 });
  cache.write('pods', [{ name: 'api' }], 1000);

  assert.equal(cache.read('pods', 1050).state, 'fresh');
  assert.equal(cache.read('pods', 1150).state, 'stale');
  assert.deepEqual(cache.read('pods', 1150).value, [{ name: 'api' }]);
});

test('removes entries after the stale window', () => {
  const cache = new KubeResponseCache({ freshMs: 100, staleMs: 300 });
  cache.write('pods', [], 1000);

  assert.equal(cache.read('pods', 1301), null);
  assert.equal(cache.entries.size, 0);
});

test('clears all entries after a mutation', () => {
  const cache = new KubeResponseCache();
  cache.write('pods', []);
  cache.write('nodes', []);

  cache.clear();

  assert.equal(cache.entries.size, 0);
});