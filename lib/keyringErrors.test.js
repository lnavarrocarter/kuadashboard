'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { KeyringStore } = require('./credentialStore');
const { loadCacheKey } = require('./logCacheCrypto');
const { createPersistentEntry } = require('./keyringEntry');

test('persistent entries require Secret Service on Linux and retain native defaults elsewhere', () => {
  class Entry { constructor(...args) { this.args = args; } }
  assert.deepEqual(createPersistentEntry('service', 'account', { Entry, platform: 'linux' }).args,
    ['service', 'account', { linux: { store: 'secret-service' } }]);
  for (const platform of ['darwin', 'win32']) {
    assert.deepEqual(createPersistentEntry('service', 'account', { Entry, platform }).args, ['service', 'account']);
  }
});

test('a keychain deletion failure preserves the profile for an unlock and retry', async () => {
  const store = Object.create(KeyringStore.prototype);
  const original = { profiles: [{ id: 'fixture', keyNames: ['first', 'second'] }] };
  let persisted = structuredClone(original);
  let locked = true;
  let writes = 0;
  const present = new Set(['first', 'second']);
  store._readMeta = () => structuredClone(persisted);
  store._writeMeta = value => { writes++; persisted = structuredClone(value); };
  store._entry = (_id, key) => ({ deletePassword() {
    if (key === 'second' && locked) throw new Error('Keychain locked');
    return present.delete(key); // v2 returns false for an already missing entry.
  } });
  await assert.rejects(store.deleteProfile('fixture'), /Keychain locked/);
  assert.equal(writes, 0);
  assert.deepEqual(persisted, original);
  assert.equal(present.has('first'), false);
  locked = false;
  assert.equal(await store.deleteProfile('fixture'), true);
  assert.equal(present.size, 0);
  assert.deepEqual(persisted, { profiles: [] });
});

test('cache-key reads that fail never create or overwrite a keychain entry', () => {
  let writes = 0;
  class LockedEntry {
    getPassword() { throw new Error('Keychain locked'); }
    setPassword() { writes++; }
  }
  assert.throws(() => loadCacheKey({ preferred: 'keychain', Entry: LockedEntry }), /Keychain locked/);
  assert.equal(writes, 0);
});

test('missing cache keys are created once and existing keys are reused', () => {
  let value = null;
  let writes = 0;
  class Entry {
    getPassword() { return value; }
    setPassword(next) { writes++; value = next; }
  }
  const first = loadCacheKey({ preferred: 'keychain', Entry });
  const second = loadCacheKey({ preferred: 'keychain', Entry });
  assert.equal(first.key.length, 32);
  assert.deepEqual(first.key, second.key);
  assert.equal(writes, 1);
});

test('an unavailable keychain reuses the encrypted file fallback without writing to the keychain', t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kua-keyring-fallback-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const first = loadCacheKey({ dataDir, preferred: 'file' });
  class LockedEntry {
    getPassword() { throw new Error('Keychain locked'); }
    setPassword() { assert.fail('must not overwrite an unreadable key'); }
  }
  const second = loadCacheKey({ dataDir, preferred: 'auto', Entry: LockedEntry });
  assert.equal(second.store, 'file');
  assert.deepEqual(second.key, first.key);
});
