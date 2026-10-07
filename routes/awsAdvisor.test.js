'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const express = require('express');
const awsRouter = require('./aws');

test('S3 Advisor cache preflight is read-only and scan requires explicit confirmation', async t => {
  const app = express();
  app.use(express.json());
  app.use('/api/cloud/aws', awsRouter);
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => server.close());

  const request = (method, path, body) => new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : '';
    const req = http.request({
      port: server.address().port,
      method,
      path,
      headers: { 'X-Profile-Id': 's3-advisor-preflight-test', ...(payload ? { 'Content-Type': 'application/json' } : {}) },
    }, response => {
      let data = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { data += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(data) }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });

  const preflight = await request('GET', '/api/cloud/aws/overview/advisor/s3');
  assert.equal(preflight.status, 200);
  assert.deepEqual(preflight.body, { report: null, cached: false });

  const unconfirmed = await request('POST', '/api/cloud/aws/overview/advisor/s3', {
    confirmed: false,
    expectedBucketCount: 2,
  });
  assert.equal(unconfirmed.status, 400);
  assert.match(unconfirmed.body.error, /confirmation/i);
});