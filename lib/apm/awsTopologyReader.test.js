'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createAwsTopologyReader } = require('./awsTopologyReader');

test('turns ASL references into explainable unconfirmed suggestions', async () => {
  const reader = createAwsTopologyReader({
    configResolver: async profileId => ({ profileId }),
    clientFactory: () => ({ async send() { return { definition: JSON.stringify({ States: {
      Invoke: { Type: 'Task', Resource: 'arn:aws:states:::lambda:invoke', Parameters: { FunctionName: 'arn:aws:lambda:us-east-1:123:function:orders-worker' } },
      Missing: { Type: 'Task', Resource: 'arn:aws:states:::lambda:invoke', Parameters: { FunctionName: 'external-worker' } },
    } }) }; } }),
  });
  const result = await reader.analyze({
    application: { provider: 'aws', profileId: 'local:prod', region: 'us-east-1' },
    resources: [
      { id: 'flow', type: 'stepfunctions', name: 'orders', arn: 'arn:aws:states:us-east-1:123:stateMachine:orders', enabled: true },
      { id: 'worker', type: 'lambda', name: 'orders-worker', arn: 'arn:aws:lambda:us-east-1:123:function:orders-worker', enabled: true },
    ], edges: [],
  });

  assert.equal(result.requests, 1);
  assert.equal(result.suggestions[0].confidence, 1);
  assert.equal(result.suggestions[0].evidence[0].type, 'asl_reference');
  assert.equal(result.unresolvedReferences[0].name, 'external-worker');
  assert.equal('arn' in result.unresolvedReferences[0], false);
  assert.equal(result.unresolvedReferences[0].candidate.arn, 'external-worker');
});

test('keeps partial ASL results when one state machine is inaccessible', async () => {
  let call = 0;
  const reader = createAwsTopologyReader({
    configResolver: async () => ({}),
    clientFactory: () => ({ async send() {
      call += 1;
      if (call === 1) throw Object.assign(new Error('denied'), { name: 'AccessDeniedException' });
      return { definition: '{"States":{}}' };
    } }),
  });
  const result = await reader.analyze({
    application: { provider: 'aws', profileId: 'local:prod', region: 'us-east-1' },
    resources: [
      { id: 'first', type: 'stepfunctions', arn: 'arn:first', enabled: true },
      { id: 'second', type: 'stepfunctions', arn: 'arn:second', enabled: true },
    ], edges: [],
  });

  assert.equal(result.requests, 1);
  assert.deepEqual(result.failedResources, [{ resourceId: 'first', code: 'AccessDeniedException' }]);
});