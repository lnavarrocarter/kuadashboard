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

const { runAs } = require('./auditContext');
const LOG_FILE = path.join(home, '.kuadashboard', 'audit.log');

test('every entry names who did it: the interface, an agent or the system', () => {
  const ui = runAs('ui', () => auditLog.log({ category: 'aws', action: 'actor.ui' }));
  const agent = runAs('mcp', () => auditLog.log({ category: 'aws', action: 'actor.mcp' }));
  const system = auditLog.log({ category: 'system', action: 'actor.system' });
  assert.deepEqual([ui.actor.kind, agent.actor.kind, system.actor.kind], ['ui', 'mcp', 'system']);
  assert.equal(typeof ui.actor.user, 'string');
  assert.ok(auditLog.exportCsv({ search: 'actor.mcp' }).split('\n')[1].includes(',mcp,'));
});

test('the chain links every entry; an edited or removed line is detected', () => {
  for (let i = 0; i < 3; i++) auditLog.log({ category: 'aws', action: `chain.${i}` });
  assert.equal(auditLog.verify().valid, true);
  const original = fs.readFileSync(LOG_FILE, 'utf8');
  try {
    const lines = original.trim().split('\n');
    const edited = JSON.parse(lines[lines.length - 2]);
    edited.action = 'something else';
    fs.writeFileSync(LOG_FILE, [...lines.slice(0, -2), JSON.stringify(edited), lines[lines.length - 1]].join('\n') + '\n');
    assert.deepEqual([auditLog.verify().valid, auditLog.verify().brokenAt.reason], [false, 'modified']);

    fs.writeFileSync(LOG_FILE, [...lines.slice(0, -2), lines[lines.length - 1]].join('\n') + '\n');
    assert.deepEqual([auditLog.verify().valid, auditLog.verify().brokenAt.reason], [false, 'missing']);
  } finally {
    fs.writeFileSync(LOG_FILE, original);
  }
});

test('entries older than the retention are pruned from memory and disk', () => {
  const old = { id: 'old-entry', timestamp: '2020-01-01T00:00:00.000Z', level: 'info', category: 'aws', action: 'retention.old', resource: '', details: {}, context: '' };
  fs.appendFileSync(LOG_FILE, JSON.stringify(old) + '\n');
  auditLog.saveSettings({ retentionDays: 30 });
  assert.equal(auditLog.getSettings().retentionDays, 30);
  assert.equal(fs.readFileSync(LOG_FILE, 'utf8').includes('old-entry'), false);
  assert.throws(() => auditLog.saveSettings({ retentionDays: 2 }), error => error.statusCode === 400);
});

test('filters by who did it', () => {
  runAs('mcp', () => auditLog.log({ category: 'aws', action: 'filter.actor' }));
  auditLog.log({ category: 'aws', action: 'filter.actor' });
  assert.equal(auditLog.queryLogs({ search: 'filter.actor', actor: 'mcp' }).total, 1);
});
