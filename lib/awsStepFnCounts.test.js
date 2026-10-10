'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { countExecutions, PAGE_LIMIT } = require('./awsStepFnCounts');

const ARN = 'arn:aws:states:us-east-1:123456789012:stateMachine:orders';
const executions = n => Array.from({ length: n }, (_, i) => ({ executionArn: `${ARN}:${i}` }));

function denied() {
  const err = new Error('User: arn:aws:iam::123456789012:user/dev is not authorized to perform: states:ListExecutions on resource: ' + ARN);
  err.name = 'AccessDeniedException';
  err.$metadata = { httpStatusCode: 400 };
  return err;
}

test('counts each status from one page and asks for the page limit', async () => {
  const calls = [];
  const counts = await countExecutions(async input => {
    calls.push(input);
    return { executions: executions({ RUNNING: 2, FAILED: 3, TIMED_OUT: 0 }[input.statusFilter]) };
  }, ARN);
  assert.deepEqual(counts, {
    limit: PAGE_LIMIT,
    running: { count: 2, truncated: false },
    failed: { count: 3, truncated: false },
    timedOut: { count: 0, truncated: false },
  });
  assert.deepEqual(calls.map(c => [c.statusFilter, c.maxResults, c.stateMachineArn]), [
    ['RUNNING', PAGE_LIMIT, ARN], ['FAILED', PAGE_LIMIT, ARN], ['TIMED_OUT', PAGE_LIMIT, ARN],
  ]);
});

test('a full page with a nextToken is reported as truncated, not as an exact total', async () => {
  const counts = await countExecutions(async ({ statusFilter }) => (
    statusFilter === 'FAILED' ? { executions: executions(PAGE_LIMIT), nextToken: 'more' } : { executions: [] }
  ), ARN);
  assert.deepEqual(counts.failed, { count: PAGE_LIMIT, truncated: true });
});

test('AccessDenied never becomes zero', async () => {
  const counts = await countExecutions(async () => { throw denied(); }, ARN);
  for (const key of ['running', 'failed', 'timedOut']) {
    assert.equal(counts[key].count, undefined);
    assert.equal(counts[key].error.kind, 'denied');
    assert.equal(counts[key].error.action, 'states:ListExecutions');
  }
});

test('one failed status keeps the others (partial result)', async () => {
  const counts = await countExecutions(async ({ statusFilter }) => {
    if (statusFilter === 'TIMED_OUT') { const err = new Error('Rate exceeded'); err.name = 'ThrottlingException'; throw err; }
    return { executions: executions(1) };
  }, ARN);
  assert.deepEqual(counts.running, { count: 1, truncated: false });
  assert.deepEqual(counts.timedOut, { error: { kind: 'error', message: 'Rate exceeded' } });
});
