const test = require('node:test');
const assert = require('node:assert/strict');
const { contextMismatch, requireExpectedContext } = require('./kubeContextGuard');

function fakeRes() {
  return {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('accepts requests without an expected context for older callers', () => {
  assert.equal(contextMismatch(undefined, 'prod'), null);
  assert.equal(contextMismatch('', 'prod'), null);
});

test('accepts a request confirmed for the active context', () => {
  assert.equal(contextMismatch('dev', 'dev'), null);
});

test('rejects a request confirmed for another context', () => {
  const res = fakeRes();
  const ok = requireExpectedContext({ body: { expectedContext: 'dev' } }, res, 'prod');
  assert.equal(ok, false);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'KUBE_CONTEXT_CHANGED');
  assert.equal(res.body.currentContext, 'prod');
  assert.match(res.body.error, /Nothing was changed/);
});
