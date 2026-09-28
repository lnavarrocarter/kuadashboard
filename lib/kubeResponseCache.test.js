'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { KubeResponseCache, kubeMutationScope } = require('./kubeResponseCache');

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

test('invalidates only the affected resource lists across namespaces', () => {
  const cache = new KubeResponseCache();
  cache.write('ctx\u0000/api/default/pods', []);
  cache.write('ctx\u0000/api/all/pods', []);
  cache.write('ctx\u0000/api/default/configmaps', []);
  cache.write('ctx\u0000/api/nodes', []);

  cache.invalidate(['pods']);

  assert.deepEqual([...cache.entries.keys()], ['ctx\u0000/api/default/configmaps', 'ctx\u0000/api/nodes']);
});

test('scopes workload mutations to the workload and its dependents', () => {
  assert.deepEqual(kubeMutationScope('/api/default/pods/api-1'), ['pods', 'events']);
  assert.deepEqual(kubeMutationScope('/api/prod/deployments/web/scale'), ['deployments', 'replicasets', 'pods', 'events']);
  assert.deepEqual(kubeMutationScope('/api/prod/deployments/web/restart'), ['deployments', 'replicasets', 'pods', 'events']);
  assert.deepEqual(kubeMutationScope('/api/prod/configmaps/app/data'), ['configmaps']);
  assert.deepEqual(kubeMutationScope('/api/nodes/node-1/drain'), ['nodes', 'pods', 'events']);
});

test('scopes YAML apply by the applied kind', () => {
  assert.deepEqual(kubeMutationScope('/api/apply', { kind: 'Secret' }), ['secrets']);
  assert.equal(kubeMutationScope('/api/apply', { kind: 'CustomThing' }), null);
  assert.equal(kubeMutationScope('/api/apply'), null);
});

test('port-forwards leave the cache intact and unknown mutations clear it', () => {
  assert.deepEqual(kubeMutationScope('/api/default/services/web/portforward'), []);
  assert.deepEqual(kubeMutationScope('/api/portforward/8080'), []);
  assert.equal(kubeMutationScope('/api/contexts/switch'), null);
  assert.equal(kubeMutationScope('/api/kubeconfig/import'), null);
});

test('cache windows can be changed at runtime from Options', () => {
  const cache = new KubeResponseCache({ freshMs: 15000, staleMs: 120000 });
  cache.write('ctx/ns/pods', [1], 0);
  assert.equal(cache.read('ctx/ns/pods', 20000).state, 'stale');
  cache.configure({ freshMs: 60000, staleMs: 240000 });
  assert.equal(cache.read('ctx/ns/pods', 20000).state, 'fresh');
  assert.equal(cache.read('ctx/ns/pods', 200000).state, 'stale');
  assert.throws(() => cache.configure({ freshMs: 10, staleMs: 5 }), /Invalid cache TTL/);
  assert.equal(cache.freshMs, 60000);
});
