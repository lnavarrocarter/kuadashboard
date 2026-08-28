'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { KubernetesAdapter } = require('./kubernetesAdapter');

class AppsV1Api {}
class CoreV1Api {}
class NetworkingV1Api {}
class EventsV1Api {}

function response(items) {
  return async () => ({ body: { items } });
}

function fixture({ eventsError = false, nodesError = false } = {}) {
  const configBuilder = contextName => ({
    kubeConfig: {
      getContexts: () => [{ name: 'docker-desktop', cluster: 'local' }],
      getClusters: () => [{ name: 'local', server: 'https://localhost' }],
      makeApiClient(Api) {
        if (Api === AppsV1Api) return {
          listDeploymentForAllNamespaces: response([{
            kind: 'Deployment', metadata: { uid: 'deployment-uid', namespace: 'orders', name: 'api', labels: { app: 'orders' } },
            spec: {
              replicas: 2, selector: { matchLabels: { app: 'orders' } },
              template: {
                spec: {
                  containers: [{ envFrom: [{ configMapRef: { name: 'api-config' } }], env: [{ valueFrom: { secretKeyRef: { name: 'api-secret' } } }] }],
                  volumes: [{ persistentVolumeClaim: { claimName: 'api-data' } }],
                },
              },
            }, status: { readyReplicas: 1 },
          }]),
          listStatefulSetForAllNamespaces: response([]), listDaemonSetForAllNamespaces: response([]),
        };
        if (Api === CoreV1Api) return {
          listServiceForAllNamespaces: response([{
            kind: 'Service', metadata: { uid: 'service-uid', namespace: 'orders', name: 'api' }, spec: { selector: { app: 'orders' } },
          }]),
          listPodForAllNamespaces: response([{
            kind: 'Pod', metadata: { uid: 'pod-uid', namespace: 'orders', name: 'api-1', labels: { app: 'orders' } },
            spec: { nodeName: 'node-a' },
            status: { phase: 'Running', containerStatuses: [{ restartCount: 2 }] },
          }]),
          listNode: nodesError
            ? async () => { throw Object.assign(new Error('nodes is forbidden'), { statusCode: 403 }); }
            : response([{
              metadata: { uid: 'node-uid', name: 'node-a' },
              spec: {},
              status: { conditions: [{ type: 'Ready', status: 'True' }] },
            }]),
          listConfigMapForAllNamespaces: response([{ kind: 'ConfigMap', metadata: { uid: 'config-uid', namespace: 'orders', name: 'api-config' } }]),
          listSecretForAllNamespaces: response([{ kind: 'Secret', metadata: { uid: 'secret-uid', namespace: 'orders', name: 'api-secret' } }]),
          listPersistentVolumeClaimForAllNamespaces: response([{ kind: 'PersistentVolumeClaim', metadata: { uid: 'pvc-uid', namespace: 'orders', name: 'api-data' } }]),
        };
        if (Api === NetworkingV1Api) return {
          listIngressForAllNamespaces: response([{
            kind: 'Ingress', metadata: { uid: 'ingress-uid', namespace: 'orders', name: 'public' },
            spec: { rules: [{ http: { paths: [{ backend: { service: { name: 'api' } } }] } }] },
          }]),
        };
        if (Api === EventsV1Api) return {
          listEventForAllNamespaces: eventsError
            ? async () => { throw Object.assign(new Error('events unavailable'), { code: 'NOT_FOUND' }); }
            : response([{ type: 'Warning', reason: 'BackOff', note: 'restart loop', metadata: { namespace: 'orders', name: 'api.1' } }]),
        };
        throw new Error(`Unexpected client ${Api.name}`);
      },
    },
  });
  return new KubernetesAdapter({ configBuilder, AppsV1Api, CoreV1Api, NetworkingV1Api, EventsV1Api });
}

test('discovers Kubernetes topology with UID identity, declared evidence and health', async () => {
  const result = await fixture().preview({ provider: 'generic', contexts: ['docker-desktop'], namespaces: ['orders'] });

  assert.equal(result.nodes.length, 8);
  assert.equal(result.nodes.find(node => node.resourceType === 'deployment').nativeId, 'deployment-uid');
  assert.equal(result.nodes.find(node => node.resourceType === 'deployment').health.status, 'degraded');
  assert.equal(result.relationships.filter(edge => edge.relationType === 'owns').length, 1);
  assert.equal(result.relationships.filter(edge => edge.evidence[0].type === 'service_selector').length, 1);
  assert.equal(result.relationships.filter(edge => edge.evidence[0].type === 'ingress_backend').length, 1);
  assert.equal(result.relationships.filter(edge => edge.relationType === 'uses').length, 3);
  const clusterNode = result.nodes.find(node => node.resourceType === 'node');
  assert.equal(clusterNode.kind, 'Node');
  assert.equal(clusterNode.health.status, 'healthy');
  // Nodes are cluster-scoped: a namespace filter must never drop them.
  assert.equal(clusterNode.namespace, '');
  const runsOn = result.relationships.find(edge => edge.relationType === 'runs_on');
  assert.equal(runsOn.targetNodeId, clusterNode.id);
  assert.equal(runsOn.confidence, 1);
  assert.deepEqual(result.nodes.filter(node => ['configmap', 'secret', 'pvc'].includes(node.resourceType)).map(node => node.name).sort(), [
    'api-config', 'api-data', 'api-secret',
  ]);
  assert.equal(result.health[0].status, 'degraded');
  assert.equal(result.capabilities[0].events, true);
  assert.equal(result.capabilities[0].clusterNodes, true);
});

test('keeps discovering everything else when listing cluster Nodes is forbidden by RBAC', async () => {
  const result = await fixture({ nodesError: true }).preview({ provider: 'generic', contexts: ['docker-desktop'] });

  assert.equal(result.capabilities[0].clusterNodes, false);
  assert.equal(result.nodes.filter(node => node.resourceType === 'node').length, 0);
  assert.equal(result.relationships.filter(edge => edge.relationType === 'runs_on').length, 0);
  // A cluster-scoped permission gap must not discard the namespace-scoped discovery.
  assert.equal(result.nodes.length, 7);
  assert.equal(result.failures.length, 0);
});

test('lists compatible contexts without querying Kubernetes resources', () => {
  const contexts = fixture().listContexts({ provider: 'generic' });
  assert.deepEqual(contexts, [{ id: 'docker-desktop', name: 'docker-desktop', cluster: 'local', server: 'https://localhost' }]);
});

test('degrades event capability without discarding Kubernetes discovery', async () => {
  const result = await fixture({ eventsError: true }).preview({ provider: 'generic' });

  assert.equal(result.nodes.length, 8);
  assert.equal(result.health[0].status, 'healthy');
  assert.equal(result.capabilities[0].events, false);
});

test('resolves resourceType/kind/discoveryKey correctly even when the k8s API omits `.kind` on list items (real-world behavior, not just test mocks)', async () => {
  const configBuilder = () => ({
    kubeConfig: {
      getContexts: () => [{ name: 'docker-desktop', cluster: 'local' }],
      getClusters: () => [{ name: 'local', server: 'https://localhost' }],
      makeApiClient(Api) {
        // Real @kubernetes/client-node responses commonly omit `.kind`/`.apiVersion` on individual
        // items inside a List response; only the mocked tests above happened to set it explicitly.
        if (Api === AppsV1Api) return {
          listDeploymentForAllNamespaces: response([{
            metadata: { uid: 'deployment-uid', namespace: 'orders', name: 'api' },
          }]),
          listStatefulSetForAllNamespaces: response([]), listDaemonSetForAllNamespaces: response([]),
        };
        if (Api === CoreV1Api) return {
          listServiceForAllNamespaces: response([]),
          listPodForAllNamespaces: response([]),
          listConfigMapForAllNamespaces: response([]),
          listSecretForAllNamespaces: response([]),
          listPersistentVolumeClaimForAllNamespaces: response([]),
        };
        if (Api === NetworkingV1Api) return { listIngressForAllNamespaces: response([]) };
        if (Api === EventsV1Api) return { listEventForAllNamespaces: response([]) };
        throw new Error(`Unexpected client ${Api.name}`);
      },
    },
  });
  const adapter = new KubernetesAdapter({ configBuilder, AppsV1Api, CoreV1Api, NetworkingV1Api, EventsV1Api });

  const result = await adapter.preview({ provider: 'generic' });

  assert.equal(result.nodes.length, 1);
  const node = result.nodes[0];
  assert.equal(node.resourceType, 'deployment');
  assert.equal(node.kind, 'Deployment');
  assert.equal(node.discoveryKey, 'docker-desktop/orders/Deployment/api');
});

test('infers a "calls" relationship between Deployments from env var metadata, the same way AWS discovery reads config to relate resources', async () => {
  const configBuilder = () => ({
    kubeConfig: {
      getContexts: () => [{ name: 'jordan-eks', cluster: 'jordan' }],
      getClusters: () => [{ name: 'jordan', server: 'https://jordan' }],
      makeApiClient(Api) {
        if (Api === AppsV1Api) return {
          listDeploymentForAllNamespaces: response([
            {
              kind: 'Deployment', metadata: { uid: 'auth-uid', namespace: 'backend360', name: 'authv1' },
              spec: { template: { spec: { containers: [{ env: [] }] } } },
            },
            {
              kind: 'Deployment', metadata: { uid: 'cliente-uid', namespace: 'backend360', name: 'cliente' },
              spec: {
                template: {
                  spec: {
                    containers: [{
                      env: [
                        { name: 'AUTH_SERVICE_URL', value: 'http://authv1.backend360.svc.cluster.local:8080' },
                        { name: 'CRON_HOST', value: 'cron360' },
                        { name: 'LOG_LEVEL', value: 'info' },
                      ],
                    }],
                  },
                },
              },
            },
            {
              kind: 'Deployment', metadata: { uid: 'cron-uid', namespace: 'backend360', name: 'cron360' },
              spec: { template: { spec: { containers: [{ env: [] }] } } },
            },
          ]),
          listStatefulSetForAllNamespaces: response([]), listDaemonSetForAllNamespaces: response([]),
        };
        if (Api === CoreV1Api) return {
          listServiceForAllNamespaces: response([{
            kind: 'Service', metadata: { uid: 'auth-service-uid', namespace: 'backend360', name: 'authv1' },
            spec: { selector: {} },
          }]),
          listPodForAllNamespaces: response([]),
          listConfigMapForAllNamespaces: response([]),
          listSecretForAllNamespaces: response([]),
          listPersistentVolumeClaimForAllNamespaces: response([]),
        };
        if (Api === NetworkingV1Api) return { listIngressForAllNamespaces: response([]) };
        if (Api === EventsV1Api) return { listEventForAllNamespaces: response([]) };
        throw new Error(`Unexpected client ${Api.name}`);
      },
    },
  });
  const adapter = new KubernetesAdapter({ configBuilder, AppsV1Api, CoreV1Api, NetworkingV1Api, EventsV1Api });

  const result = await adapter.preview({ provider: 'generic' });

  const calls = result.relationships.filter(edge => edge.relationType === 'calls');
  assert.equal(calls.length, 2);
  const clienteNode = result.nodes.find(node => node.name === 'cliente');
  const cronNode = result.nodes.find(node => node.name === 'cron360');
  const authServiceNode = result.nodes.find(node => node.name === 'authv1' && node.resourceType === 'service');

  const toAuthService = calls.find(edge => edge.targetNodeId === authServiceNode.id);
  assert.equal(toAuthService.sourceNodeId, clienteNode.id);
  assert.equal(toAuthService.evidence[0].type, 'env_service_dns');
  assert.equal(toAuthService.confidence, 0.9);

  const toCron = calls.find(edge => edge.targetNodeId === cronNode.id);
  assert.equal(toCron.sourceNodeId, clienteNode.id);
  assert.equal(toCron.evidence[0].type, 'env_service_name');
  assert.equal(toCron.confidence, 0.75);
});

test('ignores env values that merely look like a bare word without a service-hinting key, avoiding false positive relationships', () => {
  const { workloadServiceEnvReferences } = require('./kubernetesAdapter');
  const item = {
    spec: { template: { spec: { containers: [{ env: [
      { name: 'LOG_LEVEL', value: 'info' },
      { name: 'NODE_ENV', value: 'production' },
      { name: 'AUTH_SERVICE_HOST', value: 'authv1' },
    ] }] } } },
  };
  const references = workloadServiceEnvReferences(item);
  assert.deepEqual(references.map(reference => reference.service), ['authv1']);
});