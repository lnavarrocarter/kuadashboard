'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createAwsTemplateRelationshipReader, templateRelationships } = require('./awsTemplateRelationshipReader');

test('extracts CloudFormation dependency evidence without executing templates', () => {
  const relationships = templateRelationships({
    Resources: {
      Queue: { Type: 'AWS::SQS::Queue' },
      Worker: {
        Type: 'AWS::Lambda::Function',
        DependsOn: 'Queue',
        Properties: {
          QueueUrl: { Ref: 'Queue' },
          QueueArn: { 'Fn::GetAtt': ['Queue', 'Arn'] },
          Description: { 'Fn::Sub': 'Consumes ${Queue.Arn}' },
        },
      },
    },
  }, 'orders');

  assert.equal(relationships.length, 1);
  assert.equal(relationships[0].sourceLogicalId, 'Worker');
  assert.equal(relationships[0].targetLogicalId, 'Queue');
  assert.deepEqual(relationships[0].evidence.map(item => item.intrinsic), [
    'DependsOn', 'Ref', 'Fn::GetAtt', 'Fn::Sub',
  ]);
  assert.equal(relationships[0].confidence, 0.95);
});

test('supports common CloudFormation YAML intrinsic shorthand', () => {
  const relationships = templateRelationships(`
Resources:
  Queue:
    Type: AWS::SQS::Queue
  Worker:
    Type: AWS::Lambda::Function
    Properties:
      QueueUrl: !Ref Queue
      QueueArn: !GetAtt Queue.Arn
      Description: !Sub "Consumes \${Queue.Arn}"
`, 'orders');

  assert.equal(relationships.length, 1);
  assert.deepEqual(relationships[0].evidence.map(item => item.intrinsic), ['Ref', 'Fn::GetAtt', 'Fn::Sub']);
});

test('stops before AWS when the request budget is exhausted', async () => {
  let sends = 0;
  const reader = createAwsTemplateRelationshipReader({
    configResolver: async () => ({}),
    clientFactory: () => ({ async send() { sends += 1; return {}; } }),
    beforeRequest() {
      throw Object.assign(new Error('AWS request budget exhausted'), { statusCode: 429 });
    },
  });

  await assert.rejects(
    reader.analyze({ profileId: 'local:dev', region: 'us-east-1', stackNames: ['orders'] }),
    error => error.statusCode === 429,
  );
  assert.equal(sends, 0);
});