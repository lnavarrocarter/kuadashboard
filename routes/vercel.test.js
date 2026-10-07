'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const express = require('express');
const vercelRouter = require('./vercel');
const { VERCEL_ENDPOINTS, cronDefinitions, vercelFetch } = vercelRouter;

test('uses the current public Vercel API versions', () => {
  assert.equal(VERCEL_ENDPOINTS.projects, '/v10/projects');
  assert.equal(VERCEL_ENDPOINTS.project('project/name'), '/v9/projects/project%2Fname');
  assert.equal(VERCEL_ENDPOINTS.deployments, '/v7/deployments');
  assert.equal(VERCEL_ENDPOINTS.events, '/v3/events');
  assert.equal(VERCEL_ENDPOINTS.deploymentFiles('dpl/123'), '/v6/deployments/dpl%2F123/files');
  assert.equal(VERCEL_ENDPOINTS.deploymentEvents('dpl/123'), '/v3/deployments/dpl%2F123/events');
});

test('reads cron definitions from current and legacy project shapes', () => {
  const definitions = [{ path: '/api/scheduled', schedule: '0 0 * * *' }];

  assert.deepEqual(cronDefinitions({ crons: { definitions } }), definitions);
  assert.deepEqual(cronDefinitions({ crons: definitions }), definitions);
  assert.deepEqual(cronDefinitions({ crons: null }), []);
});

test('preserves the upstream Vercel error code and request path', async t => {
  t.mock.method(global, 'fetch', async () => ({
    ok: false,
    status: 400,
    statusText: 'Bad Request',
    json: async () => ({ error: { code: 'invalid_api_version', message: 'Invalid API version' } }),
  }));

  await assert.rejects(
    vercelFetch('/v99/events', 'redacted-token'),
    error => {
      assert.equal(error.status, 400);
      assert.equal(error.code, 'invalid_api_version');
      assert.equal(error.upstreamPath, '/v99/events');
      assert.match(error.message, /invalid_api_version.*GET \/v99\/events.*Invalid API version/i);
      assert.doesNotMatch(error.message, /redacted-token/);
      return true;
    }
  );
});
test('advisor scopes never carry the token of a token-only profile', () => {
  const { advisorProfileKey } = require('./vercel');
  assert.equal(advisorProfileKey('3f2c-profile'), '3f2c-profile');
  const key = advisorProfileKey('local:secret-token-value');
  assert.match(key, /^local-[a-f0-9]{16}$/);
  assert.doesNotMatch(key, /secret-token-value/);
  assert.equal(advisorProfileKey('local:secret-token-value'), key);
});

test('overview and advisor share one cached scan; refresh scans again', async t => {
  const { scanVercelAccount } = require('./vercel');
  let calls = 0;
  t.mock.method(global, 'fetch', async url => {
    calls += 1;
    const body = String(url).includes('/v10/projects') ? { projects: [{ id: 'p1', name: 'shop' }] } : {};
    return { ok: true, headers: { get: () => 'application/json' }, json: async () => body };
  });
  const resolveAuth = async () => ({ token: 'redacted-token', teamId: 'team_1' });
  const profileId = 'local:scan-test-token';

  const [first, second] = await Promise.all([
    scanVercelAccount(profileId, { resolveAuth }),
    scanVercelAccount(profileId, { resolveAuth }),
  ]);
  assert.equal(calls, 4); // projects + deployments, env and domains of one project
  assert.equal(first.scan, second.scan);
  assert.deepEqual([first.fresh, second.fresh].sort(), [false, true]);
  assert.match(first.profileKey, /^local-[a-f0-9]{16}$/);
  assert.equal(first.scan.overview.projects.total, 1);
  assert.equal(first.scan.report.scope.provider, 'vercel');

  const cached = await scanVercelAccount(profileId, { resolveAuth });
  assert.equal(cached.fresh, false);
  assert.equal(calls, 4);

  const refreshed = await scanVercelAccount(profileId, { resolveAuth, refresh: true });
  assert.equal(refreshed.fresh, true);
  assert.equal(calls, 8);
});
test('project Advisor caches metadata and never returns environment variable values', async t => {
  const upstreamPaths = [];
  t.mock.method(global, 'fetch', async url => {
    const path = new URL(url).pathname;
    upstreamPaths.push(path);
    const payload = path.endsWith('/env')
      ? { envs: [{ key: 'DATABASE_PASSWORD', type: 'plain', target: ['preview'], value: 'do-not-return-this' }] }
      : { id: 'advisor-route-project', name: 'checkout' };
    return { ok: true, headers: { get: () => 'application/json' }, json: async () => payload };
  });

  const app = express();
  app.use('/api/cloud/vercel', vercelRouter);
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => server.close());
  const port = server.address().port;
  const getReport = path => new Promise((resolve, reject) => {
    http.get({ port, path, headers: { 'X-Profile-Id': 'local:test-token' } }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(body) }));
    }).on('error', reject);
  });

  const url = '/api/cloud/vercel/projects/advisor-route-project/advisor';
  const first = await getReport(url);
  assert.equal(first.status, 200);
  assert.ok(first.body.findings.some(finding => finding.id === 'vercel.preview_unprotected'));
  assert.ok(first.body.findings.some(finding => finding.id === 'vercel.plain_secret_env'));
  assert.deepEqual(first.body.unavailable.map(source => source.source), ['deployments', 'domains']);
  assert.doesNotMatch(JSON.stringify(first.body), /do-not-return-this/);
  assert.equal(upstreamPaths.length, 2);

  const cached = await getReport(url);
  assert.equal(cached.body.fromCache, true);
  assert.equal(upstreamPaths.length, 2);

  await getReport(`${url}?refresh=1`);
  assert.equal(upstreamPaths.length, 4);
});
