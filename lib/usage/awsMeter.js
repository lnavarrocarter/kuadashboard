'use strict';
/**
 * lib/usage/awsMeter.js
 * Measures what KUA spends on AWS without touching each call site: wraps
 * `send` of the AWS SDK v3 base client classes (every @aws-sdk/client-* in
 * KUA extends one of the two copies of the Smithy client), prices each
 * response with lib/usage/awsPricing.js and records priced calls in the
 * usage ledger. Free calls are not recorded.
 *
 * Attribution: an AsyncLocalStorage context set per HTTP request (X-Profile-Id
 * and the feature from the URL) and inherited by the work it starts, such as
 * a log scan; background jobs set their own with runWithUsageContext().
 * Measuring never breaks a call: errors are logged and ignored.
 */

const { AsyncLocalStorage } = require('node:async_hooks');
const { priceCall } = require('./awsPricing');

const context = new AsyncLocalStorage();
const PATCHED = Symbol.for('kua.usageMeter');

/** Feature label of an API path, for the "spent on" breakdown. */
function featureFromPath(pathname = '') {
  const rules = [
    [/\/log-scans/, 'log-scans'],
    [/\/logs-query|\/cloudwatch\/query/, 'logs-insights'],
    [/\/cloudwatch\/log-cache|\/log-intelligence/, 'log-cache'],
    [/\/cloudwatch\/log|\/logs\b/, 'logs'],
    [/\/overview\/insights/, 'overview-insights'],
    [/\/overview/, 'overview'],
    [/\/dashboards?/, 'dashboards'],
    [/\/athena/, 'athena'],
    [/\/lex/, 'lex'],
    [/\/activity|\/metrics/, 'metrics'],
    [/\/observability|\/apm/, 'observability'],
  ];
  return rules.find(([pattern]) => pattern.test(pathname))?.[1] || 'other';
}

/** Express middleware: usage context for everything the request triggers. */
function usageContextMiddleware(req, _res, next) {
  context.run({ profileId: req.get('X-Profile-Id') || null, feature: featureFromPath(req.path) }, next);
}

function runWithUsageContext(store, fn) {
  return context.run({ ...(context.getStore() || {}), ...store }, fn);
}

function baseClients() {
  const bases = [];
  for (const id of ['@smithy/smithy-client', '@smithy/core/client']) {
    try {
      const { Client } = require(id);
      if (Client?.prototype?.send && !bases.includes(Client)) bases.push(Client);
    } catch { /* not installed in this layout */ }
  }
  return bases;
}

/**
 * Wraps `send` of the given base classes (default: the Smithy client copies).
 * @param options.ledger { record(event) }
 */
function installAwsMeter({ ledger, bases = baseClients(), log = console } = {}) {
  const seen = new Set();
  let installed = 0;
  for (const Base of bases) {
    const original = Base.prototype.send;
    if (original[PATCHED]) continue;
    const send = async function meteredSend(command, ...rest) {
      const output = await original.call(this, command, ...rest);
      try {
        // Callback-style calls return undefined: nothing to price.
        const priced = output && priceCall(command, output, seen);
        if (priced) {
          const store = context.getStore() || {};
          let region = null;
          try { region = typeof this.config?.region === 'function' ? await this.config.region() : this.config?.region ?? null; } catch { /* unknown */ }
          ledger.record({ ...priced, provider: 'aws', profileId: store.profileId ?? null, feature: store.feature ?? 'background', region });
        }
      } catch (err) {
        log.warn?.('[usage] could not record a call:', err.message);
      }
      return output;
    };
    send[PATCHED] = true;
    Base.prototype.send = send;
    installed += 1;
  }
  return installed;
}

module.exports = { installAwsMeter, usageContextMiddleware, runWithUsageContext, featureFromPath };
