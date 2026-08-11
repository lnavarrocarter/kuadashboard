'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { contextMatchesProvider, createEksWorkloadReader, isEksContext, isGkeContext } = require('./eksWorkloadReader');

test('identifies EKS contexts from ARN or API server', () => {
  assert.equal(isEksContext({ name: 'arn:aws:eks:us-east-1:123:cluster/dev', cluster: 'dev' }), true);
  assert.equal(isEksContext({ name: 'dev', cluster: 'dev' }, { server: 'https://ABC.eks.amazonaws.com' }), true);
  assert.equal(isEksContext({ name: 'docker-desktop', cluster: 'docker-desktop' }, { server: 'https://localhost' }), false);
});

test('classifies GKE and explicit Vercel Kubernetes contexts', () => {
  const gke = { name: 'gke_project_us-central1_dev', cluster: 'gke-dev' };
  const local = { name: 'docker-desktop', cluster: 'docker-desktop' };
  assert.equal(isGkeContext(gke), true);
  assert.equal(contextMatchesProvider('gcp', gke), true);
  assert.equal(contextMatchesProvider('aws', gke), false);
  assert.equal(contextMatchesProvider('vercel', local), true);
  assert.equal(contextMatchesProvider('generic', gke), true);
  assert.equal(contextMatchesProvider('generic', local), true);
});

test('lists workloads only from isolated EKS contexts', async () => {
  const calls = [];
  const contexts = [
    { name: 'arn:aws:eks:us-east-1:123:cluster/dev', cluster: 'eks-dev' },
    { name: 'docker-desktop', cluster: 'docker-desktop' },
  ];
  const configBuilder = contextName => {
    calls.push(contextName || 'catalog');
    return {
      kubeConfig: {
        getContexts: () => contexts,
        getClusters: () => [
          { name: 'eks-dev', server: 'https://ABC.eks.amazonaws.com' },
          { name: 'docker-desktop', server: 'https://localhost' },
        ],
        makeApiClient: () => ({
          listDeploymentForAllNamespaces: async () => ({ body: { items: [{ metadata: { namespace: 'orders', name: 'api', labels: { app: 'orders' } } }] } }),
          listStatefulSetForAllNamespaces: async () => ({ body: { items: [] } }),
          listDaemonSetForAllNamespaces: async () => ({ body: { items: [{ metadata: { namespace: 'monitoring', name: 'agent' } }] } }),
        }),
      },
    };
  };
  const reader = createEksWorkloadReader({ configBuilder, AppsV1Api: class {} });

  const result = await reader.listWorkloads();

  assert.deepEqual(calls, ['catalog', 'arn:aws:eks:us-east-1:123:cluster/dev']);
  assert.deepEqual(result.estimate, { awsRequests: 0, kubernetesRequests: 3 });
  assert.deepEqual(result.failedContexts, []);
  assert.deepEqual(result.workloads.map(workload => [workload.kind, workload.namespace, workload.name]), [
    ['DaemonSet', 'monitoring', 'agent'],
    ['Deployment', 'orders', 'api'],
  ]);
});

test('returns partial results when an EKS context is unreachable', async () => {
  const contexts = [
    { name: 'broken', cluster: 'broken-cluster' },
    { name: 'working', cluster: 'working-cluster' },
  ];
  const configBuilder = contextName => ({
    kubeConfig: {
      getContexts: () => contexts,
      getClusters: () => [
        { name: 'broken-cluster', server: 'https://broken.eks.amazonaws.com' },
        { name: 'working-cluster', server: 'https://working.eks.amazonaws.com' },
      ],
      makeApiClient: () => ({
        listDeploymentForAllNamespaces: async () => {
          if (contextName === 'broken') throw Object.assign(new Error('not found'), { code: 'ENOTFOUND' });
          return { body: { items: [{ metadata: { namespace: 'default', name: 'api' } }] } };
        },
        listStatefulSetForAllNamespaces: async () => ({ body: { items: [] } }),
        listDaemonSetForAllNamespaces: async () => ({ body: { items: [] } }),
      }),
    },
  });

  const result = await createEksWorkloadReader({ configBuilder, AppsV1Api: class {} }).listWorkloads();

  assert.deepEqual(result.failedContexts, [{ context: 'broken', code: 'ENOTFOUND' }]);
  assert.equal(result.workloads[0].name, 'api');
  assert.equal(result.estimate.kubernetesRequests, 4);
});