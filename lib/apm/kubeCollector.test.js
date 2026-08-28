'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { KubeCollector, parseCpu, parseMemory } = require('./kubeCollector');

const resource = {
  id: 'workload-1',
  type: 'kubernetes',
  kubeContext: 'eks-dev',
  namespace: 'orders',
  kind: 'Deployment',
  name: 'orders-api',
};

function fixture({ metricsError = null, prometheus = false } = {}) {
  const commits = [];
  const contexts = [];
  const state = { listServiceCalls: 0 };
  const database = {
    getCursor() { return { state: { restartCount: 2 } }; },
    commitMetricBatch(...args) { commits.push(args); },
    setCursor(...args) { commits.push(['cursor', ...args]); },
  };
  const pods = [
    {
      metadata: { name: 'orders-a' },
      status: {
        phase: 'Running',
        conditions: [{ type: 'Ready', status: 'True' }],
        containerStatuses: [{ ready: true, restartCount: 2 }],
      },
    },
    {
      metadata: { name: 'orders-b' },
      status: {
        phase: 'Running',
        conditions: [{ type: 'Ready', status: 'False' }],
        containerStatuses: [{ ready: false, restartCount: 1 }],
      },
    },
  ];
  const clients = {
    apps: {
      async readNamespacedDeployment() {
        return { body: { spec: { selector: { matchLabels: { app: 'orders' } } } } };
      },
    },
    core: {
      async listNamespacedPod(namespace, _a, _b, _c, _d, selector) {
        assert.equal(namespace, 'orders');
        assert.equal(selector, 'app=orders');
        return { body: { items: pods } };
      },
      async readNamespacedPod(name, namespace) {
        assert.equal(namespace, 'orders');
        return { body: pods.find(pod => pod.metadata.name === name) };
      },
      async listServiceForAllNamespaces() {
        state.listServiceCalls += 1;
        return { body: { items: prometheus ? [{
          metadata: { name: 'prometheus', namespace: 'monitoring', labels: { app: 'prometheus' } },
          spec: { ports: [{ name: 'web', port: 9090 }] },
        }] : [] } };
      },
    },
    networking: {
      async readNamespacedIngress(name, namespace) {
        assert.equal(name, 'public');
        assert.equal(namespace, 'orders');
        return { body: { spec: {
          rules: [
            { host: 'shop.example.com', http: { paths: [{ path: '/api' }, { path: '/health' }] } },
            { host: 'shop.example.com', http: { paths: [{ path: '/admin' }] } },
          ],
          tls: [{ hosts: ['shop.example.com'] }],
        } } };
      },
    },
    custom: {
      async listNamespacedCustomObject() {
        if (metricsError) throw metricsError;
        return { body: { items: [
          { metadata: { name: 'orders-a' }, containers: [{ usage: { cpu: '250m', memory: '64Mi' } }] },
          { metadata: { name: 'orders-b' }, containers: [{ usage: { cpu: '100000000n', memory: '1Gi' } }] },
          { metadata: { name: 'unrelated' }, containers: [{ usage: { cpu: '2', memory: '4Gi' } }] },
        ] } };
      },
    },
  };
  const fakeKubeConfig = {
    isolated: true,
    getCurrentCluster() { return { server: 'https://cluster.example.com' }; },
    async applyToRequest() {},
  };
  const requestCalls = [];
  function requestImpl(opts, callback) {
    requestCalls.push(opts);
    // Real proxy path shape: /api/v1/namespaces/<ns>/services/<name:port>/proxy/api/v1/query?query=<PromQL>
    assert.match(opts.uri, /\/api\/v1\/namespaces\/monitoring\/services\/prometheus(:web|:9090)?\/proxy\/api\/v1\/query\?query=/);
    const query = decodeURIComponent(opts.uri.split('query=')[1]);
    const answer = value => callback(null, { statusCode: 200 }, JSON.stringify({ data: { result: [{ value: [0, value] }] } }));
    if (query.includes('kubelet_container_log_filesystem_used_bytes')) return answer('4059136');
    if (query.includes('kube_pod_info')) return answer('23');
    if (query.includes('kube_node_status_capacity') && query.includes('cpu')) return answer('2');
    if (query.includes('kube_node_status_capacity')) return answer('8198209536');
    if (query.includes('container_cpu_usage_seconds_total')) return answer('0.42');
    return answer('123456');
  }
  const collector = new KubeCollector({
    database,
    now: () => Date.UTC(2026, 7, 4, 12, 31),
    requestImpl,
    kubeConfigBuilder(context) {
      contexts.push(context);
      return { kubeConfig: fakeKubeConfig };
    },
    clientFactory(kubeConfig) {
      assert.equal(kubeConfig, fakeKubeConfig);
      return clients;
    },
  });
  return { collector, commits, contexts, requestCalls, get listServiceCalls() { return state.listServiceCalls; } };
}

test('parses Kubernetes CPU and memory quantities', () => {
  assert.equal(parseCpu('250m'), 250000000);
  assert.equal(parseCpu('2'), 2000000000);
  assert.equal(parseMemory('64Mi'), 64 * 1024 ** 2);
  assert.equal(parseMemory('1G'), 1000 ** 3);
});

test('collects metrics, readiness and restart deltas with an isolated context', async () => {
  const subject = fixture();
  const result = await subject.collector.collect({ resource });
  assert.deepEqual(subject.contexts, ['eks-dev']);
  assert.deepEqual(result, {
    status: 'completed', errorCode: null, context: 'eks-dev',
    pods: 2, ready: 1, restarts: 3, restartDelta: 1,
  });
  const [, source, buckets, cursor] = subject.commits[0];
  assert.equal(source, 'metrics.k8s.io');
  assert.equal(buckets.find(bucket => bucket.metricName === 'cpu_cores').sum, 0.35);
  assert.equal(buckets.find(bucket => bucket.metricName === 'memory_bytes').sum, 64 * 1024 ** 2 + 1024 ** 3);
  assert.deepEqual(cursor.state, { restartCount: 3 });
});

test('keeps pod readiness complete when Metrics API usage is unavailable', async () => {
  const error = Object.assign(new Error('the server could not find metrics.k8s.io'), { statusCode: 404 });
  const subject = fixture({ metricsError: error });
  const result = await subject.collector.collect({ resource });
  assert.equal(result.status, 'partial');
  assert.equal(result.errorCode, 'metrics_api_unavailable');
  const buckets = subject.commits[0][2];
  assert.deepEqual(buckets.map(bucket => bucket.metricName), ['pods_ready', 'pods_total', 'restarts_delta']);
  assert.equal(buckets.every(bucket => bucket.quality === 'full'), true);
});

test('falls back to a discovered Prometheus Service for Kubernetes resource usage', async () => {
  const error = Object.assign(new Error('the server could not find metrics.k8s.io'), { statusCode: 404 });
  const subject = fixture({ metricsError: error, prometheus: true });
  const result = await subject.collector.collect({ resource });
  assert.equal(result.status, 'completed');
  assert.equal(result.errorCode, null);
  const [, source, buckets] = subject.commits[0];
  assert.equal(source, 'prometheus:monitoring/prometheus');
  assert.equal(buckets.find(bucket => bucket.metricName === 'cpu_cores').sum, 0.42);
  assert.equal(buckets.find(bucket => bucket.metricName === 'memory_bytes').sum, 123456);
  assert.equal(buckets.find(bucket => bucket.metricName === 'pods_ready').sum, 1);
  assert.deepEqual(subject.commits[1], ['cursor', 'workload-1', 'metrics.k8s.io', {
    timestamp: Date.UTC(2026, 7, 4, 12, 31), state: { restartCount: 3 },
  }]);
  // Real-cluster regression: the query must be sent as a proper proxied HTTP path
  // (namespace/service:port/proxy/api/v1/query?query=<PromQL>), never handed to the
  // client-node generated connectGetNamespacedServiceProxyWithPath() helper, which
  // encodeURIComponent()s the whole subpath as one segment and never reaches Prometheus.
  assert.equal(subject.requestCalls.length, 3);
  for (const opts of subject.requestCalls) {
    assert.equal(opts.uri.startsWith('https://cluster.example.com/api/v1/namespaces/monitoring/services/'), true);
    assert.match(opts.uri, /\/proxy\/api\/v1\/query\?query=sum/);
  }
});

test('collects a Pod directly, instead of failing on every pod of the application', async () => {
  const subject = fixture();
  const result = await subject.collector.collect({
    resource: { id: 'pod-1', type: 'kubernetes', kubeContext: 'eks-dev', kind: 'Pod', name: 'orders-a', namespace: 'orders' },
  });

  assert.equal(result.status, 'completed');
  assert.deepEqual({ pods: result.pods, ready: result.ready }, { pods: 1, ready: 1 });
  const buckets = subject.commits[0][2];
  assert.equal(buckets.find(bucket => bucket.metricName === 'cpu_cores').sum, 0.25);
});

test('collects log volume from Prometheus even when the Metrics API served the usage', async () => {
  const subject = fixture({ prometheus: true });
  await subject.collector.collect({ resource });

  const [, source, buckets] = subject.commits[0];
  // Usage still came from the Metrics API; only the log volume needed Prometheus.
  assert.equal(source, 'metrics.k8s.io');
  assert.equal(buckets.find(bucket => bucket.metricName === 'log_bytes').sum, 4059136);
});

test('never fails a collection because log volume is unavailable, and stops retrying', async () => {
  const subject = fixture({ prometheus: false });
  const result = await subject.collector.collect({ resource });
  await subject.collector.collect({ resource });

  assert.equal(result.status, 'completed');
  assert.equal(subject.commits[0][2].some(bucket => bucket.metricName === 'log_bytes'), false);
  // A cluster without Prometheus is probed once, not once per resource on every run.
  assert.equal(subject.listServiceCalls, 1);
});

test('reports kinds with nothing to measure as topology-only instead of failing the collection', async () => {
  const subject = fixture();
  const result = await subject.collector.collect({
    resource: { id: 'secret-1', type: 'kubernetes', kubeContext: 'eks-dev', kind: 'Secret', name: 'api-secret', namespace: 'orders' },
  });

  // The scheduler collects every Kubernetes resource, so a Secret used to raise an
  // "Unsupported Kubernetes resource kind" error on each one, on every run.
  assert.deepEqual(result, { status: 'topology_only', requests: 0, backlog: false });
  assert.equal(subject.commits.length, 0);
  assert.equal(subject.contexts.length, 0);
});

test('collects cluster Node usage and capacity from Prometheus', async () => {
  const subject = fixture({ prometheus: true });
  const result = await subject.collector.collect({
    resource: { id: 'node-1', type: 'kubernetes', kubeContext: 'eks-dev', kind: 'Node', name: 'ip-10-0-0-1.ec2.internal' },
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.pods, 23);
  const [, source, buckets] = subject.commits[0];
  assert.equal(source, 'prometheus:monitoring/prometheus');
  assert.deepEqual(Object.fromEntries(buckets.map(bucket => [bucket.metricName, bucket.sum])), {
    cpu_cores: 0.42,
    memory_bytes: 123456,
    pods_total: 23,
    node_cpu_capacity_cores: 2,
    node_memory_capacity_bytes: 8198209536,
  });
  // Node names contain dots: a PromQL equality matcher takes them literally, so regex-escaping
  // them (ip-10-0-0-1\.ec2\.internal) would both fail to match and be an invalid string escape.
  for (const opts of subject.requestCalls) {
    assert.equal(decodeURIComponent(opts.uri).includes('ip-10-0-0-1.ec2.internal'), true);
    assert.equal(decodeURIComponent(opts.uri).includes('\\.'), false);
  }
});

test('reports Ingress routing inventory from the Kubernetes API instead of inventing traffic', async () => {
  const subject = fixture();
  const result = await subject.collector.collect({
    resource: { id: 'ingress-1', type: 'kubernetes', kubeContext: 'eks-dev', kind: 'Ingress', name: 'public', namespace: 'orders' },
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.rules, 2);
  const [, source, buckets] = subject.commits[0];
  // No ingress controller is guaranteed to be scraped, so this never queries Prometheus.
  assert.equal(source, 'kubernetes.api');
  assert.equal(subject.requestCalls.length, 0);
  assert.deepEqual(Object.fromEntries(buckets.map(bucket => [bucket.metricName, bucket.sum])), {
    ingress_rules: 2,
    ingress_paths: 3,
    // Two rules share one host, so hosts must be deduplicated rather than counted per rule.
    ingress_hosts: 1,
    ingress_tls_hosts: 1,
  });
});