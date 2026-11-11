'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { createLocalRequestGuard } = require('./localRequestGuard');
const { createLocalHostGuard } = require('./localHostGuard');

const guard = createLocalRequestGuard({ hostGuard: createLocalHostGuard({ hostname: 'kua.localhost' }) });
const request = headers => ({ headers: { host: 'localhost:7190', ...headers } });

test('admits application origins, the development proxy, aliases and native clients', () => {
  for (const origin of ['http://localhost:7190', 'http://localhost:7193', 'http://127.0.0.1:7190', 'http://[::1]:7190', 'https://kua.localhost']) {
    assert.equal(guard.allows(request({ origin })), true, origin);
  }
  assert.equal(guard.allows(request({})), true);
  assert.equal(guard.allows(request({ 'sec-fetch-site': 'same-origin' })), true);
  assert.equal(guard.allows(request({ origin: 'http://localhost:7193', 'sec-fetch-site': 'same-site' })), true);
});

test('rejects foreign, opaque, malformed and duplicate origins even when metadata or proxy headers claim trust', () => {
  for (const origin of ['https://evil.example', 'http://localhost.evil.example', 'http://evil.localhost', 'null', '',
    'http://localhost/', 'http://localhost?x=1', 'http://localhost#x', 'http://evil@localhost', 'http://127.1',
    'http://2130706433', 'http://local%68ost', 'http://localhost:65536', 'file://', ['http://localhost']]) {
    assert.equal(guard.allows(request({ origin, 'sec-fetch-site': 'same-origin', 'x-forwarded-host': 'localhost' })), false, String(origin));
  }
  assert.equal(guard.allows({ ...request({ origin: 'http://localhost' }), rawHeaders: ['Origin', 'http://localhost', 'origin', 'http://localhost'] }), false);
  assert.equal(guard.allows(request({ origin: 'http://localhost', 'sec-fetch-site': 'cross-site' })), false);
  assert.equal(guard.allows(request({ 'sec-fetch-site': 'same-site' })), false);
  assert.equal(guard.allows(request({ 'sec-fetch-site': 'cross-site' })), false);
  assert.equal(guard.allows(request({ 'sec-fetch-site': 'invalid' })), false);
});

test('all unsafe API methods refuse browser form/text writes before parsing bodies or reaching handlers', async t => {
  const app = express();
  app.use('/api', guard.middleware);
  app.use(express.json());
  let mutations = 0;
  app.all('/api/probe', (req, res) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) mutations += 1;
    res.json({ ok: true });
  });
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/probe`;
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    for (const type of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=test', 'application/json']) {
      const response = await fetch(base, { method, headers: { Origin: 'https://evil.example', 'Content-Type': type }, body: '{invalid' });
      assert.equal(response.status, 403);
    }
  }
  assert.equal(mutations, 0);
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    assert.equal((await fetch(base, { method, headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 200);
  }
  assert.equal(mutations, 4);
  assert.equal((await fetch(base, { method: 'POST', headers: { Origin: 'http://localhost:7193', 'Content-Type': 'application/json' }, body: '{}' })).status, 200);
  assert.equal((await fetch(base, { headers: { Origin: 'https://evil.example' } })).status, 200);
});
