'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readEntrypoints } = require('./kubeEntrypoints');
const meta = name => ({ name, namespace: 'shop' });
const service = (name, type) => ({ metadata: meta(name), spec: { type, ports: [{ port: 80, targetPort: 8080, nodePort: 30080 }], externalIPs: ['10.0.0.2'] }, status: { loadBalancer: { ingress: [{ hostname: 'internal.example' }, { ip: '10.0.0.2' }] } } });
const ingress = { metadata: meta('web'), spec: {
  ingressClassName: 'alb', tls: [{ hosts: ['shop.example'], secretName: 'never-return' }],
  rules: [{ host: 'shop.example', http: { paths: [{ path: '/api', pathType: 'Prefix', backend: { service: { name: 'api', port: { name: 'http' } } } }] } },
    { host: 'plain.example', http: { paths: [{ path: '/', backend: { service: { name: 'web', port: { number: 80 } } } }] } }],
  defaultBackend: { service: { name: 'fallback', port: { number: 80 } } },
}, status: { loadBalancer: { ingress: [{ hostname: 'my-alb.example' }] } } };

test('reads the selected namespace once per source, maps routes and keeps private addresses honest', async () => {
  const calls = [];
  const result = await readEntrypoints({ core: { listNamespacedService: async ns => { calls.push(['services', ns]); return { body: { items: [service('private', 'LoadBalancer'), service('node', 'NodePort'), service('ignored', 'ClusterIP')] } }; } },
    networking: { listNamespacedIngress: async ns => { calls.push(['ingresses', ns]); return { items: [ingress] }; } } }, 'shop');
  assert.deepEqual(calls.sort(), [['ingresses', 'shop'], ['services', 'shop']]);
  assert.equal(result.entries.length, 3);
  const entry = result.entries.find(e => e.kind === 'Ingress');
  assert.deepEqual(entry.routes.map(r => [r.host, r.path, r.backend, r.tls]), [['shop.example', '/api', 'api:http', true], ['plain.example', '/', 'web:80', false], ['*', '*', 'fallback:80', false]]);
  assert.equal(entry.className, 'alb');
  assert.deepEqual(entry.addresses, ['my-alb.example']);
  assert.ok(!JSON.stringify(result).includes('never-return'));
  assert.deepEqual(result.entries.find(e => e.name === 'private').addresses, ['internal.example', '10.0.0.2']);
  assert.equal(result.entries.find(e => e.name === 'node').ports[0].nodePort, 30080);
  assert.deepEqual(result.unavailable, []);
});

test('cluster inventory degrades independently on RBAC denial without exposing upstream errors', async () => {
  const result = await readEntrypoints({ core: { listServiceForAllNamespaces: async () => ({ items: [service('private', 'LoadBalancer')] }) },
    networking: { listIngressForAllNamespaces: async () => { throw Object.assign(new Error('private upstream details'), { statusCode: 403 }); } } });
  assert.equal(result.entries.length, 1);
  assert.deepEqual(result.unavailable, [{ resource: 'ingresses', reason: 'forbidden' }]);
  assert.ok(!JSON.stringify(result).includes('private upstream details'));
});

test('invalid namespaces make no calls; missing APIs and empty address assignments are explicit', async () => {
  await assert.rejects(readEntrypoints({}, '../secrets'), { statusCode: 400 });
  const result = await readEntrypoints({ core: { listServiceForAllNamespaces: async () => ({ body: { items: [{ metadata: meta('pending'), spec: { type: 'LoadBalancer' } }] } }) }, networking: {} });
  assert.deepEqual(result.entries[0].addresses, []);
  assert.deepEqual(result.unavailable, [{ resource: 'ingresses', reason: 'unavailable' }]);
});
