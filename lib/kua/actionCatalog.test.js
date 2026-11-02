'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { ACTIONS, validate, actionForRoute } = require('./actionCatalog');
const { createApmRouter } = require('../../routes/apm');
const { createKuaAppsRouter } = require('../../routes/kuaApps');
const { ApmDatabase } = require('../apm/database');
const { ArchitectureDatabase } = require('../architecture/database');

// Every non-GET route the routers really mount, with the prefix server.js mounts them under.
function writeRoutes() {
  const apmDatabase = new ApmDatabase({ filePath: ':memory:' });
  const architectureDatabase = new ArchitectureDatabase({ filePath: ':memory:' });
  const routers = [
    ['/api/observability/:provider', createApmRouter({ database: apmDatabase, architectureDatabase, scheduler: {}, provider: 'aws' })],
    ['/api/kua-apps', createKuaAppsRouter({ database: architectureDatabase, apmDatabase })],
  ];
  return routers.flatMap(([prefix, router]) => router.stack
    .filter(layer => layer.route)
    .flatMap(layer => Object.keys(layer.route.methods)
      .filter(method => method !== 'get')
      .map(method => `${method.toUpperCase()} ${prefix}${layer.route.path}`)));
}

test('the catalog is valid', () => {
  assert.deepEqual(validate(), []);
});

test('every write route of KUApps and Observability is in the catalog, and nothing else is', () => {
  const mounted = writeRoutes();
  const catalogued = Object.values(ACTIONS).flatMap(action => action.routes);
  const missing = mounted.filter(route => !catalogued.includes(route));
  const stale = catalogued.filter(route => !mounted.includes(route));
  assert.deepEqual(missing, [], `Add these routes to frontend/src/shared/actionCatalog.json: ${missing.join(', ')}`);
  assert.deepEqual(stale, [], `These catalog routes no longer exist: ${stale.join(', ')}`);
});

test('validate reports what is wrong with an entry', () => {
  const problems = validate({ actions: {
    Bad: { kind: 'delete', routes: ['GET /x'], stores: ['disk'], derives: [], revision: 'maybe', invalidates: ['everything'], batchable: 'no', destructive: false, audit: true, cost: {}, summary: '' },
    'edge.read': { kind: 'read', routes: ['POST /api/kua-apps/x'], stores: ['apm-db'], derives: [], revision: 'none', invalidates: [], batchable: false, destructive: false, audit: false, cost: null, summary: 'x' },
  } });
  for (const expected of ['key must be dotted', 'kind must be', 'route "GET /x"', 'stores must list', 'revision must be', 'invalidates must list', 'batchable must be', 'cost is null', 'summary is required', 'a read writes no store']) {
    assert.ok(problems.some(problem => problem.includes(expected)), `expected a problem about "${expected}" in ${problems.join(' / ')}`);
  }
});

test('actionForRoute finds the action of a mounted route', () => {
  assert.equal(actionForRoute('post', '/api/observability/:provider/applications/:applicationId/edges/batch'), 'edge.confirm-batch');
  assert.equal(actionForRoute('GET', '/api/kua-apps/applications'), null);
});

test('destructive actions are audited, and actions that leave this computer say so', () => {
  for (const [key, action] of Object.entries(ACTIONS)) {
    if (action.destructive) assert.equal(action.audit, true, `${key} is destructive and must be audited`);
    if (action.stores.includes('control-plane') || action.stores.includes('github')) {
      assert.equal(action.kind, 'external-write', `${key} writes outside this computer`);
    }
  }
});
