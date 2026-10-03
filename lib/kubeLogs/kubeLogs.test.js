'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const { createKubeLogClient, parseWorkloadGroup, parseLogText, logUnits } = require('./kubeLogClient');
const { createKubeLogsRouter } = require('./routes');
const { createLogCache } = require('../awsLogCache');

// Routes compute query ranges with the real clock: keep the fixture just behind it.
const NOW = Math.floor(Date.now() / 1000) * 1000 - 5 * 60000;
const iso = ms => new Date(ms).toISOString().replace('Z', '123456Z');

function pod(name, { restarts = 0, owner = true, containers = ['app'] } = {}) {
  return {
    metadata: { name, namespace: 'shop', ownerReferences: owner ? [{ kind: 'ReplicaSet' }] : [] },
    spec: { containers: containers.map(c => ({ name: c })) },
    status: { containerStatuses: containers.map(c => ({ name: c, restartCount: restarts, ready: true })) },
  };
}

/** Fake CoreV1/AppsV1 with two pods of deployment "api" and recorded log reads. */
function fakeCluster(logs) {
  const reads = [];
  const core = {
    async readNamespacedPod(name) { return { body: pod(name, { owner: false }) }; },
    async listNamespacedPod(namespace, a, b, c, d, selector) { return { body: { items: selector === 'app=api' ? [pod('api-1', { restarts: 1 }), pod('api-2')] : [pod('debug', { owner: false })] } }; },
    async listPodForAllNamespaces() { return { body: { items: [pod('api-1'), pod('debug', { owner: false })] } }; },
    async readNamespacedPodLog(name, namespace, container, follow, skip, limitBytes, pretty, previous, sinceSeconds, tailLines, timestamps) {
      reads.push({ name, container, previous, sinceSeconds, timestamps, limitBytes });
      return { body: logs[`${name}${previous ? ':previous' : ''}`] || '' };
    },
  };
  const deployment = { metadata: { name: 'api', namespace: 'shop' }, spec: { selector: { matchLabels: { app: 'api' } } }, status: { replicas: 2, readyReplicas: 2 } };
  const apps = {
    async readNamespacedDeployment() { return { body: deployment }; },
    async listNamespacedDeployment() { return { body: { items: [deployment] } }; },
    async listDeploymentForAllNamespaces() { return { body: { items: [deployment] } }; },
    async listNamespacedStatefulSet() { return { body: { items: [] } }; },
    async listStatefulSetForAllNamespaces() { return { body: { items: [] } }; },
    async listNamespacedDaemonSet() { return { body: { items: [] } }; },
    async listDaemonSetForAllNamespaces() { return { body: { items: [] } }; },
  };
  return { core, apps, reads };
}

const LOGS = {
  'api-1': `${iso(NOW - 120000)} INFO started\n${iso(NOW - 60000)} ERROR connect ECONNREFUSED 10.0.0.5:5432\n${iso(NOW - 59000)} ERROR connect ECONNREFUSED 10.0.0.5:5432\n`,
  'api-1:previous': `${iso(NOW - 7200000)} FATAL out of memory\n`,
  'api-2': `${iso(NOW - 30000)} WARN slow query took 900 ms\nnot a timestamped line\n`,
};

test('workload groups are <namespace>/<kind>/<name>', () => {
  assert.deepEqual(parseWorkloadGroup('shop/deployments/api'), { namespace: 'shop', kind: 'deployments', name: 'api' });
  assert.equal(parseWorkloadGroup('shop/configmaps/api'), null);
  assert.equal(parseWorkloadGroup('../etc/passwd'), null);
});

test('log lines become events with stable ids, also for repeated identical lines', () => {
  const unit = { pod: 'api-1', container: 'app', previous: false };
  const first = parseLogText(LOGS['api-1'], unit);
  assert.equal(first.length, 3);
  assert.equal(first[0].timestamp, NOW - 120000);
  assert.equal(first[1].message, 'ERROR connect ECONNREFUSED 10.0.0.5:5432');
  assert.notEqual(first[1].eventId, first[2].eventId, 'same message at another time: two events');
  const twice = parseLogText(`${iso(NOW)} same\n${iso(NOW)} same\n`, unit);
  assert.notEqual(twice[0].eventId, twice[1].eventId, 'identical lines get their own ids');
  assert.deepEqual(parseLogText(LOGS['api-1'], unit).map(e => e.eventId), first.map(e => e.eventId), 'reading again gives the same ids');
  assert.equal(first[0].logStreamName, 'api-1/app');
  assert.equal(parseLogText(LOGS['api-1'], unit, { from: NOW - 90000 }).length, 2);
});

test('restarted containers also read their previous instance', () => {
  assert.deepEqual(logUnits([pod('a', { restarts: 2 }), pod('b')]).map(u => `${u.pod}:${u.previous}`), ['a:true', 'a:false', 'b:false']);
});

test('the client pages one container per FilterLogEvents response', async () => {
  const cluster = fakeCluster(LOGS);
  const client = createKubeLogClient(cluster, { now: () => NOW });
  const input = { logGroupName: 'shop/deployments/api', startTime: NOW - 3 * 3600000, endTime: NOW + 1 };
  const pages = [];
  let nextToken;
  do {
    const response = await client.send({ input: { ...input, nextToken } });
    pages.push(response.events.length);
    nextToken = response.nextToken;
  } while (nextToken);
  assert.deepEqual(pages, [1, 3, 1], 'api-1 previous, api-1, api-2');
  assert.ok(cluster.reads.every(read => read.timestamps === true && read.sinceSeconds >= 3 * 3600));
  await assert.rejects(client.send({ input: { logGroupName: 'nope' } }), /Not a Kubernetes workload/);
});

async function serve(router) {
  const app = express();
  app.use(express.json());
  app.use('/api/kube-logs', router);
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/kube-logs`;
  const call = async (path, { method = 'GET', body } = {}) => {
    const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
    return { status: response.status, body: response.status === 204 ? null : await response.json() };
  };
  return { call, close: () => new Promise(resolve => server.close(resolve)) };
}

test('routes: list workloads, cache one, analyze it and query it like CloudWatch', async () => {
  const cluster = fakeCluster(LOGS);
  const cache = createLogCache({ dataDir: ':memory:', now: () => NOW });
  const scans = [];
  const runner = { list: () => scans, activeCount: () => 0, start: scan => { scans.push(scan); return { id: 1, ...scan }; }, get: () => null };
  // makeApiClient returns our fakes by API class.
  const k8s = { CoreV1Api: 'core', AppsV1Api: 'apps', KubeConfig: class {} };
  const kubeConfig = { makeApiClient: api => cluster[api] };
  const { call, close } = await serve(createKubeLogsRouter({ k8s, getKubeConfig: () => kubeConfig, getContext: () => 'dev', cache: () => cache, runner: () => runner }));
  try {
    const workloads = await call('/workloads?namespace=shop');
    assert.deepEqual(workloads.body.workloads.map(w => [w.group, w.pods, w.cached]), [['shop/deployments/api', 2, false], ['shop/pods/debug', 1, false]]);

    const bad = await call('/log-cache', { method: 'POST', body: { group: 'shop/configmaps/x' } });
    assert.equal(bad.status, 400);

    const synced = await call('/log-cache', { method: 'POST', body: { group: 'shop/deployments/api', historyHours: 3 } });
    assert.equal(synced.status, 200, JSON.stringify(synced.body));
    const summary = await call('/log-cache');
    assert.equal(summary.body.groups[0].logGroup, 'shop/deployments/api');
    assert.equal(summary.body.groups[0].region, 'shop');
    // Every container, including the OOM of the previous instance of api-1.
    assert.equal(summary.body.groups[0].events, 5);
    const resynced = await call('/log-cache/sync', { method: 'POST', body: { group: 'shop/deployments/api' } });
    assert.equal(resynced.status, 200, JSON.stringify(resynced.body));
    assert.equal(resynced.body.groups[0].events, 5, 'a new sync stores each line once');

    const intel = await call('/log-intelligence?group=shop/deployments/api');
    assert.equal(intel.body.provider, 'kubernetes');
    assert.equal(intel.body.last24h.errors, 3);
    assert.ok(intel.body.signatures.some(s => /ECONNREFUSED/.test(s.signature)));
    assert.ok(!intel.body.recommendations.some(r => r.id === 'cost_retention'), 'no CloudWatch retention advice for Kubernetes');
    assert.ok(intel.body.recommendations.some(r => r.id === 'fix_connection'));

    const events = await call('/log-intelligence/events?group=shop/deployments/api&level=error');
    assert.equal(events.body.events.length, 3);

    const query = await call('/log-groups/query', { method: 'POST', body: { group: 'shop/deployments/api', source: 'cache', minutes: 1440, query: 'stats count(*) as n by @logStream' } });
    assert.equal(query.status, 200, JSON.stringify(query.body));
    assert.equal(query.body.rows.reduce((sum, row) => sum + Number(row.n), 0), 5);

    const scan = await call('/log-scans', { method: 'POST', body: { group: 'shop/deployments/api', days: 2 } });
    assert.equal(scan.status, 201);
    assert.equal(scans[0].profileId, 'k8s:dev');
    assert.equal(scans[0].region, 'shop');

    assert.equal((await call('/log-cache?group=shop/deployments/api', { method: 'DELETE' })).body.groups.length, 0);
  } finally {
    await close();
  }
});
