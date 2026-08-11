'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { validateProvider } = require('./envManager');

test('accepts every supported credential provider', () => {
  for (const provider of ['gcp', 'aws', 'vercel', 'generic']) {
    assert.equal(validateProvider(provider), true, `${provider} should be accepted`);
  }
  assert.equal(validateProvider('unknown'), false);
});