'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { mergeSameResourceNodes } = require('./sameResource');

const ARN = 'arn:aws:ec2:us-east-1:073746111526:instance/i-002905f9976a29892';
const CONTEXT = 'arn:aws:eks:us-east-1:073746111526:cluster/EKS130-360-Dev';

test('a cluster node and its projection from Observability (same ARN and object) become the discovered one', () => {
  const document = {
    nodes: [
      { id: 'kubernetes:node', provider: 'kubernetes', resourceType: 'node', kind: 'Node', name: 'ip-20-0-7-87.ec2.internal', arn: ARN, kubeContext: CONTEXT, discoveryKey: `${CONTEXT}//Node/ip-20-0-7-87.ec2.internal`, instanceType: 'm5.large', evidence: [{ type: 'kubernetes_uid' }] },
      { id: 'apm-resource:1', provider: 'kubernetes', resourceType: 'kubernetes', kind: 'Node', name: 'ip-20-0-7-87.ec2.internal', arn: ARN, nativeId: ARN, kubeContext: CONTEXT, discoveryKey: `${CONTEXT}//Node/ip-20-0-7-87.ec2.internal`, manual: true, evidence: [{ type: 'apm_membership' }] },
      { id: 'pod', provider: 'kubernetes', resourceType: 'pod', kind: 'Pod', name: 'api-1', kubeContext: CONTEXT, discoveryKey: `${CONTEXT}/ns/Pod/api-1` },
      { id: 'other-node', provider: 'kubernetes', resourceType: 'node', kind: 'Node', name: 'ip-20-0-9-46.ec2.internal', kubeContext: CONTEXT, discoveryKey: `${CONTEXT}//Node/ip-20-0-9-46.ec2.internal` },
    ],
    edges: [
      { id: 'a', sourceNodeId: 'pod', targetNodeId: 'kubernetes:node', relationType: 'runs_on', status: 'automatic' },
      { id: 'b', sourceNodeId: 'pod', targetNodeId: 'apm-resource:1', relationType: 'runs_on', status: 'manual' },
      { id: 'c', sourceNodeId: 'apm-resource:1', targetNodeId: 'kubernetes:node', relationType: 'depends_on', status: 'suggested' },
    ],
    layout: { 'apm-resource:1': { x: 10, y: 20 } },
  };
  const merges = mergeSameResourceNodes(document);
  assert.deepEqual(merges, [{ targetId: 'kubernetes:node', sourceIds: ['apm-resource:1'] }]);
  assert.deepEqual(document.nodes.map(node => node.id), ['kubernetes:node', 'pod', 'other-node']);
  // One runs_on edge, keeping the decision made by hand; the self relation disappears.
  assert.deepEqual(document.edges.map(edge => [edge.sourceNodeId, edge.targetNodeId, edge.status]), [['pod', 'kubernetes:node', 'manual']]);
  assert.deepEqual(document.layout, { 'kubernetes:node': { x: 10, y: 20 } });
  assert.deepEqual(document.nodes[0].evidence.map(item => item.type), ['kubernetes_uid', 'apm_membership']);
});

test('an EKS worker and its EC2 instance share an ARN; a shared name alone joins nothing', () => {
  const document = {
    nodes: [
      { id: 'ec2', provider: 'aws', resourceType: 'ec2', kind: 'AWS::EC2::Instance', name: 'worker', arn: ARN },
      { id: 'node', provider: 'kubernetes', resourceType: 'node', kind: 'Node', name: 'ip-20-0-7-87.ec2.internal', arn: ARN, kubeContext: CONTEXT, discoveryKey: 'k' },
      { id: 'lambda-a', provider: 'aws', resourceType: 'lambda', name: 'orders' },
      { id: 'lambda-b', provider: 'aws', resourceType: 'lambda', name: 'orders' },
    ],
    edges: [],
    layout: {},
  };
  assert.equal(mergeSameResourceNodes(document).length, 1);
  assert.equal(document.nodes.length, 3);
  assert.equal(document.nodes.filter(node => node.arn === ARN).length, 1);
  assert.equal(document.nodes.filter(node => node.name === 'orders').length, 2);
});
