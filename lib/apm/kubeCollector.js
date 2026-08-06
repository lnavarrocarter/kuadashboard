'use strict';

const k8s = require('@kubernetes/client-node');
const { buildKubeConfig } = require('../kubeConfigManager');
const { BUCKET_MS } = require('./lambdaLogMetrics');

const SOURCE = 'metrics.k8s.io';

function responseBody(response) {
  return response?.body || response || {};
}

function parseCpu(value = '0') {
  const raw = String(value);
  const number = Number.parseFloat(raw);
  if (!Number.isFinite(number)) return 0;
  if (raw.endsWith('n')) return number;
  if (raw.endsWith('u')) return number * 1000;
  if (raw.endsWith('m')) return number * 1e6;
  return number * 1e9;
}

function parseMemory(value = '0') {
  const raw = String(value);
  const number = Number.parseFloat(raw);
  if (!Number.isFinite(number)) return 0;
  const unit = raw.slice(String(number).length);
  const factors = {
    Ki: 1024,
    Mi: 1024 ** 2,
    Gi: 1024 ** 3,
    Ti: 1024 ** 4,
    K: 1000,
    M: 1000 ** 2,
    G: 1000 ** 3,
    T: 1000 ** 4,
  };
  return number * (factors[unit] || 1);
}

function selectorToString(selector = {}) {
  const parts = [];
  for (const [key, value] of Object.entries(selector.matchLabels || selector || {})) {
    parts.push(`${key}=${value}`);
  }
  for (const expression of selector.matchExpressions || []) {
    const values = (expression.values || []).join(',');
    if (expression.operator === 'In') parts.push(`${expression.key} in (${values})`);
    else if (expression.operator === 'NotIn') parts.push(`${expression.key} notin (${values})`);
    else if (expression.operator === 'Exists') parts.push(expression.key);
    else if (expression.operator === 'DoesNotExist') parts.push(`!${expression.key}`);
  }
  return parts.join(',');
}

function isMetricsApiUnavailable(error) {
  const message = error?.body?.message || error?.message || '';
  return error?.statusCode === 404 || error?.response?.statusCode === 404 ||
    /metrics\.k8s\.io|not found|the server could not find|not have a resource type/i.test(message);
}

function metric(metricName, unit, value, quality = 'full') {
  return {
    metricName,
    unit,
    count: 1,
    sum: value,
    min: value,
    max: value,
    last: value,
    quality,
  };
}

function podReady(pod) {
  const readyCondition = (pod.status?.conditions || []).find(condition => condition.type === 'Ready');
  if (readyCondition) return readyCondition.status === 'True';
  const statuses = pod.status?.containerStatuses || [];
  return statuses.length > 0 && statuses.every(status => status.ready);
}

function podRestarts(pod) {
  return (pod.status?.containerStatuses || []).reduce((sum, status) => sum + (Number(status.restartCount) || 0), 0);
}

class KubeCollector {
  constructor({
    database,
    kubeConfigBuilder = buildKubeConfig,
    clientFactory = kubeConfig => ({
      core: kubeConfig.makeApiClient(k8s.CoreV1Api),
      apps: kubeConfig.makeApiClient(k8s.AppsV1Api),
      custom: kubeConfig.makeApiClient(k8s.CustomObjectsApi),
    }),
    now = () => Date.now(),
  }) {
    if (!database) throw new Error('database is required');
    this.database = database;
    this.kubeConfigBuilder = kubeConfigBuilder;
    this.clientFactory = clientFactory;
    this.now = now;
  }

  async _resolvePods(resource, clients) {
    const namespace = resource.namespace || 'default';
    const kind = String(resource.kind || '').toLowerCase();
    let selector;
    if (kind === 'deployment') {
      const workload = responseBody(await clients.apps.readNamespacedDeployment(resource.name, namespace));
      selector = selectorToString(workload.spec?.selector);
    } else if (kind === 'statefulset') {
      const workload = responseBody(await clients.apps.readNamespacedStatefulSet(resource.name, namespace));
      selector = selectorToString(workload.spec?.selector);
    } else if (kind === 'daemonset') {
      const workload = responseBody(await clients.apps.readNamespacedDaemonSet(resource.name, namespace));
      selector = selectorToString(workload.spec?.selector);
    } else if (kind === 'service') {
      const service = responseBody(await clients.core.readNamespacedService(resource.name, namespace));
      selector = selectorToString(service.spec?.selector);
    } else {
      throw new Error(`Unsupported Kubernetes resource kind: ${resource.kind || '(empty)'}`);
    }
    if (!selector) throw new Error(`No pod selector found for ${resource.kind}/${resource.name}`);
    const response = await clients.core.listNamespacedPod(
      namespace, undefined, undefined, undefined, undefined, selector,
    );
    return (responseBody(response).items || [])
      .filter(pod => !['Succeeded', 'Failed'].includes(pod.status?.phase));
  }

  async collect({ resource }) {
    if (resource?.type !== 'kubernetes') throw new Error('Kubernetes collector only supports Kubernetes resources');
    if (!resource.kubeContext) throw new Error('Kubernetes context is required');
    const { kubeConfig } = this.kubeConfigBuilder(resource.kubeContext);
    const clients = this.clientFactory(kubeConfig);
    const pods = await this._resolvePods(resource, clients);
    const namespace = resource.namespace || 'default';
    const podNames = new Set(pods.map(pod => pod.metadata?.name).filter(Boolean));
    const ready = pods.filter(podReady).length;
    const restarts = pods.reduce((sum, pod) => sum + podRestarts(pod), 0);
    const cursor = this.database.getCursor(resource.id, SOURCE) || {};
    const previousRestarts = Number(cursor.state?.restartCount) || 0;
    const restartDelta = Math.max(0, restarts - previousRestarts);
    const timestamp = this.now();
    const bucketStart = Math.floor(timestamp / BUCKET_MS) * BUCKET_MS;
    const buckets = [
      metric('pods_ready', 'count', ready),
      metric('pods_total', 'count', pods.length),
      metric('restarts_delta', 'count', restartDelta),
    ];
    let status = 'completed';
    let errorCode = null;

    try {
      const response = await clients.custom.listNamespacedCustomObject(
        'metrics.k8s.io', 'v1beta1', namespace, 'pods',
      );
      const metricItems = (responseBody(response).items || [])
        .filter(item => podNames.has(item.metadata?.name));
      const containers = metricItems.flatMap(item => item.containers || []);
      const cpuNano = containers.reduce((sum, container) => sum + parseCpu(container.usage?.cpu), 0);
      const memoryBytes = containers.reduce((sum, container) => sum + parseMemory(container.usage?.memory), 0);
      buckets.push(metric('cpu_cores', 'cores', cpuNano / 1e9));
      buckets.push(metric('memory_bytes', 'bytes', memoryBytes));
    } catch (error) {
      if (!isMetricsApiUnavailable(error)) throw error;
      status = 'partial';
      errorCode = 'metrics_api_unavailable';
      buckets.forEach(bucket => { bucket.quality = 'partial'; });
    }

    this.database.commitMetricBatch(
      resource.id,
      SOURCE,
      buckets.map(bucket => ({ bucketStart, ...bucket })),
      {
        timestamp,
        state: { restartCount: restarts },
      },
    );
    return {
      status,
      errorCode,
      context: resource.kubeContext,
      pods: pods.length,
      ready,
      restarts,
      restartDelta,
    };
  }
}

module.exports = {
  KubeCollector,
  SOURCE,
  isMetricsApiUnavailable,
  parseCpu,
  parseMemory,
  selectorToString,
};