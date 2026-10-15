'use strict';
/**
 * lib/kua/resourceCatalog/kubernetes.js
 * The resources of a Kubernetes context a KUA Application can hold (#282): workloads, CronJobs,
 * Jobs, Services, Ingresses, PersistentVolumeClaims, PersistentVolumes and Nodes. A PV names the
 * volume that backs it (`volumeHandle` of its CSI driver: an EBS volume id or a GCP disk path), so
 * it can be related to that volume. Only list calls of the Kubernetes API.
 */

const k8s = require('@kubernetes/client-node');
const { buildKubeConfig } = require('../../kubeConfigManager');
const { createSnapshotPager, matchesSearch, catalogError, SNAPSHOT_TTL_MS } = require('./snapshots');

const body = response => response?.body || response || {};
const items = response => body(response).items || [];

// type → [Kind, api, all-namespaces method, namespaced method (null: cluster-scoped)]
const KINDS = {
  deployment: ['Deployment', 'apps', 'listDeploymentForAllNamespaces', 'listNamespacedDeployment'],
  statefulset: ['StatefulSet', 'apps', 'listStatefulSetForAllNamespaces', 'listNamespacedStatefulSet'],
  daemonset: ['DaemonSet', 'apps', 'listDaemonSetForAllNamespaces', 'listNamespacedDaemonSet'],
  cronjob: ['CronJob', 'batch', 'listCronJobForAllNamespaces', 'listNamespacedCronJob'],
  job: ['Job', 'batch', 'listJobForAllNamespaces', 'listNamespacedJob'],
  service: ['Service', 'core', 'listServiceForAllNamespaces', 'listNamespacedService'],
  ingress: ['Ingress', 'networking', 'listIngressForAllNamespaces', 'listNamespacedIngress'],
  pvc: ['PersistentVolumeClaim', 'core', 'listPersistentVolumeClaimForAllNamespaces', 'listNamespacedPersistentVolumeClaim'],
  pv: ['PersistentVolume', 'core', 'listPersistentVolume', null],
  node: ['Node', 'core', 'listNode', null],
};
const TYPE_NAMES = Object.keys(KINDS);

/** The volume behind a PV: an EBS volume, a GCP persistent disk, or another CSI volume. */
function backingVolume(pv) {
  const csi = pv.spec?.csi;
  const handle = csi?.volumeHandle || pv.spec?.awsElasticBlockStore?.volumeID || pv.spec?.gcePersistentDisk?.pdName || '';
  const driver = csi?.driver || (pv.spec?.awsElasticBlockStore ? 'kubernetes.io/aws-ebs' : pv.spec?.gcePersistentDisk ? 'kubernetes.io/gce-pd' : '');
  if (!handle) return null;
  const ebs = /ebs\.csi\.aws\.com|aws-ebs/.test(driver) ? String(handle).match(/vol-[0-9a-f]+/)?.[0] : null;
  if (ebs) return { provider: 'aws', type: 'ebs-volume', volumeId: ebs, driver };
  if (/pd\.csi\.storage\.gke\.io|gce-pd/.test(driver)) return { provider: 'gcp', type: 'gcp-disk', name: handle, driver };
  return { provider: null, type: null, handle, driver };
}

// The PersistentVolumeClaims a pod template mounts (#283: workload → PVC → PV → volume).
function claimsOf(podSpec) {
  return (podSpec?.volumes || []).map(volume => volume.persistentVolumeClaim?.claimName).filter(Boolean);
}

function details(type, item) {
  const spec = item.spec || {};
  const status = item.status || {};
  switch (type) {
    case 'deployment':
      return { replicas: spec.replicas ?? null, ready: status.readyReplicas ?? 0, claims: claimsOf(spec.template?.spec) };
    case 'statefulset':
      return {
        replicas: spec.replicas ?? null, ready: status.readyReplicas ?? 0, claims: claimsOf(spec.template?.spec),
        // Each replica N gets the claim <template>-<statefulset>-N.
        claimTemplates: (spec.volumeClaimTemplates || []).map(template => template.metadata?.name).filter(Boolean),
      };
    case 'daemonset':
      return { desired: status.desiredNumberScheduled ?? null, ready: status.numberReady ?? 0, claims: claimsOf(spec.template?.spec) };
    case 'cronjob':
      return { schedule: spec.schedule || null, suspended: !!spec.suspend, lastScheduleTime: status.lastScheduleTime ? new Date(status.lastScheduleTime).toISOString() : null, lastSuccessfulTime: status.lastSuccessfulTime ? new Date(status.lastSuccessfulTime).toISOString() : null, claims: claimsOf(spec.jobTemplate?.spec?.template?.spec) };
    case 'job':
      return { owner: item.metadata?.ownerReferences?.[0]?.name || null, succeeded: status.succeeded ?? 0, failed: status.failed ?? 0, active: status.active ?? 0, claims: claimsOf(spec.template?.spec) };
    case 'service':
      return { serviceType: spec.type || null, clusterIP: spec.clusterIP || null };
    case 'ingress':
      return { hosts: (spec.rules || []).map(rule => rule.host).filter(Boolean) };
    case 'pvc':
      return { storageClass: spec.storageClassName || null, capacity: status.capacity?.storage || spec.resources?.requests?.storage || null, phase: status.phase || null, volumeName: spec.volumeName || null };
    case 'pv':
      return {
        storageClass: spec.storageClassName || null, capacity: spec.capacity?.storage || null, phase: status.phase || null,
        claim: spec.claimRef ? `${spec.claimRef.namespace}/${spec.claimRef.name}` : null, backingVolume: backingVolume(item),
      };
    case 'node':
      return {
        instanceType: item.metadata?.labels?.['node.kubernetes.io/instance-type'] || null,
        providerId: spec.providerID || null,
        instanceId: String(spec.providerID || '').match(/i-[0-9a-f]+/)?.[0] || null,
      };
    default:
      return {};
  }
}

function createKubernetesResourceCatalog({
  configBuilder = buildKubeConfig,
  apis = { apps: k8s.AppsV1Api, batch: k8s.BatchV1Api, core: k8s.CoreV1Api, networking: k8s.NetworkingV1Api },
  now = () => Date.now(),
  snapshotTtlMs = SNAPSHOT_TTL_MS,
} = {}) {
  const pager = createSnapshotPager({ now, ttlMs: snapshotTtlMs });

  function types() {
    return TYPE_NAMES.map(type => ({ type, kind: KINDS[type][0], clusterScoped: !KINDS[type][3] }));
  }

  async function list({ context, namespace, types: requestedTypes, search, limit, cursor } = {}) {
    if (cursor) {
      const { snapshot, offset } = pager.resume(cursor, context);
      return pager.page(snapshot, { offset, limit, owner: context });
    }
    if (!context) throw catalogError('context is required (see list_kubernetes_contexts)', 400, 'INVALID');
    const types = Array.isArray(requestedTypes) && requestedTypes.length ? [...new Set(requestedTypes)] : TYPE_NAMES;
    const unknown = types.filter(type => !KINDS[type]);
    if (unknown.length) throw catalogError(`Unknown type(s): ${unknown.join(', ')}. Known: ${TYPE_NAMES.join(', ')}`, 400, 'INVALID');
    const { kubeConfig } = configBuilder(context);
    const clients = Object.fromEntries(Object.entries(apis).map(([name, Api]) => [name, kubeConfig.makeApiClient(Api)]));
    const failures = [];
    const lists = await Promise.all(types.map(async type => {
      const [kind, api, allMethod, namespacedMethod] = KINDS[type];
      try {
        const response = namespace && namespacedMethod
          ? await clients[api][namespacedMethod](namespace)
          : await clients[api][allMethod]();
        return items(response).map(item => {
          const itemNamespace = item.metadata?.namespace || null;
          const name = item.metadata?.name;
          const key = `${context}/${itemNamespace || ''}/${kind}/${name}`;
          return {
            type, kind, name, namespace: itemNamespace, context, key, details: details(type, item),
            attach: { provider: 'kubernetes', type: 'kubernetes', kind, key, name, kubeContext: context, ...(itemNamespace ? { namespace: itemNamespace } : {}) },
          };
        });
      } catch (error) {
        const status = Number(error?.statusCode || error?.response?.statusCode || 0);
        failures.push({ type, code: status === 403 ? 'access_denied' : status === 401 ? 'credentials' : (error?.code || 'list_failed') });
        return [];
      }
    }));
    const found = lists.flat().filter(item => (!namespace || !item.namespace || item.namespace === namespace) && matchesSearch(item, search));
    const snapshot = { generatedAt: new Date(now()).toISOString(), context, namespace: namespace || null, types, failures, items: found };
    return pager.page(snapshot, { offset: 0, limit, owner: context });
  }

  return { types, list };
}

module.exports = { createKubernetesResourceCatalog, backingVolume, KUBERNETES_CATALOG_TYPES: TYPE_NAMES };
