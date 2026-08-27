'use strict';

const crypto = require('crypto');
const k8s = require('@kubernetes/client-node');
const { buildKubeConfig } = require('../kubeConfigManager');
const { contextMatchesProvider } = require('../apm/eksWorkloadReader');

const WORKLOADS = [
  ['Deployment', 'listDeploymentForAllNamespaces'],
  ['StatefulSet', 'listStatefulSetForAllNamespaces'],
  ['DaemonSet', 'listDaemonSetForAllNamespaces'],
];

// The k8s API server does not reliably populate `.kind` on individual items inside a List response
// (only tests/mocks tend to set it), so the proper-case Kind used for discoveryKey/kind must come from
// the caller's own knowledge of which endpoint it queried, never from `item.kind`.
const KIND_BY_RESOURCE_TYPE = {
  deployment: 'Deployment', statefulset: 'StatefulSet', daemonset: 'DaemonSet',
  service: 'Service', pod: 'Pod', configmap: 'ConfigMap', secret: 'Secret',
  pvc: 'PersistentVolumeClaim', ingress: 'Ingress',
};

function stableId(kind, context, uid) {
  const value = `${kind}:${context}:${uid}`;
  return `kubernetes:${crypto.createHash('sha256').update(value).digest('hex').slice(0, 24)}`;
}

function labelsMatch(selector = {}, labels = {}) {
  return Object.entries(selector || {}).length > 0 && Object.entries(selector).every(([key, value]) => labels[key] === value);
}

function namespaceAllowed(item, namespaces) {
  return !namespaces?.length || namespaces.includes(item.metadata?.namespace);
}

function sourceId(context) {
  return `kubernetes:context:${context}`;
}

function nodeFromItem(context, item, resourceType, health = {}) {
  const metadata = item.metadata || {};
  const uid = String(metadata.uid || '').trim();
  if (!uid) return null;
  const kind = item.kind || KIND_BY_RESOURCE_TYPE[resourceType] || resourceType;
  return {
    id: stableId(resourceType, context, uid),
    provider: 'kubernetes',
    resourceType,
    kind,
    name: metadata.name,
    nativeId: uid,
    // Matches the APM canonical Kubernetes resource key (context/namespace/kind/name) so the same
    // workload discovered here and added manually/observed in APM resolve to one shared identity.
    discoveryKey: `${context}/${metadata.namespace || ''}/${kind}/${metadata.name}`,
    kubeContext: context,
    namespace: metadata.namespace || '',
    sourceId: sourceId(context),
    labels: metadata.labels || {},
    health,
    evidence: [{ type: 'kubernetes_uid', sourceId: sourceId(context), values: [uid] }],
  };
}

function relationship(context, source, target, relationType, evidence) {
  return {
    id: stableId(`relationship:${relationType}`, context, `${source.id}:${target.id}`),
    sourceNodeId: source.id,
    targetNodeId: target.id,
    relationType,
    status: 'suggested',
    confidence: evidence.type === 'ingress_backend' ? 1 : 0.95,
    evidence: [{ ...evidence, sourceId: sourceId(context) }],
  };
}

function workloadHealth(item) {
  const desired = Number(item.spec?.replicas ?? (item.kind === 'DaemonSet' ? item.status?.desiredNumberScheduled : 0));
  const ready = Number(item.status?.readyReplicas ?? item.status?.numberReady ?? 0);
  return { status: desired === 0 || ready >= desired ? 'healthy' : 'degraded', desired, ready };
}

function podHealth(item) {
  const statuses = item.status?.containerStatuses || [];
  const restarts = statuses.reduce((total, status) => total + Number(status.restartCount || 0), 0);
  return { status: item.status?.phase === 'Running' ? 'healthy' : 'degraded', phase: item.status?.phase || 'Unknown', restarts };
}

function ingressBackends(item) {
  const rules = item.spec?.rules || [];
  return rules.flatMap(rule => rule.http?.paths || []).map(path => path.backend?.service?.name).filter(Boolean);
}

function workloadReferences(item) {
  const references = [];
  for (const container of item.spec?.template?.spec?.containers || []) {
    for (const source of container.envFrom || []) {
      if (source.configMapRef?.name) references.push({ type: 'configmap', name: source.configMapRef.name, evidence: 'env_from_configmap' });
      if (source.secretRef?.name) references.push({ type: 'secret', name: source.secretRef.name, evidence: 'env_from_secret' });
    }
    for (const env of container.env || []) {
      if (env.valueFrom?.configMapKeyRef?.name) references.push({ type: 'configmap', name: env.valueFrom.configMapKeyRef.name, evidence: 'env_configmap_key' });
      if (env.valueFrom?.secretKeyRef?.name) references.push({ type: 'secret', name: env.valueFrom.secretKeyRef.name, evidence: 'env_secret_key' });
    }
  }
  for (const volume of item.spec?.template?.spec?.volumes || []) {
    if (volume.configMap?.name) references.push({ type: 'configmap', name: volume.configMap.name, evidence: 'volume_configmap' });
    if (volume.secret?.secretName) references.push({ type: 'secret', name: volume.secret.secretName, evidence: 'volume_secret' });
    if (volume.persistentVolumeClaim?.claimName) references.push({ type: 'pvc', name: volume.persistentVolumeClaim.claimName, evidence: 'volume_persistent_volume_claim' });
  }
  return [...new Map(references.map(reference => [`${reference.type}:${reference.name}:${reference.evidence}`, reference])).values()];
}

class KubernetesAdapter {
  constructor({
    configBuilder = buildKubeConfig,
    AppsV1Api = k8s.AppsV1Api,
    CoreV1Api = k8s.CoreV1Api,
    NetworkingV1Api = k8s.NetworkingV1Api,
    EventsV1Api = k8s.EventsV1Api,
  } = {}) {
    this.configBuilder = configBuilder;
    this.AppsV1Api = AppsV1Api;
    this.CoreV1Api = CoreV1Api;
    this.NetworkingV1Api = NetworkingV1Api;
    this.EventsV1Api = EventsV1Api;
  }

  listContexts({ provider = 'generic' } = {}) {
    const { kubeConfig } = this.configBuilder();
    const clusters = new Map(kubeConfig.getClusters().map(cluster => [cluster.name, cluster]));
    return kubeConfig.getContexts()
      .filter(context => contextMatchesProvider(provider, context, clusters.get(context.cluster)))
      .map(context => {
        const cluster = clusters.get(context.cluster);
        return { id: context.name, name: context.name, cluster: context.cluster, server: cluster?.server || '' };
      })
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async preview({ provider = 'generic', contexts: requestedContexts, namespaces } = {}) {
    const { kubeConfig } = this.configBuilder();
    const clusters = new Map(kubeConfig.getClusters().map(cluster => [cluster.name, cluster]));
    const contexts = kubeConfig.getContexts().filter(context =>
      contextMatchesProvider(provider, context, clusters.get(context.cluster)) &&
      (!requestedContexts?.length || requestedContexts.includes(context.name)));
    const result = { generatedAt: new Date().toISOString(), sources: [], nodes: [], relationships: [], health: [], capabilities: [], failures: [] };

    for (const context of contexts) {
      const contextName = context.name;
      const capabilities = { discovery: true, stableIdentity: true, relationshipEvidence: true, healthSignals: true, events: true };
      try {
        const { kubeConfig: scopedConfig } = this.configBuilder(contextName);
        const apps = scopedConfig.makeApiClient(this.AppsV1Api);
        const core = scopedConfig.makeApiClient(this.CoreV1Api);
        const networking = scopedConfig.makeApiClient(this.NetworkingV1Api);
        const events = scopedConfig.makeApiClient(this.EventsV1Api);
        const requests = [
          ...WORKLOADS.map(([, method]) => apps[method]()),
          core.listServiceForAllNamespaces(),
          core.listPodForAllNamespaces(),
          core.listConfigMapForAllNamespaces(),
          core.listSecretForAllNamespaces(),
          core.listPersistentVolumeClaimForAllNamespaces(),
          networking.listIngressForAllNamespaces(),
          events.listEventForAllNamespaces(),
        ];
        const responses = await Promise.allSettled(requests);
        const values = responses.map(response => response.status === 'fulfilled' ? response.value.body?.items || [] : []);
        if (responses.at(-1).status === 'rejected') capabilities.events = false;
        if (responses.slice(0, -1).some(response => response.status === 'rejected')) {
          throw responses.find(response => response.status === 'rejected').reason;
        }
        const [deployments, statefulSets, daemonSets, services, pods, configMaps, secrets, persistentVolumeClaims, ingresses, eventItems] = values;
        result.sources.push({ id: sourceId(contextName), type: 'kubernetes', provider: 'kubernetes', context: contextName, namespaces: namespaces || [], readOnly: true });
        // Tag each workload with its endpoint-known resourceType up front (never trust item.kind, see above).
        const taggedWorkloadItems = [
          ...deployments.map(item => [item, 'deployment']),
          ...statefulSets.map(item => [item, 'statefulset']),
          ...daemonSets.map(item => [item, 'daemonset']),
        ].filter(([item]) => namespaceAllowed(item, namespaces));
        const workloadItems = taggedWorkloadItems.map(([item]) => item);
        const referencesByWorkloadUid = new Map(workloadItems.map(item => [item.metadata?.uid, workloadReferences(item)]));
        const referencedResources = new Set(workloadItems.flatMap(item => (referencesByWorkloadUid.get(item.metadata?.uid) || [])
          .map(reference => `${item.metadata?.namespace}:${reference.type}:${reference.name}`)));
        const configurationItems = [
          ...configMaps.filter(item => referencedResources.has(`${item.metadata?.namespace}:configmap:${item.metadata?.name}`)).map(item => [item, 'configmap']),
          ...secrets.filter(item => referencedResources.has(`${item.metadata?.namespace}:secret:${item.metadata?.name}`)).map(item => [item, 'secret']),
          ...persistentVolumeClaims.filter(item => referencedResources.has(`${item.metadata?.namespace}:pvc:${item.metadata?.name}`)).map(item => [item, 'pvc']),
        ];
        const nodes = [
          ...taggedWorkloadItems.map(([item, resourceType]) => nodeFromItem(contextName, item, resourceType, workloadHealth(item))),
          ...services.filter(item => namespaceAllowed(item, namespaces)).map(item => nodeFromItem(contextName, item, 'service')),
          ...pods.filter(item => namespaceAllowed(item, namespaces)).map(item => nodeFromItem(contextName, item, 'pod', podHealth(item))),
          ...configurationItems.map(([item, type]) => nodeFromItem(contextName, item, type)),
          ...ingresses.filter(item => namespaceAllowed(item, namespaces)).map(item => nodeFromItem(contextName, item, 'ingress')),
        ].filter(Boolean);
        result.nodes.push(...nodes);
        const workloads = nodes.filter(node => ['deployment', 'statefulset', 'daemonset'].includes(node.resourceType));
        const serviceNodes = nodes.filter(node => node.resourceType === 'service');
        const podNodes = nodes.filter(node => node.resourceType === 'pod');
        const ingressNodes = nodes.filter(node => node.resourceType === 'ingress');
        const rawById = new Map([...workloadItems, ...services, ...pods, ...configurationItems.map(([item]) => item), ...ingresses].map(item => [item.metadata?.uid, item]));
        const configurationNodes = new Map(nodes
          .filter(node => ['configmap', 'secret', 'pvc'].includes(node.resourceType))
          .map(node => [`${node.namespace}:${node.resourceType}:${node.name}`, node]));
        for (const workload of workloads) {
          const selector = rawById.get(workload.nativeId)?.spec?.selector?.matchLabels || {};
          for (const pod of podNodes.filter(item => item.namespace === workload.namespace && labelsMatch(selector, item.labels))) {
            result.relationships.push(relationship(contextName, workload, pod, 'owns', { type: 'workload_selector', selector }));
          }
          for (const reference of referencesByWorkloadUid.get(workload.nativeId) || []) {
            const target = configurationNodes.get(`${workload.namespace}:${reference.type}:${reference.name}`);
            if (target) result.relationships.push(relationship(contextName, workload, target, 'uses', { type: reference.evidence, resource: reference.name }));
          }
        }
        for (const service of serviceNodes) {
          const selector = rawById.get(service.nativeId)?.spec?.selector || {};
          for (const pod of podNodes.filter(item => item.namespace === service.namespace && labelsMatch(selector, item.labels))) {
            result.relationships.push(relationship(contextName, service, pod, 'routes_to', { type: 'service_selector', selector }));
          }
        }
        for (const ingress of ingressNodes) {
          const backends = ingressBackends(rawById.get(ingress.nativeId));
          for (const service of serviceNodes.filter(item => item.namespace === ingress.namespace && backends.includes(item.name))) {
            result.relationships.push(relationship(contextName, ingress, service, 'routes_to', { type: 'ingress_backend', services: backends }));
          }
        }
        const warnings = eventItems.filter(event => event.type === 'Warning').map(event => ({
          name: event.metadata?.name || '', reason: event.reason || '', message: event.note || event.message || '',
          namespace: event.metadata?.namespace || '', count: Number(event.deprecatedCount || event.series?.count || 1),
        }));
        result.health.push({ context: contextName, status: warnings.length ? 'degraded' : 'healthy', warningEvents: warnings });
      } catch (error) {
        result.failures.push({ context: contextName, code: error.code || error.cause?.code || 'CONNECTION_FAILED' });
        result.capabilities.push({ context: contextName, discovery: false, stableIdentity: false, relationshipEvidence: false, healthSignals: false, events: false });
        continue;
      }
      result.capabilities.push({ context: contextName, ...capabilities });
    }
    return result;
  }
}

module.exports = { KubernetesAdapter, labelsMatch, nodeFromItem, stableId, workloadReferences };