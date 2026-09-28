'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { inspectDataStorage, fileKind } = require('./dataStorage');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kua-storage-'));
}

test('classifies data files by kind', () => {
  assert.equal(fileKind('apm-observability.sqlite3'), 'sqlite');
  assert.equal(fileKind('apm-observability.sqlite3-wal'), 'sqlite-wal');
  assert.equal(fileKind('aws-cost-cache.json'), 'json');
  assert.equal(fileKind('audit.log'), 'log');
});

test('reports files, SQLite pages, tables and cost cache entries', () => {
  const dir = tempDir();
  const db = new Database(path.join(dir, 'architecture.sqlite3'));
  db.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, body TEXT); CREATE INDEX items_body ON items(body);');
  const insert = db.prepare('INSERT INTO items (body) VALUES (?)');
  for (let i = 0; i < 50; i++) insert.run('x'.repeat(200));
  db.close();
  fs.writeFileSync(path.join(dir, 'aws-cost-cache.json'), JSON.stringify({ 'local:dev': { fetchedAt: 1000, data: {} } }));
  fs.writeFileSync(path.join(dir, 'audit.log'), 'line\n');

  const report = inspectDataStorage({ dir });
  assert.equal(report.exists, true);
  assert.equal(report.totalBytes, report.files.reduce((sum, f) => sum + f.bytes, 0));
  assert.deepEqual(report.awsCostCache, [{ profile: 'local:dev', fetchedAt: 1000 }]);

  const [arch] = report.databases;
  assert.equal(arch.id, 'architecture');
  assert.equal(arch.status, 'ok');
  assert.equal(arch.usedBytes + arch.freeBytes, arch.pageCount * arch.pageSize);
  const items = arch.tables.find(t => t.name === 'items');
  assert.equal(items.rows, 50);
  // The index pages count toward their table.
  assert.ok(items.bytes === null || items.bytes >= 2 * arch.pageSize);
  assert.equal(report.files.find(f => f.name === 'audit.log').id, 'audit');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a missing directory reports no files', () => {
  const report = inspectDataStorage({ dir: path.join(os.tmpdir(), 'kua-missing-dir-xyz') });
  assert.equal(report.exists, false);
  assert.deepEqual(report.files, []);
  assert.equal(report.totalBytes, 0);
});

test('a corrupt database is reported, not thrown', () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, 'broken.sqlite3'), 'not a database');
  const report = inspectDataStorage({ dir });
  assert.equal(report.databases[0].status, 'error');
  fs.rmSync(dir, { recursive: true, force: true });
});
