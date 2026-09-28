'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const net = require('node:net');
const dns = require('node:dns').promises;
const DNSValidator = require('./dnsValidator');

const { mock } = test;

function enotfound() {
  return Object.assign(new Error('queryA ENOTFOUND example.com'), { code: 'ENOTFOUND' });
}

test.afterEach(() => mock.restoreAll());

// ── Hostname handling ────────────────────────────────────────────────────────

test('normalizes Route 53 names (trailing dot, \\052 wildcard, case)', () => {
  assert.equal(DNSValidator.normalizeHostname('WWW.Example.com.'), 'www.example.com');
  assert.equal(DNSValidator.normalizeHostname('\\052.example.com.'), '*.example.com');
});

test('rejects invalid hostnames without querying DNS', async () => {
  const resolve4 = mock.method(dns, 'resolve4', async () => ['192.0.2.1']);
  const result = await DNSValidator.validate('bad host;rm -rf', 'A');
  assert.equal(result.status, 'ERROR');
  assert.match(result.message, /Invalid hostname/);
  assert.equal(resolve4.mock.callCount(), 0);
});

test('returns WARNING for wildcard records instead of resolving them', async () => {
  const resolve4 = mock.method(dns, 'resolve4', async () => ['192.0.2.1']);
  const result = await DNSValidator.validate('\\052.example.com.', 'A');
  assert.equal(result.status, 'WARNING');
  assert.equal(resolve4.mock.callCount(), 0);
});

test('returns ERROR for unsupported record types', async () => {
  const result = await DNSValidator.validate('example.com', 'SOA');
  assert.equal(result.status, 'ERROR');
  assert.match(result.message, /Unsupported record type/);
});

// ── A / AAAA ─────────────────────────────────────────────────────────────────

test('A: OK when the record resolves', async () => {
  mock.method(dns, 'resolve4', async () => ['192.0.2.1']);
  const result = await DNSValidator.validate('example.com.', 'a');
  assert.equal(result.status, 'OK');
  assert.deepEqual(result.values, ['192.0.2.1']);
});

test('A: ERROR with the resolver code when resolution fails', async () => {
  mock.method(dns, 'resolve4', async () => { throw enotfound(); });
  const result = await DNSValidator.validate('example.com', 'A');
  assert.equal(result.status, 'ERROR');
  assert.match(result.message, /ENOTFOUND/);
});

test('A: does not open TCP connections unless checkTcp is set', async () => {
  mock.method(dns, 'resolve4', async () => ['192.0.2.1']);
  const tcp = mock.method(DNSValidator, '_checkTcpConnection', async () => 443);
  await DNSValidator.validate('example.com', 'A');
  assert.equal(tcp.mock.callCount(), 0);
});

test('A: reports the reachable port when checkTcp succeeds', async () => {
  mock.method(dns, 'resolve4', async () => ['192.0.2.1']);
  const tcp = mock.method(DNSValidator, '_checkTcpConnection', async () => 443);
  const result = await DNSValidator.validate('example.com', 'A', { checkTcp: true });
  assert.equal(result.status, 'OK');
  assert.match(result.message, /TCP 443 reachable/);
  assert.deepEqual(tcp.mock.calls[0].arguments.slice(0, 2), ['192.0.2.1', [443, 80]]);
});

test('A: WARNING when resolved but TCP is not reachable', async () => {
  mock.method(dns, 'resolve4', async () => ['192.0.2.1']);
  mock.method(DNSValidator, '_checkTcpConnection', async () => null);
  const result = await DNSValidator.validate('example.com', 'A', { checkTcp: true });
  assert.equal(result.status, 'WARNING');
  assert.match(result.message, /not reachable/);
});

test('AAAA: resolves through resolve6', async () => {
  mock.method(dns, 'resolve6', async () => ['2001:db8::1']);
  const result = await DNSValidator.validate('example.com', 'AAAA');
  assert.equal(result.status, 'OK');
  assert.deepEqual(result.values, ['2001:db8::1']);
});

// ── TCP connectivity ─────────────────────────────────────────────────────────

test('_checkTcpConnection times out and tries the next port', async () => {
  const attempts = [];
  mock.method(net, 'createConnection', ({ port }) => {
    attempts.push(port);
    const handlers = {};
    const socket = {
      once: (evt, fn) => { handlers[evt] = fn; return socket; },
      destroy: () => {},
    };
    // 443 never answers (timeout); 80 connects
    if (port === 80) setImmediate(() => handlers.connect());
    return socket;
  });
  const port = await DNSValidator._checkTcpConnection('192.0.2.1', [443, 80], 20);
  assert.equal(port, 80);
  assert.deepEqual(attempts, [443, 80]);
});

test('_checkTcpConnection returns null when every port errors', async () => {
  mock.method(net, 'createConnection', () => {
    const handlers = {};
    const socket = {
      once: (evt, fn) => { handlers[evt] = fn; return socket; },
      destroy: () => {},
    };
    setImmediate(() => handlers.error(new Error('ECONNREFUSED')));
    return socket;
  });
  assert.equal(await DNSValidator._checkTcpConnection('192.0.2.1', [443, 80], 1000), null);
});

// ── TXT / MX / CNAME / NS ────────────────────────────────────────────────────

test('TXT: joins chunked strings', async () => {
  mock.method(dns, 'resolveTxt', async () => [['v=spf1 ', 'include:_spf.google.com ~all'], ['token=abc']]);
  const result = await DNSValidator.validate('example.com', 'TXT');
  assert.equal(result.status, 'OK');
  assert.deepEqual(result.values, ['v=spf1 include:_spf.google.com ~all', 'token=abc']);
});

test('TXT: ERROR when the name does not exist', async () => {
  mock.method(dns, 'resolveTxt', async () => { throw enotfound(); });
  assert.equal((await DNSValidator.validate('example.com', 'TXT')).status, 'ERROR');
});

test('MX: sorts by priority', async () => {
  mock.method(dns, 'resolveMx', async () => [
    { priority: 20, exchange: 'mx2.example.com' },
    { priority: 10, exchange: 'mx1.example.com' },
  ]);
  const result = await DNSValidator.validate('example.com', 'MX');
  assert.equal(result.status, 'OK');
  assert.deepEqual(result.values, ['10 mx1.example.com', '20 mx2.example.com']);
});

test('MX: ERROR when resolution fails', async () => {
  mock.method(dns, 'resolveMx', async () => { throw Object.assign(new Error('x'), { code: 'ENODATA' }); });
  const result = await DNSValidator.validate('example.com', 'MX');
  assert.equal(result.status, 'ERROR');
  assert.match(result.message, /ENODATA/);
});

test('CNAME and NS resolve their targets', async () => {
  mock.method(dns, 'resolveCname', async () => ['d123.cloudfront.net']);
  mock.method(dns, 'resolveNs', async () => ['ns-1.awsdns-00.com']);
  assert.equal((await DNSValidator.validate('cdn.example.com', 'CNAME')).status, 'OK');
  assert.equal((await DNSValidator.validate('example.com', 'NS')).status, 'OK');
});

// ── SPF ──────────────────────────────────────────────────────────────────────

test('SPF: OK for a single record with ~all', async () => {
  mock.method(dns, 'resolveTxt', async () => [['v=spf1 include:_spf.google.com ~all'], ['other']]);
  const result = await DNSValidator.validate('example.com', 'SPF');
  assert.equal(result.status, 'OK');
  assert.deepEqual(result.values, ['v=spf1 include:_spf.google.com ~all']);
});

test('SPF: ERROR when missing', async () => {
  mock.method(dns, 'resolveTxt', async () => [['google-site-verification=abc']]);
  assert.equal((await DNSValidator.validate('example.com', 'SPF')).status, 'ERROR');
});

test('SPF: ERROR when more than one record exists', async () => {
  mock.method(dns, 'resolveTxt', async () => [['v=spf1 -all'], ['v=spf1 ~all']]);
  const result = await DNSValidator.validate('example.com', 'SPF');
  assert.equal(result.status, 'ERROR');
  assert.match(result.message, /Multiple SPF/);
});

test('SPF: WARNING for permissive +all', async () => {
  mock.method(dns, 'resolveTxt', async () => [['v=spf1 +all']]);
  assert.equal((await DNSValidator.validate('example.com', 'SPF')).status, 'WARNING');
});

test('SPF: does not confuse v=spf10 with v=spf1', async () => {
  mock.method(dns, 'resolveTxt', async () => [['v=spf10 -all']]);
  assert.equal((await DNSValidator.validate('example.com', 'SPF')).status, 'ERROR');
});

// ── DKIM ─────────────────────────────────────────────────────────────────────

test('DKIM: resolves a full selector._domainkey hostname as-is', async () => {
  const resolveTxt = mock.method(dns, 'resolveTxt', async () => [['v=DKIM1; k=rsa; p=MIGfMA0GCSq']]);
  const result = await DNSValidator.validate('google._domainkey.example.com.', 'DKIM');
  assert.equal(result.status, 'OK');
  assert.equal(resolveTxt.mock.calls[0].arguments[0], 'google._domainkey.example.com');
});

test('DKIM: builds the hostname from domain + selector', async () => {
  const resolveTxt = mock.method(dns, 'resolveTxt', async () => [['v=DKIM1; p=abc']]);
  await DNSValidator.validate('example.com', 'DKIM', { selector: 's1' });
  assert.equal(resolveTxt.mock.calls[0].arguments[0], 's1._domainkey.example.com');
});

test('DKIM: ERROR without a selector for a bare domain', async () => {
  const result = await DNSValidator.validate('example.com', 'DKIM');
  assert.equal(result.status, 'ERROR');
  assert.match(result.message, /selector is required/);
});

test('DKIM: WARNING for a revoked key (empty p=)', async () => {
  mock.method(dns, 'resolveTxt', async () => [['v=DKIM1; p=']]);
  assert.equal((await DNSValidator.validate('s1._domainkey.example.com', 'DKIM')).status, 'WARNING');
});

test('DKIM: ERROR when the TXT is not a DKIM record', async () => {
  mock.method(dns, 'resolveTxt', async () => [['hello world']]);
  assert.equal((await DNSValidator.validate('s1._domainkey.example.com', 'DKIM')).status, 'ERROR');
});
