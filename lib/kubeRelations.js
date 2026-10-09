'use strict';

// Relations between Kubernetes objects for the inspector: a pod's owners,
// node and Services, and why a Service has (or lacks) backends. Pure
// diagnosis functions plus two readers that make the API calls.

const { indexEndpointSlices } = require('./kubeServices');

const SERVICE_NAME_LABEL = 'kubernetes.io/service-name';
const MAX_LISTED = 20;

function body(response) { return response?.body ?? response ?? {}; }
function items(response) { return body(response).items || []; }

/** A Service selector matches when every key/value is in the pod labels. */
function selectorMatches(selector = {}, labels = {}) {
  const entries = Object.entries(selector || {});
  return entries.length > 0 && entries.every(([key, value]) => labels?.[key] === value);
}

function podReady(pod) {
  return (pod.status?.conditions || []).some(c => c.type === 'Ready' && c.status === 'True');
}

function podSummary(pod) {
  return { name: pod.metadata?.name, ready: podReady(pod), phase: pod.status?.phase || 'Unknown', ip: pod.status?.podIP || null };
}

// Name before the first version/hash separator: "attencion" for both
// "attencion-3.9.1" and "attencion-20261008-155437".
function baseName(value) {
  return String(value || '').toLowerCase().split(/[-_.]/)[0];
}

/**
 * Pods that match all selector keys but one, whose value shares the base name:
 * the usual trace of a selector left on an older release label
 * (app=web-1.2 vs web-1.3). Unrelated apps differing on the same key are not
 * near misses.
 */
function nearMisses(selector = {}, pods = []) {
  const entries = Object.entries(selector || {});
  if (!entries.length) return [];
  const misses = [];
  for (const pod of pods) {
    const labels = pod.metadata?.labels || {};
    const differing = entries.filter(([key, value]) => labels[key] !== value);
    if (differing.length !== 1) continue;
    const [key, expected] = differing[0];
    if (labels[key] === undefined) continue;
    const base = baseName(expected);
    if (base.length < 3 || baseName(labels[key]) !== base) continue;
    misses.push({ pod: pod.metadata?.name, key, expected, actual: labels[key] });
  }
  return misses.slice(0, 5);
}

/**
 * Why a Service has or lacks backends.
 * state: external-name | no-selector | no-matching-pods | pods-not-ready | ok
 * `endpoints` is null when EndpointSlices could not be read.
 */
function diagnoseServiceBackends({ service, pods = [], slices = null }) {
  const selector = service.spec?.selector || {};
  const type = service.spec?.type || 'ClusterIP';
  const key = `${service.metadata?.namespace}/${service.metadata?.name}`;
  const endpoints = slices ? (indexEndpointSlices(slices).get(key) || { ready: [], notReady: [] }) : null;
  const matching = pods.filter(pod => selectorMatches(selector, pod.metadata?.labels)).map(podSummary);
  const readyPods = matching.filter(p => p.ready).length;

  let state = 'ok';
  if (type === 'ExternalName') state = 'external-name';
  else if (!Object.keys(selector).length) state = 'no-selector';
  else if (!matching.length) state = 'no-matching-pods';
  else if (!readyPods) state = 'pods-not-ready';

  return {
    state,
    type,
    selector,
    externalName: service.spec?.externalName || null,
    matchingPods: matching.slice(0, MAX_LISTED),
    matchingCount: matching.length,
    readyPods,
    endpoints: endpoints ? { ready: endpoints.ready.length, notReady: endpoints.notReady.length } : null,
    nearMisses: state === 'no-matching-pods' ? nearMisses(selector, pods) : [],
  };
}

/** Services in the pod's namespace that select it, and whether its IP is a ready endpoint. */
function podServices(pod, services = [], slices = null) {
  const index = slices ? indexEndpointSlices(slices) : null;
  const ip = pod.status?.podIP;
  return services
    .filter(service => selectorMatches(service.spec?.selector, pod.metadata?.labels))
    .map(service => {
      const endpoints = index?.get(`${service.metadata.namespace}/${service.metadata.name}`);
      return {
        name: service.metadata.name,
        // null: EndpointSlices unreadable or pod without IP, so readiness for traffic is unknown.
        readyEndpoint: endpoints && ip ? endpoints.ready.includes(ip) : null,
      };
    });
}

async function readServiceBackends({ core, discovery }, namespace, name) {
  const [service, pods, slices] = await Promise.all([
    core.readNamespacedService(name, namespace),
    core.listNamespacedPod(namespace),
    discovery.listNamespacedEndpointSlice(namespace, undefined, undefined, undefined, undefined, `${SERVICE_NAME_LABEL}=${name}`)
      .catch(() => null),
  ]);
  return diagnoseServiceBackends({ service: body(service), pods: items(pods), slices: slices ? items(slices) : null });
}

/** Owner chain (Pod -> ReplicaSet -> Deployment, Job -> CronJob...), node and Services of a pod. */
async function readPodRelations({ core, apps, batch, discovery }, namespace, name) {
  const pod = body(await core.readNamespacedPod(name, namespace));
  const owners = [];
  let owner = (pod.metadata?.ownerReferences || []).find(ref => ref.controller) || pod.metadata?.ownerReferences?.[0];
  // Two levels cover every built-in controller; a missing parent stops the walk.
  for (let depth = 0; owner && depth < 2; depth += 1) {
    owners.push({ kind: owner.kind, name: owner.name });
    let parent = null;
    try {
      if (owner.kind === 'ReplicaSet') parent = body(await apps.readNamespacedReplicaSet(owner.name, namespace));
      else if (owner.kind === 'Job') parent = body(await batch.readNamespacedJob(owner.name, namespace));
    } catch (_) { parent = null; }
    owner = parent ? (parent.metadata?.ownerReferences || []).find(ref => ref.controller) : null;
  }
  const [services, slices] = await Promise.all([
    core.listNamespacedService(namespace),
    discovery.listNamespacedEndpointSlice(namespace).catch(() => null),
  ]);
  return {
    owners,
    node: pod.spec?.nodeName || null,
    services: podServices(pod, items(services), slices ? items(slices) : null),
  };
}

module.exports = {
  diagnoseServiceBackends,
  nearMisses,
  podServices,
  readPodRelations,
  readServiceBackends,
  selectorMatches,
};
