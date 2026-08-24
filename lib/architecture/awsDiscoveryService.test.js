'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { ArchitectureDatabase } = require('./database');
const { ArchitectureGraphService } = require('./graphService');
const { ArchitectureAwsDiscoveryService } = require('./awsDiscoveryService');

function fixture() {
  const database = new ArchitectureDatabase({ filePath: ':memory:' });
  const graphService = new ArchitectureGraphService({ database });
  const calls = [];
  const deploymentReader = {
    async listDeployments(input) { calls.push(['list', input]); return { deployments: [] }; },
    async preview(input) {
      calls.push(['preview', input]);
      return {
        estimate: { awsRequests: 1, kubernetesRequests: 0 },
        resources: [
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
  return {
    database,
    calls,
    service: new ArchitectureAwsDiscoveryService({ deploymentReader, relationshipReader, graphService }),
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
    assert.deepEqual(first.relationshipAnalysis.supportedEvidence, ['cloudformation_reference', 'asl_reference']);
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
      selectedNodeIds: [preview.nodes[0].id], expectedRevision: 0, author: 'local:dev',
    });

    assert.equal(graph.revision, 1);
    assert.deepEqual(graph.document.nodes.map(node => node.name), ['orders-worker']);
    assert.deepEqual(graph.document.sources.map(source => source.name), ['orders']);
    assert.equal(graph.document.edges.length, 0);
    assert.equal(subject.database.listChanges(project.id)[0].type, 'discovery.import');
  } finally {
    subject.database.close();
  }
});