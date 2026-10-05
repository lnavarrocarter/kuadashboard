'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ArchitectureDatabase } = require('../architecture/database');
const { ApmDatabase } = require('../apm/database');
const { PostureStore } = require('../advisor/posture');
const { validateKuaAppBundle } = require('./kuaAppBundle');
const { createKuaAppIo, contentHash } = require('./kuaAppIo');

function fixture() {
  const database = new ArchitectureDatabase({ filePath: ':memory:' });
  const apmDatabase = new ApmDatabase({ filePath: ':memory:' });
  const io = createKuaAppIo({ database, apmDatabase });
  const posture = new PostureStore(apmDatabase.db);
  const application = apmDatabase.createApplication({ profileId: 'local:test', provider: 'aws', region: 'us-east-1', name: 'Orders' });
  return { database, apmDatabase, io, posture, application, close: () => { database.close(); apmDatabase.close(); } };
}

const FUTURE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

test('product Advisor acceptances travel in the bundle and are restored on import (#94)', () => {
  const subject = fixture();
  try {
    const scope = `product:${subject.application.id}`;
    subject.posture.accept({ scopeKey: scope, ruleId: 'product.no_staging', reason: 'Single environment by design', author: 'ana@example.com', expiresAt: FUTURE });
    const [revoked] = subject.posture.accept({ scopeKey: scope, ruleId: 'product.no_owner', reason: 'temporary' });
    subject.posture.revoke(revoked.id);

    const bundle = validateKuaAppBundle(JSON.parse(JSON.stringify(subject.io.exportBundle(subject.application))));
    assert.deepEqual(bundle.advisor.acceptances.map(item => [item.ruleId, item.kind, item.reason, item.author]), [['product.no_staging', 'accepted', 'Single environment by design', 'ana@example.com']]);
    assert.doesNotMatch(JSON.stringify(bundle.advisor), /product:|local:test/);

    const imported = subject.io.importBundle('local:other', bundle);
    const restored = subject.posture.list(`product:${imported.application.id}`);
    assert.deepEqual(restored.map(item => [item.ruleId, item.reason, item.author, item.expiresAt]), [['product.no_staging', 'Single environment by design', 'ana@example.com', FUTURE]]);
  } finally { subject.close(); }
});

test('sync takes the other computer acceptances, and a bundle without them changes nothing', () => {
  const subject = fixture();
  try {
    const scope = `product:${subject.application.id}`;
    subject.posture.accept({ scopeKey: scope, ruleId: 'product.local_only', reason: 'decided here' });
    const remote = { ruleId: 'product.no_staging', kind: 'silenced', reason: 'decided there', author: 'bo@example.com', createdAt: '2026-10-01T00:00:00.000Z', expiresAt: null };

    subject.io.applyBundle(subject.application, { application: { environment: '', team: '', pollingEnabled: false }, advisor: { acceptances: [remote] } }, { author: 'sync' });
    assert.deepEqual(subject.posture.list(scope).map(item => [item.ruleId, item.author]), [['product.no_staging', 'bo@example.com']]);

    // Applying the same again does not duplicate; an older KUA's bundle (no advisor) leaves them alone.
    subject.io.applyBundle(subject.application, { application: {}, advisor: { acceptances: [remote] } });
    subject.io.applyBundle(subject.application, { application: {} });
    assert.equal(subject.posture.list(scope).length, 1);
  } finally { subject.close(); }
});

test('the sync hash only includes acceptances when there are some', () => {
  const base = { application: { provider: 'aws', region: 'us-east-1' }, architecture: null };
  assert.equal(contentHash({ ...base, advisor: { acceptances: [] } }), contentHash(base));
  assert.notEqual(contentHash({ ...base, advisor: { acceptances: [{ ruleId: 'r', kind: 'accepted', reason: 'x', author: 'a' }] } }), contentHash(base));
});
