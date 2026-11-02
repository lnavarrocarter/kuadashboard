'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openLinkTarget } = require('./openLink');

test('kua://open goes to the backend with the view parameters only', () => {
  assert.deepEqual(openLinkTarget('kua://open', 'http://localhost:7190'), { url: 'http://localhost:7190/', hasView: false });
  assert.deepEqual(openLinkTarget('kua://open?view=kuapps&app=a%201&tab=review&evil=1', 'http://localhost:7190/'), {
    url: 'http://localhost:7190/?view=kuapps&app=a+1&tab=review', hasView: true,
  });
  assert.equal(openLinkTarget('kua://vercel/callback?code=1', 'http://localhost:7190'), null);
  assert.equal(openLinkTarget('https://open?view=aws', 'http://localhost:7190'), null);
  assert.equal(openLinkTarget('kua://open?view=' + 'x'.repeat(600), 'http://localhost:7190').hasView, false);
});
