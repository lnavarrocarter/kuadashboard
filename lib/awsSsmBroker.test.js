'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createSsmBroker } = require('./awsSsmBroker');

const credentials = { accessKeyId: 'AKIA-fake', secretAccessKey: 'secret-fake' };
const resolveAwsConfig = async () => ({ credentials, region: 'us-east-1' });

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write: () => {} };
  child.kill = () => { child.killed = true; };
  return child;
}

test('startSession resolves credentials, starts a session and never spawns a plugin on its own', async () => {
  let sentCommand = null;
  const client = { send: async command => { sentCommand = command; return { SessionId: 'sess-1', TokenValue: 'token', StreamUrl: 'wss://example' }; } };
  const broker = createSsmBroker({
    resolveAwsConfig,
    ssmSdk: {
      SSMClient: class { constructor(opts) { this.opts = opts; Object.assign(this, client); } },
      StartSessionCommand: class { constructor(input) { this.input = input; } },
      TerminateSessionCommand: class { constructor(input) { this.input = input; } },
    },
  });
  const result = await broker.startSession({ profileId: 'profile-1', instanceId: 'i-123' });
  assert.equal(result.response.SessionId, 'sess-1');
  assert.equal(result.region, 'us-east-1');
  assert.equal(result.instanceId, 'i-123');
  assert.equal(sentCommand.input.Target, 'i-123');
});

test('a permission-denied StartSession rejects without ever calling spawn', async () => {
  let spawnCalled = false;
  const deniedError = Object.assign(new Error('AccessDeniedException'), { name: 'AccessDeniedException', $metadata: { httpStatusCode: 403 } });
  const broker = createSsmBroker({
    resolveAwsConfig,
    spawn: () => { spawnCalled = true; return fakeChild(); },
    ssmSdk: {
      SSMClient: class { send() { return Promise.reject(deniedError); } },
      StartSessionCommand: class { constructor(input) { this.input = input; } },
      TerminateSessionCommand: class {},
    },
  });
  await assert.rejects(broker.startSession({ profileId: 'profile-1', instanceId: 'i-123' }), /AccessDeniedException/);
  assert.equal(spawnCalled, false);
});

test('an invalid/missing profile rejects before any AWS call is made', async () => {
  const broker = createSsmBroker({
    resolveAwsConfig: async () => { throw new Error('Credential profile not found'); },
    ssmSdk: { SSMClient: class {}, StartSessionCommand: class {}, TerminateSessionCommand: class {} },
  });
  await assert.rejects(broker.startSession({ profileId: 'missing', instanceId: 'i-123' }), /Credential profile not found/);
});

test('spawnPlugin passes the documented argument shape and AWS credentials via env, never on argv', () => {
  let capturedBinary, capturedArgs, capturedOptions;
  const broker = createSsmBroker({
    resolveAwsConfig,
    spawn: (binary, args, options) => { capturedBinary = binary; capturedArgs = args; capturedOptions = options; return fakeChild(); },
    ssmSdk: { SSMClient: class {}, StartSessionCommand: class {}, TerminateSessionCommand: class {} },
  });
  const response = { SessionId: 'sess-1', TokenValue: 'tok', StreamUrl: 'wss://x' };
  const child = broker.spawnPlugin({ response, region: 'us-east-1', instanceId: 'i-123', credentials });
  assert.equal(capturedBinary, 'session-manager-plugin');
  assert.equal(capturedArgs[0], JSON.stringify(response));
  assert.equal(capturedArgs[1], 'us-east-1');
  assert.equal(capturedArgs[2], 'StartSession');
  assert.equal(capturedArgs[4], JSON.stringify({ Target: 'i-123' }));
  assert.equal(capturedArgs[5], 'https://ssm.us-east-1.amazonaws.com');
  assert.equal(capturedOptions.env.AWS_ACCESS_KEY_ID, credentials.accessKeyId);
  assert.equal(capturedOptions.env.AWS_SECRET_ACCESS_KEY, credentials.secretAccessKey);
  assert.equal(JSON.stringify(capturedArgs).includes(credentials.secretAccessKey), false);
  assert.ok(child);
});

test('spawnPlugin includes a session token when present, omits it when absent', () => {
  let envWithToken;
  const broker = createSsmBroker({
    resolveAwsConfig,
    spawn: (_bin, _args, options) => { envWithToken = options.env; return fakeChild(); },
    ssmSdk: { SSMClient: class {}, StartSessionCommand: class {}, TerminateSessionCommand: class {} },
  });
  broker.spawnPlugin({ response: {}, region: 'us-east-1', instanceId: 'i-1', credentials: { ...credentials, sessionToken: 'sess-tok' } });
  assert.equal(envWithToken.AWS_SESSION_TOKEN, 'sess-tok');

  let envWithoutToken;
  const broker2 = createSsmBroker({
    resolveAwsConfig,
    spawn: (_bin, _args, options) => { envWithoutToken = options.env; return fakeChild(); },
    ssmSdk: { SSMClient: class {}, StartSessionCommand: class {}, TerminateSessionCommand: class {} },
  });
  broker2.spawnPlugin({ response: {}, region: 'us-east-1', instanceId: 'i-1', credentials });
  assert.equal('AWS_SESSION_TOKEN' in envWithoutToken, false);
});

test('terminateSession swallows a rejected TerminateSession call without throwing', async () => {
  const broker = createSsmBroker({
    resolveAwsConfig,
    ssmSdk: {
      SSMClient: class {},
      StartSessionCommand: class {},
      TerminateSessionCommand: class { constructor(input) { this.input = input; } },
    },
  });
  const client = { send: async () => { throw new Error('already terminated'); } };
  await assert.doesNotReject(broker.terminateSession(client, 'sess-1'));
});

test('terminateSession is a no-op without a client or session id (idempotent double-stop)', async () => {
  const broker = createSsmBroker({
    resolveAwsConfig,
    ssmSdk: { SSMClient: class {}, StartSessionCommand: class {}, TerminateSessionCommand: class {} },
  });
  await assert.doesNotReject(broker.terminateSession(null, null));
  await assert.doesNotReject(broker.terminateSession({ send: async () => { throw new Error('should not be called'); } }, null));
});

test('a plugin process that never exits does not prevent the caller from killing it (timeout scenario)', () => {
  const child = fakeChild();
  const broker = createSsmBroker({
    resolveAwsConfig,
    spawn: () => child,
    ssmSdk: { SSMClient: class {}, StartSessionCommand: class {}, TerminateSessionCommand: class {} },
  });
  const spawned = broker.spawnPlugin({ response: {}, region: 'us-east-1', instanceId: 'i-1', credentials });
  assert.equal(spawned, child);
  assert.doesNotThrow(() => spawned.kill());
  assert.equal(child.killed, true);
});
