'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { ApmDatabase } = require('./database');

function fixture(now = Date.UTC(2026, 7, 4, 12)) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kua-apm-db-'));
  const filePath = path.join(directory, 'apm.sqlite3');
  const database = new ApmDatabase({ filePath, now: () => now });
  return {
    database,
    directory,
    filePath,
    close() {
      database.close();
      fs.rmSync(directory, { recursive: true, force: true });
    },
  };
}

function addApplicationAndResource(database) {
  const application = database.createApplication({
    profileId: 'local:dev',
    region: 'us-east-1',
    name: 'orders',
    environment: 'dev',
    pollingEnabled: true,
  });
  const resource = database.addResource(application.id, {
    type: 'lambda',
    key: 'arn:aws:lambda:us-east-1:123:function:orders',
    arn: 'arn:aws:lambda:us-east-1:123:function:orders',
    name: 'orders',
    logGroup: '/aws/lambda/orders',
    associationSource: 'manual',
    metadata: { Application: 'orders' },
  });
  return { application, resource };
}

test('creates a private WAL database and migrates once', () => {
  const subject = fixture();
  try {
    assert.equal(subject.database.health().schemaVersion, 12);
    assert.equal(subject.database.health().journalMode, 'wal');
    assert.equal(fs.statSync(subject.directory).mode & 0o777, 0o700);
    assert.equal(fs.statSync(subject.filePath).mode & 0o777, 0o600);
    assert.equal(fs.statSync(`${subject.filePath}-wal`).mode & 0o777, 0o600);
    assert.equal(fs.statSync(`${subject.filePath}-shm`).mode & 0o777, 0o600);
    subject.database.close();
    const reopened = new ApmDatabase({ filePath: subject.filePath });
    assert.equal(reopened.health().schemaVersion, 12);
    reopened.close();
  } finally {
    fs.rmSync(subject.directory, { recursive: true, force: true });
  }
});

test('persists validated application thresholds', () => {
  const subject = fixture();
  try {
    const { application } = addApplicationAndResource(subject.database);
    assert.deepEqual(application.thresholds, {
      errorRatePercent: 5, durationMs: 1000, readyPodsPercent: 100, restartDelta: 1,
    });
    assert.deepEqual(subject.database.updateThresholds(application.id, {
      errorRatePercent: 2.5,
      restartDelta: null,
    }), {
      errorRatePercent: 2.5, durationMs: 1000, readyPodsPercent: 100, restartDelta: null,
    });
    assert.throws(
      () => subject.database.updateThresholds(application.id, { readyPodsPercent: 101 }),
      /Invalid threshold value/,
    );
  } finally {
    subject.close();
  }
});

test('stores applications, resources and confirmed edges with cascade deletes', () => {
  const subject = fixture();
  try {
    const { application, resource } = addApplicationAndResource(subject.database);
    assert.equal(JSON.stringify(resource).includes('Application'), false);
    const workload = subject.database.addResource(application.id, {
      type: 'kubernetes',
      key: 'context-a/default/deployment/orders-api',
      kubeContext: 'context-a',
      namespace: 'default',
      kind: 'Deployment',
      name: 'orders-api',
      associationSource: 'labels',
    });
    subject.database.addEdge(application.id, {
      sourceResourceId: resource.id,
      targetResourceId: workload.id,
    });
    assert.equal(subject.database.listResources(application.id).length, 2);
    assert.equal(subject.database.listEdges(application.id).length, 1);
    assert.equal(subject.database.deleteApplication(application.id), true);
    assert.equal(subject.database.listResources(application.id).length, 0);
    assert.equal(subject.database.listEdges(application.id).length, 0);
  } finally {
    subject.close();
  }
});

test('stores deployment resources as topology without arbitrary metadata', () => {
  const subject = fixture();
  try {
    const application = subject.database.createApplication({
      profileId: 'local:dev', region: 'us-east-1', name: 'publication', environment: 'dev',
    });
    for (const resource of [
      { type: 'sqs', key: 'queue', name: 'DispatcherQueue' },
      { type: 'eventbridge', key: 'rule', name: 'DispatchRule', service: 'Autoatencion' },
      { type: 'stepfunctions', key: 'state-machine', name: 'PublicationWorkflow' },
      { type: 'ecs', key: 'service', name: 'publicacion-service', service: 'Publicacion-Cluster' },
    ]) {
      subject.database.addResource(application.id, {
        ...resource,
        associationSource: 'deployment',
        metadata: { secret: 'must-not-be-stored' },
      });
    }
    const resources = subject.database.listResources(application.id);
    assert.deepEqual(resources.map(resource => resource.type), ['ecs', 'eventbridge', 'sqs', 'stepfunctions']);
    assert.equal(resources.every(resource => !('metadata' in resource)), true);
  } finally {
    subject.close();
  }
});

test('stores provider-scoped multicloud applications and resources', () => {
  const subject = fixture();
  try {
    const application = subject.database.createApplication({
      provider: 'gcp', profileId: 'gcp:dev', region: 'us-central1', name: 'checkout',
    });
    const cloudRun = subject.database.addResource(application.id, {
      provider: 'gcp', type: 'gcp-cloud-run', key: 'us-central1/checkout', name: 'checkout',
      associationSource: 'manual',
    });
    const gke = subject.database.addResource(application.id, {
      provider: 'gcp', type: 'kubernetes', key: 'gke-dev/default/Deployment/checkout',
      kubeContext: 'gke-dev', namespace: 'default', kind: 'Deployment', name: 'checkout',
      associationSource: 'manual',
    });

    assert.equal(application.provider, 'gcp');
    assert.equal(cloudRun.provider, 'gcp');
    assert.equal(gke.provider, 'gcp');
    assert.deepEqual(subject.database.listApplications({ provider: 'aws' }), []);
    assert.deepEqual(subject.database.listApplications({ provider: 'gcp' }).map(item => item.id), [application.id]);
  } finally {
    subject.close();
  }
});

test('stores a provider-free Kubernetes application in the generic scope', () => {
  const subject = fixture();
  try {
    const application = subject.database.createApplication({
      provider: 'generic', profileId: 'local', region: 'local', name: 'shared-platform',
    });
    const workload = subject.database.addResource(application.id, {
      provider: 'generic', type: 'kubernetes', key: 'docker/default/Deployment/api',
      kubeContext: 'docker', namespace: 'default', kind: 'Deployment', name: 'api',
      associationSource: 'manual',
    });

    assert.equal(application.provider, 'generic');
    assert.equal(workload.provider, 'generic');
    assert.deepEqual(subject.database.listApplications({ provider: 'generic' }).map(item => item.id), [application.id]);
    assert.deepEqual(subject.database.listApplications({ provider: 'aws' }), []);
  } finally {
    subject.close();
  }
});

test('upserts metric aggregates idempotently', () => {
  const subject = fixture();
  try {
    const { application, resource } = addApplicationAndResource(subject.database);
    const bucketStart = Date.UTC(2026, 7, 4, 12);
    subject.database.upsertMetricBucket({
      resourceId: resource.id, bucketStart, metricName: 'duration_ms', unit: 'ms',
      count: 2, sum: 30, min: 10, max: 20, last: 20, source: 'cloudwatch_logs', quality: 'full',
    });
    const aggregate = {
      resourceId: resource.id, bucketStart, metricName: 'duration_ms', unit: 'ms',
      count: 3, sum: 55, min: 10, max: 25, last: 25, source: 'cloudwatch_logs', quality: 'partial',
    };
    subject.database.upsertMetricBucket(aggregate);
    subject.database.upsertMetricBucket(aggregate);
    const [point] = subject.database.getMetricSeries({
      applicationId: application.id,
      metricName: 'duration_ms',
      from: bucketStart,
      to: bucketStart,
    });
    assert.deepEqual(
      { count: point.count, sum: point.sum, min: point.min, max: point.max, last: point.last, average: point.average, quality: point.quality },
      { count: 3, sum: 55, min: 10, max: 25, last: 25, average: 55 / 3, quality: 'partial' },
    );
  } finally {
    subject.close();
  }
});

test('groups overview metrics per resource type and kind, and filters series the same way', () => {
  const subject = fixture();
  try {
    const { application } = addApplicationAndResource(subject.database);
    const deployment = subject.database.addResource(application.id, {
      type: 'kubernetes', key: 'ctx/orders/Deployment/api', name: 'api', kind: 'Deployment',
      namespace: 'orders', kubeContext: 'ctx', associationSource: 'manual',
    });
    const bucketStart = Date.UTC(2026, 7, 4, 12);
    subject.database.upsertMetricBucket({
      resourceId: deployment.id, bucketStart, metricName: 'cpu_cores', unit: 'cores',
      count: 1, sum: 2, min: 2, max: 2, last: 2, source: 'prometheus', quality: 'full',
    });

    const overview = subject.database.getOverview(application.id, { from: bucketStart, to: bucketStart });
    const cpuRow = overview.metricsByResourceType.find(row => row.metricName === 'cpu_cores');
    assert.equal(cpuRow.resourceType, 'kubernetes');
    assert.equal(cpuRow.kind, 'Deployment');
    assert.equal(cpuRow.sum, 2);
    // The flat, application-wide aggregate stays available for existing consumers.
    assert.equal(overview.metrics.find(row => row.metricName === 'cpu_cores').sum, 2);

    assert.equal(subject.database.getMetricSeries({
      applicationId: application.id, metricName: 'cpu_cores', resourceType: 'kubernetes',
      kind: 'Deployment', from: bucketStart, to: bucketStart,
    }).length, 1);
    assert.equal(subject.database.getMetricSeries({
      applicationId: application.id, metricName: 'cpu_cores', resourceType: 'kubernetes',
      kind: 'Ingress', from: bucketStart, to: bucketStart,
    }).length, 0);
    assert.equal(subject.database.getMetricSeries({
      applicationId: application.id, metricName: 'cpu_cores', resourceType: 'lambda',
      from: bucketStart, to: bucketStart,
    }).length, 0);
  } finally {
    subject.close();
  }
});

test('commits incremental metric batches with their cursor atomically', () => {
  const subject = fixture();
  try {
    const { application, resource } = addApplicationAndResource(subject.database);
    const bucketStart = Date.UTC(2026, 7, 4, 12);
    const batch = [{
      bucketStart, metricName: 'invocations_observed', unit: 'count',
      count: 1, sum: 1, min: 1, max: 1, last: 1, quality: 'full',
    }];
    subject.database.commitMetricBatch(resource.id, 'cloudwatch_logs', batch, {
      timestamp: bucketStart + 1000,
      boundaryHashes: ['event-a'],
    });
    subject.database.commitMetricBatch(resource.id, 'cloudwatch_logs', batch, {
      timestamp: bucketStart + 2000,
      boundaryHashes: ['event-b'],
    });
    const [point] = subject.database.getMetricSeries({
      applicationId: application.id, metricName: 'invocations_observed', from: bucketStart, to: bucketStart,
    });
    assert.equal(point.sum, 2);
    assert.equal(subject.database.getCursor(resource.id, 'cloudwatch_logs').timestamp, bucketStart + 2000);
  } finally {
    subject.close();
  }
});

test('round-trips collection cursors without storing log messages', () => {
  const subject = fixture();
  try {
    const { resource } = addApplicationAndResource(subject.database);
    subject.database.setCursor(resource.id, 'cloudwatch_logs', {
      timestamp: 1234,
      nextToken: 'next-page',
      boundaryHashes: ['hash-a'],
      state: { restartCount: 2 },
    });
    assert.deepEqual(subject.database.getCursor(resource.id, 'cloudwatch_logs'), {
      timestamp: 1234,
      nextToken: 'next-page',
      boundaryHashes: ['hash-a'],
      state: { restartCount: 2 },
      updatedAt: '2026-08-04T12:00:00.000Z',
    });
  } finally {
    subject.close();
  }
});

test('enforces a hard monthly AWS request budget atomically', () => {
  const subject = fixture();
  try {
    const first = subject.database.reserveAwsRequests({
      profileId: 'local:dev', region: 'us-east-1', operation: 'FilterLogEvents', count: 7, limit: 10,
    });
    const blocked = subject.database.reserveAwsRequests({
      profileId: 'local:dev', region: 'eu-west-1', operation: 'FilterLogEvents', count: 4, limit: 10,
    });
    assert.equal(first.allowed, true);
    assert.equal(first.warning, 'warning');
    assert.deepEqual(blocked, {
      allowed: false, used: 7, requested: 4, limit: 10, remaining: 3, month: '2026-08',
    });
    assert.equal(subject.database.getApiUsage('local:dev').total, 7);
  } finally {
    subject.close();
  }
});

test('deletes metric buckets and runs older than retention', () => {
  const now = Date.UTC(2026, 7, 4, 12);
  const subject = fixture(now);
  try {
    const { application, resource } = addApplicationAndResource(subject.database);
    subject.database.upsertMetricBucket({
      resourceId: resource.id,
      bucketStart: now - 91 * 24 * 60 * 60 * 1000,
      metricName: 'invocations', count: 1, sum: 1, min: 1, max: 1, last: 1,
      source: 'cloudwatch_logs',
    });
    subject.database.setCursor(resource.id, 'cloudwatch_logs', { timestamp: now });
    subject.database.db.prepare('UPDATE apm_collection_cursors SET updated_at = ? WHERE resource_id = ?')
      .run(new Date(now - 91 * 24 * 60 * 60 * 1000).toISOString(), resource.id);
    const runId = subject.database.startCollectionRun({
      applicationId: application.id, profileId: 'local:dev', region: 'us-east-1', trigger: 'scheduled',
    });
    subject.database.db.prepare('UPDATE apm_collection_runs SET started_at = ? WHERE id = ?')
      .run(new Date(now - 91 * 24 * 60 * 60 * 1000).toISOString(), runId);
    assert.deepEqual(subject.database.cleanup(), { metrics: 1, cursors: 1, runs: 1, usage: 0 });
  } finally {
    subject.close();
  }
});

test('listRegistryResources reports which sources confirmed each canonical resource', () => {
  const subject = fixture();
  try {
    const { application } = addApplicationAndResource(subject.database);
    const canonical = {
      identityKey: JSON.stringify(['aws', 'local:dev', '123', 'us-east-1', 'lambda', 'arn:aws:lambda:us-east-1:123:function:orders']),
      provider: 'aws', profileId: 'local:dev', scopeId: '123', location: 'us-east-1',
      nativeIdentifier: 'arn:aws:lambda:us-east-1:123:function:orders', resourceType: 'lambda', displayName: 'orders',
    };
    const singleSource = subject.database.upsertRegistryResource({ ...canonical, id: 'kua-resource:single' });
    subject.database.addRegistryMembership({
      applicationId: application.id, resourceId: singleSource.id, sourceKind: 'apm_resource', sourceReference: 'apm-1',
    });

    const otherCanonical = { ...canonical, nativeIdentifier: 'arn:aws:lambda:us-east-1:123:function:worker', displayName: 'worker' };
    const bothSources = subject.database.upsertRegistryResource({
      ...otherCanonical,
      identityKey: JSON.stringify(['aws', 'local:dev', '123', 'us-east-1', 'lambda', otherCanonical.nativeIdentifier]),
      id: 'kua-resource:both',
    });
    subject.database.addRegistryMembership({
      applicationId: application.id, resourceId: bothSources.id, sourceKind: 'apm_resource', sourceReference: 'apm-2',
    });
    subject.database.addRegistryMembership({
      applicationId: application.id, resourceId: bothSources.id, sourceKind: 'architecture_node', sourceReference: 'node-2',
    });

    const resources = subject.database.listRegistryResources(application.id);
    assert.deepEqual(resources.find(resource => resource.id === singleSource.id).sources, ['apm_resource']);
    assert.deepEqual(resources.find(resource => resource.id === bothSources.id).sources.sort(), ['apm_resource', 'architecture_node']);
  } finally {
    subject.close();
  }
});

test('registry sync status tracks the last success and preserves it across a later failure', () => {
  const subject = fixture();
  try {
    const { application } = addApplicationAndResource(subject.database);
    assert.equal(subject.database.getRegistrySyncStatus(application.id), null);

    subject.database.recordRegistrySyncSuccess(application.id, {
      durationMs: 42, divergentResourceCount: 2, divergentRelationshipCount: 1,
    });
    const afterSuccess = subject.database.getRegistrySyncStatus(application.id);
    assert.ok(afterSuccess.lastSuccessAt);
    assert.equal(afterSuccess.lastError, null);
    assert.equal(afterSuccess.lastDurationMs, 42);
    assert.equal(afterSuccess.divergentResourceCount, 2);
    assert.equal(afterSuccess.divergentRelationshipCount, 1);

    subject.database.recordRegistrySyncFailure(application.id, { durationMs: 7, error: 'boom' });
    const afterFailure = subject.database.getRegistrySyncStatus(application.id);
    assert.equal(afterFailure.lastError, 'boom');
    assert.ok(afterFailure.lastErrorAt);
    assert.equal(afterFailure.lastDurationMs, 7);
    // A failed attempt must not erase the previous successful sync or its divergence counts.
    assert.equal(afterFailure.lastSuccessAt, afterSuccess.lastSuccessAt);
    assert.equal(afterFailure.divergentResourceCount, 2);
    assert.equal(afterFailure.divergentRelationshipCount, 1);

    subject.database.recordRegistrySyncSuccess(application.id, { durationMs: 5, divergentResourceCount: 0, divergentRelationshipCount: 0 });
    const afterRecovery = subject.database.getRegistrySyncStatus(application.id);
    assert.equal(afterRecovery.lastError, null);
    assert.equal(afterRecovery.lastErrorAt, null);
    assert.equal(afterRecovery.divergentResourceCount, 0);
  } finally {
    subject.close();
  }
});
