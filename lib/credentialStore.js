'use strict';
/**
 * lib/credentialStore.js
 * Abstract credential store with two interchangeable backends:
 *
 *   FileStore   — AES-256-GCM encrypted JSON file (~/.kube/kuadashboard_envs.enc)
 *                 Used in web/server mode (current default).
 *
 *   KeytarStore — OS native keychain via the `keytar` npm package
 *                 (Windows Credential Manager, macOS Keychain, libsecret on Linux).
 *                 Used when running inside Electron (desktop app).
 *
 * The active backend is selected at startup:
 *   - If `process.env.KUADASHBOARD_STORE === 'keytar'` → KeytarStore
 *   - If running as Electron (process.versions.electron exists) → KeytarStore
 *   - Otherwise → FileStore (safe default)
 *
 * This design lets the frontend Vue 3 app, the Express API routes, and future
 * Electron IPC handlers all share a single credential interface without changes.
 *
 * ─── Vault schema ────────────────────────────────────────────────────────────
 * A "profile" is a named credential set for one cloud provider:
 * {
 *   id:        string (uuid v4),
 *   name:      string (display name),
 *   provider:  'gcp' | 'aws' | 'generic',
 *   createdAt: ISO date string,
 *   updatedAt: ISO date string,
 *   keys: {
 *     [keyName: string]: string   ← stored encrypted; returned masked via API
 *   }
 * }
 */

const fs     = require('fs');
const path   = require('path');
const os     = require('os');
const crypto = require('crypto');
const { encrypt, decrypt, maskSecret } = require('./crypto');

// ─── Passphrase resolution ────────────────────────────────────────────────────
// In production / Electron, inject KUADASHBOARD_VAULT_PASS via env or IPC init.
// Fallback to a machine-derived value for zero-config local usage.
function resolvePassphrase() {
  if (process.env.KUADASHBOARD_VAULT_PASS) return process.env.KUADASHBOARD_VAULT_PASS;
  // Machine-bound fallback: hostname + username (not a secret, just obfuscation)
  return `${os.hostname()}-${os.userInfo().username}-kuadashboard`;
}

// ─── FileStore ────────────────────────────────────────────────────────────────

const VAULT_FILE = path.join(os.homedir(), '.kube', 'kuadashboard_envs.enc');

class FileStore {
  constructor() {
    this._passphrase = resolvePassphrase();
  }

  _readVault() {
    if (!fs.existsSync(VAULT_FILE)) return { profiles: [] };
    try {
      const raw = fs.readFileSync(VAULT_FILE, 'utf8');
      return JSON.parse(decrypt(raw, this._passphrase));
    } catch {
      return { profiles: [] };
    }
  }

  _writeVault(vault) {
    fs.mkdirSync(path.dirname(VAULT_FILE), { recursive: true });
    const raw = encrypt(JSON.stringify(vault, null, 2), this._passphrase);
    fs.writeFileSync(VAULT_FILE, raw, { mode: 0o600 });
  }

  async listProfiles() {
    const vault = this._readVault();
    return vault.profiles.map(p => ({
      id:        p.id,
      name:      p.name,
      provider:  p.provider,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      keyNames:  Object.keys(p.keys || {}),
    }));
  }

  async getProfile(id) {
    const vault   = this._readVault();
    const profile = vault.profiles.find(p => p.id === id);
    if (!profile) return null;
    // Return masked keys — raw keys never leave the store via the REST API
    const maskedKeys = {};
    for (const [k, v] of Object.entries(profile.keys || {})) {
      maskedKeys[k] = maskSecret(v);
    }
    return { ...profile, keys: maskedKeys };
  }

  /** Internal: returns raw (unmasked) keys. Used only by cloud route adapters. */
  async getRawKeys(id) {
    const vault   = this._readVault();
    const profile = vault.profiles.find(p => p.id === id);
    return profile ? (profile.keys || {}) : null;
  }

  async createProfile({ name, provider, keys = {} }) {
    const vault   = this._readVault();
    const profile = {
      id:        crypto.randomUUID(),
      name,
      provider:  provider || 'generic',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      keys,
    };
    vault.profiles.push(profile);
    this._writeVault(vault);
    const { keys: _k, ...safe } = profile;
    return { ...safe, keyNames: Object.keys(keys) };
  }

  async updateProfile(id, { name, keys = {} }) {
    const vault   = this._readVault();
    const idx     = vault.profiles.findIndex(p => p.id === id);
    if (idx === -1) return null;
    if (name) vault.profiles[idx].name = name;
    // Merge keys (only overwrite provided keys, keep the rest)
    vault.profiles[idx].keys      = { ...vault.profiles[idx].keys, ...keys };
    vault.profiles[idx].updatedAt = new Date().toISOString();
    this._writeVault(vault);
    return this.getProfile(id);
  }

  async deleteProfile(id) {
    const vault = this._readVault();
    const len   = vault.profiles.length;
    vault.profiles = vault.profiles.filter(p => p.id !== id);
    if (vault.profiles.length === len) return false;
    this._writeVault(vault);
    return true;
  }

  /** Export a profile's raw keys as a .env formatted string */
  async exportEnv(id) {
    const vault   = this._readVault();
    const profile = vault.profiles.find(p => p.id === id);
    if (!profile) return null;
    const lines = [`# kuadashboard export — ${profile.name} (${profile.provider})`, `# Generated: ${new Date().toISOString()}`, ''];
    for (const [k, v] of Object.entries(profile.keys || {})) {
      lines.push(`${k}=${v}`);
    }
    return lines.join('\n');
  }
}

// ─── KeytarStore ──────────────────────────────────────────────────────────────
// Thin wrapper around `keytar` for OS keychain storage.
// Profile metadata is kept in a plain JSON file; only key values go into the keychain.

const KEYTAR_META_FILE = path.join(os.homedir(), '.kube', 'kuadashboard_envs_meta.json');
const KEYTAR_SERVICE   = 'kuadashboard';

class KeytarStore {
  constructor() {
    // Lazy-require: keytar is optional and only needed in desktop mode
    try {
      this._keytar = require('keytar');
    } catch {
      throw new Error(
        'KeytarStore requires the `keytar` package. ' +
        'Install it with: npm install keytar'
      );
    }
  }

  _readMeta() {
    if (!fs.existsSync(KEYTAR_META_FILE)) return { profiles: [] };
    try { return JSON.parse(fs.readFileSync(KEYTAR_META_FILE, 'utf8')); } catch { return { profiles: [] }; }
  }

  _writeMeta(meta) {
    fs.mkdirSync(path.dirname(KEYTAR_META_FILE), { recursive: true });
    fs.writeFileSync(KEYTAR_META_FILE, JSON.stringify(meta, null, 2), { mode: 0o600 });
  }

  _keychainKey(profileId, keyName) {
    return `${profileId}::${keyName}`;
  }

  async listProfiles() {
    const meta = this._readMeta();
    return meta.profiles.map(p => ({
      id:        p.id,
      name:      p.name,
      provider:  p.provider,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      keyNames:  p.keyNames || [],
    }));
  }

  async getProfile(id) {
    const meta    = this._readMeta();
    const profile = meta.profiles.find(p => p.id === id);
    if (!profile) return null;
    const maskedKeys = {};
    for (const kn of (profile.keyNames || [])) {
      const val = await this._keytar.getPassword(KEYTAR_SERVICE, this._keychainKey(id, kn));
      maskedKeys[kn] = maskSecret(val || '');
    }
    return { ...profile, keys: maskedKeys };
  }

  async getRawKeys(id) {
    const meta    = this._readMeta();
    const profile = meta.profiles.find(p => p.id === id);
    if (!profile) return null;
    const keys = {};
    for (const kn of (profile.keyNames || [])) {
      keys[kn] = await this._keytar.getPassword(KEYTAR_SERVICE, this._keychainKey(id, kn)) || '';
    }
    return keys;
  }

  async createProfile({ name, provider, keys = {} }) {
    const meta    = this._readMeta();
    const id      = crypto.randomUUID();
    const keyNames = Object.keys(keys);
    for (const [kn, val] of Object.entries(keys)) {
      await this._keytar.setPassword(KEYTAR_SERVICE, this._keychainKey(id, kn), val);
    }
    const profile = { id, name, provider: provider || 'generic', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), keyNames };
    meta.profiles.push(profile);
    this._writeMeta(meta);
    return { ...profile };
  }

  async updateProfile(id, { name, keys = {} }) {
    const meta = this._readMeta();
    const idx  = meta.profiles.findIndex(p => p.id === id);
    if (idx === -1) return null;
    if (name) meta.profiles[idx].name = name;
    for (const [kn, val] of Object.entries(keys)) {
      await this._keytar.setPassword(KEYTAR_SERVICE, this._keychainKey(id, kn), val);
      if (!meta.profiles[idx].keyNames.includes(kn)) meta.profiles[idx].keyNames.push(kn);
    }
    meta.profiles[idx].updatedAt = new Date().toISOString();
    this._writeMeta(meta);
    return this.getProfile(id);
  }

  async deleteProfile(id) {
    const meta    = this._readMeta();
    const profile = meta.profiles.find(p => p.id === id);
    if (!profile) return false;
    for (const kn of (profile.keyNames || [])) {
      await this._keytar.deletePassword(KEYTAR_SERVICE, this._keychainKey(id, kn));
    }
    meta.profiles = meta.profiles.filter(p => p.id !== id);
    this._writeMeta(meta);
    return true;
  }

  async exportEnv(id) {
    const meta    = this._readMeta();
    const profile = meta.profiles.find(p => p.id === id);
    if (!profile) return null;
    const lines = [`# kuadashboard export — ${profile.name} (${profile.provider})`, `# Generated: ${new Date().toISOString()}`, ''];
    for (const kn of (profile.keyNames || [])) {
      const val = await this._keytar.getPassword(KEYTAR_SERVICE, this._keychainKey(id, kn)) || '';
      lines.push(`${kn}=${val}`);
    }
    return lines.join('\n');
  }
}

// ─── Factory: select backend automatically ────────────────────────────────────

function createStore() {
  const forceKeytar = process.env.KUADASHBOARD_STORE === 'keytar';
  const isElectron  = !!process.versions?.electron;

  if (forceKeytar || isElectron) {
    console.log('[credentialStore] Using KeytarStore (OS keychain)');
    return new KeytarStore();
  }
  console.log('[credentialStore] Using FileStore (AES-256-GCM encrypted file)');
  return new FileStore();
}

// Singleton — one store instance per process
let _instance = null;
function getStore() {
  if (!_instance) _instance = createStore();
  return _instance;
}

module.exports = { getStore, FileStore, KeytarStore };
