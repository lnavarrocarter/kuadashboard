'use strict';
/**
 * lib/kua/agentAccess.js
 * Whether AI agents may apply changes to KUApps (#155). Off by default: agents can always read
 * and preview, and the user turns writes on in KUA. Kept in the data directory of this computer;
 * it never travels with an application, sync or the account.
 */

const fs = require('fs');
const path = require('path');

function createAgentAccess({ dataDir, fileSystem = fs }) {
  const file = dataDir ? path.join(dataDir, 'agent-access.json') : null;
  let state = { writes: false, updatedAt: null };
  try { if (file) state = { ...state, ...JSON.parse(fileSystem.readFileSync(file, 'utf8')) }; } catch { /* default: off */ }

  return {
    get: () => ({ writes: state.writes === true, updatedAt: state.updatedAt }),
    writesEnabled: () => state.writes === true,
    set(writes, { now = Date.now() } = {}) {
      state = { writes: writes === true, updatedAt: new Date(now).toISOString() };
      if (file) {
        fileSystem.mkdirSync(path.dirname(file), { recursive: true });
        fileSystem.writeFileSync(file, JSON.stringify(state));
      }
      return this.get();
    },
  };
}

module.exports = { createAgentAccess };
