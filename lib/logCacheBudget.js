'use strict';
/**
 * lib/logCacheBudget.js
 * Size budget of the local log cache: KUA_LOG_CACHE_MB when set (an
 * administrator override, not limited by the plan), otherwise the value
 * chosen in KUA, capped by the plan (lib/plans.js). Saved in
 * <KUA data dir>/log-cache.json.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { getPlan, checkCacheBudgetMb, PLANS } = require('./plans');

const MB = 1024 * 1024;
const DEFAULT_MB = 256;

function resolveDataDir() {
  return process.env.KUA_DATA_DIR || path.join(os.homedir(), '.kuadashboard');
}

function createBudgetStore({ dataDir = resolveDataDir(), env = process.env, fileSystem = fs, plan = () => getPlan(env) } = {}) {
  const file = path.join(dataDir, 'log-cache.json');

  function envMb() {
    const mb = Number(env.KUA_LOG_CACHE_MB);
    return Number.isFinite(mb) && mb > 0 ? mb : null;
  }

  function savedMb() {
    try { return Number(JSON.parse(fileSystem.readFileSync(file, 'utf8')).budgetMb) || null; } catch { return null; }
  }

  /** { mb, bytes, source: env | saved | default, maxMb, plan } — the saved value is capped by the plan. */
  function current() {
    const active = plan();
    const fromEnv = envMb();
    if (fromEnv) return { mb: fromEnv, bytes: fromEnv * MB, source: 'env', maxMb: active.limits.logCacheMaxMb, plan: active.plan };
    const saved = savedMb();
    const mb = Math.min(saved || DEFAULT_MB, active.limits.logCacheMaxMb);
    return { mb, bytes: mb * MB, source: saved ? 'saved' : 'default', maxMb: active.limits.logCacheMaxMb, plan: active.plan, capped: !!saved && saved > mb };
  }

  /** Saves a new budget (validated against the plan); returns current(). */
  function save(mb) {
    if (envMb()) throw Object.assign(new Error('The cache budget is set by KUA_LOG_CACHE_MB'), { statusCode: 409 });
    checkCacheBudgetMb(mb, plan());
    fileSystem.mkdirSync(dataDir, { recursive: true });
    fileSystem.writeFileSync(file, JSON.stringify({ budgetMb: Math.round(Number(mb)) }));
    return current();
  }

  /** Budget options to offer: common sizes up to the plan maximum. */
  function choices() {
    const max = plan().limits.logCacheMaxMb;
    const sizes = [256, 512, 1024, 2048, 5120, 10240, 20480];
    return sizes.map(mb => ({ mb, allowed: mb <= max, plan: Object.values(PLANS).find(p => p.limits.logCacheMaxMb >= mb)?.plan || 'team' }));
  }

  return { current, save, choices };
}

let shared = null;
function getBudgetStore() {
  if (!shared) shared = createBudgetStore();
  return shared;
}

module.exports = { createBudgetStore, getBudgetStore, DEFAULT_MB };
