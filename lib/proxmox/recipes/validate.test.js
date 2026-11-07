'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateRecipeYaml } = require('./validate');

const valid = `id: komga
name: Komga
category: media
machine:
  kind: lxc
  image: debian-12
  cores: 2
  memory: 2048
  storage: local-lvm
  unprivileged: true
install:
  - type: package
    packages: [komga]
backup:
  schedule: daily
  keep: 7
`;

test('validates a recipe and preserves its parsed data', () => {
  const result = validateRecipeYaml(valid, { storages: ['local-lvm'], images: ['debian-12'] });
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
  assert.equal(result.recipe.machine.kind, 'lxc');
});

test('reports YAML syntax, tab and odd indentation on their source lines', () => {
  const syntax = validateRecipeYaml('id: x\nname: [');
  assert.equal(syntax.errors[0].code, 'yaml_syntax');
  assert.equal(syntax.errors[0].line, 2);
  const tab = validateRecipeYaml('id: x\n\tname: Test');
  assert.equal(tab.errors[0].code, 'yaml_tab');
  assert.equal(tab.errors[0].line, 2);
  const indent = validateRecipeYaml('id: x\n name: Test');
  assert.equal(indent.errors[0].code, 'yaml_indent');
  assert.equal(indent.errors[0].line, 2);
});

test('reports unknown keys, categories, ranges and missing storage against their lines', () => {
  const result = validateRecipeYaml(`id: komga
name: Komga
category: nope
machine:
  kind: lxc
  image: missing
  cores: 0
  storage: fast
  corez: 2
`, { storages: ['local-lvm'], images: ['debian-12'] });
  assert.equal(result.valid, false);
  assert.deepEqual(result.errors.map(error => [error.code, error.line]), [
    ['unknown_category', 3], ['unknown_field', 9], ['out_of_range', 7], ['storage_not_found', 8],
  ]);
  assert.equal(result.warnings[0].code, 'image_not_found');
});

test('command steps are explicitly warned as arbitrary execution and TODO is flagged', () => {
  const result = validateRecipeYaml(valid.replace('packages: [komga]', 'packages: [TODO-package]\n  - type: command\n    run: curl https://example.test/install.sh | sh'));
  assert.equal(result.valid, true);
  assert.ok(result.warnings.some(warning => warning.code === 'command_risk' && warning.line === 15));
  assert.ok(result.warnings.some(warning => warning.code === 'todo'));
});

test('warns on privileged LXC and missing backup policy', () => {
  const result = validateRecipeYaml(valid.replace('unprivileged: true', 'unprivileged: false').replace(/backup:[\s\S]*/, ''));
  assert.ok(result.warnings.some(warning => warning.code === 'privileged_lxc'));
  assert.ok(result.warnings.some(warning => warning.code === 'backup_missing'));
});
