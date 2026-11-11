'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { assertNoPackagedVercelSecret } = require('./check-packaged-secrets');

test('packaging rejects a nonempty OAuth secret without echoing its value', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kua-pack-secrets-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'config'));
  for (const line of ['VERCEL_OAUTH_CLIENT_SECRET=secret-value', 'VERCEL_OAUTH_CLIENT_SECRET="secret-value"', "export VERCEL_OAUTH_CLIENT_SECRET = 'secret-value'"]) {
    fs.writeFileSync(path.join(root, 'config/runtime.env'), line);
    assert.throws(() => assertNoPackagedVercelSecret(root), error => {
      assert.match(error.message, /Packaging refused/);
      assert.doesNotMatch(error.message, /secret-value/);
      return true;
    });
  }
  fs.writeFileSync(path.join(root, 'config/runtime.env'), '# VERCEL_OAUTH_CLIENT_SECRET=comment\nVERCEL_OAUTH_CLIENT_SECRET=""\n');
  assert.doesNotThrow(() => assertNoPackagedVercelSecret(root));
  assert.equal(require('../package.json').build.beforePack, 'electron/beforePack.js');
});
