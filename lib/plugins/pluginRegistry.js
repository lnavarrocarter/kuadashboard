'use strict';
/**
 * lib/plugins/pluginRegistry.js
 * Registry of first-party plugins (#193). A plugin declares a manifest (what it is, what it reads,
 * what it costs); the person turns it on or off in Plugins/Connections. The choice is local to this
 * computer and lives in <dataDir>/plugins.json.
 *
 * A plugin that is off mounts nothing: its routes answer 404 PLUGIN_DISABLED (guard), its evidence
 * adapter is not asked (adapters), and its status is not read. Turning it off never deletes what it
 * configured, so KUApps keeps working and turning it on again finds everything as it was.
 *
 * Plugin definition: { manifest, adapter?, status?(), defaultActive?() }. `defaultActive` only runs
 * once per plugin, to migrate what existed before the registry (see migrate()).
 */

const fs = require('fs');
const path = require('path');
const { CAPABILITY_NAMES, normalizeExtensionManifest } = require('../kua/extensionContract');

const PLUGIN_MANIFEST_VERSION = 1;
const COST_LEVELS = ['free', 'metered'];
const MANIFEST_KEYS = ['manifestVersion', 'id', 'name', 'description', 'version', 'contractVersion', 'category', 'capabilities', 'resourceTypes', 'credentialFields', 'reads', 'cost'];

function pluginError(message, statusCode, code) {
  return Object.assign(new Error(message), { statusCode, code });
}

function text(value, label, max = 240) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw pluginError(`${label} must be a non-empty string of at most ${max} characters`, 400, 'INVALID_PLUGIN_MANIFEST');
  return value.trim();
}

function list(value, label, itemCheck) {
  if (!Array.isArray(value) || value.length > 50) throw pluginError(`${label} must be an array`, 400, 'INVALID_PLUGIN_MANIFEST');
  return value.map(item => itemCheck(item));
}

/** Validates a plugin manifest: closed set of fields, explicit capabilities, declared cost. */
function normalizePluginManifest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw pluginError('Plugin manifest must be an object', 400, 'INVALID_PLUGIN_MANIFEST');
  const unknown = Object.keys(input).find(key => !MANIFEST_KEYS.includes(key));
  if (unknown) throw pluginError(`Plugin manifest contains an unsupported field: ${unknown}`, 400, 'INVALID_PLUGIN_MANIFEST');
  if (input.manifestVersion !== PLUGIN_MANIFEST_VERSION || input.contractVersion !== 1) throw pluginError('Unsupported plugin contract version', 400, 'UNSUPPORTED_PLUGIN_VERSION');
  const id = text(input.id, 'Plugin id', 80).toLowerCase();
  if (!/^[a-z][a-z0-9.-]{1,79}$/.test(id)) throw pluginError('Plugin id has an invalid format', 400, 'INVALID_PLUGIN_MANIFEST');
  const version = text(input.version, 'Plugin version', 80);
  if (!/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(version)) throw pluginError('Plugin version must use semantic versioning', 400, 'INVALID_PLUGIN_MANIFEST');
  if (!input.capabilities || typeof input.capabilities !== 'object' || Array.isArray(input.capabilities)) throw pluginError('Plugin capabilities must be an object', 400, 'INVALID_PLUGIN_MANIFEST');
  const capabilities = {};
  for (const name of CAPABILITY_NAMES) {
    if (typeof input.capabilities[name] !== 'boolean') throw pluginError(`Plugin capability ${name} must be explicitly true or false`, 400, 'INVALID_PLUGIN_MANIFEST');
    capabilities[name] = input.capabilities[name];
  }
  if (Object.keys(input.capabilities).some(name => !CAPABILITY_NAMES.includes(name))) throw pluginError('Plugin capabilities contain an unknown capability', 400, 'INVALID_PLUGIN_MANIFEST');
  const cost = input.cost;
  if (!cost || typeof cost !== 'object' || !COST_LEVELS.includes(cost.level)) throw pluginError('Plugin cost must declare a level (free or metered)', 400, 'INVALID_PLUGIN_MANIFEST');
  return {
    manifestVersion: PLUGIN_MANIFEST_VERSION,
    id,
    name: text(input.name, 'Plugin name', 120),
    description: text(input.description, 'Plugin description', 600),
    version,
    contractVersion: 1,
    category: text(input.category, 'Plugin category', 60),
    capabilities,
    resourceTypes: list(input.resourceTypes, 'Plugin resourceTypes', item => text(item, 'Plugin resource type', 80)),
    credentialFields: list(input.credentialFields, 'Plugin credentialFields', item => {
      if (!item || typeof item !== 'object' || typeof item.secret !== 'boolean') throw pluginError('Plugin credential fields declare name and secret', 400, 'INVALID_PLUGIN_MANIFEST');
      return { name: text(item.name, 'Plugin credential field', 80), secret: item.secret };
    }),
    reads: list(input.reads, 'Plugin reads', item => text(item, 'Plugin read', 200)),
    cost: { level: cost.level, summary: text(cost.summary, 'Plugin cost summary', 300) },
  };
}

function createPluginRegistry({ dataDir = null, plugins = [], defaults = {}, fileSystem = fs } = {}) {
  const file = dataDir ? path.join(dataDir, 'plugins.json') : null;
  const registered = new Map();
  let preferences = { version: 1, active: {} };

  for (const plugin of plugins) {
    const manifest = normalizePluginManifest(plugin.manifest);
    if (registered.has(manifest.id)) throw pluginError(`Duplicate plugin: ${manifest.id}`, 400, 'DUPLICATE_PLUGIN');
    if (plugin.adapter) {
      const extension = normalizeExtensionManifest(plugin.adapter.manifest);
      if (extension.id !== manifest.id) throw pluginError('The evidence adapter must have the id of its plugin', 400, 'INVALID_PLUGIN_MANIFEST');
    }
    registered.set(manifest.id, { ...plugin, manifest });
  }

  try {
    if (file) {
      const stored = JSON.parse(fileSystem.readFileSync(file, 'utf8'));
      if (stored && typeof stored.active === 'object' && !Array.isArray(stored.active)) preferences = { version: 1, active: { ...stored.active } };
    }
  } catch { /* nothing chosen yet */ }

  function persist() {
    if (!file) return;
    fileSystem.mkdirSync(path.dirname(file), { recursive: true });
    fileSystem.writeFileSync(file, JSON.stringify(preferences));
  }

  // First run of a plugin: keeps what the person already had before the registry existed (for
  // example applications that already synced with GitHub), and leaves everything else off.
  function migrate() {
    let changed = false;
    for (const [id, plugin] of registered) {
      if (typeof preferences.active[id] === 'boolean') continue;
      let initial = defaults[id];
      if (typeof initial !== 'boolean') {
        try { initial = plugin.defaultActive ? plugin.defaultActive() === true : false; } catch { initial = false; }
      }
      preferences.active[id] = initial;
      changed = true;
    }
    if (changed) { try { persist(); } catch { /* chosen again next start */ } }
  }
  migrate();

  const find = id => {
    const plugin = registered.get(String(id || ''));
    if (!plugin) throw pluginError('Plugin not found', 404, 'PLUGIN_NOT_FOUND');
    return plugin;
  };
  const isActive = id => registered.has(id) && preferences.active[id] === true;

  async function describe(plugin) {
    const active = isActive(plugin.manifest.id);
    let status = null;
    if (active && plugin.status) {
      try { status = await plugin.status(); } catch (error) { status = { state: 'unavailable', detail: error.message }; }
    }
    return { manifest: structuredClone(plugin.manifest), active, status };
  }

  return {
    isActive,
    manifests: () => [...registered.values()].map(plugin => structuredClone(plugin.manifest)),
    list: () => Promise.all([...registered.values()].map(describe)),
    setActive(id, active) {
      const plugin = find(id);
      if (typeof active !== 'boolean') throw pluginError('active must be true or false', 400, 'INVALID_PLUGIN_STATE');
      preferences.active[plugin.manifest.id] = active;
      persist();
      return describe(plugin);
    },
    /** Evidence adapters of the plugins that are on, read on every query so turning one off applies at once. */
    adapters: () => [...registered.values()].filter(plugin => plugin.adapter && isActive(plugin.manifest.id)).map(plugin => plugin.adapter),
    /** Express middleware: the routes of a plugin that is off answer 404 instead of working. */
    guard: id => (_req, res, next) => (isActive(id)
      ? next()
      : res.status(404).json({ error: 'This plugin is turned off. Turn it on in Plugins/Connections.', code: 'PLUGIN_DISABLED' })),
  };
}

module.exports = { PLUGIN_MANIFEST_VERSION, createPluginRegistry, normalizePluginManifest };
