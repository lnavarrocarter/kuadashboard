'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { ArchitectureDatabase } = require('./database');
const { ArchitectureGraphService } = require('./graphService');
const { ArchitectureAwsDiscoveryService } = require('./awsDiscoveryService');

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
      'cloudformation_reference', 'aws_inventory', 'eventbridge_target', 'asl_reference',
    ]);
  } finally {
    subject.database.close();
  }
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
    assert.equal(preview.sources[0].type, 'aws_inventory');
    assert.equal(preview.estimate.awsRequests, 6);
    assert.equal(subject.calls.length, 0);
  } finally {
    subject.database.close();
  }
});

test('merges regional and CloudFormation identities for the same AWS resources', async () => {
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
          type: 'sqs', key: 'AWS::SQS::Queue:orders', identity: 'AWS::SQS::Queue:orders',
          arn: 'arn:aws:sqs:us-east-1:123456789012:orders', name: 'orders',
          kind: 'AWS::SQS::Queue', stackName: '', logicalId: '', sourceType: 'inventory',
        },
      ],
      relationships: [],
    },
  });
  try {
    const preview = await subject.service.preview({
      profileId: 'local:dev', region: 'us-east-1', accountId: '123456789012', stackNames: ['orders'],
    });

    assert.equal(preview.nodes.filter(node => node.resourceType === 'stepfunctions').length, 1);
    assert.equal(preview.nodes.filter(node => node.resourceType === 'sqs').length, 1);
    assert.equal(preview.nodes.find(node => node.resourceType === 'stepfunctions').logicalId, 'Workflow');
    assert.equal(preview.nodes.find(node => node.resourceType === 'sqs').logicalId, 'Queue');
  } finally {
    subject.database.close();
  }
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