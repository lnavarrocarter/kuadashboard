'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { generateRecipePlan } = require('./plan');

const lxc = `id: komga
name: Komga
category: media
machine:
  kind: lxc
  image: debian-12
  count: 2
  cores: 2
  memory: 2048
  storage: local-lvm
  unprivileged: true
install:
  - type: command
    run: echo "hello world"
backup:
  schedule: daily
  keep: 7
`;

test('generates a deterministic inert LXC plan with an explicitly risky command', () => {
  const plan = generateRecipePlan(lxc, { firstVmid: 210, now: () => Date.UTC(2026, 0, 1) });
  assert.equal(plan.executable, false);
  assert.equal(plan.requiresConfirmation, true);
  assert.equal(plan.generatedAt, '2026-01-01T00:00:00.000Z');
  assert.deepEqual(plan.steps.map(step => step.id), ['create-210', 'install-210-1', 'backup-210', 'create-211', 'install-211-1', 'backup-211']);
  assert.deepEqual(plan.steps[0].argv.slice(0, 3), ['pct', 'create', '210']);
  const command = plan.steps[1];
  assert.equal(command.risk, 'Arbitrary command: echo "hello world"');
  assert.match(command.display, /echo/);
  assert.equal(command.requiresConfirmation, true);
});

test('generates VM create, image import and cloud-init steps', () => {
  const plan = generateRecipePlan(lxc.replace('kind: lxc', 'kind: vm').replace('count: 2', 'count: 1'), { firstVmid: 300 });
  assert.deepEqual(plan.steps.slice(0, 3).map(step => step.argv.slice(0, 2)), [['qm', 'create'], ['qm', 'importdisk'], ['qm', 'set']]);
});

test('refuses to generate a plan from invalid YAML', () => {
  assert.throws(() => generateRecipePlan(lxc.replace('category: media', 'category: invalid')), error => error.code === 'INVALID_RECIPE' && error.validation.errors.length > 0);
});
