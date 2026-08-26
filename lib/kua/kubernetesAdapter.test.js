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

function fixture({ eventsError = false } = {}) {
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
            status: { phase: 'Running', containerStatuses: [{ restartCount: 2 }] },
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

  assert.equal(result.nodes.length, 7);
  assert.equal(result.nodes.find(node => node.resourceType === 'deployment').nativeId, 'deployment-uid');
  assert.equal(result.nodes.find(node => node.resourceType === 'deployment').health.status, 'degraded');
  assert.equal(result.relationships.filter(edge => edge.relationType === 'owns').length, 1);
  assert.equal(result.relationships.filter(edge => edge.evidence[0].type === 'service_selector').length, 1);
  assert.equal(result.relationships.filter(edge => edge.evidence[0].type === 'ingress_backend').length, 1);
  assert.equal(result.relationships.filter(edge => edge.relationType === 'uses').length, 3);
  assert.deepEqual(result.nodes.filter(node => ['configmap', 'secret', 'pvc'].includes(node.resourceType)).map(node => node.name).sort(), [
    'api-config', 'api-data', 'api-secret',
  ]);
  assert.equal(result.health[0].status, 'degraded');
  assert.equal(result.capabilities[0].events, true);
});

test('lists compatible contexts without querying Kubernetes resources', () => {
  const contexts = fixture().listContexts({ provider: 'generic' });
  assert.deepEqual(contexts, [{ id: 'docker-desktop', name: 'docker-desktop', cluster: 'local', server: 'https://localhost' }]);
});

test('degrades event capability without discarding Kubernetes discovery', async () => {
  const result = await fixture({ eventsError: true }).preview({ provider: 'generic' });

  assert.equal(result.nodes.length, 7);
  assert.equal(result.health[0].status, 'healthy');
  assert.equal(result.capabilities[0].events, false);
});