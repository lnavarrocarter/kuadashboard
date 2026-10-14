'use strict';
/**
 * lib/kua/agentAccess.js
 * What AI agents (MCP) may do on this KUA:
 *   - enabled: whether KUA answers agents at all. On by default; the user turns it off from the
 *     tray panel or KUA → Help & Options → AI agents, and every agent request is refused.
 *   - writes: whether agents may apply changes to KUApps (#155). Off by default: agents can
 *     always read and preview, and the user turns writes on in KUA.
 * Kept in the data directory of this computer; it never travels with an application, sync or
 * the account. When the last agent request arrived is kept in memory only.
 */

const fs = require('fs');
const path = require('path');

function createAgentAccess({ dataDir, fileSystem = fs }) {
  const file = dataDir ? path.join(dataDir, 'agent-access.json') : null;
  let state = { enabled: true, writes: false, updatedAt: null };
  let lastRequestAt = null;
  try { if (file) state = { ...state, ...JSON.parse(fileSystem.readFileSync(file, 'utf8')) }; } catch { /* default: on, read-only */ }

  function save() {
    if (!file) return;
    fileSystem.mkdirSync(path.dirname(file), { recursive: true });
    fileSystem.writeFileSync(file, JSON.stringify(state));
  }

  return {
    get: () => ({ enabled: state.enabled !== false, writes: state.writes === true, updatedAt: state.updatedAt, lastRequestAt }),
    enabled: () => state.enabled !== false,
    writesEnabled: () => state.enabled !== false && state.writes === true,
    /**
     * set(true|false) changes writes (as before); set({ enabled, writes }) changes only the
     * fields it names.
     */
    set(changes, { now = Date.now() } = {}) {
      const next = typeof changes === 'boolean' ? { writes: changes } : (changes || {});
      if ('enabled' in next) state.enabled = next.enabled === true;
      if ('writes' in next) state.writes = next.writes === true;
      state.updatedAt = new Date(now).toISOString();
      save();
      return this.get();
    },
    recordRequest({ now = Date.now() } = {}) {
      lastRequestAt = new Date(now).toISOString();
    },
  };
}

module.exports = { createAgentAccess };
