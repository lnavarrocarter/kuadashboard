'use strict';
/**
 * lib/mcp/claudeDesktop.js
 * "Install in Claude Desktop" (#306): opens kua.mcpb, the Claude Desktop extension that ships
 * with KUA (mcpb/, built before packaging), with the program the system uses for .mcpb files.
 * Claude Desktop then shows its own install dialog: KUA never edits its configuration.
 */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { pluginSourceDir } = require('./claudePlugin');

class DesktopError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

/** dist/kua.mcpb next to the app (unpacked) or in the repository after `npm run build:mcpb`. */
function mcpbPath(rootDir) {
  return path.join(pluginSourceDir(rootDir), 'mcpb', 'dist', 'kua.mcpb');
}

/** The command that opens a file with its default program on each system. */
function openCommand(file, platform = process.platform) {
  if (platform === 'darwin') return { command: 'open', args: [file] };
  // explorer.exe opens a file with the program registered for its extension, without a shell.
  if (platform === 'win32') return { command: 'explorer.exe', args: [file] };
  return { command: 'xdg-open', args: [file] };
}

/** Opens kua.mcpb; Claude Desktop installs it. */
async function openMcpb({ rootDir, platform = process.platform, spawnImpl = spawn, exists = fs.existsSync } = {}) {
  const file = mcpbPath(rootDir);
  if (!exists(file)) throw new DesktopError('This KUA does not include the Claude Desktop extension. Build it with npm run build:mcpb.', 'MCPB_MISSING');
  const { command, args } = openCommand(file, platform);
  return new Promise((resolve, reject) => {
    let child;
    try { child = spawnImpl(command, args, { detached: true, stdio: 'ignore', windowsHide: true }); } catch (err) { reject(err); return; }
    child.on('error', err => reject(new DesktopError(`Could not open ${path.basename(file)}: ${err.message}`, 'OPEN_FAILED')));
    // The program keeps running (it is Claude Desktop): only a failure to start is an error.
    child.on('spawn', () => { child.unref(); resolve({ client: 'claudeDesktop', name: 'kua', mode: 'mcpb', file }); });
  });
}

module.exports = { DesktopError, mcpbPath, openCommand, openMcpb };
