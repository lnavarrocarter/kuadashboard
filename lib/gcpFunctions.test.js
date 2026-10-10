'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseFunctionName, functionParamsError, mapFunction, functionLogFilter } = require('./gcpFunctions');

test('reads the region from segment 3 and the name from segment 5', () => {
  assert.deepEqual(parseFunctionName('projects/p/locations/us-central1/functions/terminalApi'), {
    project: 'p', location: 'us-central1', name: 'terminalApi', fullName: 'projects/p/locations/us-central1/functions/terminalApi',
  });
  assert.equal(parseFunctionName('terminalApi'), null);
  assert.equal(parseFunctionName('projects/p/locations/us-central1/services/x'), null);
});

test('list rows keep the real region and the full name for homonyms', () => {
  const a = mapFunction({ name: 'projects/p/locations/us-central1/functions/api', state: 'ACTIVE', serviceConfig: { uri: 'https://a' } });
  const b = mapFunction({ name: 'projects/p/locations/europe-west1/functions/api', state: 'ACTIVE', eventTrigger: { eventType: 'x' } });
  assert.equal(a.location, 'us-central1');
  assert.equal(b.location, 'europe-west1');
  assert.equal(a.name, b.name);
  assert.notEqual(a.fullName, b.fullName);
  assert.equal(a.trigger, 'HTTPS');
  assert.equal(b.trigger, 'EVENT');
});

test('a function name sent as location is rejected before any request', () => {
  assert.match(functionParamsError({ location: 'terminalApi', name: 'terminalApi' }), /Invalid function region/);
  assert.equal(functionParamsError({ location: 'us-central1', name: 'terminalApi' }), null);
  assert.equal(functionParamsError({ location: 'northamerica-northeast1', name: 'fn_1' }), null);
  assert.match(functionParamsError({ location: 'us-central1', name: 'a"b' }), /Invalid function name/);
});

test('log filter is pinned to the function region', () => {
  const filter = functionLogFilter({ location: 'europe-west1', name: 'api', since: '2026-10-10T00:00:00Z' });
  assert.match(filter, /resource\.labels\.location="europe-west1"/);
  assert.match(filter, /resource\.labels\.region="europe-west1"/);
});
