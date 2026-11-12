'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { mapSpanToNode, projectTraceToArchitecture, shortestInventoryPath } = require('./traceProjection');

const node = (id, name, extra = {}) => ({ id, name, provider: 'aws', resourceType: 'service', evidence: [{ type: 'discovery', sourceId: 'source:1', values: ['private'] }], ...extra });
const graph = {
  document: {
    nodes: [node('browser', 'shop-web'), node('lb', 'public-alb', { resourceType: 'elb' }), node('api', 'checkout-api'), node('db', 'orders-db', { resourceType: 'rds' })],
    edges: [
      { id: 'web-lb', sourceNodeId: 'browser', targetNodeId: 'lb', relationType: 'routes_to', status: 'confirmed', evidence: [{ type: 'elb_target', sourceId: 'aws:topology:1', values: ['private'] }] },
      { id: 'lb-api', sourceNodeId: 'lb', targetNodeId: 'api', relationType: 'routes_to', status: 'automatic', evidence: [{ type: 'target_registration', sourceId: 'aws:topology:1' }] },
      { id: 'api-db', sourceNodeId: 'api', targetNodeId: 'db', relationType: 'depends_on', status: 'manual', evidence: [{ type: 'user_confirmed', sourceId: 'apm:1' }] },
    ],
  },
};
const span = (spanId, serviceName, parentSpanId = '') => ({
  traceId: '1'.repeat(32), spanId, parentSpanId, serviceName,
  name: 'GET HTTP', kind: 2, statusCode: 0,
  startTime: '2026-11-12T13:00:00.000Z', endTime: '2026-11-12T13:00:00.010Z',
  resource: { 'service.name': serviceName }, attributes: {},
});

test('projects observed parent-child spans and keeps load balancer inventory separate', () => {
  const trace = { traceId: '1'.repeat(32), spans: [span('a'.repeat(16), 'shop-web'), span('b'.repeat(16), 'checkout-api', 'a'.repeat(16))], links: [] };
  const result = projectTraceToArchitecture(trace, { id: 'project-1', name: 'shop', profileId: 'aws:dev' }, graph);
  assert.equal(result.coverage, 'partial');
  assert.equal(result.spans.length, 2);
  assert.equal(result.segments[0].status, 'partial');
  assert.deepEqual(result.segments[0].inventoryNodes.map(item => item.id), ['lb']);
  assert.equal(result.segments[0].inventoryEdges.every(edge => edge.observedSpan === false), true);
  assert.equal(JSON.stringify(result).includes('private'), false);
  assert.equal(result.gaps[0].reason, 'unobserved_architecture_hops');
});

test('maps observed database client calls to endpoint inventory without claiming database-side spans', () => {
  const client = { ...span('f'.repeat(16), 'checkout-api'), kind: 3, attributes: {
    'db.system.name': 'postgresql', 'server.address': 'orders-db.internal', 'server.port': 5432,
  } };
  const trace = { traceId: '1'.repeat(32), spans: [client], links: [] };
  const targetGraph = { document: { nodes: [
    node('api', 'checkout-api'), node('db', 'orders-db', { resourceType: 'rds', endpoint: 'orders-db.internal' }),
  ], edges: [] } };
  const result = projectTraceToArchitecture(trace, { id: 'project-1', name: 'shop', profileId: 'local:dev' }, targetGraph);
  assert.equal(result.spans[0].architecture.node.id, 'api');
  assert.equal(result.spans[0].databaseTarget.node.id, 'db');
  assert.equal(result.spans[0].databaseTarget.clientCallObserved, true);
  assert.equal(result.spans[0].databaseTarget.databaseServerSpanObserved, false);
  assert.equal(result.coverage, 'partial');
  assert.equal(result.gaps.some(gap => gap.reason === 'database_server_span_unobserved'), true);
  assert.equal(JSON.stringify(result).includes('orders-db.internal'), false);
});

test('maps GCP Cloud Run, Functions, GKE and Compute spans using resource identity', () => {
  const gcpNode = (id, name, resourceType, extra = {}) => ({ id, name, provider: 'gcp', resourceType, accountId: 'project-a', evidence: [], ...extra });
  const nodes = [
    gcpNode('run', 'checkout', 'gcp-cloud-run', { region: 'us-central1' }),
    gcpNode('fn', 'checkout', 'gcp-function', { region: 'us-central1' }),
    gcpNode('gke', 'cluster-a', 'gcp-gke', { region: 'us-central1-a' }),
    gcpNode('vm', 'worker-a', 'gcp-compute-instance', { region: 'us-central1-a', instanceId: '12345' }),
  ];
  const map = resource => mapSpanToNode({ serviceName: 'same-generic-name', resource: { 'cloud.provider': 'gcp', 'cloud.account.id': 'project-a', ...resource } }, nodes);
  assert.equal(map({ 'cloud.platform': 'gcp_cloud_run', 'cloud.region': 'us-central1', 'faas.name': 'checkout' }).node.id, 'run');
  assert.equal(map({ 'cloud.platform': 'gcp_cloud_functions', 'cloud.region': 'us-central1', 'faas.name': 'checkout' }).node.id, 'fn');
  assert.equal(map({ 'cloud.platform': 'gcp_kubernetes_engine', 'cloud.availability_zone': 'us-central1-a', 'k8s.cluster.name': 'cluster-a' }).node.id, 'gke');
  assert.equal(map({ 'cloud.platform': 'gcp_compute_engine', 'cloud.availability_zone': 'us-central1-a', 'host.id': '12345' }).node.id, 'vm');
});

test('maps GCP Cloud SQL client spans to discovered IP endpoints', () => {
  const client = { ...span('9'.repeat(16), 'checkout-api'), kind: 3, attributes: {
    'db.system.name': 'postgresql', 'server.address': '10.0.0.8',
  } };
  const dbNode = node('cloudsql', 'orders-db', { provider: 'gcp', resourceType: 'gcp-sql', endpoints: ['10.0.0.8'] });
  const result = projectTraceToArchitecture({ traceId: client.traceId, spans: [client], links: [] }, { id: 'p', name: 'gcp', profileId: 'local:gcp' }, { document: { nodes: [dbNode], edges: [] } });
  assert.equal(result.spans[0].databaseTarget.status, 'matched');
  assert.equal(result.spans[0].databaseTarget.node.id, 'cloudsql');
  assert.equal(result.coverage, 'partial');
});

test('maps client endpoint spans to Cloud Run URI and keeps unknown GCP API peers partial', () => {
  const client = { ...span('8'.repeat(16), 'web'), kind: 3, attributes: { 'server.address': 'receipt-abc-uc.a.run.app' } };
  const cloudRun = node('run', 'receipt-worker', { provider: 'gcp', resourceType: 'gcp-cloud-run', uri: 'https://receipt-abc-uc.a.run.app' });
  const known = projectTraceToArchitecture({ traceId: client.traceId, spans: [client], links: [] }, { id: 'p', name: 'gcp', profileId: 'local:gcp' }, { document: { nodes: [node('web', 'web'), cloudRun], edges: [] } });
  assert.equal(known.spans[0].peerTarget.node.id, 'run');
  assert.equal(JSON.stringify(known).includes('receipt-abc-uc.a.run.app'), false);
  const unknownClient = { ...client, attributes: { 'server.address': 'storage.googleapis.com' } };
  const unknown = projectTraceToArchitecture({ traceId: client.traceId, spans: [unknownClient], links: [] }, { id: 'p', name: 'gcp', profileId: 'local:gcp' }, { document: { nodes: [node('web', 'web'), cloudRun], edges: [] } });
  assert.equal(unknown.spans[0].peerTarget.status, 'unmatched');
  assert.equal(unknown.gaps.some(gap => gap.reason === 'client_peer_unmapped'), true);
  assert.equal(unknown.coverage, 'partial');
});

test('uses exact resource identity and reports ambiguous name matches instead of guessing', () => {
  const exact = mapSpanToNode({ serviceName: 'api', resource: { 'cloud.resource_id': 'arn:aws:lambda:us-east-1:1:function:checkout' } }, [
    node('lambda', 'checkout', { arn: 'arn:aws:lambda:us-east-1:1:function:checkout' }),
    node('same-name', 'api'),
  ]);
  assert.equal(exact.status, 'matched');
  assert.equal(exact.node.id, 'lambda');
  const ambiguous = mapSpanToNode({ serviceName: 'api', resource: {} }, [node('api-a', 'api'), node('api-b', 'api')]);
  assert.equal(ambiguous.status, 'ambiguous');
});

test('ignores suggested and rejected edges and marks multiple inventory routes ambiguous', () => {
  const noConfirmed = { document: { nodes: [node('a', 'a'), node('b', 'b')], edges: [
    { id: 'guess', sourceNodeId: 'a', targetNodeId: 'b', status: 'suggested' },
    { id: 'rejected', sourceNodeId: 'a', targetNodeId: 'b', status: 'rejected' },
  ] } };
  assert.deepEqual(shortestInventoryPath(noConfirmed, 'a', 'b'), { status: 'missing' });
  const ambiguous = { document: { nodes: [node('a', 'a'), node('x', 'x'), node('y', 'y'), node('b', 'b')], edges: [
    { id: 'ax', sourceNodeId: 'a', targetNodeId: 'x', status: 'confirmed' },
    { id: 'xb', sourceNodeId: 'x', targetNodeId: 'b', status: 'confirmed' },
    { id: 'ay', sourceNodeId: 'a', targetNodeId: 'y', status: 'manual' },
    { id: 'yb', sourceNodeId: 'y', targetNodeId: 'b', status: 'automatic' },
  ] } };
  assert.equal(shortestInventoryPath(ambiguous, 'a', 'b').status, 'ambiguous');
});

test('projects an OTLP span link from producer to consumer as observed async correlation', () => {
  const producer = span('c'.repeat(16), 'queue-producer');
  const consumer = span('d'.repeat(16), 'queue-consumer');
  const trace = { traceId: '1'.repeat(32), spans: [producer, consumer], links: [
    { traceId: '1'.repeat(32), spanId: consumer.spanId, linkedTraceId: '1'.repeat(32), linkedSpanId: producer.spanId },
  ] };
  const asyncGraph = { document: { nodes: [node('producer', producer.serviceName), node('consumer', consumer.serviceName)], edges: [
    { id: 'publishes', sourceNodeId: 'producer', targetNodeId: 'consumer', relationType: 'publishes_to', status: 'automatic', evidence: [] },
  ] } };
  const result = projectTraceToArchitecture(trace, { id: 'project-1', name: 'jobs', profileId: 'local:dev' }, asyncGraph);
  assert.equal(result.segments[0].fromSpanId, producer.spanId);
  assert.equal(result.segments[0].toSpanId, consumer.spanId);
  assert.equal(result.segments[0].observedRelationship, 'span_link');
  assert.equal(result.segments[0].status, 'observed');
  assert.equal(result.coverage, 'observed');
});

test('never labels a capped trace as fully observed', () => {
  const trace = { traceId: '1'.repeat(32), spans: [span('e'.repeat(16), 'shop-web')], links: [], truncated: true };
  const result = projectTraceToArchitecture(trace, { id: 'project-1', name: 'shop', profileId: 'local:dev' }, graph);
  assert.equal(result.coverage, 'partial');
  assert.equal(result.gaps.some(gap => gap.reason === 'trace_data_truncated'), true);
});
