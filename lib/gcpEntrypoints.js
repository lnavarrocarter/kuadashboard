'use strict';

const { listAllPages } = require('./gcpPaging');
const { mapLimited } = require('./kua/resourceCatalog/snapshots');

const COMPUTE = 'https://compute.googleapis.com/compute/v1';
const EXTERNAL = new Set(['EXTERNAL', 'EXTERNAL_MANAGED']);
const last = value => value?.split('/').pop() || null;

function urlMapServices(map) {
  const routes = [map, ...(map.pathMatchers || []).flatMap(matcher => [
    matcher, ...(matcher.pathRules || []), ...(matcher.routeRules || []),
  ])];
  return routes.flatMap(route => [
    route.defaultService, route.service,
    ...(route.defaultRouteAction?.weightedBackendServices || []).map(entry => entry.backendService),
    ...(route.routeAction?.weightedBackendServices || []).map(entry => entry.backendService),
  ]).filter(Boolean);
}

async function readGcpEntrypoints({ fetchApi, authCtx, listCloudRun }) {
  const project = authCtx.projectId;
  const projectPath = `projects/${encodeURIComponent(project)}`;
  const read = url => fetchApi(url, authCtx);

  async function aggregated(field) {
    let incomplete = false;
    const page = await listAllPages(async url => {
      const data = await read(url);
      const scopes = Object.values(data.items || {});
      incomplete ||= !!data.unreachables?.length || scopes.some(scope => scope.warning && scope.warning.code !== 'NO_RESULTS_ON_PAGE');
      return { ...data, rows: scopes.flatMap(scope => scope[field] || []) };
    }, authCtx, `${COMPUTE}/${projectPath}/aggregated/${field}?returnPartialSuccess=true`, 'rows');
    return { ...page, partial: incomplete || page.partial };
  }

  async function domains() {
    const url = new URL(`https://run.googleapis.com/apis/domains.cloudrun.com/v1/namespaces/${encodeURIComponent(project)}/domainmappings`);
    const items = [];
    const seen = new Set();
    let partial = false;
    for (let page = 0; page < 20; page++) {
      const data = await read(url.toString());
      items.push(...(data.items || []));
      partial ||= !!data.unreachable?.length;
      const cursor = data.metadata?.continue;
      if (!cursor) return { items, partial };
      if (seen.has(cursor)) break;
      seen.add(cursor);
      url.searchParams.set('continue', cursor);
    }
    return { items, partial: true };
  }

  const lookups = new Map();
  function readComputeReference(reference, resourceTypes) {
    if (typeof reference !== 'string') return null;
    const path = reference.replace(/^https:\/\/(?:www|compute)\.googleapis\.com\/compute\/v1\//, '');
    const match = /^projects\/([^/]+)\/(?:global|regions\/[a-z0-9-]+)\/([A-Za-z]+)\/[a-z0-9-]+$/.exec(path);
    if (!match || match[1] !== project || !resourceTypes.includes(match[2])) return null;
    if (!lookups.has(path)) {
      if (lookups.size >= 100) return null;
      lookups.set(path, read(`${COMPUTE}/${path}`).catch(() => null));
    }
    return lookups.get(path);
  }

  async function forwardingRules() {
    const page = await aggregated('forwardingRules');
    const rules = page.items.filter(rule => EXTERNAL.has(rule.loadBalancingScheme) && rule.IPAddress && !rule.parentForwardingRule);
    const entries = await mapLimited(rules, 4, async rule => {
      const backends = rule.backendService ? [rule.backendService] : [];
      let unresolved = false;
      if (!backends.length && rule.target && /\/target(?:Https?|Tcp|Ssl|Grpc)Proxies\//.test(rule.target)) {
        const proxy = await readComputeReference(rule.target, ['targetHttpProxies', 'targetHttpsProxies', 'targetTcpProxies', 'targetSslProxies', 'targetGrpcProxies']);
        if (proxy?.service) backends.push(proxy.service);
        else if (proxy?.urlMap) {
          const map = await readComputeReference(proxy.urlMap, ['urlMaps']);
          if (map) backends.push(...urlMapServices(map));
          else unresolved = true;
        } else unresolved = true;
      }
      return {
        name: rule.name, location: last(rule.region) || 'global', addresses: [rule.IPAddress],
        destinations: [...new Set(backends.length ? backends : [rule.target].filter(Boolean))],
        unresolved,
      };
    });
    return { items: entries, partial: page.partial };
  }

  const sources = {
    cloudrun: async () => ({
      items: (await listCloudRun(authCtx)).filter(service => service.ingress === 'all').map(service => ({
        name: service.name, location: service.region, addresses: [service.uri].filter(Boolean),
      })),
    }),
    domains: async () => {
      const page = await domains();
      return { ...page, items: page.items.map(mapping => ({
        name: mapping.metadata?.name,
        location: mapping.metadata?.labels?.['cloud.googleapis.com/location'] || null,
        addresses: [mapping.metadata?.name].filter(Boolean),
        destinations: [mapping.spec?.routeName].filter(Boolean),
      })).filter(mapping => mapping.name) };
    },
    forwardingRules,
    vms: async () => {
      const page = await aggregated('instances');
      return { ...page, items: page.items.map(vm => ({
        name: vm.name, location: last(vm.zone),
        addresses: [...new Set((vm.networkInterfaces || []).flatMap(nic => [
          ...(nic.accessConfigs || []).map(config => config.natIP),
          ...(nic.ipv6AccessConfigs || []).map(config => config.externalIpv6),
        ]).filter(Boolean))],
      })).filter(vm => vm.addresses.length) };
    },
  };
  const groups = await Promise.all(Object.entries(sources).map(async ([source, load]) => {
    try {
      const page = await load();
      return { source, entries: page.items, status: page.partial ? 'partial' : 'complete' };
    } catch {
      return { source, entries: [], status: 'unavailable' };
    }
  }));
  return { projectId: project, groups };
}

module.exports = { readGcpEntrypoints };
