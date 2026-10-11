'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PLANS, FREE_LIMITS_FROM, getPlan, requireFeature, checkKuaAppLimit } = require('./plans');

const plan = name => ({ ...PLANS[name], source: 'test' });

test('KUA_PLAN overrides the plan in development only; the packaged app ignores it', () => {
  assert.equal(getPlan({ KUA_PLAN: 'pro' }).plan, 'pro');
  assert.equal(getPlan({ KUA_PLAN: 'pro', KUA_PACKAGED: '1' }).plan, 'free');
  // The packaged app takes the plan from the KUA account, never from the variable.
  assert.deepEqual(['plan', 'source'].map(key => getPlan({ KUA_PLAN: 'team', KUA_PACKAGED: '1' }, { account: () => 'pro' })[key]), ['pro', 'account']);
});

test('Free keeps local features and leaves agents, scheduled work and more KUApps to Pro', () => {
  assert.equal(PLANS.free.features.agents, false);
  assert.equal(PLANS.free.features.scheduledTasks, false);
  assert.equal(PLANS.free.limits.kuaApps, 3);
  for (const name of ['pro', 'team']) {
    assert.equal(PLANS[name].features.agents, true, name);
    assert.equal(PLANS[name].features.scheduledTasks, true, name);
    assert.equal(PLANS[name].limits.kuaApps, null, name);
  }
});

test('a missing feature answers PLAN_REQUIRED with the plan that has it', () => {
  assert.throws(() => requireFeature('agents', 'Agents need Pro', plan('free')), error => error.code === 'PLAN_REQUIRED' && error.required === 'pro' && error.statusCode === 403);
  assert.doesNotThrow(() => requireFeature('agents', 'Agents need Pro', plan('pro')));
});

test('the KUApps limit counts existing applications and only refuses new ones', () => {
  assert.doesNotThrow(() => checkKuaAppLimit(2, plan('free')));
  assert.throws(() => checkKuaAppLimit(3, plan('free')), error => error.code === 'PLAN_REQUIRED' && error.limit === 3 && error.current === 3);
  assert.throws(() => checkKuaAppLimit(5, plan('free')), error => error.current === 5);
  assert.doesNotThrow(() => checkKuaAppLimit(500, plan('pro')));
});

test('forwarding the audit log to an external destination is part of Team', () => {
  assert.deepEqual(['free', 'pro', 'team'].map(name => PLANS[name].features.auditForwarding), [false, false, true]);
});

test('saving path filters on the canvas is part of Pro and Team; isolating a path stays local on Free', () => {
  assert.deepEqual(['free', 'pro', 'team'].map(name => PLANS[name].features.savedPathFilters), [false, true, true]);
});

test('Free keeps agents, scheduled work and unlimited KUApps until the date of the terms', () => {
  const before = getPlan({}, { now: Date.parse(FREE_LIMITS_FROM) - 1 });
  assert.deepEqual([before.features.agents, before.features.scheduledTasks, before.limits.kuaApps], [true, true, null]);
  assert.deepEqual(before.transition, { effectiveAt: FREE_LIMITS_FROM, features: ['agents', 'scheduledTasks'], limits: { kuaApps: 3 } });
  assert.equal(before.features.advisor, false, 'what Free never had does not change');

  const after = getPlan({}, { now: Date.parse(FREE_LIMITS_FROM) });
  assert.deepEqual([after.features.agents, after.features.scheduledTasks, after.limits.kuaApps], [false, false, 3]);
  assert.equal(after.transition, undefined);

  // A linked Free account follows the same date; KUA_PLAN=free tries the final limits now.
  assert.equal(getPlan({}, { account: () => 'free', now: Date.parse(FREE_LIMITS_FROM) - 1 }).limits.kuaApps, null);
  assert.equal(getPlan({ KUA_PLAN: 'free' }, { now: Date.parse(FREE_LIMITS_FROM) - 1 }).limits.kuaApps, 3);
});
