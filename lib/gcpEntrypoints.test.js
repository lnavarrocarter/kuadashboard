'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readGcpEntrypoints } = require('./gcpEntrypoints');

test('collects project entry points and resolves external forwarding rules to configured backends', async () => {
  const calls = [];
  const proxy = 'https://www.googleapis.com/compute/v1/projects/shop/global/targetHttpsProxies/front';
  const backend = 'projects/shop/global/backendServices/web';
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

test('records TLS, HTTPS redirect, Cloud Armor and domain route evidence without guessing on failed reads', async () => {
  const g = 'https://www.googleapis.com/compute/v1/projects/shop/global';
  const objects = {
    '/targetHttpProxies/plain': { urlMap: `${g}/urlMaps/site` },
    '/targetHttpProxies/redirect': { urlMap: `${g}/urlMaps/to-https` },
    '/targetHttpsProxies/default-tls': { urlMap: `${g}/urlMaps/site` },
    '/targetHttpsProxies/modern': { urlMap: `${g}/urlMaps/site`, sslPolicy: `${g}/sslPolicies/modern` },
    '/targetHttpsProxies/legacy': { urlMap: `${g}/urlMaps/site`, sslPolicy: `${g}/sslPolicies/legacy` },
    '/urlMaps/site': { defaultService: `${g}/backendServices/web`, pathMatchers: [{ defaultService: `${g}/backendServices/api` }] },
    '/urlMaps/to-https': { defaultUrlRedirect: { httpsRedirect: true, redirectResponseCode: 'MOVED_PERMANENTLY_DEFAULT' } },
    '/sslPolicies/modern': { minTlsVersion: 'TLS_1_2' },
    '/sslPolicies/legacy': { minTlsVersion: 'TLS_1_1' },
    '/backendServices/web': { securityPolicy: `${g}/securityPolicies/edge` },
    '/backendServices/api': {},
  };
  const rule = (name, proxy) => ({ name, IPAddress: '203.0.113.9', target: `${g}/${proxy}`, loadBalancingScheme: 'EXTERNAL_MANAGED' });
  const result = await readGcpEntrypoints({
    authCtx: { projectId: 'shop' },
    listCloudRun: async () => [{ name: 'web', region: 'us-central1', ingress: 'all' }],
    fetchApi: async url => {
      const path = new URL(url).pathname;
      if (path.endsWith('/domainmappings')) return { items: [
        { metadata: { name: 'shop.example.com', labels: { 'cloud.googleapis.com/location': 'us-central1' } }, spec: { routeName: 'web' } },
        { metadata: { name: 'old.example.com', labels: { 'cloud.googleapis.com/location': 'us-central1' } }, spec: { routeName: 'retired' } },
        { metadata: { name: 'eu.example.com', labels: { 'cloud.googleapis.com/location': 'europe-west1' } }, spec: { routeName: 'web' } },
      ] };
      if (path.endsWith('/aggregated/forwardingRules')) return { items: { global: { forwardingRules: [
        rule('plain', 'targetHttpProxies/plain'), rule('redirect', 'targetHttpProxies/redirect'),
        rule('default-tls', 'targetHttpsProxies/default-tls'), rule('modern', 'targetHttpsProxies/modern'),
        rule('legacy', 'targetHttpsProxies/legacy'), rule('unreadable', 'targetHttpsProxies/missing'),
      ] } } };
      if (path.endsWith('/aggregated/instances')) return { items: {} };
      const object = Object.entries(objects).find(([suffix]) => path.endsWith(suffix));
      if (object) return object[1];
      throw new Error('not found');
    },
  });
  const groups = Object.fromEntries(result.groups.map(group => [group.source, group]));
  const byName = Object.fromEntries(groups.forwardingRules.entries.map(entry => [entry.name, entry]));
  assert.equal(byName.plain.httpsRedirect, false);
  assert.equal(byName.redirect.httpsRedirect, true);
  assert.deepEqual(byName.plain.backendSecurity, [{ name: 'web', securityPolicy: 'edge' }, { name: 'api', securityPolicy: null }]);
  assert.deepEqual(byName['default-tls'].tls, { sslPolicy: null, minTlsVersion: 'TLS_1_0' });
  assert.deepEqual(byName.modern.tls, { sslPolicy: 'modern', minTlsVersion: 'TLS_1_2' });
  assert.deepEqual(byName.legacy.tls, { sslPolicy: 'legacy', minTlsVersion: 'TLS_1_1' });
  assert.equal(byName.unreadable.tls, null);
  assert.deepEqual(byName.unreadable.backendSecurity, []);
  assert.deepEqual(groups.domains.entries.map(entry => [entry.name, entry.routeExists]),
    [['shop.example.com', true], ['old.example.com', false], ['eu.example.com', false]]);
});

test('leaves domain route evidence unknown when Cloud Run services cannot be listed', async () => {
  const result = await readGcpEntrypoints({
    authCtx: { projectId: 'shop' },
    listCloudRun: async () => { throw new Error('permission denied'); },
    fetchApi: async url => url.includes('/domainmappings')
      ? { items: [{ metadata: { name: 'shop.example.com' }, spec: { routeName: 'web' } }] }
      : { items: {} },
  });
  const domains = result.groups.find(group => group.source === 'domains');
  assert.equal(domains.entries[0].routeExists, null);
});
