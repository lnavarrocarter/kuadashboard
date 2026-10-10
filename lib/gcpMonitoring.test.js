'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { timeSeriesParams, normalizeTimeSeries } = require('./gcpMonitoring');

test('builds the aggregation the caller asked for and rejects unknown reducers', () => {
  const { params, interval } = timeSeriesParams({
    metric: 'run.googleapis.com/request_count', filter: 'resource.labels.location="us-central1"',
    hours: 1, aligner: 'ALIGN_RATE', reducer: 'REDUCE_SUM', groupBy: ['resource.labels.revision_name'],
  }, new Date('2026-10-10T12:00:00Z'));
  assert.equal(params.get('aggregation.crossSeriesReducer'), 'REDUCE_SUM');
  assert.equal(params.get('aggregation.perSeriesAligner'), 'ALIGN_RATE');
  assert.deepEqual(params.getAll('aggregation.groupByFields'), ['resource.labels.revision_name']);
  assert.match(params.get('filter'), /^metric\.type="run\.googleapis\.com\/request_count" AND resource\.labels\.location="us-central1"$/);
  assert.equal(interval.start, '2026-10-10T11:00:00.000Z');
  assert.throws(() => timeSeriesParams({ metric: 'x', reducer: 'REDUCE_EVERYTHING' }), /Unsupported reducer/);
  assert.throws(() => timeSeriesParams({ metric: 'x" OR 1' }), /Invalid metric/);
});

test('a single series becomes points; several series stay separate', () => {
  const one = normalizeTimeSeries({ timeSeries: [{ points: [
    { interval: { endTime: '2026-10-10T11:02:00Z' }, value: { doubleValue: 2 } },
    { interval: { endTime: '2026-10-10T11:01:00Z' }, value: { int64Value: '1' } },
  ] }] });
  assert.deepEqual(one.points.map(p => p.y), [1, 2]);
  assert.equal(one.status, 'ok');
  assert.equal(one.lastSampleAt, '2026-10-10T11:02:00Z');

  const many = normalizeTimeSeries({ timeSeries: [
    { resource: { labels: { location: 'us-central1' } }, points: [{ interval: { endTime: 'a' }, value: { doubleValue: 1 } }] },
    { resource: { labels: { location: 'europe-west1' } }, points: [{ interval: { endTime: 'b' }, value: { doubleValue: 5 } }] },
  ] });
  assert.equal(many.seriesCount, 2);
  assert.deepEqual(many.points, []);
  assert.equal(many.series[1].resourceLabels.location, 'europe-west1');
});

test('missing values are skipped, not drawn as zero; no series is "empty"', () => {
  const r = normalizeTimeSeries({ timeSeries: [{ points: [{ interval: { endTime: 'a' }, value: {} }] }] });
  assert.deepEqual(r.points, []);
  assert.equal(r.status, 'empty');
  assert.equal(normalizeTimeSeries({}).status, 'empty');
  assert.equal(normalizeTimeSeries({ timeSeries: [], nextPageToken: 't' }).partial, true);
});
