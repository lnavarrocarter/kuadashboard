'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const express = require('express');
const { logRedactionMiddleware, ready, redactLogPayload, redactText } = require('./logRedaction');

test('live log responses leave sanitized, with the count of hidden secrets; other routes are untouched (#239)', async () => {
  await ready;
  const app = express();
  app.use('/api', logRedactionMiddleware);
  app.get('/api/cloud/aws/logs/lambda/orders', (_req, res) => res.json({ logGroupName: '/aws/lambda/orders', events: [
    { timestamp: 1, message: 'connecting with DB_PASSWORD=hunter2 to db' },
    { timestamp: 2, message: 'GET /health 200' },
  ] }));
  app.get('/api/cloud/gcp/cloudrun/us/api/logs', (_req, res) => res.json({ entries: [{ message: 'ok', jsonPayload: { headers: { authorization: 'Bearer abcdefghijklmnop' }, db: { password: 'hunter2', user: 'app', tokenizer: 'bpe' } } }] }));
  app.get('/api/cloud/aws/settings', (_req, res) => res.json({ events: [{ message: 'password=kept-on-purpose' }] }));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const get = async path => (await fetch(`http://127.0.0.1:${server.address().port}${path}`)).json();
  try {
    const lambda = await get('/api/cloud/aws/logs/lambda/orders');
    assert.equal(lambda.events[0].message, 'connecting with DB_PASSWORD: [redacted] to db');
    assert.equal(lambda.events[1].message, 'GET /health 200');
    assert.deepEqual(lambda.redaction, { secrets: 1, types: { password: 1 } });
    const gcp = await get('/api/cloud/gcp/cloudrun/us/api/logs');
    assert.equal(gcp.entries[0].jsonPayload.headers.authorization, '[redacted]');
    assert.deepEqual(gcp.entries[0].jsonPayload.db, { password: '[redacted]', user: 'app', tokenizer: 'bpe' });
    assert.deepEqual(gcp.redaction, { secrets: 2, types: { authorization: 1, password: 1 } });
    // Not a log route.
    assert.equal((await get('/api/cloud/aws/settings')).events[0].message, 'password=kept-on-purpose');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('streamed chunks keep their newline; Insights rows and nested arrays are redacted', async () => {
  await ready;
  assert.equal(redactText('token=abc123\n'), 'token: [redacted]\n');
  assert.equal(redactText('plain line\n'), 'plain line\n');
  const body = redactLogPayload({ results: [[{ field: '@timestamp', value: '2026-10-09' }, { field: '@message', value: 'api_key=xyz' }]] });
  assert.equal(body.results[0][1].value, 'api_key: [redacted]');
});
