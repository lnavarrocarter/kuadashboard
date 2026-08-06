'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { readLocalAwsProfiles, resolveAwsConfig } = require('./awsProfileResolver');

function profileHome() {
  const homeDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'kua-aws-profile-'));
  const awsDirectory = path.join(homeDirectory, '.aws');
  fs.mkdirSync(awsDirectory);
  fs.writeFileSync(path.join(awsDirectory, 'credentials'), [
    '[dev]',
    'aws_access_key_id = fake-access-key',
    'aws_secret_access_key = fake-secret-key',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(awsDirectory, 'config'), [
    '[profile dev]',
    'region = eu-west-1',
    '',
    '[profile sso-dev]',
    'sso_session = company',
    'sso_account_id = 123456789012',
    'region = us-west-2',
    '',
    '[sso-session company]',
    'sso_start_url = https://example.awsapps.com/start',
    'sso_region = us-east-1',
  ].join('\n'));
  return homeDirectory;
}

test('reads static and SSO profiles without exposing credentials', () => {
  const homeDirectory = profileHome();
  try {
    assert.deepEqual(readLocalAwsProfiles({ homeDirectory }), [
      { name: 'dev', region: 'eu-west-1', sso: false },
      { name: 'sso-dev', region: 'us-west-2', sso: true },
    ]);
  } finally {
    fs.rmSync(homeDirectory, { recursive: true, force: true });
  }
});

test('resolves local profiles through fromIni without loading real credentials', async () => {
  const homeDirectory = profileHome();
  let fromIniOptions;
  try {
    const config = await resolveAwsConfig('local:dev', {
      homeDirectory,
      fromIni(options) {
        fromIniOptions = options;
        return async () => ({ accessKeyId: 'injected', secretAccessKey: 'injected' });
      },
    });
    assert.equal(config.region, 'eu-west-1');
    assert.equal(fromIniOptions.profile, 'dev');
    assert.equal(fromIniOptions.filepath, path.join(homeDirectory, '.aws', 'credentials'));
  } finally {
    fs.rmSync(homeDirectory, { recursive: true, force: true });
  }
});

test('resolves stored temporary credentials and default region', async () => {
  const config = await resolveAwsConfig('stored-id', {
    store: {
      async getRawKeys() {
        return {
          AWS_ACCESS_KEY_ID: 'fake-access',
          AWS_SECRET_ACCESS_KEY: 'fake-secret',
          AWS_SESSION_TOKEN: 'fake-session',
        };
      },
    },
  });
  assert.deepEqual(config, {
    credentials: {
      accessKeyId: 'fake-access',
      secretAccessKey: 'fake-secret',
      sessionToken: 'fake-session',
    },
    region: 'us-east-1',
  });
});

test('returns 404 for unknown local profiles', async () => {
  const homeDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'kua-aws-empty-'));
  try {
    await assert.rejects(
      resolveAwsConfig('local:missing', { homeDirectory }),
      error => error.$metadata?.httpStatusCode === 404,
    );
  } finally {
    fs.rmSync(homeDirectory, { recursive: true, force: true });
  }
});