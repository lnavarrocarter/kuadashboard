'use strict';
/**
 * vscode/src/kuaStatus.js
 * The KUA running on this computer, as the extension shows it (#302): where it listens, its
 * version and plan, whether AI agents are allowed, and how its MCP server is started.
 *
 * Found like the MCP server finds it (lib/mcp/runtime.js: ~/.kuadashboard/run/, any port), or at
 * the `kua.url` setting. Only GETs to the local API; nothing leaves this computer.
 */

const runtime = require('../../lib/mcp/runtime');

function createKuaStatus({
  configuredUrl = () => '',
  resolveKua = runtime.resolveKua,
  listInstances = runtime.listInstances,
  fetchImpl = globalThis.fetch,
  timeoutMs = 2000,
} = {}) {
  async function getJson(base, path) {
    try {
      const response = await fetchImpl(new URL(path, base), { signal: AbortSignal.timeout(timeoutMs) });
      return response.ok ? await response.json() : null;
    } catch { return null; }
  }

  return {
    /** { reachable, url, version, source, packaged, plan, agents, launch } — a field it could not read is null. */
    async read() {
      const url = String(configuredUrl() || '').trim();
      const kua = await resolveKua({ env: url ? { KUA_URL: url } : {} });
      const instance = listInstances().find(item => item.url === kua.url) || null;
      const base = { reachable: kua.reachable, url: kua.url, version: kua.version || null, source: kua.source, packaged: instance ? instance.packaged === true : null };
      if (!kua.reachable) return { ...base, plan: null, agents: null, launch: null };
      const [plan, agents, launch] = await Promise.all([
        getJson(kua.url, '/api/system/plan'),
        getJson(kua.url, '/api/kua-apps/agent-access'),
        getJson(kua.url, '/api/system/mcp'),
      ]);
      return {
        ...base,
        plan: plan?.plan || null,
        agents: agents ? { enabled: agents.enabled !== false, writes: agents.writes === true } : null,
        launch: launch?.command ? { command: launch.command, args: launch.args || [], env: launch.env || {} } : null,
      };
    },
  };
}

module.exports = { createKuaStatus };
