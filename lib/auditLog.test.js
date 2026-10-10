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

test('pages the matches and reports how many there are', () => {
  for (let i = 0; i < 5; i++) auditLog.log({ category: 'aws', action: `paging.${i}` });
  const page = auditLog.queryLogs({ search: 'paging.', limit: 2, offset: 2 });
  assert.equal(page.total, 5);
  assert.deepEqual(page.entries.map(e => e.action), ['paging.2', 'paging.1']);
});

test('stats and CSV follow the same filters as the list', () => {
  auditLog.log({ category: 'gcp', action: 'scoped.read', level: 'warning' });
  auditLog.log({ category: 'gcp', action: 'scoped.read', level: 'error' });
  auditLog.log({ category: 'aws', action: 'scoped.other' });
  const stats = auditLog.getStats({ search: 'scoped.read' });
  assert.equal(stats.total, 2);
  assert.deepEqual(stats.byCategory, { gcp: 2 });
  const csv = auditLog.exportCsv({ search: 'scoped.read' }).trim().split('\n');
  assert.equal(csv.length, 3);
  assert.ok(csv.slice(1).every(row => row.includes('scoped.read')));
});

test('filters by time range', () => {
  auditLog.log({ category: 'aws', action: 'window.now' });
  const future = new Date(Date.now() + 60_000).toISOString();
  assert.equal(auditLog.queryLogs({ search: 'window.now', from: future }).total, 0);
  assert.equal(auditLog.queryLogs({ search: 'window.now', to: future }).total, 1);
});
