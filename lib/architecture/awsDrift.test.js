'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { awsIdentifier, checkAwsMap } = require('./awsDrift');

const node = (id, kind, identifier, extra = {}) => ({ id, provider: 'aws', kind, name: identifier, nativeId: `${kind}:${identifier}`, ...extra });
const awsError = name => Object.assign(new Error(name), { name });

test('only identifiers with the shape AWS expects are verified; names from diagrams are not', () => {
  assert.equal(awsIdentifier(node('a', 'AWS::EC2::SecurityGroup', 'sg-0720983be49e437e2')), 'sg-0720983be49e437e2');
  assert.equal(awsIdentifier(node('b', 'AWS::Cognito::UserPool', 'cognito-081')), '');
  assert.equal(awsIdentifier(node('c', 'AWS::ApiGateway::Stage', 'prod')), '');
  assert.equal(awsIdentifier(node('d', 'AWS::Lambda::Function', 'arn:aws:lambda:us-east-1:1:function:orders')), 'orders');
  assert.equal(awsIdentifier(node('e', 'AWS::SQS::Queue', 'jobs')), '');
  assert.equal(awsIdentifier(node('e', 'AWS::SQS::Queue', 'jobs'), { accountId: '111111111111', region: 'us-east-1' }), 'https://sqs.us-east-1.amazonaws.com/111111111111/jobs');
});

test('gone only when AWS says it does not exist; denied, unsupported or unreachable are not verified', async () => {
  const document = { nodes: [
    node('gone', 'AWS::EC2::SecurityGroup', 'sg-00000000000000001'),
    node('here', 'AWS::EC2::SecurityGroup', 'sg-00000000000000002'),
    node('denied', 'AWS::EKS::Cluster', 'dev'),
    node('drawn', 'AWS::Cognito::UserPool', 'cognito-081'),
    node('nowhere', 'AWS::Lambda::Function', 'orders', { accountId: '222222222222' }),
    { id: 'k8s', provider: 'kubernetes', kind: 'Pod', name: 'x' },
  ] };
  const calls = [];
  const reader = {
    async exists(item, location, identifier) {
      calls.push([item.id, location.profileId, identifier]);
      if (item.id === 'gone') throw awsError('ResourceNotFoundException');
      if (item.id === 'denied') throw awsError('AccessDeniedException');
      return true;
    },
  };
  const locate = item => (item.accountId === '222222222222' ? null : { profileId: 'local:dev', accountId: '111111111111', region: 'us-east-1' });
  const result = await checkAwsMap(document, { locate, reader });
  assert.equal(result.checked, 5);
  assert.equal(result.present, 1);
  assert.deepEqual(result.changes.map(change => [change.nodeId, change.change, change.provider]), [['gone', 'gone', 'aws']]);
  assert.deepEqual(result.notVerified, { unsupported: 1, noConnection: 1, denied: 1, failed: 0 });
  assert.deepEqual(calls.map(call => call[0]).sort(), ['denied', 'gone', 'here']);
});
