'use strict';

// Delegates the interactive data channel to AWS's own `session-manager-plugin` binary —
// the same thing `aws ssm start-session` shells out to internally. There is no public
// spec and no AWS-SDK-for-JS support for that binary WebSocket protocol, so this is the
// only well-precedented path (see docs/architecture/console-sessions.md).

function loadSsmSdk(overrides = {}) {
  if (overrides.SSMClient && overrides.StartSessionCommand && overrides.TerminateSessionCommand) return overrides;
  const sdk = require('@aws-sdk/client-ssm');
  return {
    SSMClient: overrides.SSMClient || sdk.SSMClient,
    StartSessionCommand: overrides.StartSessionCommand || sdk.StartSessionCommand,
    TerminateSessionCommand: overrides.TerminateSessionCommand || sdk.TerminateSessionCommand,
  };
}

function createSsmBroker({ resolveAwsConfig, ssmSdk, spawn, pluginBinary = 'session-manager-plugin' } = {}) {
  resolveAwsConfig ||= require('./awsProfileResolver').resolveAwsConfig;
  const { SSMClient, StartSessionCommand, TerminateSessionCommand } = loadSsmSdk(ssmSdk);
  spawn ||= require('child_process').spawn;

  async function startSession({ profileId, instanceId }) {
    const { credentials, region } = await resolveAwsConfig(profileId);
    const client = new SSMClient({ credentials, region });
    const response = await client.send(new StartSessionCommand({ Target: instanceId }));
    return { client, region, credentials, response, instanceId };
  }

  function spawnPlugin({ response, region, instanceId, credentials }) {
    const args = [
      JSON.stringify(response),
      region,
      'StartSession',
      '',
      JSON.stringify({ Target: instanceId }),
      `https://ssm.${region}.amazonaws.com`,
    ];
    const env = { ...process.env, AWS_ACCESS_KEY_ID: credentials.accessKeyId, AWS_SECRET_ACCESS_KEY: credentials.secretAccessKey };
    if (credentials.sessionToken) env.AWS_SESSION_TOKEN = credentials.sessionToken;
    return spawn(pluginBinary, args, { env });
  }

  async function terminateSession(client, sessionId) {
    if (!client || !sessionId) return;
    try { await client.send(new TerminateSessionCommand({ SessionId: sessionId })); } catch (_) {}
  }

  return { startSession, spawnPlugin, terminateSession };
}

module.exports = { createSsmBroker };
