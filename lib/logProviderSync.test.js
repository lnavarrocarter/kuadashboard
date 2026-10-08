'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createLogProviderSync, parseProviderLogGroup, estimateLogSyncRequests } = require('./logProviderSync');

test('provider log groups parse without losing encoded names', () => {
  assert.deepEqual(parseProviderLogGroup('gcp:function:project-1:us-central1:checkout%3Aworker'), {
    provider: 'gcp', kind: 'function', project: 'project-1', region: 'us-central1', name: 'checkout:worker',
  });
  assert.deepEqual(parseProviderLogGroup('vercel:project:prj_123'), { provider: 'vercel', projectId: 'prj_123' });
  assert.equal(parseProviderLogGroup('/aws/lambda/checkout'), null);
});

test('Cloud Logging pages use the shared sync cursor and bounded page estimate', async () => {
  let captured;
  const cache = {
    syncGroup: async options => {
      captured = options;
      const page = await options.client.send(new options.FilterLogEventsCommand({ startTime: 10, endTime: 20, nextToken: 'cursor' }));
      return { status: 'ok', events: page.events };
    },
  };
  const sync = createLogProviderSync({ cache, gcpBroker: { fetchCachePage: async input => ({ events: [{ timestamp: 15, message: 'ERROR fixture' }], nextToken: input.pageToken }) }, vercelBroker: {} });
  const result = await sync({ profileId: 'gcp-profile', region: 'us-central1', logGroup: 'gcp:cloudrun:project-1:us-central1:checkout' });

  assert.equal(captured.maxPages, 5);
  assert.equal(captured.latestOnly, false);
  assert.equal(result.events[0].timestamp, 15);
  assert.equal(estimateLogSyncRequests('gcp'), 5);
});

test('Vercel runtime logs use a single bounded latest-only cache sync', async () => {
  let fetched;
  let captured;
  const cache = {
    syncGroup: async options => {
      captured = options;
      const page = await options.client.send(new options.FilterLogEventsCommand({ startTime: 10, endTime: 20 }));
      return { status: page.nextToken ? 'partial' : 'ok', events: page.events };
    },
  };
  const sync = createLogProviderSync({
    cache, gcpBroker: {},
    vercelBroker: { runtimeLogs: async input => { fetched = input; return { events: [{ timestamp: 15, eventId: 'row' }], deploymentId: 'dpl_1', truncated: false }; } },
  });
  const result = await sync({ profileId: 'vercel-profile', region: 'global', logGroup: 'vercel:project:prj_123' });

  assert.equal(fetched.projectId, 'prj_123');
  assert.equal(captured.maxPages, 1);
  assert.equal(captured.latestOnly, true);
  assert.equal(result.events[0].eventId, 'row');
  assert.equal(estimateLogSyncRequests('vercel'), 2);
});

test('Vercel response truncation stays visible as a partial sync', async () => {
  const cache = {
    syncGroup: async options => {
      const page = await options.client.send(new options.FilterLogEventsCommand({ startTime: 10, endTime: 20 }));
      return { status: page.nextToken ? 'partial' : 'ok' };
    },
  };
  const sync = createLogProviderSync({ cache, gcpBroker: {}, vercelBroker: { runtimeLogs: async () => ({ events: [], truncated: true }) } });
  const result = await sync({ profileId: 'p', region: 'global', logGroup: 'vercel:project:prj_1' });
  assert.equal(result.status, 'partial');
  assert.equal(result.truncated, true);
});