'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const profiles = new Map();

function stubModule(request, exports) {
  const resolved = require.resolve(request);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

stubModule('../lib/credentialStore', {
  getStore: () => ({ getRawKeys: async id => profiles.get(id) || null }),
});
stubModule('../lib/gcloudCli', {
  CONFIG_LIST_ARGS: [],
  createGcloudCli: () => ({
    listConfigs: async () => [{ name: 'dev', project: 'local-project', account: 'dev@example.com' }],
    getAccessToken: async () => 'local-access-token',
    invalidateToken() {},
  }),
});

const gcp = require('./gcp');

test('local gcloud credentials remain usable through GoogleAuth and OAuth2Client', async () => {
  const result = await gcp.resolveGcpAuth('local:dev');
  assert.equal(result.projectId, 'local-project');
  assert.equal(result.account, 'dev@example.com');
  const client = await result.auth.getClient();
  assert.equal(client, result.auth.cachedCredential);
  assert.deepEqual(await client.getAccessToken(), { token: 'local-access-token' });
  const headers = await client.getRequestHeaders();
  assert.equal(headers.get?.('authorization') || headers.authorization || headers.Authorization, 'Bearer local-access-token');
});

test('service account credentials retain their project and signer when building the auth client', async () => {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const credentials = {
    type: 'service_account',
    project_id: 'service-project',
    client_email: 'service@example.com',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  };
  profiles.set('service', { GCP_SERVICE_ACCOUNT_JSON: JSON.stringify(credentials), GCP_PROJECT_ID: 'configured-project' });

  const result = await gcp.resolveGcpAuth('service');
  assert.equal(result.projectId, 'configured-project');
  assert.equal(result.account, credentials.client_email);
  const client = await result.auth.getClient();
  assert.equal(client.email, credentials.client_email);
  assert.equal(client.key, credentials.private_key);
});

test('missing and malformed service account credentials preserve actionable errors', async () => {
  await assert.rejects(gcp.resolveGcpAuth('missing'), error => error.code === 404);
  profiles.set('malformed', { GCP_SERVICE_ACCOUNT_JSON: '{not-json' });
  await assert.rejects(gcp.resolveGcpAuth('malformed'), error => error.code === 400 && /not valid JSON/.test(error.message));
  profiles.set('wrong-type', { GCP_SERVICE_ACCOUNT_JSON: JSON.stringify({ type: 'authorized_user' }) });
  await assert.rejects(gcp.resolveGcpAuth('wrong-type'), error => error.code === 400 && /service account credentials/.test(error.message));
});
