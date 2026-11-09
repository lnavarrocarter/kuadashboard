'use strict';

const { isValidNamespace } = require('./kubePrometheus');

const addressesOf = object => [...new Set((object.status?.loadBalancer?.ingress || [])
  .flatMap(entry => [entry.ip, entry.hostname]).filter(Boolean))];
const backendOf = backend => backend?.service
  ? `${backend.service.name}:${backend.service.port?.number ?? backend.service.port?.name ?? ''}`
  : backend?.resource ? `${backend.resource.kind}/${backend.resource.name}` : '';

// These are declared entry points, not proof of internet reachability. A private
// load balancer and a NodePort behind a firewall must remain visible as such.
function ingressEntry(ingress) {
  const tls = ingress.spec?.tls || [];
  const routes = (ingress.spec?.rules || []).flatMap(rule => (rule.http?.paths || []).map(path => ({
    host: rule.host || '*', path: path.path || '/', pathType: path.pathType || '',
    backend: backendOf(path.backend),
    tls: tls.some(config => (config.hosts || []).includes(rule.host)),
  })));
  if (ingress.spec?.defaultBackend) routes.push({ host: '*', path: '*', pathType: '', backend: backendOf(ingress.spec.defaultBackend), tls: false });
  return {
    kind: 'Ingress', resource: 'ingresses', name: ingress.metadata.name, namespace: ingress.metadata.namespace,
    type: 'Ingress', addresses: addressesOf(ingress),
    className: ingress.spec?.ingressClassName || ingress.metadata.annotations?.['kubernetes.io/ingress.class'] || '',
    tlsConfigured: tls.length > 0, routes,
  };
}

function serviceEntry(service) {
  return {
    kind: 'Service', resource: 'services', name: service.metadata.name, namespace: service.metadata.namespace,
    type: service.spec.type,
    addresses: [...new Set([...addressesOf(service), ...(service.spec.externalIPs || [])])],
    ports: (service.spec.ports || []).map(port => ({
      port: port.port, protocol: port.protocol || 'TCP', nodePort: port.nodePort ?? null,
      targetPort: port.targetPort ?? port.port,
    })),
    selector: service.spec.selector || {},
  };
}

async function readEntrypoints({ core, networking }, namespace = 'all') {
  if (!isValidNamespace(namespace)) throw Object.assign(new Error('Invalid namespace'), { statusCode: 400 });
  const all = namespace === 'all';
  const sources = [
    ['ingresses', () => all ? networking.listIngressForAllNamespaces() : networking.listNamespacedIngress(namespace)],
    ['services', () => all ? core.listServiceForAllNamespaces() : core.listNamespacedService(namespace)],
  ];
  const results = await Promise.allSettled(sources.map(([, read]) => Promise.resolve().then(read)));
  const entries = [], unavailable = [];
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === 'rejected') {
      unavailable.push({ resource: sources[i][0], reason: (result.reason?.statusCode || result.reason?.response?.statusCode) === 403 ? 'forbidden' : 'unavailable' });
      continue;
    }
    const items = (result.value?.body ?? result.value)?.items || [];
    entries.push(...(i === 0 ? items.map(ingressEntry) : items
      .filter(service => ['LoadBalancer', 'NodePort'].includes(service.spec?.type)).map(serviceEntry)));
  }
  entries.sort((a, b) => a.namespace.localeCompare(b.namespace) || a.name.localeCompare(b.name) || a.kind.localeCompare(b.kind));
  return { namespace, entries, unavailable };
}

module.exports = { readEntrypoints };
