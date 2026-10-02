'use strict';
/**
 * lib/logCacheCrypto.js
 * Sealed blocks for the local log cache: events are serialized, compressed
 * with Brotli and encrypted with AES-256-GCM. Each block is bound to its log
 * group through the GCM additional data, so a block cannot be moved to (or
 * read as) another group.
 *
 * Key: one random 256-bit key per installation.
 *   - Stored in the OS keychain of the current user (Windows Credential
 *     Manager/DPAPI, macOS Keychain, libsecret) through @napi-rs/keyring.
 *   - Fallback when no keychain is available: a key file next to the cache,
 *     wrapped with the KUA vault passphrase (lib/crypto.js, PBKDF2 + AES-GCM).
 * Losing the key only loses the cache (it is rebuilt from CloudWatch).
 *
 * Compression and encryption run on the libuv thread pool (async zlib), so
 * large compactions never block the server.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { promisify } = require('util');

const brotliCompress = promisify(zlib.brotliCompress);
const brotliDecompress = promisify(zlib.brotliDecompress);

const FORMAT_VERSION = 1;
const IV_LEN = 12;
const TAG_LEN = 16;
const KEYRING_SERVICE = 'kuadashboard';
const KEYRING_ACCOUNT = 'log-cache-key';
// Measured on real Lambda logs: q5 ≈ 33x, q9 ≈ 35x at 3x the time, q11 ≈ 39x but ~55x slower.
const QUALITY = { hot: 5, cold: 9 };

function keyFromKeyring() {
  const { Entry } = require('@napi-rs/keyring');
  const entry = new Entry(KEYRING_SERVICE, KEYRING_ACCOUNT);
  let stored = null;
  try { stored = entry.getPassword(); } catch { stored = null; }
  if (stored) return { key: Buffer.from(stored, 'base64'), store: 'keychain' };
  const key = crypto.randomBytes(32);
  entry.setPassword(key.toString('base64'));
  // Read back: some keychains accept the write but fail silently.
  if (entry.getPassword() !== key.toString('base64')) throw new Error('keychain write was not persisted');
  return { key, store: 'keychain' };
}

function keyFromFile(dataDir, fileSystem = fs) {
  const { encrypt, decrypt } = require('./crypto');
  const { resolvePassphrase } = require('./credentialStore');
  const file = path.join(dataDir, 'log-cache.key');
  if (fileSystem.existsSync(file)) {
    return { key: Buffer.from(decrypt(fileSystem.readFileSync(file, 'utf8'), resolvePassphrase()), 'base64'), store: 'file' };
  }
  const key = crypto.randomBytes(32);
  fileSystem.mkdirSync(dataDir, { recursive: true });
  fileSystem.writeFileSync(file, encrypt(key.toString('base64'), resolvePassphrase()), { mode: 0o600 });
  return { key, store: 'file' };
}

/**
 * The cache key of this OS user. KUA_LOG_CACHE_KEYSTORE=file forces the
 * passphrase-wrapped file (e.g. headless servers without a keychain).
 */
function loadCacheKey({ dataDir, preferred = process.env.KUA_LOG_CACHE_KEYSTORE } = {}) {
  if (preferred !== 'file') {
    try { return keyFromKeyring(); } catch (err) {
      if (preferred === 'keychain') throw err;
      console.warn('[log-cache] OS keychain unavailable, using a passphrase-wrapped key file:', err.message);
    }
  }
  return keyFromFile(dataDir);
}

function aadFor(scope) {
  return Buffer.from(`kua-log-cache|${scope.profileId}|${scope.region}|${scope.logGroup}`);
}

// Compact layout: stream names once, timestamps as deltas from the block start.
function serialize(events) {
  const streams = [];
  const streamIndex = new Map();
  const base = events.length ? events[0].timestamp : 0;
  const rows = events.map(event => {
    const stream = event.logStreamName || '';
    if (!streamIndex.has(stream)) { streamIndex.set(stream, streams.length); streams.push(stream); }
    return [event.timestamp - base, streamIndex.get(stream), event.id, event.message];
  });
  return Buffer.from(JSON.stringify({ v: FORMAT_VERSION, base, streams, rows }));
}

function deserialize(buffer) {
  const data = JSON.parse(buffer.toString('utf8'));
  return data.rows.map(([delta, stream, id, message]) => ({
    timestamp: data.base + delta, logStreamName: data.streams[stream], id, message,
  }));
}

/** events ({ timestamp, logStreamName, id, message }, sorted) → { payload, rawBytes } */
async function sealBlock(key, scope, events, { tier = 'hot' } = {}) {
  const raw = serialize(events);
  const compressed = await brotliCompress(raw, {
    params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: QUALITY[tier] ?? QUALITY.hot,
      [zlib.constants.BROTLI_PARAM_SIZE_HINT]: raw.length,
      [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
    },
  });
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_LEN });
  cipher.setAAD(aadFor(scope));
  const encrypted = Buffer.concat([cipher.update(compressed), cipher.final()]);
  return { payload: Buffer.concat([Buffer.from([FORMAT_VERSION]), iv, cipher.getAuthTag(), encrypted]), rawBytes: raw.length };
}

/** Inverse of sealBlock. Throws if the key, the group or the bytes do not match. */
async function openBlock(key, scope, payload) {
  const buffer = Buffer.from(payload);
  if (buffer[0] !== FORMAT_VERSION) throw new Error(`Unsupported log block format ${buffer[0]}`);
  const iv = buffer.subarray(1, 1 + IV_LEN);
  const tag = buffer.subarray(1 + IV_LEN, 1 + IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_LEN });
  decipher.setAAD(aadFor(scope));
  decipher.setAuthTag(tag);
  const compressed = Buffer.concat([decipher.update(buffer.subarray(1 + IV_LEN + TAG_LEN)), decipher.final()]);
  return deserialize(await brotliDecompress(compressed));
}

function shortHash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('base64url').slice(0, 16);
}

/**
 * Short stable id for deduplication, from the event content (stream, time,
 * message). Every source yields the same id for the same event: FilterLogEvents
 * (which has event ids) and Logs Insights results (which do not).
 */
function eventKey(event, message) {
  return shortHash(`${event.logStreamName || ''}\u0000${Number(event.timestamp)}\u0000${message}`);
}

/** Id used by the first cache versions (from the CloudWatch event id), still recognized when deduplicating. */
function legacyEventKey(event) {
  return event.eventId ? shortHash(event.eventId) : null;
}

/** Fixed value sealed with the key: detects a key that no longer matches the cache. */
async function keyCheck(key) {
  return sealBlock(key, { profileId: '-', region: '-', logGroup: '-' }, [{ timestamp: 0, logStreamName: '', id: 'check', message: 'kua' }]);
}

async function verifyKeyCheck(key, payload) {
  try { return (await openBlock(key, { profileId: '-', region: '-', logGroup: '-' }, payload))[0]?.message === 'kua'; } catch { return false; }
}

module.exports = { loadCacheKey, sealBlock, openBlock, eventKey, legacyEventKey, keyCheck, verifyKeyCheck, QUALITY };
