'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readGcpEntrypoints } = require('./gcpEntrypoints');

test('collects project entry points and resolves external forwarding rules to configured backends', async () => {
  const calls = [];
  const proxy = 'https://www.googleapis.com/compute/v1/projects/shop/global/targetHttpsProxies/front';
  const backend = 'projects/shop/global/backendServices/web';
  const neg = 'https://www.googleapis.com/compute/v1/projects/shop/regions/us-central1/networkEndpointGroups/run-neg';
  const authCtx = { projectId: 'shop' };
  const result = await readGcpEntrypoints({
    authCtx,
    listCloudRun: async () => [
      { name: 'web', region: 'us-central1', ingress: 'all', uri: 'https://web.run.app' },
      { name: 'private', region: 'us-central1', ingress: 'internal' },
    ],
    fetchApi: async (url, ctx) => {
      assert.equal(ctx, authCtx);
      const path = new URL(url);
      calls.push(path.pathname);
      if (path.pathname.endsWith('/domainmappings')) {
        return path.searchParams.has('continue')
          ? { items: [{ metadata: { name: 'second.example.com' }, spec: { routeName: 'web' } }] }
          : { items: [{ metadata: { name: 'shop.example.com' }, spec: { routeName: 'web' } }], metadata: { continue: 'next' } };
      }
      if (path.pathname.endsWith('/aggregated/forwardingRules')) {
        return { items: { global: { forwardingRules: [
          { name: 'https', IPAddress: '203.0.113.1', target: proxy, loadBalancingScheme: 'EXTERNAL_MANAGED' },
          { name: 'https-v6', IPAddress: '2001:db8::1', target: proxy, loadBalancingScheme: 'EXTERNAL_MANAGED' },
          { name: 'tcp', IPAddress: '203.0.113.2', backendService: backend, loadBalancingScheme: 'EXTERNAL' },
          { name: 'private', IPAddress: '10.0.0.1', loadBalancingScheme: 'INTERNAL' },
          { name: 'other', IPAddress: '203.0.113.3', target: proxy.replace('/shop/', '/other/'), loadBalancingScheme: 'EXTERNAL' },
        ] } } };
      }
      if (path.pathname.endsWith('/targetHttpsProxies/front')) return { urlMap: 'projects/shop/global/urlMaps/routes' };
      if (path.pathname.endsWith('/urlMaps/routes')) return { defaultService: backend, pathMatchers: [{ routeRules: [{ routeAction: { weightedBackendServices: [{ backendService: 'projects/shop/global/backendServices/api' }] } }] }] };
      if (path.pathname.endsWith('/backendServices/web')) return { backends: [{ group: neg }] };
      if (path.pathname.endsWith('/backendServices/api')) return { backends: [{ group: neg }] };
      if (path.pathname.endsWith('/networkEndpointGroups/run-neg')) return { region: 'https://www.googleapis.com/compute/v1/projects/shop/regions/us-central1', cloudRun: { service: 'web' } };
      if (path.pathname.endsWith('/aggregated/instances')) return { items: { 'zones/us-central1-a': { instances: [
        { name: 'vm', zone: 'zones/us-central1-a', networkInterfaces: [
          {}, { accessConfigs: [{ natIP: '203.0.113.4' }], ipv6AccessConfigs: [{ externalIpv6: '2001:db8::4' }] },
        ] },
        { name: 'private-vm', networkInterfaces: [{ networkIP: '10.0.0.2' }] },
      ] } } };
      throw new Error('Unexpected request');
    },
  });
  const groups = Object.fromEntries(result.groups.map(group => [group.source, group]));
  assert.equal(result.projectId, 'shop');
  assert.deepEqual(groups.cloudrun.entries.map(entry => entry.name), ['web']);
  assert.equal(groups.domains.entries.length, 2);
  assert.deepEqual(groups.domains.entries[0].destinations, ['web']);
  assert.deepEqual(groups.forwardingRules.entries.map(entry => entry.name), ['https', 'https-v6', 'tcp', 'other']);
  assert.deepEqual(groups.forwardingRules.entries[0].destinations, [backend, 'projects/shop/global/backendServices/api']);
  assert.deepEqual(groups.forwardingRules.entries[0].routes.map(route => [route.backendService, route.service]), [
    [backend, 'projects/shop/locations/us-central1/services/web'],
    ['projects/shop/global/backendServices/api', 'projects/shop/locations/us-central1/services/web'],
  ]);
  assert.equal(groups.forwardingRules.entries[0].nativeId, 'projects/shop/global/forwardingRules/https');
  assert.equal(groups.forwardingRules.entries[3].unresolved, true);
  assert.deepEqual(groups.vms.entries[0].addresses, ['203.0.113.4', '2001:db8::4']);
  assert.equal(groups.vms.entries.length, 1);
  assert.equal(calls.filter(path => path.endsWith('/targetHttpsProxies/front')).length, 1);
  assert.ok(calls.every(path => !path.includes('/other/')));
});

test('retains readable sources when permissions fail or Compute reports incomplete scope coverage', async () => {
  const result = await readGcpEntrypoints({
    authCtx: { projectId: 'shop' },
    listCloudRun: async () => { throw new Error('permission denied'); },
    fetchApi: async url => {
      if (url.includes('/domainmappings')) return { items: [], unreachable: ['us-east1'] };
      if (url.includes('/forwardingRules')) throw new Error('permission denied');
      return { items: { 'zones/us-east1-a': { warning: { code: 'UNREACHABLE' } } } };
    },
  });
  assert.deepEqual(result.groups.map(({ source, status }) => [source, status]), [
    ['cloudrun', 'unavailable'], ['domains', 'partial'], ['forwardingRules', 'unavailable'], ['vms', 'partial'],
  ]);
});
