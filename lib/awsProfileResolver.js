'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { getStore } = require('./credentialStore');

function awsProfilePaths(homeDirectory = os.homedir()) {
  return {
    credentialsFile: path.join(homeDirectory, '.aws', 'credentials'),
    configFile: path.join(homeDirectory, '.aws', 'config'),
  };
}

function readLocalAwsProfiles({ fileSystem = fs, homeDirectory = os.homedir() } = {}) {
  const { credentialsFile, configFile } = awsProfilePaths(homeDirectory);
  const profiles = {};

  if (fileSystem.existsSync(credentialsFile)) {
    let current = null;
    for (const raw of fileSystem.readFileSync(credentialsFile, 'utf8').split('\n')) {
      const line = raw.trim();
      const section = line.match(/^\[([^\]]+)\]$/);
      if (section) {
        current = section[1];
        profiles[current] = profiles[current] || {};
        continue;
      }
      if (!current) continue;
      const property = line.match(/^(\w+)\s*=\s*(.+)$/);
      if (property) profiles[current][property[1].toLowerCase()] = property[2].trim();
    }
  }

  if (fileSystem.existsSync(configFile)) {
    let current = null;
    for (const raw of fileSystem.readFileSync(configFile, 'utf8').split('\n')) {
      const line = raw.trim();
      const section = line.match(/^\[(?:profile\s+)?([^\]]+)\]$/);
      if (section) {
        current = section[1];
        profiles[current] = profiles[current] || {};
        continue;
      }
      if (!current) continue;
      const property = line.match(/^(\w+)\s*=\s*(.+)$/);
      if (!property) continue;
      const key = property[1].toLowerCase();
      if (key === 'region' && !profiles[current].region) profiles[current].region = property[2].trim();
      else if (key.startsWith('sso_')) profiles[current][key] = property[2].trim();
    }
  }

  return Object.entries(profiles)
    .filter(([name]) => !name.startsWith('sso-session '))
    .filter(([, data]) =>
      data.aws_access_key_id || data.aws_secret_access_key ||
      data.sso_start_url || data.sso_session || data.sso_account_id)
    .map(([name, data]) => ({
      name,
      region: data.region || 'us-east-1',
      sso: !!(data.sso_start_url || data.sso_session || data.sso_account_id),
    }));
}

async function resolveAwsConfig(profileId, dependencies = {}) {
  if (typeof profileId !== 'string' || !profileId) {
    throw Object.assign(new Error('AWS profile ID is required'), { $metadata: { httpStatusCode: 400 } });
  }

  const homeDirectory = dependencies.homeDirectory || os.homedir();
  if (profileId.startsWith('local:')) {
    const profileName = profileId.slice(6);
    const profiles = readLocalAwsProfiles({
      fileSystem: dependencies.fileSystem || fs,
      homeDirectory,
    });
    const profile = profiles.find(item => item.name === profileName);
    if (!profile) {
      throw Object.assign(new Error(`Local AWS profile not found: ${profileName}`), { $metadata: { httpStatusCode: 404 } });
    }
    const fromIni = dependencies.fromIni || require('@aws-sdk/credential-providers').fromIni;
    const { credentialsFile } = awsProfilePaths(homeDirectory);
    return {
      credentials: fromIni({ profile: profileName, filepath: credentialsFile }),
      region: profile.region,
    };
  }

  const store = dependencies.store || getStore();
  const keys = await store.getRawKeys(profileId);
  if (!keys) {
    throw Object.assign(new Error('Credential profile not found'), { $metadata: { httpStatusCode: 404 } });
  }

  const accessKeyId = keys.AWS_ACCESS_KEY_ID;
  const secretAccessKey = keys.AWS_SECRET_ACCESS_KEY;
  const sessionToken = keys.AWS_SESSION_TOKEN;
  if (!accessKeyId || !secretAccessKey) {
    throw Object.assign(
      new Error('Profile is missing AWS_ACCESS_KEY_ID or AWS_SECRET_ACCESS_KEY'),
      { $metadata: { httpStatusCode: 400 } },
    );
  }

  return {
    credentials: sessionToken
      ? { accessKeyId, secretAccessKey, sessionToken }
      : { accessKeyId, secretAccessKey },
    region: keys.AWS_DEFAULT_REGION || 'us-east-1',
  };
}

module.exports = {
  awsProfilePaths,
  readLocalAwsProfiles,
  resolveAwsConfig,
};