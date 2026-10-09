const test = require('node:test');
const assert = require('node:assert/strict');
const { diagnoseServiceBackends, nearMisses, podServices, readPodRelations, selectorMatches } = require('./kubeRelations');

function pod(name, labels, { ready = true, ip = `10.0.0.${name.length}` } = {}) {
  return {
    metadata: { name, namespace: 'backend', labels },
    status: { phase: 'Running', podIP: ip, conditions: [{ type: 'Ready', status: ready ? 'True' : 'False' }] },
  };
}

function service(name, selector, extra = {}) {
  return { metadata: { name, namespace: 'backend' }, spec: { selector, ...extra } };
}

function slice(serviceName, ready = [], notReady = []) {
  return {
    metadata: { namespace: 'backend', labels: { 'kubernetes.io/service-name': serviceName } },
    endpoints: [
      ...ready.map(ip => ({ addresses: [ip], conditions: { ready: true } })),
      ...notReady.map(ip => ({ addresses: [ip], conditions: { ready: false } })),
    ],
  };
}

test('an empty selector never matches', () => {
  assert.equal(selectorMatches({}, { app: 'x' }), false);
  assert.equal(selectorMatches({ app: 'x' }, { app: 'x', tier: 'web' }), true);
});

test('a selector left on an older release reports the near miss', () => {
  const pods = [pod('sot-a', { app: 'sot360-3.9.2', tier: 'api' }), pod('other', { app: 'web' })];
  const result = diagnoseServiceBackends({ service: service('sot', { app: 'sot360-3.9.1', tier: 'api' }), pods, slices: [] });
  assert.equal(result.state, 'no-matching-pods');
  assert.deepEqual(result.nearMisses, [{ pod: 'sot-a', key: 'app', expected: 'sot360-3.9.1', actual: 'sot360-3.9.2' }]);
  assert.deepEqual(result.endpoints, { ready: 0, notReady: 0 });
});

test('matching pods that are not ready are told apart from no match', () => {
  const pods = [pod('web-a', { app: 'web' }, { ready: false, ip: '10.0.0.5' })];
  const result = diagnoseServiceBackends({ service: service('web', { app: 'web' }), pods, slices: [slice('web', [], ['10.0.0.5'])] });
  assert.equal(result.state, 'pods-not-ready');
  assert.equal(result.matchingCount, 1);
  assert.deepEqual(result.endpoints, { ready: 0, notReady: 1 });
  assert.deepEqual(result.nearMisses, []);
});

test('no selector, external names and unreadable endpoints have their own state', () => {
  assert.equal(diagnoseServiceBackends({ service: service('manual', undefined) }).state, 'no-selector');
  assert.equal(diagnoseServiceBackends({ service: service('ext', undefined, { type: 'ExternalName', externalName: 'db.example.com' }) }).state, 'external-name');
  const healthy = diagnoseServiceBackends({ service: service('web', { app: 'web' }), pods: [pod('web-a', { app: 'web' })], slices: null });
  assert.equal(healthy.state, 'ok');
  assert.equal(healthy.endpoints, null);
});

test('near misses ignore pods missing the key entirely', () => {
  assert.deepEqual(nearMisses({ app: 'a', tier: 'b' }, [pod('x', { tier: 'b' })]), []);
});

test('a pod lists the Services that select it and whether it receives traffic', () => {
  const p = pod('web-a', { app: 'web' }, { ip: '10.0.0.9' });
  const services = [service('web', { app: 'web' }), service('admin', { app: 'admin' })];
  assert.deepEqual(podServices(p, services, [slice('web', ['10.0.0.9'])]), [{ name: 'web', readyEndpoint: true }]);
  assert.deepEqual(podServices(p, services, null), [{ name: 'web', readyEndpoint: null }]);
});

test('reads the owner chain up to the Deployment', async () => {
  const p = { ...pod('web-a', { app: 'web' }), metadata: { ...pod('web-a', { app: 'web' }).metadata, ownerReferences: [{ kind: 'ReplicaSet', name: 'web-6f9', controller: true }] }, spec: { nodeName: 'node-1' } };
  const clients = {
    core: {
      readNamespacedPod: async () => ({ body: p }),
      listNamespacedService: async () => ({ body: { items: [service('web', { app: 'web' })] } }),
    },
    apps: { readNamespacedReplicaSet: async () => ({ body: { metadata: { ownerReferences: [{ kind: 'Deployment', name: 'web', controller: true }] } } }) },
    batch: {},
    discovery: { listNamespacedEndpointSlice: async () => { throw new Error('forbidden'); } },
  };
  const relations = await readPodRelations(clients, 'backend', 'web-a');
  assert.deepEqual(relations.owners, [{ kind: 'ReplicaSet', name: 'web-6f9' }, { kind: 'Deployment', name: 'web' }]);
  assert.equal(relations.node, 'node-1');
  assert.deepEqual(relations.services, [{ name: 'web', readyEndpoint: null }]);
});

test('near misses ignore other apps that only share the label key', () => {
  const pods = [
    pod('attencion-a', { app: 'attencion-20261008-155437' }),
    pod('authv1-a', { app: 'authv1-20261008-155437' }),
  ];
  assert.deepEqual(nearMisses({ app: 'attencion-3.9.1' }, pods), [
    { pod: 'attencion-a', key: 'app', expected: 'attencion-3.9.1', actual: 'attencion-20261008-155437' },
  ]);
  assert.deepEqual(nearMisses({ app: 'frontend-shell' }, pods), []);
});
