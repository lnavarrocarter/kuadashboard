'use strict';

const k8s = require('@kubernetes/client-node');
const request = require('request');
const { buildKubeConfig } = require('../kubeConfigManager');
const { BUCKET_MS } = require('./lambdaLogMetrics');

const SOURCE = 'metrics.k8s.io';
const PROMETHEUS_SOURCE = 'prometheus';

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

function prometheusServiceScore(service = {}) {
  const metadata = service.metadata || {};
  const labels = metadata.labels || {};
  const text = [metadata.name, metadata.namespace, ...Object.keys(labels), ...Object.values(labels)].join(' ').toLowerCase();
  if (/alertmanager|grafana|operator|node-exporter|kube-state-metrics/.test(text)) return 0;
  let score = 0;
  if (labels['app.kubernetes.io/name'] === 'prometheus' || labels.app === 'prometheus') score += 8;
  if (String(metadata.name || '').toLowerCase().includes('prometheus')) score += 5;
  if ((service.spec?.ports || []).some(port => Number(port.port) === 9090 || Number(port.targetPort) === 9090)) score += 4;
  return score;
}

function prometheusServiceCandidates(service = {}) {
  const name = service.metadata?.name;
  const ports = service.spec?.ports || [];
  return [...new Set([name, ...ports.flatMap(port => [
    port.name ? `${name}:${port.name}` : null,
    port.port ? `${name}:${port.port}` : null,
  ])].filter(Boolean))];
}

function prometheusScalar(response) {
  const body = responseBody(response);
  const value = body?.data?.result?.[0]?.value?.[1];
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function prometheusQueryPath(query) {
  return `api/v1/query?query=${encodeURIComponent(query)}`;
}

function regexEscape(value = '') {
  return String(value).replace(/[|\\{}()[\]^$+*?.]/g, '\\$&');
}

// The @kubernetes/client-node generated connectGetNamespacedServiceProxyWithPath()
// re-encodes its whole `path` argument as a single URI segment (encodeURIComponent),
// which mangles the `/`, `?` and `=` in a PromQL proxy subpath and never actually
// reaches the Prometheus service on a real cluster. Build the proxy request
// ourselves instead, the same way server.js's working kubeApiGet()/prometheusQuery() do.
function kubeProxyGet(kubeConfig, pathname, requestImpl = request) {
  const cluster = kubeConfig.getCurrentCluster();
  if (!cluster?.server) return Promise.reject(new Error('No active Kubernetes cluster server'));
  const opts = {
    method: 'GET',
    uri: `${cluster.server.replace(/\/$/, '')}${pathname}`,
    json: false,
    timeout: 10000,
  };
  return kubeConfig.applyToRequest(opts).then(() => new Promise((resolve, reject) => {
    requestImpl(opts, (error, response, body) => {
      if (error) return reject(error);
      if (response.statusCode < 200 || response.statusCode > 299) {
        const err = new Error(`HTTP ${response.statusCode}: ${String(body || '').slice(0, 220)}`);
        err.statusCode = response.statusCode;
        return reject(err);
      }
      try {
        resolve(typeof body === 'string' ? JSON.parse(body) : body);
      } catch (parseError) {
        reject(parseError);
      }
    });
  }));
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
    requestImpl = request,
  }) {
    if (!database) throw new Error('database is required');
    this.database = database;
    this.kubeConfigBuilder = kubeConfigBuilder;
    this.clientFactory = clientFactory;
    this.now = now;
    this.requestImpl = requestImpl;
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

  async _collectPrometheusUsage(kubeConfig, namespace, podNames, clients) {
    if (!clients.core?.listServiceForAllNamespaces) {
      throw new Error('Prometheus Service proxy is unavailable');
    }
    const services = (responseBody(await clients.core.listServiceForAllNamespaces()).items || [])
      .map(service => ({ service, score: prometheusServiceScore(service) }))
      .filter(item => item.score > 0)
      .sort((left, right) => right.score - left.score)
      .map(item => item.service);
    if (!services.length) throw new Error('No Prometheus Service found');
    const names = [...podNames];
    const podMatcher = names.length === 1 ? `pod="${names[0]}"` : `pod=~"${names.map(regexEscape).join('|')}"`;
    const scope = `namespace="${namespace}",${podMatcher},container!="",container!="POD"`;
    const queries = [
      `sum(rate(container_cpu_usage_seconds_total{${scope}}[5m]))`,
      `sum(container_memory_working_set_bytes{${scope}})`,
    ];
    let lastError = null;
    for (const service of services) {
      for (const target of prometheusServiceCandidates(service)) {
        try {
          const [cpu, memory] = await Promise.all(queries.map(query => kubeProxyGet(
            kubeConfig,
            `/api/v1/namespaces/${service.metadata.namespace}/services/${target}/proxy/${prometheusQueryPath(query)}`,
            this.requestImpl,
          )));
          return {
            cpuCores: prometheusScalar(cpu),
            memoryBytes: prometheusScalar(memory),
            service: `${service.metadata.namespace}/${service.metadata.name}`,
          };
        } catch (error) {
          lastError = error;
        }
      }
    }
    throw lastError || new Error('Prometheus query failed');
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
    let source = SOURCE;

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
      try {
        const usage = await this._collectPrometheusUsage(kubeConfig, namespace, podNames, clients);
        buckets.push(metric('cpu_cores', 'cores', usage.cpuCores));
        buckets.push(metric('memory_bytes', 'bytes', usage.memoryBytes));
        source = `${PROMETHEUS_SOURCE}:${usage.service}`;
      } catch (_) {
        status = 'partial';
        errorCode = 'metrics_api_unavailable';
      }
    }

    this.database.commitMetricBatch(
      resource.id,
      source,
      buckets.map(bucket => ({ bucketStart, ...bucket })),
      {
        timestamp,
        state: { restartCount: restarts },
      },
    );
    if (source !== SOURCE) {
      this.database.setCursor?.(resource.id, SOURCE, { timestamp, state: { restartCount: restarts } });
    }
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
  PROMETHEUS_SOURCE,
  SOURCE,
  isMetricsApiUnavailable,
  parseCpu,
  parseMemory,
  selectorToString,
};