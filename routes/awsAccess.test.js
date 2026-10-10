'use strict';

// End-to-end check of routes/aws.js error handling: a denied AWS call must
// answer 403 with a typed access request built from the route's catalog.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');

function stubModule(request, exports) {
  const resolved = require.resolve(request);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

let lambdaError = null;
stubModule('../lib/awsProfileResolver', {
  awsProfilePaths: () => ({}),
  readLocalAwsProfiles: () => [],
  resolveAwsConfig: async () => ({ region: 'us-east-1', credentials: { accessKeyId: 'AKIA', secretAccessKey: 'x' } }),
});
stubModule('@aws-sdk/client-lambda', {
  LambdaClient: class { async send() { throw lambdaError; } },
  ListFunctionsCommand: class {},
});
stubModule('@aws-sdk/client-resource-groups-tagging-api', {
  ResourceGroupsTaggingAPIClient: class { async send() { return { ResourceTagMappingList: [] }; } },
  GetResourcesCommand: class {},
});

const router = require('./aws');

async function request(path) {
  const app = express();
  app.use('/api/cloud/aws', router);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    return await new Promise((resolve, reject) => {
      http.get({ port, path, headers: { 'X-Profile-Id': 'stored-profile' } }, res => {
        let body = '';
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
      }).on('error', reject);
    });
  } finally {
    server.close();
  }
}

test('a denied AWS call answers 403 with the actions and policy to request', async t => {
  t.mock.method(console, 'error', () => {});
  lambdaError = Object.assign(
    new Error('User: arn:aws:iam::123456789012:user/dev is not authorized to perform: lambda:ListFunctions on resource: * because no identity-based policy allows the lambda:ListFunctions action'),
    { name: 'AccessDeniedException', $metadata: { httpStatusCode: 400 } },
  );
  const { status, body } = await request('/api/cloud/aws/lambda');
  assert.equal(status, 403);
  assert.equal(body.code, 'AccessDenied');
  assert.match(body.error, /not authorized to perform: lambda:ListFunctions/);
  assert.equal(body.access.failedAction, 'lambda:ListFunctions');
  assert.equal(body.access.route, 'GET /lambda');
  assert.equal(body.access.account, '123456789012');
  assert.equal(body.access.principal, 'arn:aws:iam::123456789012:user/dev');
  assert.deepEqual(body.access.policy.Statement, [{ Sid: 'KuaAccess', Effect: 'Allow', Action: ['lambda:ListFunctions', 'tag:GetResources'], Resource: '*' }]);
});

test('other AWS errors keep their status and carry no access request', async t => {
  t.mock.method(console, 'error', () => {});
  lambdaError = Object.assign(new Error('Rate exceeded'), { name: 'ThrottlingException', $metadata: { httpStatusCode: 429 } });
  const { status, body } = await request('/api/cloud/aws/lambda');
  assert.equal(status, 429);
  assert.deepEqual(body, { error: 'Rate exceeded' });
});
