'use strict';

// Service rows for GET /api/:namespace/services: app name from the selector and
// backend pod IPs from EndpointSlices, fetched with a single list call for the
// whole namespace (or cluster) instead of one pod lookup per Service.

const APP_LABEL_KEYS = ['app.kubernetes.io/name', 'app', 'k8s-app', 'app.kubernetes.io/instance', 'name'];
const SERVICE_NAME_LABEL = 'kubernetes.io/service-name';

function appNameFor(service) {
  const selector = service.spec?.selector || {};
  const labels = service.metadata?.labels || {};
  for (const source of [selector, labels]) {
    const key = APP_LABEL_KEYS.find(k => source[k]);
    if (key) return source[key];
  }
  return '-';
}

/**
 * Map "<namespace>/<service>" -> { ready: [ip], notReady: [ip] } from EndpointSlices.
 * A missing `ready` condition means "unknown" and is treated as ready (per the API).
 */
function indexEndpointSlices(slices = []) {
  const index = new Map();
  for (const slice of slices) {
    const svcName = slice.metadata?.labels?.[SERVICE_NAME_LABEL];
    if (!svcName) continue;
    const key = `${slice.metadata.namespace}/${svcName}`;
    if (!index.has(key)) index.set(key, { ready: new Set(), notReady: new Set() });
    const entry = index.get(key);
    for (const ep of slice.endpoints || []) {
      const bucket = ep.conditions?.ready === false ? entry.notReady : entry.ready;
      for (const ip of ep.addresses || []) bucket.add(ip);
    }
  }
  const result = new Map();
  for (const [key, { ready, notReady }] of index) {
    for (const ip of ready) notReady.delete(ip);
    result.set(key, { ready: [...ready].sort(compareIps), notReady: [...notReady].sort(compareIps) });
  }
  return result;
}

function compareIps(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  if (pa.length === 4 && pb.length === 4 && pa.every(Number.isFinite) && pb.every(Number.isFinite)) {
    for (let i = 0; i < 4; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
    return 0;
  }
  return a.localeCompare(b);
}

/**
 * Text for the "Backend IPs" column. `backends` is undefined when EndpointSlices
 * could not be read (e.g. RBAC), which is shown as "?" rather than "none".
 */
function formatBackends(service, backends, endpointsAvailable = true) {
  if (service.spec?.type === 'ExternalName') return service.spec.externalName ? `→ ${service.spec.externalName}` : '-';
  if (!endpointsAvailable) return '?';
  if (!backends || (!backends.ready.length && !backends.notReady.length)) return '-';
  const parts = [];
  if (backends.ready.length) parts.push(backends.ready.join(', '));
  if (backends.notReady.length) parts.push(`not ready: ${backends.notReady.join(', ')}`);
  return parts.join(' · ');
}

function mapService(svc, endpointIndex, endpointsAvailable = true) {
  const rawPorts = (svc.spec?.ports || []).map(port => ({
    name: port.name || '',
    port: port.port,
    targetPort: port.targetPort ?? port.port,
    protocol: port.protocol || 'TCP',
    nodePort: port.nodePort,
  }));
  const backends = endpointIndex?.get(`${svc.metadata.namespace}/${svc.metadata.name}`);
  return {
    name:       svc.metadata.name,
    namespace:  svc.metadata.namespace,
    type:       svc.spec?.type,
    clusterIP:  svc.spec?.clusterIP,
    externalIP: svc.spec?.externalIPs?.join(',')
                || svc.status?.loadBalancer?.ingress?.[0]?.ip
                || svc.status?.loadBalancer?.ingress?.[0]?.hostname
                || '-',
    ports: rawPorts.map(p => `${p.port}:${p.targetPort}/${p.protocol}`).join(', ') || '-',
    rawPorts,
    selector:   svc.spec?.selector || {},
    app:        appNameFor(svc),
    backendIPs: formatBackends(svc, backends, endpointsAvailable),
    backendReady:    backends?.ready.length ?? 0,
    backendNotReady: backends?.notReady.length ?? 0,
    age:   svc.metadata.creationTimestamp,
  };
}

/**
 * List Services plus their EndpointSlices with exactly two API calls, run in parallel.
 * A failure reading EndpointSlices degrades the IP column instead of failing the list.
 */
async function listServicesWithBackends({ core, discovery }, namespace) {
  const all = namespace === 'all';
  const [services, slices] = await Promise.all([
    all ? core.listServiceForAllNamespaces() : core.listNamespacedService(namespace),
    (all ? discovery.listEndpointSliceForAllNamespaces() : discovery.listNamespacedEndpointSlice(namespace))
      .catch(() => null),
  ]);
  const items = services.body?.items || services.items || [];
  const endpointsAvailable = slices !== null;
  const index = endpointsAvailable ? indexEndpointSlices(slices.body?.items || slices.items || []) : new Map();
  return items.map(svc => mapService(svc, index, endpointsAvailable));
}

module.exports = { appNameFor, indexEndpointSlices, formatBackends, mapService, listServicesWithBackends };
