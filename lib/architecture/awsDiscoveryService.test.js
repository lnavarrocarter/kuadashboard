'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { ArchitectureDatabase } = require('./database');
const { ArchitectureGraphService } = require('./graphService');
const { ArchitectureAwsDiscoveryService, mergeResources } = require('./awsDiscoveryService');

function fixture({ deploymentResources, inventory, now } = {}) {
  const database = new ArchitectureDatabase({ filePath: ':memory:' });
  const graphService = new ArchitectureGraphService({ database });
  const calls = [];
  const deploymentReader = {
    async listDeployments(input) { calls.push(['list', input]); return { deployments: [] }; },
    async preview(input) {
      calls.push(['preview', input]);
      return {
        estimate: { awsRequests: 1, kubernetesRequests: 0 },
        resources: deploymentResources || [
          {
            type: 'lambda', key: 'AWS::Lambda::Function:orders-worker', arn: null,
            name: 'orders-worker', kind: 'AWS::Lambda::Function', stackName: 'orders', logicalId: 'Worker',
          },
          {
            type: 'sqs', key: 'AWS::SQS::Queue:https://sqs.us-east-1.amazonaws.com/123/orders', arn: null,
            name: 'orders', kind: 'AWS::SQS::Queue', stackName: 'orders', logicalId: 'Queue',
          },
        ],
      };
    },
  };
  const relationshipReader = {
    async analyze() {
      return {
        requests: 1,
        failures: [],
        relationships: [{
          stackName: 'orders', sourceLogicalId: 'Worker', targetLogicalId: 'Queue',
          relationType: 'depends_on', confidence: 0.95,
          evidence: [{ type: 'cloudformation_reference', path: 'Resources.Worker.Properties.Queue', intrinsic: 'Ref' }],
        }],
      };
    },
  };
  const inventoryReader = {
    async analyze() {
      return inventory || {
        accountId: '', resources: [], relationships: [], failures: [], requests: 0, truncated: false,
      };
    },
  };
  return {
    database,
    calls,
    service: new ArchitectureAwsDiscoveryService({ deploymentReader, inventoryReader, relationshipReader, graphService, now }),
  };
}

test('normalizes AWS deployment resources as deterministic evidence-backed candidates', async () => {
  const subject = fixture();
  try {
    const input = {
      profileId: 'local:dev', region: 'us-east-1', accountId: '123456789012', stackNames: ['orders'],
    };
    const first = await subject.service.preview(input);
    const second = await subject.service.preview(input);

    assert.deepEqual(first.nodes.map(node => node.id), second.nodes.map(node => node.id));
    assert.equal(first.scope.id, 'aws:123456789012:us-east-1');
    assert.equal(first.sources[0].readOnly, true);
    assert.equal(first.nodes[0].evidence[0].type, 'cloudformation_resource');
    assert.equal(first.relationshipSuggestions.length, 1);
    assert.equal(first.relationshipSuggestions[0].status, 'suggested');
    assert.deepEqual(first.relationshipAnalysis.supportedEvidence, [
      'cloudformation_reference', 'aws_inventory', 'eventbridge_target', 'lambda_event_source_mapping', 'asl_reference',
    ]);
  } finally {
    subject.database.close();
  }
});

test('keeps same-named non-regional resources from different stacks distinct', () => {
  const resources = mergeResources([
    {
      type: 'glue', key: 'AWS::Glue::Job:payments/TransformJob', arn: null,
      name: 'TransformJob', kind: 'AWS::Glue::Job', stackName: 'payments', logicalId: 'TransformJob',
    },
    {
      type: 'glue', key: 'AWS::Glue::Job:reporting/TransformJob', arn: null,
      name: 'TransformJob', kind: 'AWS::Glue::Job', stackName: 'reporting', logicalId: 'TransformJob',
    },
  ]);

  assert.equal(resources.length, 2);
  assert.deepEqual(resources.map(resource => resource.identity), [
    'AWS::Glue::Job:payments/TransformJob',
    'AWS::Glue::Job:reporting/TransformJob',
  ]);
});

test('identifies an application from regional AWS inventory without CloudFormation stacks', async () => {
  const workflowArn = 'arn:aws:states:us-east-1:123456789012:stateMachine:orders';
  const lambdaKey = 'AWS::Lambda::Function:orders-worker';
  const subject = fixture({
    inventory: {
      accountId: '123456789012',
      requests: 6,
      failures: [],
      truncated: false,
      resources: [
        {
          type: 'eventbridge', key: 'AWS::Events::Rule:default|orders', identity: 'AWS::Events::Rule:default|orders',
          arn: 'arn:aws:events:us-east-1:123456789012:rule/orders', name: 'orders', service: 'default',
          kind: 'AWS::Events::Rule', stackName: '', logicalId: '', sourceType: 'inventory',
        },
        {
          type: 'stepfunctions', key: workflowArn, identity: workflowArn, arn: workflowArn, name: 'orders',
          kind: 'AWS::StepFunctions::StateMachine', stackName: '', logicalId: '', sourceType: 'inventory',
        },
        {
          type: 'lambda', key: lambdaKey, identity: lambdaKey,
          arn: 'arn:aws:lambda:us-east-1:123456789012:function:orders-worker', name: 'orders-worker',
          kind: 'AWS::Lambda::Function', stackName: '', logicalId: '', sourceType: 'inventory',
        },
      ],
      relationships: [
        {
          sourceKey: 'AWS::Events::Rule:default|orders', targetKey: workflowArn,
          relationType: 'triggers', confidence: 0.99, evidence: [{ type: 'eventbridge_target' }],
        },
        {
          sourceKey: workflowArn, targetKey: lambdaKey,
          relationType: 'invokes', confidence: 0.98, evidence: [{ type: 'asl_reference' }],
        },
      ],
    },
  });
  try {
    const preview = await subject.service.preview({
      profileId: 'local:dev', region: 'us-east-1', stackNames: [],
    });

    assert.equal(preview.scope.accountId, '123456789012');
    assert.deepEqual(preview.nodes.map(node => node.name), ['orders', 'orders', 'orders-worker']);
    assert.deepEqual(preview.relationshipSuggestions.map(edge => edge.relationType), ['triggers', 'invokes']);
    assert.equal(preview.applicationCandidates.length, 1);
    assert.equal(preview.applicationCandidates[0].resourceCount, 3);
    assert.equal(preview.applicationCandidates[0].relationshipCount, 2);
    assert.deepEqual(preview.applicationCandidates[0].nodeIds, preview.nodes.map(node => node.id));
    assert.deepEqual(preview.applicationCandidates[0].resourceTypes, [
      { type: 'eventbridge', count: 1 },
      { type: 'stepfunctions', count: 1 },
      { type: 'lambda', count: 1 },
    ]);
    assert.deepEqual(preview.applicationCandidates[0].entrypoints.map(item => item.type), [
      'eventbridge', 'stepfunctions',
    ]);
    assert.equal(preview.sources[0].type, 'aws_inventory');
    assert.equal(preview.estimate.awsRequests, 6);
    assert.equal(subject.calls.length, 0);
  } finally {
    subject.database.close();
  }
});

test('limits CloudFormation previews to selected stack resources', async () => {
  const workflowArn = 'arn:aws:states:us-east-1:123456789012:stateMachine:orders';
  const subject = fixture({
    deploymentResources: [
      {
        type: 'stepfunctions', key: `AWS::StepFunctions::StateMachine:${workflowArn}`,
        arn: workflowArn, name: 'orders', kind: 'AWS::StepFunctions::StateMachine',
        stackName: 'orders', logicalId: 'Workflow',
      },
      {
        type: 'sqs', key: 'AWS::SQS::Queue:https://sqs.us-east-1.amazonaws.com/123456789012/orders',
        arn: null, name: 'orders', kind: 'AWS::SQS::Queue', stackName: 'orders', logicalId: 'Queue',
      },
    ],
    inventory: {
      accountId: '123456789012', requests: 4, failures: [], truncated: false,
      resources: [
        {
          type: 'stepfunctions', key: workflowArn, identity: workflowArn, arn: workflowArn, name: 'orders',
          kind: 'AWS::StepFunctions::StateMachine', stackName: '', logicalId: '', sourceType: 'inventory',
        },
        {
          type: 'lambda', key: 'AWS::Lambda::Function:unrelated-worker', identity: 'AWS::Lambda::Function:unrelated-worker',
          arn: 'arn:aws:lambda:us-east-1:123456789012:function:unrelated-worker', name: 'unrelated-worker',
          kind: 'AWS::Lambda::Function', stackName: '', logicalId: '', sourceType: 'inventory',
        },
      ],
      relationships: [{ sourceKey: workflowArn, targetKey: 'AWS::Lambda::Function:unrelated-worker', relationType: 'invokes', confidence: 0.98, evidence: [{ type: 'asl_reference' }] }],
    },
  });
  try {
    const preview = await subject.service.preview({
      profileId: 'local:dev', region: 'us-east-1', accountId: '123456789012', stackNames: ['orders'],
    });

    assert.deepEqual(preview.nodes.map(node => node.name), ['orders', 'orders']);
    assert.equal(preview.nodes.some(node => node.name === 'unrelated-worker'), false);
    assert.equal(preview.nodes.find(node => node.resourceType === 'stepfunctions').logicalId, 'Workflow');
    assert.equal(preview.nodes.find(node => node.resourceType === 'sqs').logicalId, 'Queue');
    assert.equal(preview.sources.some(source => source.type === 'aws_inventory'), false);
    assert.equal(preview.relationshipSuggestions.length, 0);
    assert.equal(preview.estimate.awsRequests, 2);
  } finally {
    subject.database.close();
  }
});

test('hides Lambda permissions while attaching their evidence to API routes', () => {
  const preview = require('./awsDiscoveryService').normalizePreview({
    profileId: 'local:dev', region: 'us-east-1', accountId: '123456789012', stackNames: ['orders'],
    resources: [
      { type: 'api-route', key: 'method', name: 'GetOrders', kind: 'AWS::ApiGateway::Method', stackName: 'orders', logicalId: 'GetOrders' },
      { type: 'lambda', key: 'worker', name: 'orders-worker', kind: 'AWS::Lambda::Function', stackName: 'orders', logicalId: 'Worker' },
      { type: 'policy', key: 'permission', name: 'permission', kind: 'AWS::Lambda::Permission', stackName: 'orders', logicalId: 'GetOrdersPermission' },
    ],
    relationships: [
      { stackName: 'orders', sourceLogicalId: 'GetOrders', targetLogicalId: 'Worker', relationType: 'routes_to', confidence: 0.99, evidence: [{ type: 'cloudformation_reference', route: 'GET /orders' }] },
      { stackName: 'orders', sourceLogicalId: 'GetOrdersPermission', targetLogicalId: 'Worker', relationType: 'authorizes', confidence: 0.95, evidence: [] },
    ], failures: [], estimate: { awsRequests: 1 },
  });

  assert.equal(preview.nodes.some(node => node.kind === 'AWS::Lambda::Permission'), false);
  assert.deepEqual(preview.relationshipSuggestions[0].evidence.map(item => item.type), [
    'cloudformation_reference', 'lambda_permission',
  ]);
});

test('imports only confirmed candidates in one graph revision', async () => {
  const subject = fixture();
  try {
    const project = subject.database.createProject({ profileId: 'local:dev', name: 'orders' });
    const preview = await subject.service.preview({
      profileId: 'local:dev', region: 'us-east-1', accountId: '123456789012', stackNames: ['orders'],
    });
    const graph = await subject.service.importSelection(project.id, {
      profileId: 'local:dev', region: 'us-east-1', accountId: '123456789012', stackNames: ['orders'],
      selectedNodeIds: preview.nodes.map(node => node.id), expectedRevision: 0, author: 'local:dev',
      automaticEdgeThreshold: 0.85,
    });

    assert.equal(graph.revision, 1);
    assert.deepEqual(graph.document.nodes.map(node => node.name), ['orders-worker', 'orders']);
    assert.deepEqual(graph.document.sources.map(source => source.name), ['orders']);
    assert.equal(graph.document.edges.length, 1);
    assert.equal(graph.document.edges[0].status, 'automatic');
    assert.equal(subject.database.listChanges(project.id)[0].type, 'discovery.import');
    assert.equal(subject.calls.filter(([type]) => type === 'preview').length, 1);
  } finally {
    subject.database.close();
  }
});

test('refreshes an expired preview before importing', async () => {
  let currentTime = 1_000;
  const subject = fixture({ now: () => currentTime });
  try {
    const project = subject.database.createProject({ profileId: 'local:dev', name: 'orders' });
    const input = {
      profileId: 'local:dev', region: 'us-east-1', accountId: '123456789012', stackNames: ['orders'],
    };
    const preview = await subject.service.preview(input);
    currentTime += 5 * 60 * 1000 + 1;

    await subject.service.importSelection(project.id, {
      ...input, selectedNodeIds: preview.nodes.map(node => node.id), expectedRevision: 0,
    });

    assert.equal(subject.calls.filter(([type]) => type === 'preview').length, 2);
  } finally {
    subject.database.close();
  }
});

test('keeps a rejected automatic relationship rejected after rediscovery', async () => {
  const subject = fixture();
  try {
    const project = subject.database.createProject({ profileId: 'local:dev', name: 'reviews' });
    const input = {
      profileId: 'local:dev', region: 'us-east-1', accountId: '123456789012', stackNames: ['orders'],
      expectedRevision: 0, author: 'local:dev', automaticEdgeThreshold: 0.85,
    };
    const preview = await subject.service.preview(input);
    const imported = await subject.service.importSelection(project.id, {
      ...input, selectedNodeIds: preview.nodes.map(node => node.id),
    });
    const edgeId = imported.document.edges[0].id;
    const rejected = subject.service.graphService.applyOperation(project.id, {
      type: 'edge.review', subjectId: edgeId, value: { decision: 'reject' },
    }, { expectedRevision: 1, author: 'local:dev' });
    assert.equal(rejected.document.edges[0].status, 'rejected');

    const rediscovered = await subject.service.importSelection(project.id, {
      ...input, expectedRevision: 2, selectedNodeIds: preview.nodes.map(node => node.id),
    });
    assert.equal(rediscovered.document.edges[0].status, 'rejected');
  } finally {
    subject.database.close();
  }
});

test('previews CloudFormation sync changes without mutating the graph', async () => {
  const subject = fixture({
    deploymentResources: [
      {
        type: 'lambda', key: 'AWS::Lambda::Function:orders-worker', arn: null,
        name: 'orders-worker-v2', kind: 'AWS::Lambda::Function', stackName: 'orders', logicalId: 'Worker',
      },
      {
        type: 'sqs', key: 'AWS::SQS::Queue:https://sqs.us-east-1.amazonaws.com/123/orders', arn: null,
        name: 'orders', kind: 'AWS::SQS::Queue', stackName: 'orders', logicalId: 'Queue',
      },
      {
        type: 's3', key: 'AWS::S3::Bucket:orders-audit', arn: null,
        name: 'orders-audit', kind: 'AWS::S3::Bucket', stackName: 'orders', logicalId: 'AuditBucket',
      },
    ],
  });
  try {
    const project = subject.database.createProject({ profileId: 'local:dev', name: 'sync-preview' });
    const input = { profileId: 'local:dev', region: 'us-east-1', accountId: '123456789012', stackNames: ['orders'] };
    subject.service.graphService.applyOperation(project.id, {
      type: 'discovery.import',
      value: {
        scopes: [{ id: 'aws:123456789012:us-east-1', provider: 'aws', profileId: 'local:dev', accountId: '123456789012', region: 'us-east-1' }],
        sources: [{ id: 'aws:cloudformation:123456789012:us-east-1:orders', type: 'cloudformation', provider: 'aws', accountId: '123456789012', region: 'us-east-1', name: 'orders' }],
        nodes: [
          {
            id: 'existing-worker', name: 'orders-worker', provider: 'aws', accountId: '123456789012', region: 'us-east-1',
            resourceType: 'lambda', kind: 'AWS::Lambda::Function', nativeId: 'AWS::Lambda::Function:orders-worker',
            discoveryKey: 'AWS::Lambda::Function:orders-worker', sourceId: 'aws:cloudformation:123456789012:us-east-1:orders',
            stackName: 'orders', logicalId: 'Worker', evidence: [{ type: 'cloudformation_resource', sourceId: 'aws:cloudformation:123456789012:us-east-1:orders', values: ['orders', 'Worker', 'AWS::Lambda::Function'] }],
          },
          {
            id: 'existing-table', name: 'orders-table', provider: 'aws', accountId: '123456789012', region: 'us-east-1',
            resourceType: 'dynamodb', kind: 'AWS::DynamoDB::Table', nativeId: 'AWS::DynamoDB::Table:orders-table',
            discoveryKey: 'AWS::DynamoDB::Table:orders-table', sourceId: 'aws:cloudformation:123456789012:us-east-1:orders',
            stackName: 'orders', logicalId: 'Table', evidence: [{ type: 'cloudformation_resource', sourceId: 'aws:cloudformation:123456789012:us-east-1:orders', values: ['orders', 'Table', 'AWS::DynamoDB::Table'] }],
          },
        ],
        edges: [],
      },
    }, { expectedRevision: 0, author: 'local:dev' });

    const before = subject.database.getGraph(project.id);
    const sync = await subject.service.previewSync(project.id, input);
    const after = subject.database.getGraph(project.id);

    assert.equal(after.revision, before.revision);
    assert.equal(sync.summary.resources.changed, 1);
    assert.equal(sync.summary.resources.new, 2);
    assert.equal(sync.summary.resources.missing, 1);
    assert.deepEqual(sync.resources.changed[0].node.id, 'existing-worker');
    assert.equal(sync.resources.changed[0].preview.name, 'orders-worker-v2');
    assert.equal(sync.resources.missing[0].node.name, 'orders-table');
    assert.equal(sync.summary.changeCount, 5);
  } finally {
    subject.database.close();
  }
});