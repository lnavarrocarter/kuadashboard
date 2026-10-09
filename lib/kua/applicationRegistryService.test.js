'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ApmDatabase } = require('../apm/database');
const { ArchitectureDatabase } = require('../architecture/database');
const { ApplicationRegistryService, resourceOwnProvider } = require('./applicationRegistryService');

function fixture(now = Date.UTC(2026, 7, 4, 12)) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kua-registry-'));
  const database = new ApmDatabase({ filePath: path.join(directory, 'apm.sqlite3'), now: () => now });
  const architectureDatabase = new ArchitectureDatabase({ filePath: ':memory:' });
  return {
    database,
    architectureDatabase,
    registry: new ApplicationRegistryService({ database, architectureDatabase }),
    close() {
      database.close();
      architectureDatabase.close();
      fs.rmSync(directory, { recursive: true, force: true });
    },
  };
}

test('resourceOwnProvider derives identity from the resource type, not the parent application provider', () => {
  assert.equal(resourceOwnProvider({ type: 'kubernetes', provider: 'aws' }), 'kubernetes');
  assert.equal(resourceOwnProvider({ type: 'kubernetes', provider: 'gcp' }), 'kubernetes');
  assert.equal(resourceOwnProvider({ type: 'gcp-cloud-run', provider: 'generic' }), 'gcp');
  assert.equal(resourceOwnProvider({ type: 'gcp-function', provider: 'generic' }), 'gcp');
  assert.equal(resourceOwnProvider({ type: 'vercel-project', provider: 'generic' }), 'vercel');
  assert.equal(resourceOwnProvider({ type: 'lambda', provider: 'aws' }), 'aws');
});

test('reconcile() applies at most one Architecture revision even when it both projects a missing APM resource and stamps registry ids', () => {
  const subject = fixture();
  try {
    const application = subject.database.createApplication({
      profileId: 'local:dev', region: 'us-east-1', name: 'orders',
    });
    const project = subject.architectureDatabase.createProject({ profileId: 'local:dev', name: 'orders-architecture' });
    subject.database.updateArchitectureProjectLink(application.id, project.id);
    const revisionBeforeReconcile = subject.architectureDatabase.getGraph(project.id).revision;

    // A resource with no matching graph node yet forces reconcile() to both add a node (missingNodes)
    // and stamp its registryResourceId in the same call, previously two separate saveGraph calls.
    subject.database.addResource(application.id, {
      type: 'lambda', key: 'arn:aws:lambda:us-east-1:123:function:checkout',
      arn: 'arn:aws:lambda:us-east-1:123:function:checkout', name: 'checkout', associationSource: 'manual',
    });

    const result = subject.registry.reconcile(subject.database.getApplication(application.id));

    const graph = subject.architectureDatabase.getGraph(project.id);
    assert.equal(graph.revision, revisionBeforeReconcile + 1, 'reconcile() must apply exactly one revision, not one per internal mutation');
    assert.equal(graph.document.nodes.length, 1);
    assert.ok(graph.document.nodes[0].registryResourceId, 'the projected node must already carry its registry id after a single revision');
    assert.equal(result.resources.length, 1);
    assert.equal(result.syncStatus.lastError, null);
    assert.ok(result.syncStatus.lastSuccessAt);
  } finally {
    subject.close();
  }
});

test('reconcile() projects discovered load balancers as ELB metrics resources with target group ARNs', () => {
  const subject = fixture();
  try {
    const application = subject.database.createApplication({
      profileId: 'local:dev', region: 'us-east-1', name: 'orders',
    });
    const project = subject.architectureDatabase.createProject({ profileId: 'local:dev', name: 'orders-architecture' });
    subject.database.updateArchitectureProjectLink(application.id, project.id);
    const graph = subject.architectureDatabase.getGraph(project.id);
    const loadBalancerArn = 'arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/app/orders/abcdef0123456789';
    const targetGroupArn = 'arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/orders-api/0123456789abcdef';
    subject.architectureDatabase.saveGraph(project.id, {
      ...graph.document,
      nodes: [
        { id: 'alb', name: 'orders', provider: 'aws', region: 'us-east-1', resourceType: 'loadbalancer', kind: 'AWS::ElasticLoadBalancingV2::LoadBalancer', nativeId: loadBalancerArn, arn: loadBalancerArn },
        { id: 'target-group', name: 'orders-api', provider: 'aws', region: 'us-east-1', resourceType: 'targetgroup', kind: 'AWS::ElasticLoadBalancingV2::TargetGroup', nativeId: targetGroupArn, arn: targetGroupArn },
      ],
      edges: [{ id: 'routes', sourceNodeId: 'alb', targetNodeId: 'target-group', relationType: 'routes_to', status: 'automatic' }],
    }, { expectedRevision: graph.revision });

    subject.registry.reconcile(subject.database.getApplication(application.id));

    const [resource] = subject.database.listResources(application.id);
    assert.equal(resource.type, 'elb');
    assert.equal(resource.arn, loadBalancerArn);
    assert.deepEqual(resource.metadata, { targetGroups: [targetGroupArn] });
  } finally {
    subject.close();
  }
});

test('reconcile() flags a relationship as divergent only while its status is still suggested, pending human review', () => {
  const subject = fixture();
  try {
    const application = subject.database.createApplication({
      profileId: 'local:dev', region: 'us-east-1', name: 'orders',
    });
    const project = subject.architectureDatabase.createProject({ profileId: 'local:dev', name: 'orders-architecture' });
    subject.database.updateArchitectureProjectLink(application.id, project.id);
    const graph = subject.architectureDatabase.getGraph(project.id);
    subject.architectureDatabase.saveGraph(project.id, {
      ...graph.document,
      nodes: [
        { id: 'node-worker', name: 'worker', provider: 'aws', accountId: '123456789012', region: 'us-east-1', resourceType: 'lambda', nativeId: 'arn:aws:lambda:us-east-1:123456789012:function:worker', arn: 'arn:aws:lambda:us-east-1:123456789012:function:worker' },
        { id: 'node-queue', name: 'queue', provider: 'aws', accountId: '123456789012', region: 'us-east-1', resourceType: 'sqs', nativeId: 'arn:aws:sqs:us-east-1:123456789012:queue', arn: 'arn:aws:sqs:us-east-1:123456789012:queue' },
      ],
      edges: [{ id: 'edge-1', sourceNodeId: 'node-worker', targetNodeId: 'node-queue', relationType: 'depends_on', status: 'suggested' }],
    }, { expectedRevision: graph.revision });

    const result = subject.registry.reconcile(subject.database.getApplication(application.id));

    assert.equal(result.relationships.length, 1);
    assert.equal(result.relationships[0].divergent, true);
    assert.equal(result.syncStatus.divergentRelationshipCount, 1);
  } finally {
    subject.close();
  }
});

test('reconcile() records a sync failure diagnostic without swallowing the underlying error', () => {
  const subject = fixture();
  try {
    const application = subject.database.createApplication({
      profileId: 'local:dev', region: 'us-east-1', name: 'orders',
    });
    const project = subject.architectureDatabase.createProject({ profileId: 'local:dev', name: 'orders-architecture' });
    subject.database.updateArchitectureProjectLink(application.id, project.id);
    subject.database.addResource(application.id, {
      type: 'lambda', key: 'arn:aws:lambda:us-east-1:123:function:checkout',
      arn: 'arn:aws:lambda:us-east-1:123:function:checkout', name: 'checkout', associationSource: 'manual',
    });
    const originalSaveGraph = subject.architectureDatabase.saveGraph.bind(subject.architectureDatabase);
    subject.architectureDatabase.saveGraph = () => { throw new Error('boom'); };

    try {
      assert.throws(() => subject.registry.reconcile(subject.database.getApplication(application.id)), /boom/);
    } finally {
      subject.architectureDatabase.saveGraph = originalSaveGraph;
    }

    const status = subject.database.getRegistrySyncStatus(application.id);
    assert.equal(status.lastError, 'boom');
    assert.ok(status.lastErrorAt);
  } finally {
    subject.close();
  }
});

test('reconcile() correlates a supported Architecture-discovered resource type (S3) into a single dual-sourced registry entry', () => {
  const subject = fixture();
  try {
    const application = subject.database.createApplication({
      profileId: 'local:dev', region: 'us-east-1', name: 'orders',
    });
    const project = subject.architectureDatabase.createProject({ profileId: 'local:dev', name: 'orders-architecture' });
    subject.database.updateArchitectureProjectLink(application.id, project.id);
    const graph = subject.architectureDatabase.getGraph(project.id);
    // S3 bucket names are globally unique (no account/region in the ARN); the Architecture node still
    // carries a discovery-time accountId/region, which must not split identity from the APM projection.
    subject.architectureDatabase.saveGraph(project.id, {
      ...graph.document,
      nodes: [{
        id: 'node-bucket', name: 'orders-bucket', provider: 'aws', accountId: '123456789012', region: 'us-east-1',
        resourceType: 's3', kind: 'AWS::S3::Bucket', nativeId: 'arn:aws:s3:::orders-bucket', arn: 'arn:aws:s3:::orders-bucket',
      }],
    }, { expectedRevision: graph.revision });

    const result = subject.registry.reconcile(subject.database.getApplication(application.id));

    assert.equal(result.resources.length, 1, 'the S3 bucket must correlate into ONE registry resource, not one per source');
    assert.deepEqual([...result.resources[0].sources].sort(), ['apm_resource', 'architecture_node']);
    assert.equal(result.resources[0].correlatable, true);
    assert.equal(result.resources[0].divergent, false);
    assert.equal(result.syncStatus.divergentResourceCount, 0);
  } finally {
    subject.close();
  }
});

test('reconcile() never counts a still-unsupported Architecture-only resource type (e.g. Kinesis) as divergent, since APM cannot observe it', () => {
  const subject = fixture();
  try {
    const application = subject.database.createApplication({
      profileId: 'local:dev', region: 'us-east-1', name: 'orders',
    });
    const project = subject.architectureDatabase.createProject({ profileId: 'local:dev', name: 'orders-architecture' });
    subject.database.updateArchitectureProjectLink(application.id, project.id);
    const graph = subject.architectureDatabase.getGraph(project.id);
    subject.architectureDatabase.saveGraph(project.id, {
      ...graph.document,
      nodes: [{
        id: 'node-stream', name: 'orders-stream', provider: 'aws', accountId: '123456789012', region: 'us-east-1',
        resourceType: 'kinesis', kind: 'AWS::Kinesis::Stream', nativeId: 'arn:aws:kinesis:us-east-1:123456789012:stream/orders-stream',
        arn: 'arn:aws:kinesis:us-east-1:123456789012:stream/orders-stream',
      }],
    }, { expectedRevision: graph.revision });

    const result = subject.registry.reconcile(subject.database.getApplication(application.id));

    assert.equal(result.resources.length, 1);
    assert.deepEqual(result.resources[0].sources, ['architecture_node']);
    assert.equal(result.resources[0].correlatable, false, 'Kinesis has no apm_resources schema support yet');
    assert.equal(result.resources[0].divergent, false);
    assert.equal(result.syncStatus.divergentResourceCount, 0, 'a structurally single-source resource type must never be reported as divergent');
  } finally {
    subject.close();
  }
});

test('attaching resources again keeps a relationship the user rejected (#150)', () => {
  const subject = fixture();
  try {
    const application = subject.database.createApplication({ profileId: 'local:dev', region: 'us-east-1', name: 'orders' });
    const project = subject.architectureDatabase.createProject({ profileId: 'local:dev', name: 'orders-architecture' });
    subject.database.updateArchitectureProjectLink(application.id, project.id);
    const api = { type: 'lambda', key: 'arn:aws:lambda:us-east-1:123456789012:function:api', arn: 'arn:aws:lambda:us-east-1:123456789012:function:api', name: 'api' };
    const queue = { type: 'sqs', key: 'arn:aws:sqs:us-east-1:123456789012:orders', arn: 'arn:aws:sqs:us-east-1:123456789012:orders', name: 'orders' };
    subject.registry.attachResource(subject.database.getApplication(application.id), api);
    subject.registry.attachResource(subject.database.getApplication(application.id), queue);
    const graph = subject.architectureDatabase.getGraph(project.id);
    const [source, target] = graph.document.nodes;
    subject.architectureDatabase.saveGraph(project.id, {
      ...graph.document,
      edges: [{ id: 'edge-1', sourceNodeId: source.id, targetNodeId: target.id, relationType: 'publishes_to', status: 'rejected', confidence: 0.9, evidence: [] }],
    }, { expectedRevision: graph.revision });

    const again = subject.registry.attachResource(subject.database.getApplication(application.id), api);

    assert.equal(again.created, false, 'the second attach is an idempotent retry');
    assert.equal(subject.database.listResources(application.id).length, 2);
    const relationships = subject.database.listRegistryRelationships(application.id);
    assert.equal(relationships.length, 1);
    assert.equal(relationships[0].status, 'rejected', 'a human decision survives reconciliation');
    assert.equal(subject.architectureDatabase.getGraph(project.id).document.edges[0].status, 'rejected');
  } finally {
    subject.close();
  }
});

test('a CloudFormation node without ARN and its APM projection are one registry resource (#166)', () => {
  const subject = fixture();
  try {
    const application = subject.database.createApplication({ name: 'APP TEST' });
    const project = subject.architectureDatabase.createProject({ profileId: 'local:prod', name: 'app-test-map' });
    subject.database.updateArchitectureProjectLink(application.id, project.id);
    const graph = subject.architectureDatabase.getGraph(project.id);
    subject.architectureDatabase.saveGraph(project.id, {
      ...graph.document,
      nodes: [{
        id: 'node-fn', name: 'AnswerApiFunction', provider: 'aws', accountId: '341710078349', region: 'us-east-1',
        resourceType: 'lambda', kind: 'AWS::Lambda::Function', nativeId: 'AWS::Lambda::Function:AnswerApiFunction', arn: null,
      }],
    }, { expectedRevision: graph.revision });

    const binding = { scopeKey: 'k', profileId: 'local:prod', status: 'verified' };
    subject.database.listScopeBindings = () => [binding];
    const result = subject.registry.reconcile(subject.database.getApplication(application.id));

    const [resource] = subject.database.listResources(application.id);
    assert.deepEqual([resource.scopeId, resource.location], ['341710078349', 'us-east-1']);
    assert.equal(result.resources.length, 1, 'one resource, not one per source');
    assert.deepEqual(result.resources[0].sources.sort(), ['apm_resource', 'architecture_node']);
    assert.equal(result.syncStatus.divergentResourceCount, 0);
  } finally {
    subject.close();
  }
});

test('the same native identifier in two scopes stays two resources; a renamed duplicate is one (#150)', () => {
  const subject = fixture();
  try {
    const application = subject.database.createApplication({ name: 'Search' });
    const deployment = (context, name) => ({
      provider: 'kubernetes', type: 'kubernetes', kind: 'deployment', key: `${context}/search/deployment/api`,
      kubeContext: context, namespace: 'search', name,
    });
    const current = () => subject.database.getApplication(application.id);
    subject.registry.attachResource(current(), deployment('staging', 'api'));
    subject.registry.attachResource(current(), deployment('production', 'api'));
    const resources = () => subject.database.listRegistryResources(application.id);
    assert.equal(resources().length, 2, 'staging and production are different resources');
    assert.deepEqual(resources().map(resource => resource.scopeId).sort(), ['production', 'staging']);

    // The same identity under another display name, attached again and seen from a diagram, is still one.
    const again = subject.registry.attachResource(current(), deployment('production', 'search-api'));
    assert.equal(again.created, false);
    const project = subject.architectureDatabase.createProject({ profileId: 'local:dev', name: 'search' });
    subject.database.updateArchitectureProjectLink(application.id, project.id);
    const graph = subject.architectureDatabase.getGraph(project.id);
    subject.architectureDatabase.saveGraph(project.id, {
      ...graph.document,
      nodes: [{ id: 'n1', name: 'Search API (prod)', provider: 'kubernetes', kind: 'deployment', resourceType: 'deployment', kubeContext: 'production', namespace: 'search', discoveryKey: 'production/search/deployment/api' }],
    }, { expectedRevision: graph.revision });
    subject.registry.reconcile(current());
    assert.equal(resources().length, 2);
    assert.deepEqual(resources().find(resource => resource.scopeId === 'production').sources.sort(), ['apm_resource', 'architecture_node']);
  } finally {
    subject.close();
  }
});

test('a node hidden in a view keeps its resource in the application, with its collected data, and is not added again (#146)', () => {
  const subject = fixture();
  try {
    const application = subject.database.createApplication({ profileId: 'local:dev', region: 'us-east-1', name: 'orders' });
    const project = subject.architectureDatabase.createProject({ profileId: 'local:dev', name: 'orders' });
    subject.database.updateArchitectureProjectLink(application.id, project.id);
    const queue = 'arn:aws:sqs:us-east-1:123456789012:orders';
    const graph = subject.architectureDatabase.getGraph(project.id);
    subject.architectureDatabase.saveGraph(project.id, {
      ...graph.document,
      nodes: [{ id: 'queue', name: 'orders', provider: 'aws', region: 'us-east-1', resourceType: 'sqs', arn: queue, nativeId: queue }],
    }, { expectedRevision: graph.revision });
    const current = () => subject.database.getApplication(application.id);
    subject.registry.reconcile(current());
    const [observed] = subject.database.listResources(application.id);
    assert.equal(observed.associationSource, 'architecture');
    subject.database.upsertMetricBucket({ resourceId: observed.id, bucketStart: 0, metricName: 'NumberOfMessagesSent', count: 1, source: 'cloudwatch' });

    const before = subject.architectureDatabase.getGraph(project.id);
    const { applyGraphOperation } = require('../architecture/graphService');
    subject.architectureDatabase.saveGraph(project.id, applyGraphOperation(before.document, { type: 'node.hide', subjectId: 'queue' }), { expectedRevision: before.revision });
    subject.registry.reconcile(current());

    assert.deepEqual(subject.database.listResources(application.id).map(resource => resource.id), [observed.id], 'the resource and its data stay');
    assert.equal(subject.database.listLatestMetricTimes([observed.id]).size, 1);
    assert.equal(subject.database.listRegistryResources(application.id).length, 1);
    const nodes = subject.architectureDatabase.getGraph(project.id).document.nodes;
    assert.equal(nodes.length, 1, 'no second node is projected for the hidden resource');
    assert.equal(nodes[0].hidden, true);
  } finally {
    subject.close();
  }
});

test('a CloudFormation secret is not a Kubernetes Secret: it is never observed as a Kubernetes workload', () => {
  const { apmProjectionFromNode } = require('./applicationRegistryService');
  const arn = 'arn:aws:secretsmanager:us-east-1:341710078349:secret:sm-dl-spo-prd-HxnfMI';
  const application = { provider: null, region: '' };
  for (const node of [
    { id: 's1', name: 'sm-dl-spo-prd', provider: 'aws', resourceType: 'secret', kind: 'AWS::SecretsManager::Secret', arn },
    { id: 's2', name: 'sm-dl-spo-prd', resourceType: 'secret', kind: 'AWS::SecretsManager::Secret', discoveryKey: `AWS::SecretsManager::Secret:${arn}` },
    { id: 's3', name: 'sm-dl-spo-prd', resourceType: 'secret', arn },
  ]) assert.equal(apmProjectionFromNode(application, node), null, node.id);
  // A real Kubernetes Secret is still one.
  assert.equal(apmProjectionFromNode(application, { id: 'k', name: 'db', resourceType: 'secret', kind: 'Secret', kubeContext: 'prod', namespace: 'app', discoveryKey: 'prod/app/secret/db' }).type, 'kubernetes');
});

test('a node without its account becomes the resource the application knows with one; ambiguity and homonyms stay apart (#239)', () => {
  const subject = fixture();
  try {
    const application = subject.database.createApplication({ profileId: 'local:dev', region: 'us-east-1', name: 'dev' });
    const project = subject.architectureDatabase.createProject({ profileId: 'local:dev', name: 'dev' });
    subject.database.updateArchitectureProjectLink(application.id, project.id);
    const key = 'AWS::EC2::SecurityGroup:sg-0720983be49e437e2';
    const node = (id, extra) => ({ id, name: 'sg-0720983be49e437e2', provider: 'aws', resourceType: 'ec2', kind: 'AWS::EC2::SecurityGroup', nativeId: key, discoveryKey: key, ...extra });
    const graph = subject.architectureDatabase.getGraph(project.id);
    subject.architectureDatabase.saveGraph(project.id, {
      ...graph.document,
      nodes: [
        node('with-account', { accountId: '073746111526', region: 'us-east-1' }),
        node('without-account', {}),
        // Two different log groups that share a display name: never joined.
        { id: 'error-1', name: 'error', provider: 'aws', resourceType: 'cloudformation', nativeId: 'Custom::LogRetention:/aws-glue/jobs/error', accountId: '073746111526', region: 'us-east-1' },
        { id: 'error-2', name: 'error', provider: 'aws', resourceType: 'cloudformation', nativeId: 'Custom::LogRetention:/aws-glue/python-jobs/error', accountId: '073746111526', region: 'us-east-1' },
      ],
    }, { expectedRevision: graph.revision });
    subject.registry.reconcile(subject.database.getApplication(application.id));
    const resources = subject.database.listRegistryResources(application.id);
    const groups = resources.filter(resource => resource.displayName === 'sg-0720983be49e437e2');
    assert.equal(groups.length, 1, 'one security group, with its account');
    assert.equal(groups[0].scopeId, '073746111526');
    assert.equal(resources.filter(resource => resource.displayName === 'error').length, 2);

    // Two candidate accounts: nothing is guessed.
    const next = subject.architectureDatabase.getGraph(project.id);
    subject.architectureDatabase.saveGraph(project.id, {
      ...next.document,
      nodes: [...next.document.nodes, node('other-account', { id: 'other-account', accountId: '111111111111', region: 'us-east-1' })],
    }, { expectedRevision: next.revision });
    subject.registry.reconcile(subject.database.getApplication(application.id));
    const scopes = subject.database.listRegistryResources(application.id).filter(resource => resource.displayName === 'sg-0720983be49e437e2').map(resource => resource.scopeId).sort();
    assert.deepEqual(scopes, ['', '073746111526', '111111111111']);
  } finally {
    subject.close();
  }
});
