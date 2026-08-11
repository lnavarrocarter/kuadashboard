'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { VERCEL_ENDPOINTS, cronDefinitions, vercelFetch } = require('./vercel');

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