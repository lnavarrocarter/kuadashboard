'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadLambdaTags, tagsFor, functionName, MAX_PAGES } = require('./awsLambdaTags');

const fnArn = (name, qualifier) => `arn:aws:lambda:us-east-1:123456789012:function:${name}${qualifier ? `:${qualifier}` : ''}`;

test('reads tags in bulk, filtered to Lambda functions, following pagination', async () => {
  const calls = [];
  const pages = [
    { ResourceTagMappingList: [{ ResourceARN: fnArn('orders'), Tags: [{ Key: 'team', Value: 'shop' }] }], PaginationToken: 'p2' },
    { ResourceTagMappingList: [{ ResourceARN: fnArn('billing', 'live'), Tags: [{ Key: 'env', Value: 'prod' }] }] },
  ];
  const result = await loadLambdaTags(async input => { calls.push(input); return pages[calls.length - 1]; });
  assert.deepEqual(calls.map(c => [c.ResourceTypeFilters, c.ResourcesPerPage, c.PaginationToken]), [
    [['lambda:function'], 100, undefined], [['lambda:function'], 100, 'p2'],
  ]);
  assert.equal(result.truncated, false);
  assert.deepEqual(tagsFor('orders', result), { team: 'shop' });
  assert.deepEqual(tagsFor('billing', result), { env: 'prod' });
});

test('a function missing from a complete answer has no tags; from a cut answer, unknown tags', async () => {
  const complete = await loadLambdaTags(async () => ({ ResourceTagMappingList: [] }));
  assert.deepEqual(tagsFor('quiet', complete), {});
  const cut = await loadLambdaTags(async () => ({ ResourceTagMappingList: [], PaginationToken: 'more' }));
  assert.equal(cut.truncated, true);
  assert.equal(tagsFor('quiet', cut), null);
});

test('stops after the page limit', async () => {
  let calls = 0;
  await loadLambdaTags(async () => { calls += 1; return { PaginationToken: 'again' }; });
  assert.equal(calls, MAX_PAGES);
});

test('tags that were not read are null, never an empty list', () => {
  assert.equal(tagsFor('orders', null), null);
  assert.equal(functionName(fnArn('orders', '3')), 'orders');
  assert.equal(functionName('not-an-arn'), null);
});
