'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');
const { createKuappsTaskJournalRouter } = require('./kuappsTaskJournal');

test('GET returns the journal with the filters from the query string', async () => {
  const calls = [];
  const journal = { list: filter => { calls.push(filter); return { entries: [], summary: { requests: 0 } }; } };
  const app = express();
  app.use('/journal', createKuappsTaskJournalRouter({ journal }));
  const server = app.listen(0);
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/journal?applicationId=app-1&since=2026-11-02T10:00:00Z&limit=50`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { entries: [], summary: { requests: 0 } });
    assert.deepEqual(calls, [{ applicationId: 'app-1', since: '2026-11-02T10:00:00Z', limit: '50' }]);
  } finally {
    server.close();
  }
});

test('repeated query parameters are ignored instead of reaching the journal as arrays', async () => {
  const calls = [];
  const app = express();
  app.use('/journal', createKuappsTaskJournalRouter({ journal: { list: filter => { calls.push(filter); return {}; } } }));
  const server = app.listen(0);
  try {
    await fetch(`http://127.0.0.1:${server.address().port}/journal?applicationId=a&applicationId=b`);
    assert.equal(calls[0].applicationId, null);
  } finally {
    server.close();
  }
});

test('the router requires a journal', () => {
  assert.throws(() => createKuappsTaskJournalRouter({}), TypeError);
});
