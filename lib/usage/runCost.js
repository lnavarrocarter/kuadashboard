'use strict';
/**
 * lib/usage/runCost.js
 * What one run of a background task cost, per cloud (#353). The ledger (lib/usage/ledger.js)
 * prices every billed call; this adds each one to the task run it happened in.
 *
 * Attribution follows lib/usage/awsMeter.js: an AsyncLocalStorage context opened around the run
 * (trackRunCost) and inherited by the work it starts, so runs that overlap never mix. A run that
 * pauses and resumes (a log scan) keeps adding to the same task id until takeRunCost() reads it.
 */

const { AsyncLocalStorage } = require('node:async_hooks');

const context = new AsyncLocalStorage();
const totals = new Map(); // taskId → { provider → { calls, usd, potentialUsd } }

/** Runs fn with its priced calls counted for taskId. */
function trackRunCost(taskId, fn) {
  return context.run({ taskId: String(taskId) }, fn);
}

/** Called by the ledger for every priced call; a no-op outside a tracked run. */
function addRunCost({ provider = 'aws', usd = 0, potentialUsd = 0 } = {}) {
  const store = context.getStore();
  if (!store) return;
  const byProvider = totals.get(store.taskId) || {};
  const row = byProvider[provider] || { calls: 0, usd: 0, potentialUsd: 0 };
  row.calls += 1;
  row.usd += Number(usd) || 0;
  row.potentialUsd += Number(potentialUsd) || 0;
  byProvider[provider] = row;
  totals.set(store.taskId, byProvider);
}

/** The cost of the run that just ended, by provider, or null when it made no priced call. */
function takeRunCost(taskId) {
  const byProvider = totals.get(String(taskId));
  totals.delete(String(taskId));
  if (!byProvider) return null;
  const round = value => Math.round(value * 1e8) / 1e8;
  return Object.fromEntries(Object.entries(byProvider).map(([provider, row]) => [provider, { calls: row.calls, usd: round(row.usd), potentialUsd: round(row.potentialUsd) }]));
}

module.exports = { trackRunCost, addRunCost, takeRunCost };
