'use strict';
/**
 * lib/mcp/claudePlugin.js
 * The Claude Code plugin of KUA (plugins/kua, #305) as a local marketplace on this computer, so
 * "Install in Claude Code" installs it without downloading anything from GitHub.
 *
 * KUA copies the marketplace (.claude-plugin/marketplace.json) and the plugin (plugins/kua) that
 * ship with it to ~/.kuadashboard/claude-plugin. Claude Code reads a plugin of a local marketplace
 * in place, so when a newer KUA copies its plugin there, Claude Code uses it at its next session:
 * plugin and KUA keep the same version.
 */

const fs = require('node:fs');
const path = require('node:path');
const { runDir } = require('./runtime');

const MARKETPLACE = 'kuadashboard';
const PLUGIN = 'kua';

/** Where the installed app keeps unpacked files (next to app.asar), or the repository itself. */
function pluginSourceDir(rootDir) {
  return path.basename(rootDir) === 'app.asar' ? path.join(path.dirname(rootDir), 'app.asar.unpacked') : rootDir;
}

/** ~/.kuadashboard/claude-plugin (next to the run folder, so KUA_RUN_DIR moves it in tests). */
function claudePluginDir({ dir = runDir() } = {}) {
  return path.join(path.dirname(dir), 'claude-plugin');
}

/** Copies the marketplace and the plugin from `sourceDir` to `targetDir`; returns targetDir. */
function syncClaudePlugin({ sourceDir, targetDir = claudePluginDir(), fileSystem = fs }) {
  const marketplace = path.join(sourceDir, '.claude-plugin', 'marketplace.json');
  const plugin = path.join(sourceDir, 'plugins', PLUGIN);
  if (!fileSystem.existsSync(marketplace) || !fileSystem.existsSync(path.join(plugin, '.claude-plugin', 'plugin.json'))) {
    throw Object.assign(new Error('This KUA does not include its Claude Code plugin.'), { code: 'PLUGIN_MISSING' });
  }
  fileSystem.mkdirSync(path.join(targetDir, '.claude-plugin'), { recursive: true });
  fileSystem.copyFileSync(marketplace, path.join(targetDir, '.claude-plugin', 'marketplace.json'));
  // Only KUA's own folder is replaced, so files removed from a newer plugin do not linger.
  const targetPlugin = path.join(targetDir, 'plugins', PLUGIN);
  fileSystem.rmSync(targetPlugin, { recursive: true, force: true });
  fileSystem.cpSync(plugin, targetPlugin, { recursive: true });
  return targetDir;
}

module.exports = { MARKETPLACE, PLUGIN, claudePluginDir, pluginSourceDir, syncClaudePlugin };
