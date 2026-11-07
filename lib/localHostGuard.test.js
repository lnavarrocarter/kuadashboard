'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createLocalHostGuard } = require('./localHostGuard');

const request = host => ({ headers: { host } });
const guard = createLocalHostGuard({ hostname: '' });

test('admits loopback hosts, development ports and an explicit alias', () => {
  for (const host of ['localhost', 'LOCALHOST:7190', '127.0.0.1:7192', '[::1]:7190']) {
    assert.equal(guard.allows(request(host)), true, host);
  }
  const custom = createLocalHostGuard({ hostname: 'kua.localhost' });
  assert.equal(custom.allows(request('kua.localhost:7190')), true);
  assert.equal(custom.allows(request('localhost:7190')), true);
  assert.equal(guard.allows(request('kua.localhost')), false);
});

test('rejects rebinding domains, malformed authorities and URL normalization tricks', () => {
  for (const host of [undefined, '', 'evil.test:7190', 'localhost.evil.test', 'evil-localhost',
    'localhost@evil.test', 'evil.test@localhost', 'http://localhost', 'localhost/path',
    'localhost#evil', 'localhost?evil', 'localhost.', ' localhost', 'localhost ',
    'local%68ost', '127.1', '2130706433', '0x7f000001', 'localhost:0',
    'localhost:65536', 'localhost:', 'localhost:7190:80', '[::1', '[::2]:7190',
    'localhost,evil.test', 'localhost\r\nX-Test: bad']) {
    assert.equal(guard.allows(request(host)), false, String(host));
  }
});

test('rejects duplicate Hosts and ignores proxy headers', () => {
  assert.equal(guard.allows({ headers: { host: 'localhost' }, rawHeaders: ['Host', 'localhost', 'hOSt', 'evil.test'] }), false);
  assert.equal(guard.allows({ headers: { host: 'evil.test', 'x-forwarded-host': 'localhost', forwarded: 'host=localhost' } }), false);
  assert.equal(guard.allows({ headers: { host: 'localhost', 'x-forwarded-host': 'evil.test' } }), true);
});

test('invalid alias configuration fails closed', () => {
  for (const hostname of ['http://kua.localhost', 'kua.localhost:7190', 'kua.localhost/path', '*', 'a..b', '-kua', '[::2]']) {
    assert.throws(() => createLocalHostGuard({ hostname }), /KUA_HOSTNAME/);
  }
});

test('middleware refuses the request before a route can execute', () => {
  let reachedRoute = false;
  const res = { set() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  guard.middleware(request('evil.test'), res, () => { reachedRoute = true; });
  assert.equal(reachedRoute, false);
  assert.equal(res.code, 403);
  guard.middleware(request('localhost'), res, () => { reachedRoute = true; });
  assert.equal(reachedRoute, true);
});

test('WebSocket upgrades are refused before a ticket can be consumed', () => {
  let response = '';
  const socket = { end(value) { response = value; } };
  assert.equal(guard.admitUpgrade(request('evil.test'), socket), false);
  assert.match(response, /^HTTP\/1.1 403 Forbidden/);
  response = '';
  assert.equal(guard.admitUpgrade(request('localhost:7190'), socket), true);
  assert.equal(response, '');
});

test('an HTTP API rejects untrusted Hosts before parsing JSON, and accepts local MCP requests', async t => {
  const http = require('node:http');
  const app = require('express')();
  app.use('/api', guard.middleware);
  app.use(require('express').json());
  app.post('/api/probe', (_req, res) => res.json({ ok: true }));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const send = (host, body) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: server.address().port, path: '/api/probe', method: 'POST',
      headers: { Host: host, 'Content-Type': 'application/json' } }, res => {
      res.resume(); res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject); req.end(body);
  });
  assert.equal(await send('rebind.example', '{invalid'), 403);
  assert.equal(await send('localhost:7190', '{}'), 200);
  assert.equal(await send('127.0.0.1:7192', '{}'), 200);
});
