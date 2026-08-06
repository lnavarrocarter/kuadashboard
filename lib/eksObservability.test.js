'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  aggregateMetricResults,
  buildMetricQueries,
} = require('./eksObservability');

const dimensions = pod => [
  { Name: 'ClusterName', Value: 'demo' },
  { Name: 'Namespace', Value: 'checkout' },
  { Name: 'PodName', Value: pod },
];

test('aggregates Container Insights streams by namespace', () => {
  const catalog = [
    { MetricName: 'pod_cpu_utilization', Dimensions: dimensions('api-a') },
    { MetricName: 'pod_cpu_utilization', Dimensions: dimensions('api-b') },
    { MetricName: 'pod_number_of_container_restarts', Dimensions: dimensions('api-a') },
    { MetricName: 'pod_number_of_container_restarts', Dimensions: dimensions('api-b') },
    { MetricName: 'node_cpu_utilization', Dimensions: [{ Name: 'NodeName', Value: 'node-a' }] },
  ];
  const descriptors = buildMetricQueries(catalog, 'namespace', 60);

  assert.equal(descriptors.length, 4);
  const results = descriptors.map(descriptor => ({
    Id: descriptor.id,
    Timestamps: [new Date('2026-07-31T12:00:00Z')],
    Values: [descriptor.metricName === 'pod_cpu_utilization'
      ? descriptor.id === 'm0' ? 20 : 40
      : descriptor.id === 'm2' ? 1 : 2],
  }));
  const aggregated = aggregateMetricResults(descriptors, results);

  assert.equal(aggregated.groups.length, 1);
  assert.equal(aggregated.groups[0].name, 'checkout');
  assert.equal(aggregated.groups[0].metrics.pod_cpu_utilization.latest, 30);
  assert.equal(aggregated.groups[0].metrics.pod_number_of_container_restarts.latest, 3);
  assert.equal(aggregated.summary.pod_cpu_utilization.latest, 30);
});

test('rejects unsupported groupings', () => {
  assert.throws(
    () => buildMetricQueries([], 'application', 60),
    /Unsupported EKS metric grouping/,
  );
});