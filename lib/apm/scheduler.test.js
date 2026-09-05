'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { ApmScheduler, POLL_INTERVAL_MS } = require('./scheduler');

function fixture() {
  const applications = [
    { id: 'app-a', profileId: 'local:dev', region: 'us-east-1', pollingEnabled: true },
    { id: 'app-b', profileId: 'local:dev', region: 'us-east-1', pollingEnabled: true },
    { id: 'app-off', profileId: 'local:dev', region: 'us-west-2', pollingEnabled: false },
  ];
  const runs = new Map();
  const calls = [];
  let runNumber = 0;
  const database = {
    listApplications() { return applications; },
    getApplication(id) { return applications.find(application => application.id === id) || null; },
    listResources(id) {
      return id === 'app-a'
        ? [{ id: 'lambda-a', type: 'lambda' }, { id: 'kube-a', type: 'kubernetes' }]
        : [{ id: 'lambda-b', type: 'lambda' }];
    },
    startCollectionRun(input) {
      const id = `run-${++runNumber}`;
      runs.set(id, { id, ...input, status: 'running' });
      return id;
    },
    finishCollectionRun(id, result) { Object.assign(runs.get(id), result); },
    getCollectionRun(id) { return runs.get(id); },
  };
  const scheduler = new ApmScheduler({
    database,
    awsCollector: {
      async collect({ application, resource }) {
        calls.push(`${application.id}:${resource.id}`);
        return resource.id === 'lambda-b'
          ? { status: 'budget_exhausted', requests: 0, backlog: true }
          : { status: 'completed', requests: 1, backlog: false };
      },
    },
    kubeCollector: {
      async collect({ application, resource }) {
        calls.push(`${application.id}:${resource.id}`);
        return { status: 'partial', errorCode: 'metrics_api_unavailable' };
      },
    },
  });
  return { scheduler, calls, runs };
}

test('uses a fixed 30-minute interval without an immediate catch-up run', () => {
  let callback;
  let interval;
  const scheduler = new ApmScheduler({
    database: {}, awsCollector: {}, kubeCollector: {},
    timers: {
      setInterval(next, milliseconds) { callback = next; interval = milliseconds; return { unref() {} }; },
      clearInterval() {},
    },
  });
  scheduler.start();
  assert.equal(interval, POLL_INTERVAL_MS);
  assert.equal(typeof callback, 'function');
});

test('serializes applications in one profile/region and records partial and budget states', async () => {
  const subject = fixture();
  const [scopeResults] = await subject.scheduler.runScheduled();
  assert.deepEqual(subject.calls, ['app-a:lambda-a', 'app-a:kube-a', 'app-b:lambda-b']);
  assert.equal(scopeResults[0].run.status, 'partial');
  assert.equal(scopeResults[0].run.errorCode, 'metrics_api_unavailable');
  assert.equal(scopeResults[0].run.requestCount, 1);
  assert.equal(scopeResults[1].run.status, 'budget_exhausted');
  assert.equal(scopeResults[1].run.backlog, true);
  assert.equal(subject.calls.some(call => call.startsWith('app-off:')), false);
});

test('rejects overlapping collection in the same profile and region', async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const subject = fixture();
  subject.scheduler.awsCollector.collect = async () => pending;
  const first = subject.scheduler.collectApplication('app-a');
  const overlap = await subject.scheduler.collectApplication('app-b');
  assert.deepEqual(overlap, { skipped: true, reason: 'collection_in_progress' });
  release({ status: 'completed', requests: 1 });
  await first;
});

test('records expired AWS credentials as a stable error code', async () => {
  const subject = fixture();
  subject.scheduler.awsCollector.collect = async () => {
    throw Object.assign(new Error('The security token included in the request is expired'), {
      name: 'ExpiredTokenException',
      apmRequestCount: 1,
    });
  };

  const result = await subject.scheduler.collectApplication('app-a');
  assert.equal(result.run.status, 'partial');
  assert.equal(result.run.errorCode, 'credentials_expired');
  assert.equal(result.run.requestCount, 1);
  assert.equal(result.resources[0].errorCode, 'credentials_expired');
  assert.equal(result.resources[0].requests, 1);
});

test('routes CloudWatch-backed resources to the metric collector and counts their billable requests', async () => {
  const subject = fixture();
  const collected = [];
  subject.scheduler.database.listResources = () => [
    { id: 'ec2-a', type: 'ec2' },
    { id: 'iam-a', type: 'iam' },
  ];
  subject.scheduler.awsMetricCollector = {
    supports: resource => resource.type === 'ec2',
    async collect({ resource }) {
      collected.push(resource.id);
      return { status: 'completed', requests: 1, backlog: false };
    },
  };

  const result = await subject.scheduler.collectApplication('app-a');

  assert.deepEqual(collected, ['ec2-a'], 'only resources the collector supports may be billed');
  assert.equal(result.run.requestCount, 1);
  // A type no collector supports stays inventory instead of failing the run.
  assert.equal(result.resources.find(item => item.resourceId === 'iam-a').status, 'topology_only');
  assert.equal(result.run.status, 'completed');
});