'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { ApmDatabase } = require('../apm/database');
const { ArchitectureDatabase } = require('../architecture/database');
const { markGone, recordCollection } = require('../apm/resourcePresence');
const { ApplicationRegistryService } = require('./applicationRegistryService');
const { applicationIssues } = require('./applicationIssues');

const NOW = Date.UTC(2026, 9, 9, 12);
const HOUR = 3600000;

test('issues name the resource, the evidence, since when and the action, most important first (#239)', () => {
  const database = new ApmDatabase({ filePath: ':memory:', now: () => NOW });
  const architectureDatabase = new ArchitectureDatabase({ filePath: ':memory:' });
  try {
    const registry = new ApplicationRegistryService({ database, architectureDatabase });
    const application = database.createApplication({ provider: 'aws', profileId: 'local:prod', region: 'us-east-1', name: 'Orders', pollingEnabled: true });
    const lambda = name => registry.attachResource(database.getApplication(application.id), { provider: 'aws', type: 'lambda', key: `arn:aws:lambda:us-east-1:1:function:${name}`, arn: `arn:aws:lambda:us-east-1:1:function:${name}`, name }).resource;
    const failing = lambda('payments');
    const broken = lambda('reports');
    const healthy = lambda('catalog');
    const worker = registry.attachResource(database.getApplication(application.id), {
      provider: 'kubernetes', type: 'kubernetes', kind: 'Deployment', key: 'prod/app/Deployment/worker-1.0.0', kubeContext: 'prod', namespace: 'app', name: 'worker-1.0.0',
    }).resource;

    // payments: 30 errors in 100 invocations (objective 5 %); catalog: fine.
    for (const [resource, invocations, errors] of [[failing, 100, 30], [healthy, 100, 0]]) {
      database.upsertMetricBucket({ resourceId: resource.id, bucketStart: NOW - 2 * HOUR, metricName: 'invocations_observed', count: 1, sum: invocations, source: 'cloudwatch_logs' });
      database.upsertMetricBucket({ resourceId: resource.id, bucketStart: NOW - 2 * HOUR, metricName: 'errors_observed', count: 1, sum: errors, source: 'cloudwatch_logs' });
    }
    recordCollection(database, broken.id, { status: 'failed', errorCode: 'AccessDeniedException', message: 'not authorized to perform logs:FilterLogEvents', now: NOW - HOUR });
    markGone(database, worker.id, { now: NOW - 3 * HOUR });
    // An old failure outside the range is still the last outcome: it stays listed until it collects.

    const { issues, counts } = applicationIssues({ database, application: database.getApplication(application.id), from: NOW - 24 * HOUR, to: NOW, now: NOW });
    assert.deepEqual(issues.map(issue => [issue.kind, issue.resourceName, issue.severity, issue.action]), [
      ['threshold', 'payments', 'critical', 'open_signals'],
      ['gone', 'worker-1.0.0', 'warning', 'review_missing'],
      ['collection_failed', 'reports', 'warning', 'retry'],
    ]);
    assert.deepEqual(issues[0].evidence, { metric: 'errorRatePercent', value: 30, threshold: 5, comparison: 'maximum' });
    assert.equal(issues[0].since, new Date(NOW - 2 * HOUR).toISOString());
    assert.deepEqual(issues[2].evidence, { errorCode: 'AccessDeniedException', message: 'not authorized to perform logs:FilterLogEvents' });
    assert.ok(issues.every(issue => issue.registryId && issue.resourceId));
    assert.deepEqual(counts, { critical: 1, warning: 2, info: 0 });

    // Outside the range the threshold is not an issue anymore.
    const later = applicationIssues({ database, application: database.getApplication(application.id), from: NOW - HOUR, to: NOW, now: NOW });
    assert.equal(later.issues.some(issue => issue.kind === 'threshold'), false);
  } finally {
    database.close();
    architectureDatabase.close();
  }
});
