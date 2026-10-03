'use strict';
/**
 * lib/mcp/launch.js
 * How an MCP client should start the KUA MCP server on this machine, so the
 * UI can show ready-to-paste setup for Claude Code, Codex and others.
 *
 * - From the repository (plain Node): `node <repo>/mcp/server.mjs`.
 * - From the installed app: the KuaDashboard executable in Node mode
 *   (ELECTRON_RUN_AS_NODE=1) on the unpacked copy of mcp/server.mjs, so no
 *   separate Node install is needed. electron-builder unpacks mcp/** and the
 *   modules it imports (asarUnpack in package.json).
 */

const path = require('node:path');

const DEFAULT_PORT = 7190;

/**
 * @param options.execPath  process.execPath of the backend (node, or the Electron binary)
 * @param options.electron  process.versions.electron (set when forked by the desktop app)
 * @param options.rootDir   directory that holds server.js (…/app.asar when packaged)
 * @param options.port      port the backend listens on
 */
function mcpLaunch({ execPath, electron, rootDir, port = DEFAULT_PORT, platform = process.platform }) {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  const packaged = paths.basename(rootDir) === 'app.asar';
  const baseDir = packaged ? paths.join(paths.dirname(rootDir), 'app.asar.unpacked') : rootDir;
  const env = {};
  if (electron) env.ELECTRON_RUN_AS_NODE = '1';
  if (Number(port) !== DEFAULT_PORT) env.KUA_URL = `http://localhost:${port}`;
  return {
    packaged,
    // `node` from PATH in development survives Node upgrades better than an absolute path.
    command: electron ? execPath : 'node',
    args: [paths.join(baseDir, 'mcp', 'server.mjs')],
    env,
  };
}

module.exports = { mcpLaunch };
