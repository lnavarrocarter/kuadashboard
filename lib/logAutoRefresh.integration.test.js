'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { CloudWatchLogsClient } = require('@aws-sdk/client-cloudwatch-logs');
const { createAutoRefresh } = require('./logAutoRefresh');
const { createLogCache } = require('./awsLogCache');
const { createUsageLedger } = require('./usage/ledger');
const { installAwsMeter } = require('./usage/awsMeter');
const { createTaskHistory } = require('./taskHistory');
const { createBackgroundTaskRegistry, createPeriodicTaskControls } = require('./backgroundTaskRegistry');
const { PLANS } = require('./plans');

test('Run now refreshes through a real SDK client and persists usage and run cost without AWS access', async t => {
  const now = () => Date.UTC(2026, 10, 6, 12);
  const cache = createLogCache({ dataDir: ':memory:', now });
  const ledger = createUsageLedger({ dataDir: ':memory:', now });
  const history = createTaskHistory({ dataDir: ':memory:', now });
  const client = new CloudWatchLogsClient({
    region: 'us-east-1', maxAttempts: 1,
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    requestHandler: { handle() { throw new Error('A test must never send an AWS request'); } },
  });
  let calls = 0;
  client.middlewareStack.add(() => async args => {
    calls += 1;
    assert.equal(args.input.logGroupName, '/aws/lambda/test');
    return { output: { $metadata: {}, events: [{ eventId: 'new-event', timestamp: now() - 1000, message: 'x'.repeat(2048) }] } };
  }, { step: 'finalizeRequest', name: 'offlineCloudWatchResponse' });
  // Patch only this client's class, and restore it after this isolated test.
  const ownSend = Object.getOwnPropertyDescriptor(CloudWatchLogsClient.prototype, 'send');
  t.after(() => {
    if (ownSend) Object.defineProperty(CloudWatchLogsClient.prototype, 'send', ownSend);
    else delete CloudWatchLogsClient.prototype.send;
    client.destroy();
    cache.close(); ledger.close(); history.close();
  });
  assert.equal(installAwsMeter({ ledger, bases: [CloudWatchLogsClient] }), 1);
  cache.enable({ profileId: 'test-profile', region: 'us-east-1', logGroup: '/aws/lambda/test' });
  cache.setRefresh({ profileId: 'test-profile', region: 'us-east-1', logGroup: '/aws/lambda/test', minutes: 1 });
  const refresh = createAutoRefresh({ cache, clientFor: async () => client, plan: () => PLANS.team, now });
  const registry = createBackgroundTaskRegistry({ history, now });
  const task = registry.register({ id: 'logs.refresh', name: 'Automatic log refresh', intervalMs: 30000 });
  task.setControls(createPeriodicTaskControls(refresh, task, { runNow: () => refresh.tick() }));

  await registry.control('logs.refresh', 'run');
  // run() returns the in-flight operation when Run now has already started it.
  await task.run(() => { throw new Error('Run now must start only one operation'); });
  assert.equal(calls, 1);
  const usage = ledger.summary({ profileId: 'test-profile' });
  assert.equal(usage.recent.length, 1);
  assert.equal(usage.recent[0].feature, 'log-refresh');
  assert.equal(usage.recent[0].kind, 'filterLogEvents');
  assert.ok(usage.recent[0].potentialUsd > 0);
  const run = history.list().runs[0];
  assert.equal(run.outcome, 'completed');
  assert.equal(run.cost.aws.calls, 1);
  assert.equal(run.cost.aws.usd, 0);
  assert.ok(run.cost.aws.potentialUsd > 0);
  assert.equal(refresh.statusOf({ profileId: 'test-profile', region: 'us-east-1', logGroup: '/aws/lambda/test', refreshMinutes: 1 }).last.inserted, 1);
});
