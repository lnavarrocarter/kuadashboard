'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { listAllPages } = require('./gcpPaging');

const pager = pages => async url => {
  const token = new URL(url).searchParams.get('pageToken') || '0';
  const i = Number(token);
  return { items: pages[i], ...(i + 1 < pages.length ? { nextPageToken: String(i + 1) } : {}) };
};

test('follows page tokens until the end', async () => {
  const r = await listAllPages(pager([[1, 2], [3], [4]]), {}, 'https://x.test/v1/b?project=p&maxResults=2', 'items');
  assert.deepEqual(r.items, [1, 2, 3, 4]);
  assert.equal(r.partial, false);
  assert.equal(r.pages, 3);
});

test('stops at maxPages and marks the result partial', async () => {
  const r = await listAllPages(pager([[1], [2], [3]]), {}, 'https://x.test/v1/list', 'items', { maxPages: 2 });
  assert.deepEqual(r.items, [1, 2]);
  assert.equal(r.partial, true);
});

test('keeps an explicit page size and rejects a stuck token', async () => {
  const urls = [];
  await listAllPages(async url => { urls.push(url); return { items: [] }; }, {}, 'https://x.test/v1/builds?pageSize=100', 'items');
  assert.equal(new URL(urls[0]).searchParams.get('pageSize'), '100');
  await assert.rejects(listAllPages(async () => ({ items: [1], nextPageToken: 'same' }), {}, 'https://x.test/v1/l?pageToken=same', 'items'), /Non-advancing/);
});
