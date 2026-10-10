'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyGcpError, httpStatusFor } = require('./gcpErrors');

const rest = (code, status, message, details = []) =>
  Object.assign(new Error(JSON.stringify({ error: { code, status, message, details } })), { code, statusCode: code });

test('400 INVALID_ARGUMENT is an invalid request, never an IAM or API problem', () => {
  const info = classifyGcpError(rest(400, 'INVALID_ARGUMENT', 'Invalid project name: projects/p/locations/-'));
  assert.equal(info.kind, 'invalid_request');
  assert.equal(info.code, 'INVALID_ARGUMENT');
  assert.equal(info.message, 'Invalid project name: projects/p/locations/-');
  assert.equal(info.activationUrl, null);
  assert.equal(httpStatusFor(info), 400);
});

test('SERVICE_DISABLED is api_disabled and keeps only the activation link', () => {
  const info = classifyGcpError(rest(403, 'PERMISSION_DENIED',
    'Cloud Tasks API has not been used in project 123 before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/cloudtasks.googleapis.com/overview?project=123 then retry.',
    [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'SERVICE_DISABLED', domain: 'googleapis.com',
      metadata: { service: 'cloudtasks.googleapis.com', activationUrl: 'https://console.developers.google.com/apis/api/cloudtasks.googleapis.com/overview?project=123' } }]));
  assert.equal(info.kind, 'api_disabled');
  assert.equal(info.service, 'cloudtasks.googleapis.com');
  assert.match(info.activationUrl, /cloudtasks/);
});

test('403 without SERVICE_DISABLED is a permission problem without an enable link', () => {
  const info = classifyGcpError(rest(403, 'PERMISSION_DENIED', "Permission 'run.services.list' denied. See https://console.cloud.google.com/iam-admin"));
  assert.equal(info.kind, 'permission');
  assert.equal(info.activationUrl, null);
});

test('expired credentials, quota, not found and transient errors', () => {
  assert.equal(classifyGcpError(rest(401, 'UNAUTHENTICATED', 'Request had invalid authentication credentials.')).kind, 'auth');
  assert.equal(classifyGcpError(new Error('invalid_grant: reauth related error')).kind, 'auth');
  assert.equal(classifyGcpError(rest(429, 'RESOURCE_EXHAUSTED', 'Quota exceeded')).kind, 'quota');
  assert.equal(classifyGcpError(rest(404, 'NOT_FOUND', 'not found')).kind, 'not_found');
  assert.equal(classifyGcpError(rest(503, 'UNAVAILABLE', 'try again')).kind, 'transient');
  assert.equal(classifyGcpError(Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' })).kind, 'transient');
});

test('gRPC errors from the client libraries map to the same kinds', () => {
  assert.equal(classifyGcpError(Object.assign(new Error('7 PERMISSION_DENIED: denied'), { code: 7 })).kind, 'permission');
  assert.equal(classifyGcpError(Object.assign(new Error('7 PERMISSION_DENIED: x'), { code: 7, reason: 'SERVICE_DISABLED' })).kind, 'api_disabled');
  const bad = classifyGcpError(Object.assign(new Error('3 INVALID_ARGUMENT: bad parent'), { code: 3 }));
  assert.equal(bad.kind, 'invalid_request');
  assert.equal(bad.message, 'bad parent');
  assert.equal(httpStatusFor(bad), 400);
});
