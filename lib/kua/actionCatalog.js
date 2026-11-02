'use strict';
/**
 * lib/kua/actionCatalog.js
 * What every KUApps and Observability action touches, declared before it runs (#329):
 * whether it reads or writes, which local stores it writes and recomputes, whether it
 * moves or checks the application revision, whether it calls a cloud or leaves this
 * computer, what it costs, whether it is destructive, and which UI data it invalidates.
 *
 * The catalog itself is frontend/src/shared/actionCatalog.json, shared with the UI task
 * coordinator (frontend/src/lib/taskCoordinator.js), so both sides read one definition.
 * lib/kua/actionCatalog.test.js fails when a write route is missing from it, and
 * scripts/generate-action-catalog-docs.js writes the documentation table from it.
 */

const CATALOG = require('../../frontend/src/shared/actionCatalog.json');

const KINDS = ['read', 'write', 'cloud-read', 'cloud-write', 'external-write'];
const STORES = ['apm-db', 'architecture-graph', 'registry', 'scopes', 'change-plans', 'log-cache', 'local-settings', 'control-plane', 'github'];
const REVISIONS = ['none', 'checked', 'moves', 'checked-moves', 'graph'];
// Data the UI reloads after a write (frontend/src/stores/useApmStore.js and KUApps views).
const UI_PARTS = ['overview', 'topology', 'forecast', 'registry', 'kuapps.registry', 'kuapps.missing'];
const ROUTE = /^(POST|PATCH|PUT|DELETE) \/api\/(observability\/:provider|kua-apps)(\/[\w:./-]*)?$/;
const KEY = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/;

function validate(catalog = CATALOG) {
  const problems = [];
  const seenRoutes = new Map();
  for (const [key, action] of Object.entries(catalog.actions || {})) {
    const where = `action ${key}`;
    if (!KEY.test(key)) problems.push(`${where}: key must be dotted lowercase`);
    if (!KINDS.includes(action.kind)) problems.push(`${where}: kind must be one of ${KINDS.join(', ')}`);
    if (!Array.isArray(action.routes) || !action.routes.length) problems.push(`${where}: routes is required`);
    for (const route of action.routes || []) {
      if (!ROUTE.test(route)) problems.push(`${where}: route "${route}" must be "<METHOD> /api/..."`);
      if (seenRoutes.has(route)) problems.push(`${where}: route "${route}" is also in ${seenRoutes.get(route)}`);
      seenRoutes.set(route, key);
    }
    for (const field of ['stores', 'derives']) {
      if (!Array.isArray(action[field]) || action[field].some(store => !STORES.includes(store))) {
        problems.push(`${where}: ${field} must list stores from ${STORES.join(', ')}`);
      }
    }
    if (action.kind === 'read' && action.stores?.length) problems.push(`${where}: a read writes no store`);
    if (!REVISIONS.includes(action.revision)) problems.push(`${where}: revision must be one of ${REVISIONS.join(', ')}`);
    if (!Array.isArray(action.invalidates) || action.invalidates.some(part => !UI_PARTS.includes(part))) {
      problems.push(`${where}: invalidates must list UI parts from ${UI_PARTS.join(', ')}`);
    }
    for (const flag of ['batchable', 'destructive', 'audit']) {
      if (typeof action[flag] !== 'boolean') problems.push(`${where}: ${flag} must be true or false`);
    }
    if (action.cost !== null && (typeof action.cost?.api !== 'string' || !action.cost.api)) problems.push(`${where}: cost is null or { api, note }`);
    if (typeof action.summary !== 'string' || !action.summary.trim()) problems.push(`${where}: summary is required`);
  }
  return problems;
}

const problems = validate();
if (problems.length) throw new Error(`Invalid action catalog:\n${problems.join('\n')}`);

const ACTIONS = Object.freeze(CATALOG.actions);
const BY_ROUTE = new Map(Object.entries(ACTIONS).flatMap(([key, action]) => action.routes.map(route => [route, key])));

/** The action key of a route, e.g. actionForRoute('POST', '/api/kua-apps/applications/:applicationId/scopes'). */
function actionForRoute(method, routePath) {
  return BY_ROUTE.get(`${String(method).toUpperCase()} ${routePath}`) || null;
}

module.exports = { ACTIONS, KINDS, STORES, REVISIONS, UI_PARTS, validate, actionForRoute };
