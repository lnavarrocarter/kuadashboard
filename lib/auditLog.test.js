'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Keep the real ~/.kuadashboard/audit.log out of the test.
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kua-audit-'));
process.env.HOME = home;
process.env.USERPROFILE = home;
const auditLog = require('./auditLog');

test('keeps the vercel category instead of filing it as system', () => {
  auditLog.log({ category: 'vercel', action: 'deployment.redeploy', resource: 'project-1' });
  const [entry] = auditLog.getLogs({ category: 'vercel' });
  assert.equal(entry?.category, 'vercel');
  assert.equal(entry.action, 'deployment.redeploy');
});

test('files unknown categories as system', () => {
  auditLog.log({ category: 'not-a-category', action: 'unknown.action' });
  const [entry] = auditLog.getLogs({ search: 'unknown.action' });
  assert.equal(entry?.category, 'system');
});
