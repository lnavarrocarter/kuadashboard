'use strict';

const yaml = require('js-yaml');
const {
  BACKUP_KEYS, DEFAULT_CATEGORIES, HEALTH_KEYS, INSTALL_KEYS, MACHINE_KEYS,
  NETWORK_KEYS, OBSERVABILITY_KEYS, ROOT_KEYS,
} = require('./schema');

function sourceLine(source, path) {
  const wanted = [];
  String(path || '').replace(/([^.[\]]+)|\[(\d+)\]/g, (_, key, index) => wanted.push(key || Number(index)));
  if (!wanted.length) return 1;
  const stack = [];
  const listIndexes = new Map();
  const lines = source.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const indent = /^ */.exec(line)[0].length;
    while (stack.length && stack.at(-1).indent >= indent) stack.pop();
    const parent = stack.at(-1)?.path || [];
    const list = /^\s*-\s*(?:([^:#][^:]*):)?/.exec(line);
    if (list) {
      const parentKey = JSON.stringify(parent);
      const itemIndex = listIndexes.get(parentKey) || 0;
      listIndexes.set(parentKey, itemIndex + 1);
      const itemPath = [...parent, itemIndex];
      stack.push({ indent, path: itemPath });
      if (list[1]) {
        const key = list[1].trim();
        const pathAtKey = [...itemPath, key];
        if (JSON.stringify(pathAtKey) === JSON.stringify(wanted)) return index + 1;
      }
      continue;
    }
    const mapping = /^\s*([^:#][^:]*):(?:\s.*)?$/.exec(line);
    if (!mapping) continue;
    const key = mapping[1].trim();
    const pathAtKey = [...parent, key];
    if (JSON.stringify(pathAtKey) === JSON.stringify(wanted)) return index + 1;
    if (/^\s*[^:#][^:]*:\s*$/.test(line)) stack.push({ indent, path: pathAtKey });
  }
  const last = wanted.at(-1);
  const fallback = lines.findIndex(line => new RegExp(`^\\s*${String(last).replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\s*:`).test(line));
  return fallback >= 0 ? fallback + 1 : 1;
}

function diagnostic(source, severity, code, path, message, line = null) {
  return { severity, code, path: path || '', line: line || sourceLine(source, path), message };
}

function containsTodo(value) {
  if (typeof value === 'string') return /\bTODO\b/i.test(value);
  if (Array.isArray(value)) return value.some(containsTodo);
  if (value && typeof value === 'object') return Object.values(value).some(containsTodo);
  return false;
}

function validateObjectKeys(source, object, allowed, prefix, errors) {
  if (!object || typeof object !== 'object' || Array.isArray(object)) return;
  for (const key of Object.keys(object)) {
    if (!allowed.has(key)) errors.push(diagnostic(source, 'error', 'unknown_field', prefix ? `${prefix}.${key}` : key, `Unknown field: ${key}`));
  }
}

function validateRecipeYaml(source, { categories = DEFAULT_CATEGORIES, storages = null, images = null } = {}) {
  source = String(source ?? '');
  const errors = [];
  const warnings = [];

  const tabLine = source.split(/\r?\n/).findIndex(line => /^ *\t/.test(line) || /\t/.test(line));
  if (tabLine >= 0) errors.push(diagnostic(source, 'error', 'yaml_tab', '', 'Tabs are not allowed in YAML indentation', tabLine + 1));
  const oddIndentLine = source.split(/\r?\n/).findIndex(line => {
    if (!line.trim() || /^\s*#/.test(line)) return false;
    const spaces = /^ */.exec(line)[0].length;
    return spaces > 0 && spaces % 2 === 1;
  });
  if (oddIndentLine >= 0) errors.push(diagnostic(source, 'error', 'yaml_indent', '', 'Indentation must use pairs of spaces', oddIndentLine + 1));
  if (errors.length) return { recipe: null, errors, warnings, valid: false };

  let recipe;
  try {
    recipe = yaml.load(source, { schema: yaml.JSON_SCHEMA, maxAliasCount: 20 });
  } catch (error) {
    const line = Number.isInteger(error.mark?.line) ? Math.min(error.mark.line + 1, Math.max(1, source.split(/\r?\n/).length)) : 1;
    errors.push(diagnostic(source, 'error', 'yaml_syntax', '', error.reason || error.message, line));
    return { recipe: null, errors, warnings, valid: false };
  }
  if (!recipe || typeof recipe !== 'object' || Array.isArray(recipe)) {
    errors.push(diagnostic(source, 'error', 'recipe_object', '', 'A recipe must be a YAML mapping'));
    return { recipe: null, errors, warnings, valid: false };
  }

  validateObjectKeys(source, recipe, new Set(ROOT_KEYS), '', errors);
  for (const field of ['id', 'name', 'category', 'machine']) {
    if (recipe[field] === undefined || recipe[field] === null || recipe[field] === '') {
      errors.push(diagnostic(source, 'error', 'required', field, `${field} is required`));
    }
  }
  if (recipe.id !== undefined && (typeof recipe.id !== 'string' || !/^[a-z0-9][a-z0-9-]{1,62}$/.test(recipe.id))) {
    errors.push(diagnostic(source, 'error', 'invalid_id', 'id', 'id must be a lowercase slug of 2 to 63 characters'));
  }
  if (recipe.name !== undefined && (typeof recipe.name !== 'string' || !recipe.name.trim())) {
    errors.push(diagnostic(source, 'error', 'invalid_name', 'name', 'name must be a non-empty string'));
  }
  if (recipe.category !== undefined && !categories.includes(recipe.category)) {
    errors.push(diagnostic(source, 'error', 'unknown_category', 'category', `Unknown category: ${recipe.category}`));
  }

  const machine = recipe.machine;
  if (machine !== undefined) {
    if (!machine || typeof machine !== 'object' || Array.isArray(machine)) {
      errors.push(diagnostic(source, 'error', 'invalid_machine', 'machine', 'machine must be a mapping'));
    } else {
      validateObjectKeys(source, machine, new Set(MACHINE_KEYS), 'machine', errors);
      if (!['lxc', 'vm'].includes(machine.kind)) errors.push(diagnostic(source, 'error', 'invalid_kind', 'machine.kind', 'machine.kind must be lxc or vm'));
      if (typeof machine.image !== 'string' || !machine.image.trim()) errors.push(diagnostic(source, 'error', 'required', 'machine.image', 'machine.image is required'));
      for (const [field, min, max] of [['count', 1, 100], ['cores', 1, 128], ['memory', 16, 1048576], ['disk', 1, 1048576]]) {
        if (machine[field] !== undefined && (!Number.isInteger(machine[field]) || machine[field] < min || machine[field] > max)) {
          errors.push(diagnostic(source, 'error', 'out_of_range', `machine.${field}`, `machine.${field} must be an integer from ${min} to ${max}`));
        }
      }
      if (machine.unprivileged !== undefined && typeof machine.unprivileged !== 'boolean') errors.push(diagnostic(source, 'error', 'invalid_type', 'machine.unprivileged', 'machine.unprivileged must be true or false'));
      if (machine.kind === 'lxc' && machine.unprivileged === false) warnings.push(diagnostic(source, 'warning', 'privileged_lxc', 'machine.unprivileged', 'Privileged LXC containers increase host risk'));
      if (machine.storage !== undefined && storages && !storages.includes(machine.storage)) errors.push(diagnostic(source, 'error', 'storage_not_found', 'machine.storage', `Storage does not exist on this node: ${machine.storage}`));
      if (machine.image && images && !images.includes(machine.image)) warnings.push(diagnostic(source, 'warning', 'image_not_found', 'machine.image', `Image is not available in the selected storage: ${machine.image}`));
    }
  }

  if (recipe.install !== undefined && !Array.isArray(recipe.install)) errors.push(diagnostic(source, 'error', 'invalid_install', 'install', 'install must be a list of steps'));
  if (Array.isArray(recipe.install)) recipe.install.forEach((step, index) => {
    const path = `install[${index}]`;
    if (!step || typeof step !== 'object' || Array.isArray(step)) {
      errors.push(diagnostic(source, 'error', 'invalid_step', path, 'Install step must be a mapping'));
      return;
    }
    const allowedKeys = INSTALL_KEYS[step.type];
    if (!allowedKeys) {
      errors.push(diagnostic(source, 'error', 'invalid_step_type', `${path}.type`, `Unsupported install step type: ${step.type || '(missing)'}`));
      return;
    }
    validateObjectKeys(source, step, new Set(allowedKeys), path, errors);
    const required = { package: ['packages'], service: ['name'], file: ['path', 'content'], template: ['source', 'destination'], command: ['run'] }[step.type];
    for (const field of required) if (step[field] === undefined || step[field] === '') errors.push(diagnostic(source, 'error', 'required', `${path}.${field}`, `${step.type} step requires ${field}`));
    if (step.type === 'command') warnings.push(diagnostic(source, 'warning', 'command_risk', `${path}.run`, `Command executes arbitrary guest code: ${String(step.run || '')}`));
    if (containsTodo(step)) warnings.push(diagnostic(source, 'warning', 'todo', path, 'Install step contains TODO'));
  });

  if (recipe.backup === undefined || recipe.backup === null) warnings.push(diagnostic(source, 'warning', 'backup_missing', 'backup', 'Recipe has no backup policy'));
  if (recipe.backup !== undefined && recipe.backup !== null) {
    if (typeof recipe.backup !== 'object' || Array.isArray(recipe.backup)) errors.push(diagnostic(source, 'error', 'invalid_backup', 'backup', 'backup must be a mapping'));
    else validateObjectKeys(source, recipe.backup, new Set(BACKUP_KEYS), 'backup', errors);
  }

  if (recipe.network !== undefined) {
    if (!recipe.network || typeof recipe.network !== 'object' || Array.isArray(recipe.network)) errors.push(diagnostic(source, 'error', 'invalid_network', 'network', 'network must be a mapping'));
    else validateObjectKeys(source, recipe.network, new Set(NETWORK_KEYS), 'network', errors);
  }
  if (recipe.health !== undefined) {
    if (!recipe.health || typeof recipe.health !== 'object' || Array.isArray(recipe.health)) errors.push(diagnostic(source, 'error', 'invalid_health', 'health', 'health must be a mapping'));
    else {
      validateObjectKeys(source, recipe.health, new Set(HEALTH_KEYS), 'health', errors);
      if (!['http', 'tcp', 'ssh'].includes(recipe.health.type)) errors.push(diagnostic(source, 'error', 'invalid_health_type', 'health.type', 'health.type must be http, tcp or ssh'));
      if (!Number.isInteger(recipe.health.port) || recipe.health.port < 1 || recipe.health.port > 65535) errors.push(diagnostic(source, 'error', 'invalid_port', 'health.port', 'health.port must be an integer from 1 to 65535'));
      if (recipe.health.type === 'http' && (typeof recipe.health.path !== 'string' || !recipe.health.path.startsWith('/'))) errors.push(diagnostic(source, 'error', 'invalid_health_path', 'health.path', 'HTTP health.path must start with /'));
    }
  }
  if (recipe.observability !== undefined) {
    if (!recipe.observability || typeof recipe.observability !== 'object' || Array.isArray(recipe.observability)) errors.push(diagnostic(source, 'error', 'invalid_observability', 'observability', 'observability must be a mapping'));
    else validateObjectKeys(source, recipe.observability, new Set(OBSERVABILITY_KEYS), 'observability', errors);
  }

  return { recipe, errors, warnings, valid: errors.length === 0 };
}

module.exports = { DEFAULT_CATEGORIES, validateRecipeYaml };
