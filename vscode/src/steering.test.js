'use strict';
// Kiro's steering file from the kua skill (#214).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { steeringChange, steeringFrom } = require('./steering');

test('the steering is the kua skill, always included, without its front matter', () => {
  const skill = fs.readFileSync(path.join(__dirname, '..', '..', 'plugins', 'kua', 'skills', 'kua', 'SKILL.md'), 'utf8');
  const steering = steeringFrom(skill);
  assert.match(steering, /^---\ninclusion: always\n---\n/);
  assert.equal(steering.includes('name: kua'), false);
  assert.equal(steering.includes('mcp__plugin_kua_kua__'), false, 'tools are named as Kiro shows them');
  assert.match(steering, /The tools of its `kua` MCP server/);
  for (const rule of ['preview_application_change', 'Never print, log or commit secrets', 'AGENTS_DISABLED']) assert.ok(steering.includes(rule), rule);
  assert.throws(() => steeringFrom('# no front matter'), /front matter/);
});

test('an existing file is reported as the same or different, never silently replaced', () => {
  assert.equal(steeringChange(null, 'a'), 'create');
  assert.equal(steeringChange('a', 'a'), 'same');
  assert.equal(steeringChange('mine', 'a'), 'different');
});
