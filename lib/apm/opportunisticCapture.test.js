'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ApmDatabase } = require('./database');
const {
  captureKubernetesMetrics,
  captureLambdaCloudWatchMetrics,
  captureLambdaLogEvents,
  KUBERNETES_SOURCE,
  OPPORTUNISTIC_SOURCE,
} = require('./opportunisticCapture');

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kua-apm-opportunistic-'));
  const filePath = path.join(directory, 'apm.sqlite3');
  const now = Date.UTC(2026, 7, 4, 12);
  const database = new ApmDatabase({ filePath, now: () => now });
  const application = database.createApplication({
    profileId: 'local:dev', region: 'us-east-1', name: 'orders', environment: 'dev',
  });
  const resource = database.addResource(application.id, {
    type: 'lambda', key: 'arn:orders', name: 'orders-handler',
    logGroup: '/aws/lambda/orders-handler', associationSource: 'manual',
  });
  return { application, database, directory, filePath, now, resource };
}

test('captures only aggregates and deduplicates repeated opportunistic events', () => {
  const subject = fixture();
  const message = 'REPORT RequestId: request-a Duration: 12 ms Billed Duration: 13 ms Memory Size: 128 MB Max Memory Used: 42 MB';
  const events = [{ eventId: 'event-a', timestamp: subject.now - 1000, message }];
  try {
    const first = captureLambdaLogEvents({
      database: subject.database,
      profileId: 'local:dev',
      region: 'us-east-1',
      functionName: 'orders-handler',
      logGroupName: '/aws/lambda/orders-handler',
      events,
    });
    const second = captureLambdaLogEvents({
      database: subject.database,
      profileId: 'local:dev',
      region: 'us-east-1',
      functionName: 'orders-handler',
      logGroupName: '/aws/lambda/orders-handler',
      events,
    });

    assert.equal(first[0].reports, 1);
    assert.equal(second[0].reports, 0);
    const overview = subject.database.getOverview(subject.application.id, { from: 0, to: subject.now });
    assert.equal(overview.metrics.find(metric => metric.metricName === 'invocations_observed').sum, 1);
    assert.equal(subject.database.getCursor(subject.resource.id, OPPORTUNISTIC_SOURCE).boundaryHashes.includes('event-a'), true);
    assert.equal(subject.database.getLatestCollectionRun(subject.application.id).requestCount, 0);
    subject.database.close();
    assert.equal(fs.readFileSync(subject.filePath).includes(Buffer.from(message)), false);
  } finally {
    if (subject.database.db.open) subject.database.close();
    fs.rmSync(subject.directory, { recursive: true, force: true });
  }
});

test('ignores functions outside the associated profile and region', () => {
  const subject = fixture();
  try {
    assert.deepEqual(captureLambdaLogEvents({
      database: subject.database,
      profileId: 'local:other',
      region: 'us-east-1',
      functionName: 'orders-handler',
      events: [],
    }), []);
    assert.deepEqual(captureLambdaLogEvents({
      database: subject.database,
      profileId: 'local:dev',
      region: 'eu-west-1',
      functionName: 'orders-handler',
      events: [],
    }), []);
    assert.equal(subject.database.getLatestCollectionRun(subject.application.id), null);
  } finally {
    subject.database.close();
    fs.rmSync(subject.directory, { recursive: true, force: true });
  }
});

test('upserts already-loaded CloudWatch metrics without double counting', () => {
  const subject = fixture();
  const metrics = {
    Invocations: [
      { t: new Date(subject.now - 10 * 60 * 1000), v: 4 },
      { t: new Date(subject.now - 5 * 60 * 1000), v: 6 },
    ],
    Duration: [
      { t: new Date(subject.now - 10 * 60 * 1000), v: 100 },
      { t: new Date(subject.now - 5 * 60 * 1000), v: 140 },
    ],
    ConcurrentExecutions: [{ t: new Date(subject.now - 5 * 60 * 1000), v: 3 }],
  };
  try {
    const input = {
      database: subject.database,
      profileId: 'local:dev',
      region: 'us-east-1',
      functionName: 'orders-handler',
      logGroupName: '/aws/lambda/orders-handler',
      metrics,
    };
    captureLambdaCloudWatchMetrics(input);
    captureLambdaCloudWatchMetrics(input);

    const overview = subject.database.getOverview(subject.application.id, { from: 0, to: subject.now });
    assert.equal(overview.metrics.find(metric => metric.metricName === 'invocations_cloudwatch').sum, 10);
    assert.equal(overview.metrics.find(metric => metric.metricName === 'duration_cloudwatch_ms').average, 120);
    assert.equal(overview.metrics.find(metric => metric.metricName === 'concurrency_cloudwatch').max, 3);
  } finally {
    subject.database.close();
    fs.rmSync(subject.directory, { recursive: true, force: true });
  }
});

test('upserts already-loaded Kubernetes aggregates without persisting pod details', () => {
  const subject = fixture();
  const resource = subject.database.addResource(subject.application.id, {
    type: 'kubernetes', key: 'eks-dev/orders/Deployment/orders-api', name: 'orders-api',
    kubeContext: 'eks-dev', namespace: 'orders', kind: 'Deployment', associationSource: 'manual',
  });
  const metrics = {
    timestamp: new Date(subject.now - 5 * 60 * 1000).toISOString(),
    source: 'metrics.k8s.io',
    cpu: { cores: 0.35 },
    memory: { bytes: 1140850688 },
    items: [{ name: 'private-pod-name', cpu: '250m', memory: '64Mi' }],
  };
  try {
    const input = {
      database: subject.database,
      kubeContext: 'eks-dev',
      namespace: 'orders',
      resourceType: 'deployments',
      name: 'orders-api',
      metrics,
    };
    captureKubernetesMetrics(input);
    captureKubernetesMetrics(input);

    const cpu = subject.database.getMetricSeries({
      applicationId: subject.application.id,
      resourceId: resource.id,
      metricName: 'cpu_cores',
      from: 0,
      to: subject.now,
    });
    assert.equal(cpu.length, 1);
    assert.equal(cpu[0].sum, 0.35);
    assert.equal(cpu[0].source, KUBERNETES_SOURCE);
    assert.equal(subject.database.getLatestCollectionRun(subject.application.id).requestCount, 0);
    subject.database.close();
    assert.equal(fs.readFileSync(subject.filePath).includes(Buffer.from('private-pod-name')), false);
  } finally {
    if (subject.database.db.open) subject.database.close();
    fs.rmSync(subject.directory, { recursive: true, force: true });
  }
});

test('ignores Kubernetes metrics from a different active context', () => {
  const subject = fixture();
  subject.database.addResource(subject.application.id, {
    type: 'kubernetes', key: 'eks-dev/orders/Deployment/orders-api', name: 'orders-api',
    kubeContext: 'eks-dev', namespace: 'orders', kind: 'Deployment', associationSource: 'manual',
  });
  try {
    assert.deepEqual(captureKubernetesMetrics({
      database: subject.database,
      kubeContext: 'eks-prod',
      namespace: 'orders',
      resourceType: 'deployments',
      name: 'orders-api',
      metrics: { source: 'metrics.k8s.io', cpu: { cores: 1 }, memory: { bytes: 1 } },
    }), []);
    assert.equal(subject.database.getLatestCollectionRun(subject.application.id), null);
  } finally {
    subject.database.close();
    fs.rmSync(subject.directory, { recursive: true, force: true });
  }
});