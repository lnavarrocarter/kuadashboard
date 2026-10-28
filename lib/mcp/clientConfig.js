'use strict';
/**
 * lib/mcp/clientConfig.js
 * Agents configured by a JSON file instead of a CLI (#307): Gemini CLI, Cursor, Windsurf and Kiro. Each
 * keeps its MCP servers under `mcpServers` in a file of the user's home; KUA adds, replaces or
 * removes only its own `kua` entry and leaves everything else in the file as it was.
 *
 *   gemini    ~/.gemini/settings.json             (the CLI's whole settings file)
 *   cursor    ~/.cursor/mcp.json
 *   windsurf  ~/.codeium/windsurf/mcp_config.json
 *   kiro      ~/.kiro/settings/mcp.json           (read by the Kiro IDE and kiro-cli; $KIRO_HOME moves ~/.kiro)
 *
 * A file that is not valid JSON is never rewritten: the user fixes it first, so nothing is lost.
 * Writes go to a temporary file renamed over the original. No cloud call, no network.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const NAME = 'kua';
const FILE_CLIENTS = {
  gemini: ['.gemini', 'settings.json'],
  cursor: ['.cursor', 'mcp.json'],
  windsurf: ['.codeium', 'windsurf', 'mcp_config.json'],
  kiro: ['.kiro', 'settings', 'mcp.json'],
};

class ConfigError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

function configFile(client, { home = os.homedir(), env = process.env } = {}) {
  const parts = FILE_CLIENTS[client];
  if (!parts) throw new ConfigError(`Unknown client "${client}".`, 'UNKNOWN_CLIENT');
  if (client === 'kiro' && env.KIRO_HOME) return path.join(env.KIRO_HOME, ...parts.slice(1));
  return path.join(home, ...parts);
}

function readConfig(file, fileSystem) {
  let text;
  try { text = fileSystem.readFileSync(file, 'utf8'); } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
  if (!text.trim()) return {};
  let value;
  try { value = JSON.parse(text); } catch {
    throw new ConfigError(`${file} is not valid JSON; fix it first so nothing in it is lost.`, 'INVALID_CONFIG');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ConfigError(`${file} does not hold a JSON object.`, 'INVALID_CONFIG');
  if (value.mcpServers !== undefined && (typeof value.mcpServers !== 'object' || value.mcpServers === null || Array.isArray(value.mcpServers))) {
    throw new ConfigError(`"mcpServers" in ${file} is not an object.`, 'INVALID_CONFIG');
  }
  return value;
}

function writeConfig(file, value, fileSystem) {
  fileSystem.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.kua-${process.pid}.tmp`;
  fileSystem.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fileSystem.renameSync(temporary, file);
}

/** The server entry the agent starts: KUA's launch, with env only when it has any. */
function serverEntry({ command, args = [], env = {} }) {
  return { command, args: [...args], ...(Object.keys(env).length ? { env: { ...env } } : {}) };
}

/** Adds or replaces `kua` in the agent's file. */
function installInConfig({ client, launch, home, fileSystem = fs }) {
  const file = configFile(client, { home });
  const config = readConfig(file, fileSystem);
  writeConfig(file, { ...config, mcpServers: { ...(config.mcpServers || {}), [NAME]: serverEntry(launch) } }, fileSystem);
  return { client, name: NAME, mode: 'config', file };
}

/** Removes only `kua`; a file KUA never touched stays untouched. */
function uninstallFromConfig({ client, home, fileSystem = fs }) {
  const file = configFile(client, { home });
  const config = readConfig(file, fileSystem);
  if (!config.mcpServers || !(NAME in config.mcpServers)) return { client, name: NAME, removed: false, file };
  const { [NAME]: _removed, ...others } = config.mcpServers;
  writeConfig(file, { ...config, mcpServers: others }, fileSystem);
  return { client, name: NAME, removed: true, file };
}

/** Per agent: its file, whether the agent seems installed (its folder exists) and whether KUA is in it. */
function configStatus({ home, fileSystem = fs } = {}) {
  return Object.keys(FILE_CLIENTS).map(client => {
    const file = configFile(client, { home });
    let added = false;
    let error = null;
    try { added = NAME in (readConfig(file, fileSystem).mcpServers || {}); } catch (err) { error = err.code || 'UNREADABLE'; }
    return { client, file, present: fileSystem.existsSync(path.dirname(file)), added, ...(error ? { error } : {}) };
  });
}

module.exports = { ConfigError, FILE_CLIENTS, configFile, configStatus, installInConfig, serverEntry, uninstallFromConfig };
