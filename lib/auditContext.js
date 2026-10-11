'use strict';
/**
 * lib/auditContext.js
 * Who an audit entry comes from, set per HTTP request: the KUA interface or an
 * AI agent through MCP (X-KUA-Actor: mcp). Work that runs outside a request
 * (schedulers, startup) is the system. lib/auditLog.js adds the person: the
 * operating system user and the linked KUA account, when there is one.
 */

const { AsyncLocalStorage } = require('node:async_hooks');

const storage = new AsyncLocalStorage();

function auditContextMiddleware(req, _res, next) {
  const actor = String(req.get?.('X-KUA-Actor') || '').toLowerCase() === 'mcp' ? 'mcp' : 'ui';
  storage.run({ actor }, next);
}

/** 'ui' | 'mcp' | 'system' */
function currentActorKind() {
  return storage.getStore()?.actor || 'system';
}

function runAs(actor, fn) {
  return storage.run({ actor }, fn);
}

module.exports = { auditContextMiddleware, currentActorKind, runAs };
