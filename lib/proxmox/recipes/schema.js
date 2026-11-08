'use strict';

const DEFAULT_CATEGORIES = Object.freeze([
  'data', 'media', 'ai', 'network', 'containers', 'productivity', 'gaming', 'base',
]);

const ROOT_KEYS = Object.freeze(['id', 'name', 'category', 'description', 'machine', 'network', 'install', 'health', 'backup', 'observability']);
const MACHINE_KEYS = Object.freeze(['kind', 'image', 'count', 'cores', 'memory', 'disk', 'storage', 'unprivileged', 'features']);
const NETWORK_KEYS = Object.freeze(['zone', 'dns', 'tailscale']);
const HEALTH_KEYS = Object.freeze(['type', 'port', 'path']);
const BACKUP_KEYS = Object.freeze(['schedule', 'keep']);
const OBSERVABILITY_KEYS = Object.freeze(['logs', 'metrics', 'alerts']);
const INSTALL_KEYS = Object.freeze({
  package: Object.freeze(['type', 'packages', 'manager']),
  service: Object.freeze(['type', 'name', 'enabled', 'state']),
  file: Object.freeze(['type', 'path', 'content', 'mode', 'owner']),
  template: Object.freeze(['type', 'source', 'destination', 'variables', 'mode', 'owner']),
  command: Object.freeze(['type', 'run', 'description']),
});

module.exports = { BACKUP_KEYS, DEFAULT_CATEGORIES, HEALTH_KEYS, INSTALL_KEYS, MACHINE_KEYS, NETWORK_KEYS, OBSERVABILITY_KEYS, ROOT_KEYS };
