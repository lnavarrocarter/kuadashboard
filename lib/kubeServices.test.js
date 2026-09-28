'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  appNameFor, indexEndpointSlices, formatBackends, listServicesWithBackends,
} = require('./kubeServices');

function service(name, { namespace = 'default', type = 'ClusterIP', selector, labels, ...spec } = {}) {
  return {
    metadata: { name, namespace, labels, creationTimestamp: '2026-09-01T00:00:00Z' },
    spec: { type, clusterIP: '10.100.0.1', ports: [{ port: 80, targetPort: 8080, protocol: 'TCP' }], selector, ...spec },
    status: {},
  };
}

function slice(svcName, endpoints, namespace = 'default') {
  return {
    metadata: { name: `${svcName}-abc`, namespace, labels: { 'kubernetes.io/service-name': svcName } },
    endpoints,
  };
}

function fakeClients({ services = [], slices = [], slicesError = null } = {}) {
  const calls = { services: 0, slices: 0, pods: 0 };
  const list = items => ({ body: { items } });
  const core = {
    listNamespacedService: async () => { calls.services++; return list(services); },
    listServiceForAllNamespaces: async () => { calls.services++; return list(services); },
    listNamespacedPod: async () => { calls.pods++; return list([]); },
    readNamespacedService: async () => { throw new Error('per-service read not allowed'); },
  };
  const getSlices = async () => {
    calls.slices++;
    if (slicesError) throw slicesError;
    return list(slices);
  };
  const discovery = {
    listNamespacedEndpointSlice: getSlices,
    listEndpointSliceForAllNamespaces: getSlices,
  };
  return { clients: { core, discovery }, calls };
}

// ── App name ─────────────────────────────────────────────────────────────────

test('app name prefers app.kubernetes.io/name, then app, from the selector', () => {
  assert.equal(appNameFor(service('s', { selector: { app: 'legacy', 'app.kubernetes.io/name': 'api' } })), 'api');
  assert.equal(appNameFor(service('s', { selector: { app: 'web' } })), 'web');
  assert.equal(appNameFor(service('s', { selector: { 'k8s-app': 'kube-dns' } })), 'kube-dns');
});

test('app name falls back to service labels, then "-"', () => {
  assert.equal(appNameFor(service('s', { labels: { app: 'from-labels' } })), 'from-labels');
  assert.equal(appNameFor(service('s', { selector: { tier: 'db' } })), '-');
});

// ── EndpointSlice index ──────────────────────────────────────────────────────

test('indexes ready and not-ready IPs per namespace/service across slices', () => {
  const index = indexEndpointSlices([
    slice('api', [
      { addresses: ['10.0.1.12'], conditions: { ready: true } },
      { addresses: ['10.0.1.9'] }, // unknown readiness counts as ready
      { addresses: ['10.0.1.30'], conditions: { ready: false } },
    ]),
    slice('api', [{ addresses: ['10.0.1.12'], conditions: { ready: true } }]), // duplicate across slices
    slice('api', [{ addresses: ['10.0.2.5'], conditions: { ready: true } }], 'other'),
    { metadata: { name: 'orphan', namespace: 'default', labels: {} }, endpoints: [{ addresses: ['10.9.9.9'] }] },
  ]);
  assert.deepEqual(index.get('default/api'), { ready: ['10.0.1.9', '10.0.1.12'], notReady: ['10.0.1.30'] });
  assert.deepEqual(index.get('other/api'), { ready: ['10.0.2.5'], notReady: [] });
  assert.equal(index.size, 2);
});

test('an IP ready in one slice is not also reported as not ready', () => {
  const index = indexEndpointSlices([
    slice('api', [{ addresses: ['10.0.1.1'], conditions: { ready: false } }]),
    slice('api', [{ addresses: ['10.0.1.1'], conditions: { ready: true } }]),
  ]);
  assert.deepEqual(index.get('default/api'), { ready: ['10.0.1.1'], notReady: [] });
});

// ── Column text ──────────────────────────────────────────────────────────────

test('formats backends: ready, not ready, none, unknown and ExternalName', () => {
  const svc = service('api');
  assert.equal(formatBackends(svc, { ready: ['10.0.1.1', '10.0.1.2'], notReady: [] }), '10.0.1.1, 10.0.1.2');
  assert.equal(formatBackends(svc, { ready: ['10.0.1.1'], notReady: ['10.0.1.3'] }), '10.0.1.1 · not ready: 10.0.1.3');
  assert.equal(formatBackends(svc, undefined), '-');
  assert.equal(formatBackends(svc, undefined, false), '?');
  assert.equal(formatBackends(service('ext', { type: 'ExternalName', externalName: 'db.example.com' }), undefined), '→ db.example.com');
});

// ── Endpoint behaviour ───────────────────────────────────────────────────────

test('keeps existing fields (type, clusterIP, ports, rawPorts) and adds app, selector and backend IPs', async () => {
  const { clients } = fakeClients({
    services: [service('api', { selector: { app: 'api' } })],
    slices: [slice('api', [{ addresses: ['10.0.1.5'], conditions: { ready: true } }])],
  });
  const [row] = await listServicesWithBackends(clients, 'default');
  assert.equal(row.type, 'ClusterIP');
  assert.equal(row.clusterIP, '10.100.0.1');
  assert.equal(row.ports, '80:8080/TCP');
  assert.deepEqual(row.rawPorts, [{ name: '', port: 80, targetPort: 8080, protocol: 'TCP', nodePort: undefined }]);
  assert.deepEqual(row.selector, { app: 'api' });
  assert.equal(row.app, 'api');
  assert.equal(row.backendIPs, '10.0.1.5');
  assert.equal(row.backendReady, 1);
});

test('uses a constant number of API calls regardless of how many services exist (no N+1)', async () => {
  const services = Array.from({ length: 250 }, (_, i) => service(`svc-${i}`, { selector: { app: `app-${i}` } }));
  const slices = services.map((s, i) => slice(s.metadata.name, [{ addresses: [`10.1.${Math.floor(i / 250)}.${i % 250}`] }]));
  const { clients, calls } = fakeClients({ services, slices });

  const rows = await listServicesWithBackends(clients, 'default');

  assert.equal(rows.length, 250);
  assert.deepEqual(calls, { services: 1, slices: 1, pods: 0 });
  assert.equal(rows[42].backendIPs, '10.1.0.42');
});

test('uses the all-namespaces list calls for "all"', async () => {
  const { clients, calls } = fakeClients({
    services: [service('a', { namespace: 'ns1' }), service('a', { namespace: 'ns2' })],
    slices: [slice('a', [{ addresses: ['10.0.0.1'] }], 'ns1'), slice('a', [{ addresses: ['10.0.0.2'] }], 'ns2')],
  });
  const rows = await listServicesWithBackends(clients, 'all');
  assert.deepEqual(rows.map(r => r.backendIPs), ['10.0.0.1', '10.0.0.2']);
  assert.deepEqual(calls, { services: 1, slices: 1, pods: 0 });
});

test('still lists services when EndpointSlices cannot be read (e.g. RBAC)', async () => {
  const { clients } = fakeClients({
    services: [service('api', { selector: { app: 'api' } })],
    slicesError: Object.assign(new Error('forbidden'), { statusCode: 403 }),
  });
  const [row] = await listServicesWithBackends(clients, 'default');
  assert.equal(row.app, 'api');
  assert.equal(row.backendIPs, '?');
});

test('propagates errors listing services', async () => {
  const { clients } = fakeClients();
  clients.core.listNamespacedService = async () => { throw new Error('boom'); };
  await assert.rejects(listServicesWithBackends(clients, 'default'), /boom/);
});
