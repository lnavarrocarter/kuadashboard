'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createReadOnlyMode, guardedArea, isReadOnlySql } = require('./readOnlyMode');

test('reads pass and writes to clouds and clusters are guarded', () => {
  assert.equal(guardedArea('GET', '/api/cloud/aws/ec2'), null);
  assert.equal(guardedArea('POST', '/api/cloud/aws/ec2/i-1/stop'), 'aws');
  assert.equal(guardedArea('PUT', '/api/cloud/aws/tags'), 'aws');
  assert.equal(guardedArea('DELETE', '/api/cloud/gcp/compute/vms/z/vm-1'), 'gcp');
  assert.equal(guardedArea('POST', '/api/cloud/vercel/deployments/d-1/redeploy'), 'vercel');
  assert.equal(guardedArea('POST', '/api/helm/install'), 'helm');
  assert.equal(guardedArea('DELETE', '/api/helm/releases/default/web'), 'helm');
  assert.equal(guardedArea('POST', '/api/console/sessions'), 'console');
});

test('every Kubernetes write is guarded, including routes that do not exist yet', () => {
  assert.equal(guardedArea('DELETE', '/api/default/pods/web-1'), 'kubernetes');
  assert.equal(guardedArea('POST', '/api/prod/deployments/api/scale'), 'kubernetes');
  assert.equal(guardedArea('PUT', '/api/apply'), 'kubernetes');
  assert.equal(guardedArea('POST', '/api/nodes/n-1/drain'), 'kubernetes');
  assert.equal(guardedArea('POST', '/api/namespaces'), 'kubernetes');
  assert.equal(guardedArea('POST', '/api/default/cronjobs/backup/trigger'), 'kubernetes');
});

test('reads sent as POST and local operations stay available', () => {
  assert.equal(guardedArea('POST', '/api/cloud/aws/sso/start'), null);
  assert.equal(guardedArea('POST', '/api/cloud/aws/cloudwatch/log-groups/insights'), null);
  assert.equal(guardedArea('POST', '/api/cloud/aws/dynamodb/orders/scan'), null);
  assert.equal(guardedArea('DELETE', '/api/cloud/aws/cloudwatch/log-cache'), null);
  assert.equal(guardedArea('POST', '/api/cloud/gcp/logging/query'), null);
  assert.equal(guardedArea('POST', '/api/cloud/gcp/gke/us-central1/main/connect'), null);
  assert.equal(guardedArea('POST', '/api/cloud/vercel/oauth/callback'), null);
  assert.equal(guardedArea('POST', '/api/helm/repos'), null);
  assert.equal(guardedArea('POST', '/api/default/services/web/portforward'), null);
  assert.equal(guardedArea('DELETE', '/api/portforward/8080'), null);
  // KUA's own state and this computer's configuration are not cloud changes
  for (const pathname of ['/api/contexts/switch', '/api/kubeconfig/import', '/api/system/cache-settings', '/api/cloud/envs/profiles',
    '/api/kua-apps/applications', '/api/architecture/projects/p/graph', '/api/observability/aws/applications/a/collect', '/api/audit/logs']) {
    assert.equal(guardedArea('POST', pathname), null, pathname);
  }
});

test('Athena and BigQuery queries pass only when they read', () => {
  assert.equal(isReadOnlySql('SELECT * FROM orders WHERE note = \'drop table x\''), true);
  assert.equal(isReadOnlySql('with recent as (select 1) select * from recent;'), true);
  assert.equal(isReadOnlySql('-- comment\nSHOW TABLES'), true);
  assert.equal(isReadOnlySql('DROP TABLE orders'), false);
  assert.equal(isReadOnlySql('INSERT INTO t SELECT 1'), false);
  assert.equal(isReadOnlySql('CREATE TABLE t AS SELECT 1'), false);
  assert.equal(isReadOnlySql('SELECT 1; DELETE FROM t'), false);
  assert.equal(isReadOnlySql('with x as (select 1) insert into t select * from x'), false);
  assert.equal(isReadOnlySql(''), false);
  assert.equal(guardedArea('POST', '/api/cloud/aws/athena/query', { query: 'SELECT 1' }), null);
  assert.equal(guardedArea('POST', '/api/cloud/aws/athena/query', { query: 'DROP TABLE t' }), 'aws');
  assert.equal(guardedArea('POST', '/api/cloud/gcp/bigquery/query', { query: 'DELETE FROM d.t WHERE true' }), 'gcp');
});

function tempFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kua-ro-')), 'read-only.json');
}

function fakeResponse() {
  return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

test('the middleware refuses guarded writes only while the mode is on, and audits it', () => {
  const entries = [];
  const mode = createReadOnlyMode({ file: tempFile(), env: {}, audit: { log: entry => entries.push(entry) } });
  const request = { method: 'POST', originalUrl: '/api/cloud/aws/ec2/i-1/stop', body: {} };
  let passed = 0;
  mode.middleware(request, fakeResponse(), () => { passed += 1; });
  assert.equal(passed, 1);

  mode.setEnabled(true);
  const res = fakeResponse();
  mode.middleware(request, res, () => { passed += 1; });
  assert.equal(passed, 1);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, 'READ_ONLY');
  assert.equal(res.body.area, 'aws');
  assert.deepEqual(entries.map(entry => entry.action), ['readOnly.enabled', 'readOnly.refused']);
  mode.middleware({ method: 'GET', originalUrl: '/api/cloud/aws/ec2' }, fakeResponse(), () => { passed += 1; });
  assert.equal(passed, 2);
});

test('the state survives a restart; KUA_READ_ONLY forces it on', () => {
  const file = tempFile();
  createReadOnlyMode({ file, env: {} }).setEnabled(true);
  assert.deepEqual(createReadOnlyMode({ file, env: {} }).state(), { enabled: true, forced: false });

  const forced = createReadOnlyMode({ file: tempFile(), env: { KUA_READ_ONLY: '1' } });
  assert.deepEqual(forced.state(), { enabled: true, forced: true });
  assert.throws(() => forced.setEnabled(false), error => error.status === 409);
});

test('terminals are refused while the mode is on; log streams are not', () => {
  const mode = createReadOnlyMode({ file: tempFile(), env: {} });
  const socket = { ended: '', end(text) { this.ended = text; } };
  assert.equal(mode.admitUpgrade('/ws/exec', socket), true);
  mode.setEnabled(true);
  assert.equal(mode.admitUpgrade('/ws/logs', socket), true);
  assert.equal(mode.admitUpgrade('/ws/exec', socket), false);
  assert.match(socket.ended, /403/);
  assert.equal(mode.admitUpgrade('/ws/aws-ssm', { end() {} }), false);
});
