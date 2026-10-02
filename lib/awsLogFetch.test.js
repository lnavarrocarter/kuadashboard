'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { fetchNewest } = require('./awsLogFetch');
const { createLogCache, pickBinMs, HOT_MS } = require('./awsLogCache');

class FilterLogEventsCommand { constructor(input) { this.input = input; } }

const NOW = Date.UTC(2026, 9, 1, 12);
const MIN = 60 * 1000;

// A fake CloudWatch that, like the real one, returns events ascending in pages of `pageSize`.
function fakeCloudWatch(events, pageSize = 100) {
  const calls = [];
  return {
    calls,
    async send({ input }) {
      calls.push(input);
      const matching = events.filter(e => e.timestamp >= input.startTime && e.timestamp < input.endTime).sort((a, b) => a.timestamp - b.timestamp);
      const offset = Number(input.nextToken || 0);
      const page = matching.slice(offset, offset + pageSize);
      return { events: page, nextToken: offset + pageSize < matching.length ? String(offset + pageSize) : undefined };
    },
  };
}

test('fetchNewest returns the newest events of the range, not the oldest', async () => {
  const events = Array.from({ length: 600 }, (_, i) => ({ eventId: `e${i}`, timestamp: NOW - (600 - i) * MIN, message: `m${i}` }));
  const client = fakeCloudWatch(events);
  const result = await fetchNewest({ client, FilterLogEventsCommand, logGroupName: '/g', startTime: NOW - 700 * MIN, endTime: NOW, limit: 50 });
  assert.equal(result.events.length, 50);
  assert.equal(result.events[0].message, 'm599');
  assert.equal(result.events[49].message, 'm550');
  assert.equal(result.more, true);
});

test('fetchNewest retries a busy segment with a shorter window so the newest part is kept', async () => {
  const events = Array.from({ length: 2000 }, (_, i) => ({ eventId: `e${i}`, timestamp: NOW - 4 * MIN + i * 100, message: `m${i}` }));
  const client = fakeCloudWatch(events, 100);
  const result = await fetchNewest({ client, FilterLogEventsCommand, logGroupName: '/g', startTime: NOW - 10 * MIN, endTime: NOW, limit: 100, maxPages: 30 });
  assert.equal(result.events[0].message, 'm1999');
  assert.ok(client.calls.some(call => call.endTime - call.startTime < 5 * MIN), 'segment was shortened');
});

test('fetchNewest passes filter and stream through and stops at the start of the range', async () => {
  const client = fakeCloudWatch([{ eventId: 'a', timestamp: NOW - MIN, message: 'x' }]);
  const result = await fetchNewest({ client, FilterLogEventsCommand, logGroupName: '/g', startTime: NOW - 60 * MIN, endTime: NOW, limit: 10, filterPattern: 'ERROR', logStreamNames: ['s'] });
  assert.equal(result.events.length, 1);
  assert.equal(result.more, false);
  assert.equal(client.calls[0].filterPattern, 'ERROR');
  assert.deepEqual(client.calls[0].logStreamNames, ['s']);
  assert.equal(client.calls[client.calls.length - 1].startTime, NOW - 60 * MIN);
});

test('pickBinMs adapts the resolution to the range', () => {
  assert.equal(pickBinMs(60 * 1000), 1000);
  assert.equal(pickBinMs(15 * MIN), 10 * 1000);
  assert.equal(pickBinMs(60 * MIN), 30 * 1000);
  assert.equal(pickBinMs(24 * 60 * MIN), 15 * MIN);
  assert.equal(pickBinMs(7 * 24 * 60 * MIN), 2 * 60 * MIN);
});

test('cache histogram counts events per bin and level, honouring filters', async () => {
  const cache = createLogCache({ dataDir: ':memory:', now: () => NOW });
  const scope = { profileId: 'p', region: 'r', logGroup: '/g' };
  cache.enable(scope);
  await cache.insertEvents({ ...scope, events: [
    { eventId: '1', timestamp: NOW - 50 * 1000, message: 'ERROR Task timed out' },
    { eventId: '2', timestamp: NOW - 49 * 1000, message: 'WARN slow' },
    { eventId: '3', timestamp: NOW - 10 * 1000, message: 'INFO ok' },
  ] });
  const result = await cache.histogram({ ...scope, from: NOW - 60 * 1000, to: NOW });
  assert.equal(result.binMs, 1000);
  assert.equal(result.buckets.length, 60);
  assert.deepEqual(result.buckets[10], { start: NOW - 50 * 1000, error: 1, warn: 0, info: 0 });
  assert.equal(result.events, 3);
  assert.equal((await cache.histogram({ ...scope, from: NOW - 60 * 1000, to: NOW, category: 'timeout' })).events, 1);
  assert.equal((await cache.histogram({ ...scope, from: NOW - 60 * 1000, to: NOW, pattern: '?WARN ?INFO' })).events, 2);
  assert.equal(result.coverage.oldest, NOW - 50 * 1000);
});

test('cache search uses CloudWatch filter pattern syntax', async () => {
  const cache = createLogCache({ dataDir: ':memory:', now: () => NOW });
  const scope = { profileId: 'p', region: 'r', logGroup: '/g' };
  cache.enable(scope);
  await cache.insertEvents({ ...scope, events: [
    { eventId: '1', timestamp: NOW - 3000, message: 'ERROR Task timed out' },
    { eventId: '2', timestamp: NOW - 2000, message: 'WARN slow healthcheck' },
    { eventId: '3', timestamp: NOW - 1000, message: '{"level":"error","code":500}' },
  ] });
  const search = async pattern => (await cache.query({ ...scope, pattern })).map(e => e.eventId || e.message);
  assert.deepEqual(await search('"Task timed out"'), ['ERROR Task timed out']);
  assert.deepEqual(await search('?ERROR ?WARN -healthcheck'), ['ERROR Task timed out']);
  assert.deepEqual(await search('{ $.code >= 500 }'), ['{"level":"error","code":500}']);
  await assert.rejects(cache.query({ ...scope, pattern: '{ $.code >= }' }), /Invalid filter pattern/);
});

test('history setting: "only new events" never backfills; a shorter history limits how far back', async () => {
  const cache = createLogCache({ dataDir: ':memory:', now: () => NOW });
  const scope = { profileId: 'p', region: 'r', logGroup: '/g' };
  cache.enable({ ...scope, historyMs: 0 });
  const ranges = [];
  const client = { async send({ input }) { ranges.push([input.startTime, input.endTime]); return { events: [] }; } };
  const first = await cache.syncGroup({ ...scope, client, FilterLogEventsCommand });
  assert.deepEqual(ranges, [], 'nothing before now is read');
  assert.equal(first.status, 'ok');
  assert.equal(first.group.backfillPending, false);
  assert.equal(first.group.historyMs, 0);

  cache.setHistory({ ...scope, historyMs: 24 * 60 * MIN });
  ranges.length = 0;
  await cache.syncGroup({ ...scope, client, FilterLogEventsCommand });
  assert.equal(Math.min(...ranges.map(r => r[0])), NOW - 24 * 60 * MIN, 'backfill stops at the history limit');

  const other = { ...scope, logGroup: '/h' };
  cache.enable({ ...other, historyMs: 60 * MIN });
  ranges.length = 0;
  await cache.syncGroup({ ...other, client, FilterLogEventsCommand });
  assert.deepEqual(ranges[0], [NOW - 60 * MIN, NOW], 'recent read never goes past the history');
  assert.ok(HOT_MS > 60 * MIN);
});
