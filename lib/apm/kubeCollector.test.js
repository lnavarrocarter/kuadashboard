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
      async listServiceForAllNamespaces() {
        return { body: { items: prometheus ? [{
          metadata: { name: 'prometheus', namespace: 'monitoring', labels: { app: 'prometheus' } },
          spec: { ports: [{ name: 'web', port: 9090 }] },
        }] : [] } };
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
    if (query.includes('container_cpu_usage_seconds_total')) {
      callback(null, { statusCode: 200 }, JSON.stringify({ data: { result: [{ value: [0, '0.42'] }] } }));
    } else {
      callback(null, { statusCode: 200 }, JSON.stringify({ data: { result: [{ value: [0, '123456'] }] } }));
    }
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
  return { collector, commits, contexts, requestCalls };
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
  assert.equal(subject.requestCalls.length, 2);
  for (const opts of subject.requestCalls) {
    assert.equal(opts.uri.startsWith('https://cluster.example.com/api/v1/namespaces/monitoring/services/'), true);
    assert.match(opts.uri, /\/proxy\/api\/v1\/query\?query=sum/);
  }
});