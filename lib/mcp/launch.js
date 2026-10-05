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

/**
 * Windows paths with forward slashes: Node and Windows accept them, and they
 * survive being pasted into bash, where unquoted backslashes are removed
 * (C:\Users\me\… became C:Usersme…).
 */
const portable = (value, platform) => (platform === 'win32' ? String(value).replace(/\\/g, '/') : String(value));

/**
 * No KUA_URL: the MCP server finds the running KUA by itself (lib/mcp/runtime.js),
 * so the same setup works for the installed app and for development.
 *
 * @param options.execPath  process.execPath of the backend (node, or the Electron binary)
 * @param options.electron  process.versions.electron (set when forked by the desktop app)
 * @param options.rootDir   directory that holds server.js (…/app.asar when packaged)
 */
function mcpLaunch({ execPath, electron, rootDir, platform = process.platform }) {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  const packaged = paths.basename(rootDir) === 'app.asar';
  const baseDir = packaged ? paths.join(paths.dirname(rootDir), 'app.asar.unpacked') : rootDir;
  const env = {};
  if (electron) env.ELECTRON_RUN_AS_NODE = '1';
  return {
    packaged,
    // `node` from PATH in development survives Node upgrades better than an absolute path.
    command: electron ? portable(execPath, platform) : 'node',
    args: [portable(paths.join(baseDir, 'mcp', 'server.mjs'), platform)],
    env,
  };
}

module.exports = { mcpLaunch };
