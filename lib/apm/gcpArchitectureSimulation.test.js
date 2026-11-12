'use strict';

const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const test = require('node:test');
const { ROOT_CONTEXT, trace } = require('@opentelemetry/api');
const { W3CTraceContextPropagator } = require('@opentelemetry/core');
const { ArchitectureCloudDiscoveryService } = require('../architecture/cloudDiscoveryService');
const { ArchitectureDatabase } = require('../architecture/database');
const { createGcpDiscoveryReader } = require('../architecture/gcpDiscoveryReader');
const { ArchitectureGraphService } = require('../architecture/graphService');
const { createGcpResourceCatalog } = require('../kua/resourceCatalog/gcp');
const { OtlpGatewayStore, createOtlpGatewayRouter } = require('./otlpGateway');

const PROJECT = 'sandbox-project';
const REGION = 'us-central1';
const RUN = `projects/${PROJECT}/locations/${REGION}/services/checkout-api`;
const CLOUD_SQL = `projects/${PROJECT}/instances/orders-db`;
const BACKEND = `projects/${PROJECT}/global/backendServices/checkout-backend`;
const NEG = `projects/${PROJECT}/regions/${REGION}/networkEndpointGroups/checkout-neg`;
const PUBLIC_IP = '203.0.113.24';
const TRACE_ID = 'c'.repeat(32);
const ids = { browser: '1'.repeat(16), request: '2'.repeat(16), api: '3'.repeat(16), db: '4'.repeat(16) };

function attr(key, value) {
  return { key, value: typeof value === 'number' ? { intValue: String(value) } : { stringValue: String(value) } };
}

function resourceSpan(attributes, spans) {
  return { resource: { attributes: Object.entries(attributes).map(([key, value]) => attr(key, value)) },
    scopeSpans: [{ scope: { name: 'kua-gcp-sandbox', version: '1' }, spans }] };
}

function span({ id, parent = '', name, kind, start, attributes = [] }) {
  return {
    traceId: TRACE_ID, spanId: id, ...(parent ? { parentSpanId: parent } : {}), name, kind,
    startTimeUnixNano: String(start), endTimeUnixNano: String(start + 1_000_000n), attributes,
  };
}

function gcpRuntime() {
  return {
    'cloud.provider': 'gcp', 'cloud.account.id': PROJECT, 'cloud.platform': 'gcp_cloud_run',
    'cloud.region': REGION, 'faas.name': 'checkout-api', 'faas.version': 'checkout-api-00001',
  };
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${server.address().port}/api/observability/otlp`;
}

test('GCP sandbox simulates discovery → Architecture import → W3C → OTLP → Cloud SQL trace projection', async t => {
  const architectureDatabase = new ArchitectureDatabase({ filePath: ':memory:' });
  const project = architectureDatabase.createProject({ profileId: 'gcp:sandbox', name: 'GCP trace sandbox' });
  architectureDatabase.saveGraph(project.id, {
    projectId: project.id,
    nodes: [{ id: 'shop-web', name: 'shop-web', provider: 'generic', resourceType: 'frontend' }],
  }, { expectedRevision: 0 });

  const computeCalls = [];
  const catalogCalls = [];
  const proxy = `https://www.googleapis.com/compute/v1/projects/${PROJECT}/global/targetHttpsProxies/checkout-edge`;
  const urlMap = `projects/${PROJECT}/global/urlMaps/checkout-routes`;
  const simulatedGoogleApi = async url => {
      const parsed = new URL(url);
      if (parsed.hostname === 'compute.googleapis.com') computeCalls.push(parsed.pathname);
      else catalogCalls.push(parsed.pathname);
      if (parsed.pathname.endsWith('/aggregated/forwardingRules')) return { items: { global: { forwardingRules: [
        { name: 'checkout-https', IPAddress: PUBLIC_IP, target: proxy, loadBalancingScheme: 'EXTERNAL_MANAGED' },
      ] } } };
      if (parsed.pathname.endsWith('/targetHttpsProxies/checkout-edge')) return { urlMap };
      if (parsed.pathname.endsWith('/urlMaps/checkout-routes')) return { defaultService: BACKEND };
      if (parsed.pathname.endsWith('/backendServices/checkout-backend')) return { backends: [{ group: `https://www.googleapis.com/compute/v1/${NEG}` }] };
      if (parsed.pathname.endsWith('/networkEndpointGroups/checkout-neg')) return {
        region: `https://www.googleapis.com/compute/v1/projects/${PROJECT}/regions/${REGION}`,
        networkEndpointType: 'SERVERLESS', cloudRun: { service: 'checkout-api' },
      };
      if (parsed.hostname === 'run.googleapis.com' && parsed.pathname.endsWith('/services')) return { services: [{ name: RUN, uri: 'https://checkout-api-uc.a.run.app' }] };
      if (parsed.hostname === 'sqladmin.googleapis.com') return { items: [{ name: 'orders-db', region: REGION,
        ipAddresses: [{ ipAddress: '10.42.0.8', type: 'PRIVATE' }] }] };
      if (parsed.hostname === 'pubsub.googleapis.com' && parsed.pathname.endsWith('/topics')) return { topics: [{ name: `projects/${PROJECT}/topics/orders` }] };
      if (parsed.hostname === 'pubsub.googleapis.com' && parsed.pathname.endsWith('/subscriptions')) return { subscriptions: [{
        name: `projects/${PROJECT}/subscriptions/orders-push`, topic: `projects/${PROJECT}/topics/orders`,
        pushConfig: { pushEndpoint: 'https://checkout-api-uc.a.run.app/push?secret=must-not-be-stored' },
      }] };
      if (parsed.hostname === 'cloudscheduler.googleapis.com' && parsed.pathname.endsWith('/locations')) return {
        locations: [{ name: `projects/${PROJECT}/locations/${REGION}`, locationId: REGION }],
      };
      if (parsed.hostname === 'cloudscheduler.googleapis.com' && parsed.pathname.endsWith('/jobs')) return { jobs: [{
        name: `projects/${PROJECT}/locations/${REGION}/jobs/nightly-reconcile`,
        httpTarget: { uri: 'https://checkout-api-uc.a.run.app/reconcile?token=must-not-be-stored' },
        pubsubTarget: { topicName: `projects/${PROJECT}/topics/orders` },
      }] };
      throw new Error(`Unexpected sandbox API request: ${parsed.pathname}`);
  };
  const resolveAuth = async () => ({ projectId: PROJECT });
  const gcpCatalog = createGcpResourceCatalog({ resolveAuth, fetchApi: simulatedGoogleApi });
  const catalog = { list: options => gcpCatalog.list({ ...options, types: [
    'gcp-cloud-run', 'gcp-sql', 'gcp-pubsub-topic', 'gcp-pubsub-subscription', 'gcp-scheduler-job',
  ] }) };
  const reader = createGcpDiscoveryReader({ resolveAuth, catalog, fetchJson: simulatedGoogleApi });
  const discovery = new ArchitectureCloudDiscoveryService({
    provider: 'gcp', reader, graphService: new ArchitectureGraphService({ database: architectureDatabase }),
  });
  const preview = await discovery.preview({ profileId: 'local:gcp-sandbox', projectId: project.id });
  assert.equal(preview.estimate.entrypointStatus, 'complete');
  assert.equal(preview.estimate.entrypointLoadBalancers, 1);
  const imported = await discovery.importSelection(project.id, {
    profileId: 'local:gcp-sandbox', selectedNodeIds: preview.nodes.filter(node => !node.alreadyInGraph).map(node => node.id),
    expectedRevision: 1, author: 'sandbox', reason: 'GCP trace sandbox',
  });
  const graph = architectureDatabase.getGraph(project.id);
  const nodeByType = type => graph.document.nodes.find(node => node.resourceType === type && node.name !== 'shop-web');
  const loadBalancer = nodeByType('gcp-load-balancer');
  const backend = nodeByType('gcp-backend-service');
  const cloudRun = graph.document.nodes.find(node => node.nativeId === RUN);
  const cloudSql = graph.document.nodes.find(node => node.nativeId === CLOUD_SQL);
  assert.ok(imported.revision > 1);
  assert.ok(loadBalancer && backend && cloudRun && cloudSql);
  assert.deepEqual(graph.document.edges.filter(edge => edge.relationType === 'routes_to').map(edge => edge.status), ['automatic', 'automatic']);
  assert.deepEqual(graph.document.edges.map(edge => edge.relationType).sort(), [
    'invokes', 'publishes_to', 'pushes_to', 'routes_to', 'routes_to', 'subscribes_to',
  ]);

  const store = new OtlpGatewayStore({ filePath: ':memory:' });
  const app = express();
  app.use('/api/observability/otlp', createOtlpGatewayRouter({ store, architectureDatabase }));
  const server = http.createServer(app);
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    store.close();
    architectureDatabase.close();
  });
  const base = await listen(server);
  const request = async (path, options = {}) => {
    const response = await fetch(`${base}${path}`, {
      method: options.method || 'GET',
      headers: {
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        ...(options.enrollmentToken ? { 'X-KUA-Enrollment-Token': options.enrollmentToken } : {}),
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {}),
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    });
    return { status: response.status, headers: response.headers, body: await response.json() };
  };
  const tokenResponse = await request('/enrollment-token', { method: 'POST' });
  const enrolled = await request('/enroll', { method: 'POST', enrollmentToken: tokenResponse.body.token,
    body: { contractVersion: 1, name: 'gcp-sandbox-workload', agentVersion: '1.0.0', capabilities: ['traces'] } });
  assert.equal(enrolled.status, 201);

  const w3c = new W3CTraceContextPropagator();
  const carrier = {};
  const requestContext = trace.setSpanContext(ROOT_CONTEXT, { traceId: TRACE_ID, spanId: ids.request, traceFlags: 1, isRemote: false });
  w3c.inject(requestContext, carrier, { set: (target, key, value) => { target[key] = value; } });
  assert.equal(carrier.traceparent, `00-${TRACE_ID}-${ids.request}-01`);
  const extracted = w3c.extract(ROOT_CONTEXT, carrier, { get: (source, key) => source[key], keys: source => Object.keys(source) });
  const extractedParent = trace.getSpanContext(extracted);
  assert.equal(extractedParent.traceId, TRACE_ID);
  assert.equal(extractedParent.spanId, ids.request);

  const time = BigInt(Date.now()) * 1_000_000n;
  const payload = { resourceSpans: [
    resourceSpan({ 'service.name': 'shop-web' }, [
      span({ id: ids.browser, name: 'GET /checkout', kind: 2, start: time }),
      span({ id: ids.request, parent: ids.browser, name: 'GET checkout-api', kind: 3, start: time + 1_000_000n,
        attributes: [attr('server.address', PUBLIC_IP), attr('http.route', '/checkout/{orderId}'), attr('url.path', '/checkout/private?token=secret')] }),
    ]),
    resourceSpan({ 'service.name': 'checkout-api', ...gcpRuntime() }, [
      span({ id: ids.api, parent: extractedParent.spanId, name: 'POST /orders', kind: 2, start: time + 2_000_000n }),
      span({ id: ids.db, parent: ids.api, name: 'SELECT orders', kind: 3, start: time + 3_000_000n,
        attributes: [attr('db.system.name', 'postgresql'), attr('db.operation.name', 'SELECT'), attr('server.address', '10.42.0.8'), attr('db.statement', 'SELECT * FROM orders WHERE id=secret')] }),
    ]),
  ] };
  const accepted = await request('/v1/traces', { method: 'POST', token: enrolled.body.token, body: payload });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.headers.get('x-kua-otlp-accepted-spans'), '4');
  const projected = await request(`/traces/${TRACE_ID}/architecture?projectId=${project.id}`, { headers: { 'X-Profile-Id': 'gcp:sandbox' } });
  assert.equal(projected.status, 200);
  assert.equal(projected.body.spans.length, 4);
  assert.equal(projected.body.spans[2].architecture.node.id, cloudRun.id);
  assert.equal(projected.body.spans[1].peerTarget.node.id, loadBalancer.id);
  assert.deepEqual(projected.body.segments[1].inventoryNodes.map(node => node.id), [loadBalancer.id, backend.id]);
  assert.deepEqual(projected.body.segments[1].inventoryEdges.map(edge => edge.evidence[0].type), [
    'gcp_forwarding_rule_backend', 'gcp_serverless_neg_backend',
  ]);
  assert.equal(projected.body.spans[3].databaseTarget.node.id, cloudSql.id);
  assert.equal(projected.body.spans[3].databaseTarget.databaseServerSpanObserved, false);
  assert.equal(projected.body.coverage, 'partial');
  const serialized = JSON.stringify(projected.body);
  for (const secret of ['203.0.113.24', '10.42.0.8', '/checkout/private', 'token=secret', 'SELECT * FROM orders']) {
    assert.equal(serialized.includes(secret), false, `projection leaked ${secret}`);
  }

  const projectTrace = () => request(`/traces/${TRACE_ID}/architecture?projectId=${project.id}`, { headers: { 'X-Profile-Id': 'gcp:sandbox' } });
  const unknownPeerPayload = structuredClone(payload);
  unknownPeerPayload.resourceSpans[0].scopeSpans[0].spans[1].attributes[0] = attr('server.address', 'storage.googleapis.com');
  assert.equal((await request('/v1/traces', { method: 'POST', token: enrolled.body.token, body: unknownPeerPayload })).status, 200);
  const unknownPeer = await projectTrace();
  assert.equal(unknownPeer.body.spans[1].peerTarget.status, 'unmatched');
  assert.equal(unknownPeer.body.segments[1].status, 'unknown');

  assert.equal((await request('/v1/traces', { method: 'POST', token: enrolled.body.token, body: payload })).status, 200);
  const ambiguousGraph = structuredClone(graph.document);
  ambiguousGraph.nodes.push({ ...loadBalancer, id: 'duplicate-gcp-load-balancer', nativeId: `projects/${PROJECT}/global/forwardingRules/duplicate-edge` });
  architectureDatabase.saveGraph(project.id, ambiguousGraph, { expectedRevision: graph.revision });
  const ambiguousPeer = await projectTrace();
  assert.equal(ambiguousPeer.body.spans[1].peerTarget.status, 'ambiguous');
  assert.equal(ambiguousPeer.body.spans[1].peerTarget.node, undefined);
  assert.equal(ambiguousPeer.body.segments[1].status, 'unknown');
  assert.deepEqual(computeCalls, [
    `/compute/v1/projects/${PROJECT}/aggregated/forwardingRules`,
    `/compute/v1/projects/${PROJECT}/global/targetHttpsProxies/checkout-edge`,
    `/compute/v1/projects/${PROJECT}/global/urlMaps/checkout-routes`,
    `/compute/v1/projects/${PROJECT}/global/backendServices/checkout-backend`,
    `/compute/v1/projects/${PROJECT}/regions/${REGION}/networkEndpointGroups/checkout-neg`,
  ]);
  assert.ok(catalogCalls.some(path => path.includes('/services')));
  assert.ok(catalogCalls.some(path => path.endsWith('/instances')));
  assert.ok(catalogCalls.some(path => path.endsWith('/topics')));
  assert.ok(catalogCalls.some(path => path.endsWith('/subscriptions')));
  assert.ok(catalogCalls.some(path => path.endsWith('/locations')));
  assert.ok(catalogCalls.some(path => path.endsWith('/jobs')));
  assert.equal(catalogCalls.some(path => path.includes('must-not-be-stored')), false);
});
