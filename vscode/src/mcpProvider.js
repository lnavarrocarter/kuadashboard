'use strict';
/**
 * vscode/src/mcpProvider.js
 * The KUA MCP server for the editor's chat (#302), through vscode.lm.registerMcpServerDefinitionProvider.
 *
 * It starts the MCP server of the KUA that is installed (GET /api/system/mcp), not a copy shipped
 * with the extension, so the server and KUA always have the same version. The last launch seen is
 * kept: with KUA closed the server still starts and tells the agent to open KUA, instead of the
 * tools vanishing.
 */

/**
 * The launch as the editor runs it. KUA in development answers `node` from PATH, which an editor
 * started from the dock may not have: the editor's own Node (Electron in Node mode) runs it instead.
 */
function editorLaunch(launch, { execPath = process.execPath, configuredUrl = '' } = {}) {
  if (!launch?.command) return null;
  const env = { ...(launch.env || {}) };
  let command = launch.command;
  if (command === 'node') {
    command = execPath;
    env.ELECTRON_RUN_AS_NODE = '1';
  }
  // A KUA set by hand in the settings is passed on; otherwise the server finds the running one.
  if (configuredUrl) env.KUA_URL = configuredUrl;
  return { command, args: [...(launch.args || [])], env };
}

/**
 * @param vscode           the vscode module (McpStdioServerDefinition)
 * @param currentLaunch    () => { command, args, env, version } | null
 * @param onDidChange      vscode Event fired when KUA starts, stops or changes port or version
 */
function createMcpProvider({ vscode, currentLaunch, onDidChange }) {
  return {
    onDidChangeMcpServerDefinitions: onDidChange,
    provideMcpServerDefinitions() {
      const launch = currentLaunch();
      if (!launch) return [];
      return [new vscode.McpStdioServerDefinition('KUA', launch.command, launch.args, launch.env, launch.version || undefined)];
    },
    resolveMcpServerDefinition(server) {
      return server;
    },
  };
}

module.exports = { createMcpProvider, editorLaunch };
