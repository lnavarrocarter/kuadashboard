'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { extractAslReferences, arnContext } = require('./aslReferences');

test('extracts direct and optimized ASL resource references with state evidence', () => {
  const references = extractAslReferences({ States: {
    Direct: { Type: 'Task', Resource: 'arn:aws:lambda:us-east-1:123:function:orders-direct' },
    Worker: {
      Type: 'Task', Resource: 'arn:aws:states:::lambda:invoke',
      Parameters: { FunctionName: 'arn:aws:lambda:us-east-1:123:function:orders-worker:live' },
    },
    Nested: {
      Type: 'Task', Resource: 'arn:aws:states:::states:startExecution.sync:2',
      Parameters: { StateMachineArn: 'arn:aws:states:us-east-1:123:stateMachine:orders-child' },
    },
  } });

  assert.deepEqual(references.map(reference => [reference.type, reference.name, reference.relationType]), [
    ['lambda', 'orders-direct', 'invokes'],
    ['lambda', 'orders-worker', 'invokes'],
    ['stepfunctions', 'orders-child', 'starts_execution'],
  ]);
  assert.equal(references[1].statePath, 'Worker');
});

test('walks Map and Parallel states and ignores dynamic references', () => {
  const references = extractAslReferences({ States: {
    FanOut: { Type: 'Parallel', Branches: [{ States: {
      Queue: { Type: 'Task', Resource: 'arn:aws:states:::sqs:sendMessage', Parameters: { QueueUrl: 'https://sqs.us-east-1.amazonaws.com/123/orders' } },
    } }] },
    Dynamic: { Type: 'Task', Resource: 'arn:aws:states:::lambda:invoke', Parameters: { 'FunctionName.$': '$.function' } },
  } });

  assert.equal(references.length, 1);
  assert.equal(references[0].name, 'orders');
  assert.match(references[0].statePath, /Branch 1/);
});

test('extracts S3 SDK integrations as topology evidence', () => {
  const references = extractAslReferences({ States: {
    Archive: { Type: 'Task', Resource: 'arn:aws:states:::aws-sdk:s3:putObject', Parameters: { Bucket: 'gasco-archive', Key: 'result.json' } },
  } });
  assert.deepEqual(references.map(item => [item.type, item.name, item.relationType]), [['s3', 'gasco-archive', 'accesses']]);
});
test('Glue jobs, DynamoDB tables and SNS topics of a definition become references (#283)', () => {
  const definition = {
    States: {
      Extract: { Type: 'Task', Resource: 'arn:aws:states:::glue:startJobRun.sync', Parameters: { JobName: 'nightly-etl' } },
      Save: { Type: 'Task', Resource: 'arn:aws:states:::dynamodb:putItem', Parameters: { TableName: 'orders', Item: {} } },
      Read: { Type: 'Task', Resource: 'arn:aws:states:::aws-sdk:dynamodb:getItem', Parameters: { TableName: 'arn:aws:dynamodb:us-east-1:111111111111:table/customers' } },
      Notify: { Type: 'Task', Resource: 'arn:aws:states:::sns:publish', Parameters: { TopicArn: 'arn:aws:sns:us-east-1:111111111111:alerts' } },
      Dynamic: { Type: 'Task', Resource: 'arn:aws:states:::glue:startJobRun', Parameters: { 'JobName.$': '$.job' } },
    },
  };
  const context = arnContext('arn:aws:states:us-east-1:111111111111:stateMachine:orders');
  assert.deepEqual(extractAslReferences(definition, context).map(reference => [reference.type, reference.name, reference.arn, reference.relationType]), [
    ['glue', 'nightly-etl', 'arn:aws:glue:us-east-1:111111111111:job/nightly-etl', 'runs_job'],
    ['dynamodb', 'orders', 'arn:aws:dynamodb:us-east-1:111111111111:table/orders', 'accesses'],
    ['dynamodb', 'customers', 'arn:aws:dynamodb:us-east-1:111111111111:table/customers', 'accesses'],
    ['sns', 'alerts', 'arn:aws:sns:us-east-1:111111111111:alerts', 'publishes_to'],
  ]);
  assert.equal(extractAslReferences(definition)[0].arn, '', 'without the state machine ARN the job keeps only its name');
});
