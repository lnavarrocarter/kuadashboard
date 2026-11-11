'use strict';

// The automatic Linux backend can fall back to keyutils, whose credentials
// disappear on reboot. KUA's credentials and encryption keys must persist.
function createPersistentEntry(service, username, { Entry = require('@napi-rs/keyring').Entry, platform = process.platform } = {}) {
  return platform === 'linux'
    ? new Entry(service, username, { linux: { store: 'secret-service' } })
    : new Entry(service, username);
}

module.exports = { createPersistentEntry };
