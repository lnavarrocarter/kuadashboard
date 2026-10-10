'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createAgentPlanGuard } = require('./agentPlanGuard');
const { PLANS } = require('./plans');

function run(guard, { actor, url = '/api/kua-apps/applications' }) {
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  let passed = false;
  guard({ originalUrl: url, headers: actor ? { 'x-kua-actor': actor } : {} }, res, () => { passed = true; });
  return { passed, res };
}

test('agents need Pro or Team; the UI is never affected', () => {
  const free = createAgentPlanGuard({ plan: () => PLANS.free });
  const refused = run(free, { actor: 'mcp' });
  assert.equal(refused.passed, false);
  assert.equal(refused.res.statusCode, 403);
  assert.deepEqual([refused.res.body.code, refused.res.body.required, refused.res.body.feature], ['PLAN_REQUIRED', 'pro', 'agents']);
  assert.equal(run(free, {}).passed, true, 'requests from the UI pass');
  assert.equal(run(free, { actor: 'mcp', url: '/api/health' }).passed, true, 'discovery stays open');
  assert.equal(run(createAgentPlanGuard({ plan: () => PLANS.pro }), { actor: 'mcp' }).passed, true);
});
