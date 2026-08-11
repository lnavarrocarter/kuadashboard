'use strict';

const k8s = require('@kubernetes/client-node');
const { buildKubeConfig } = require('../kubeConfigManager');

const WORKLOAD_KINDS = [
  ['Deployment', 'listDeploymentForAllNamespaces'],
  ['StatefulSet', 'listStatefulSetForAllNamespaces'],
  ['DaemonSet', 'listDaemonSetForAllNamespaces'],
];

function isEksContext(context, cluster) {
  const identity = `${context.name} ${context.cluster} ${cluster?.name || ''} ${cluster?.server || ''}`.toLowerCase();
  return identity.includes('arn:aws:eks:') || identity.includes('.eks.amazonaws.com');
}

function isGkeContext(context, cluster) {
  const identity = `${context.name} ${context.cluster} ${cluster?.name || ''} ${cluster?.server || ''}`.toLowerCase();
  return identity.startsWith('gke_') || identity.includes('container.googleapis.com');
}

function contextMatchesProvider(provider, context, cluster) {
  if (provider === 'generic') return true;
  if (provider === 'aws') return isEksContext(context, cluster);
  if (provider === 'gcp') return isGkeContext(context, cluster);
  return provider === 'vercel';
}

function createEksWorkloadReader({ configBuilder = buildKubeConfig, AppsV1Api = k8s.AppsV1Api } = {}) {
  return {
    async listWorkloads({ provider = 'aws' } = {}) {
      const { kubeConfig } = configBuilder();
      const clusters = new Map(kubeConfig.getClusters().map(cluster => [cluster.name, cluster]));
      const contexts = kubeConfig.getContexts().filter(context =>
        contextMatchesProvider(provider, context, clusters.get(context.cluster)));
      const workloads = [];
      const failedContexts = [];
      let requests = 0;

      for (const context of contexts) {
        try {
          const { kubeConfig: scopedConfig } = configBuilder(context.name);
          const apps = scopedConfig.makeApiClient(AppsV1Api);
          for (const [kind, method] of WORKLOAD_KINDS) {
            requests += 1;
            const response = await apps[method]();
            for (const item of response.body?.items || []) {
              workloads.push({
                key: `${context.name}/${item.metadata.namespace}/${kind}/${item.metadata.name}`,
                context: context.name,
                namespace: item.metadata.namespace,
                kind,
                name: item.metadata.name,
                labels: item.metadata.labels || {},
              });
            }
          }
        } catch (error) {
          failedContexts.push({
            context: context.name,
            code: error.code || error.cause?.code || 'CONNECTION_FAILED',
          });
        }
      }

      workloads.sort((left, right) => left.key.localeCompare(right.key));
      return {
        estimate: { awsRequests: 0, kubernetesRequests: requests },
        contexts: contexts.map(context => context.name),
        failedContexts,
        workloads,
      };
    },
  };
}

module.exports = { WORKLOAD_KINDS, contextMatchesProvider, createEksWorkloadReader, isEksContext, isGkeContext };