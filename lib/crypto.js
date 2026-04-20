'use strict';
/**
 * lib/crypto.js
 * AES-256-GCM symmetric encryption utilities for the FileStore credential backend.
 *
 * The encryption key is derived from a passphrase using PBKDF2 (SHA-256, 210 000 iterations)
 * and a per-installation salt stored alongside the encrypted vault file.
 *
 * NOTE: When running as an Electron desktop app, prefer KeytarStore (OS keychain) instead.
 *       This module is the fallback for web/server mode.
 */

const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');
const os     = require('os');

const ALGORITHM    = 'aes-256-gcm';
const KEY_LEN      = 32;          // 256 bits
const IV_LEN       = 12;          // 96-bit IV recommended for GCM
const TAG_LEN      = 16;          // 128-bit auth tag
const PBKDF2_ITER  = 210_000;
const PBKDF2_HASH  = 'sha256';
const SALT_FILE    = path.join(os.homedir(), '.kube', 'kuadashboard_salt');

// ─── Salt (per-installation) ──────────────────────────────────────────────────

function getOrCreateSalt() {
  if (fs.existsSync(SALT_FILE)) {
    return fs.readFileSync(SALT_FILE);
  }
  const salt = crypto.randomBytes(32);
  fs.mkdirSync(path.dirname(SALT_FILE), { recursive: true });
  fs.writeFileSync(SALT_FILE, salt, { mode: 0o600 });
  return salt;
}

// ─── Key derivation ───────────────────────────────────────────────────────────

/**
 * Derive an AES-256 key from a passphrase + installation salt.
 * @param {string} passphrase
 * @returns {Buffer}
 */
function deriveKey(passphrase) {
  const salt = getOrCreateSalt();
  return crypto.pbkdf2Sync(passphrase, salt, PBKDF2_ITER, KEY_LEN, PBKDF2_HASH);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Encrypt a plaintext string.
 * @param {string} plaintext
 * @param {string} passphrase
 * @returns {string}  base64-encoded payload: IV(12) + ciphertext + authTag(16)
 */
function encrypt(plaintext, passphrase) {
  const key    = deriveKey(passphrase);
  const iv     = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LEN });

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  // Layout: [IV 12B][TAG 16B][ciphertext]
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

/**
 * Decrypt a base64-encoded payload produced by `encrypt()`.
 * @param {string} payload  base64 string
 * @param {string} passphrase
 * @returns {string}  original plaintext
 */
function decrypt(payload, passphrase) {
  const key  = deriveKey(passphrase);
  const buf  = Buffer.from(payload, 'base64');

  const iv         = buf.subarray(0, IV_LEN);
  const tag        = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ciphertext = buf.subarray(IV_LEN + TAG_LEN);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LEN });
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/**
 * Mask a secret for display: show first 4 chars + asterisks.
 * @param {string} secret
 * @returns {string}
 */
function maskSecret(secret) {
  if (!secret || secret.length <= 4) return '****';
  return secret.slice(0, 4) + '*'.repeat(Math.min(secret.length - 4, 20));
}

module.exports = { encrypt, decrypt, maskSecret };
