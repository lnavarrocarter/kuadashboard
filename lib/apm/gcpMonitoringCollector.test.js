'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { GcpMonitoringCollector, gcpPlan } = require('./gcpMonitoringCollector');
const { estimateCollectionCost } = require('./collectionCost');
const { signalCapabilities } = require('./signalCapabilities');

const RUN = { id: 'r1', type: 'gcp-cloud-run', key: 'projects/ncaicloud/locations/us-central1/services/kua-control-plane', name: 'kua-control-plane', scopeId: 'ncaicloud' };
const NOW = Date.parse('2026-10-15T12:00:00Z');

test('Cloud Run is read as one series per metric, filtered to the service (#286)', async () => {
  const urls = [];
  const commits = [];
  const collector = new GcpMonitoringCollector({
    database: { getCursor: () => null, commitMetricBatch: (...args) => commits.push(args) },
    resolveAuth: async profileId => ({ profileId, projectId: 'ncaicloud' }),
    fetchApi: async url => {
      urls.push(new URL(url));
      return { timeSeries: [{ points: [{ interval: { endTime: '2026-10-15T11:55:00Z' }, value: { int64Value: '12' } }] }] };
    },
    now: () => NOW,
  });
  const result = await collector.collect({ application: { profileId: 'local:ncaicloud' }, resource: RUN });
  assert.deepEqual([result.status, result.requests], ['completed', 3]);
  assert.ok(urls.every(url => url.pathname === '/v3/projects/ncaicloud/timeSeries'));
  assert.ok(urls.every(url => url.searchParams.get('filter').includes('resource.labels.service_name="kua-control-plane"')));
  assert.ok(urls.every(url => url.searchParams.get('aggregation.crossSeriesReducer')), 'every query is reduced to one series');
  assert.match(urls[1].searchParams.get('filter'), /response_code_class="5xx"/);
  assert.deepEqual(commits[0][2].map(bucket => [bucket.metricName, bucket.last]), [['gcp_run_requests', 12], ['gcp_run_5xx', 12], ['gcp_run_latency_p95_ms', 12]]);
  await assert.rejects(collector.collect({ application: {}, resource: RUN }), error => error.code === 'scope_unbound');
});

test('Cloud SQL and VMs have plans; buckets and functions stay topology only (#286)', () => {
  assert.match(gcpPlan({ type: 'gcp-sql', key: 'projects/p/instances/orders-db' }).metrics[0].filter, /database_id="p:orders-db"/);
  assert.equal(gcpPlan({ type: 'gcp-sql', key: 'projects/p/instances/orders-db' }).metrics[0].scale, 100);
  assert.match(gcpPlan({ type: 'gcp-compute-instance', key: 'projects/p/zones/us-central1-a/instances/api' }).metrics[0].filter, /instance_name="api"/);
  assert.equal(gcpPlan({ type: 'gcp-bucket', key: 'projects/_/buckets/x' }), null);
  assert.equal(signalCapabilities(RUN).metrics, true);
  assert.equal(signalCapabilities({ type: 'gcp-bucket', key: 'projects/_/buckets/x' }).metrics, false);
});

test('the cost estimate counts Cloud Monitoring series against the free million (#286)', () => {
  const cost = estimateCollectionCost([RUN], { intervalMinutes: 30 });
  assert.equal(cost.perRun.gcpSeries, 3);
  assert.equal(cost.perMonth.gcpSeries, 4320);
  assert.equal(cost.perMonth.gcpFreeShare, 0.00432);
  assert.equal(cost.perMonth.gcpUsdBeyondFree, 0.00216);
  assert.equal(cost.byType['gcp-cloud-run'].billed, true);
});
