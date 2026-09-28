'use strict';

// Persistent KUA SSH key per Google account (like gcloud's
// ~/.ssh/google_compute_engine), so reconnecting to a GCP VM reuses the key the
// VM already trusts instead of pushing a new one on every connection.
//
// Stored in ~/.kube/kuadashboard_ssh_keys.enc, encrypted with the same
// AES-256-GCM scheme and passphrase as the credential vault; never written in
// plain text and never sent to the frontend.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { utils } = require('ssh2');
const { encrypt, decrypt } = require('./crypto');

const DEFAULT_FILE = path.join(os.homedir(), '.kube', 'kuadashboard_ssh_keys.enc');

function createSshKeyVault({
  file = DEFAULT_FILE,
  passphrase = () => require('./credentialStore').resolvePassphrase(),
  generate = email => utils.generateKeyPairSync('ed25519', { comment: `kua-${email}` }),
  now = () => Date.now(),
} = {}) {
  function read() {
    if (!fs.existsSync(file)) return { keys: {} };
    try {
      return JSON.parse(decrypt(fs.readFileSync(file, 'utf8'), passphrase()));
    } catch {
      // Unreadable (other machine/passphrase or corrupt): start over, like a lost key
      return { keys: {} };
    }
  }

  function write(vault) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, encrypt(JSON.stringify(vault), passphrase()), { mode: 0o600 });
  }

  /** The key pair for this Google account, creating and saving it on first use. */
  function getOrCreate(email) {
    const vault = read();
    const existing = vault.keys[email];
    if (existing?.public && existing?.private) return { public: existing.public, private: existing.private, created: false };
    const pair = generate(email);
    vault.keys[email] = { public: pair.public, private: pair.private, createdAt: new Date(now()).toISOString() };
    write(vault);
    return { public: pair.public, private: pair.private, created: true };
  }

  /** Forget the key for an account (a new one is generated next time). */
  function forget(email) {
    const vault = read();
    if (!vault.keys[email]) return false;
    delete vault.keys[email];
    write(vault);
    return true;
  }

  return { getOrCreate, forget };
}

let _instance = null;
function getSshKeyVault() {
  if (!_instance) _instance = createSshKeyVault();
  return _instance;
}

module.exports = { createSshKeyVault, getSshKeyVault };
