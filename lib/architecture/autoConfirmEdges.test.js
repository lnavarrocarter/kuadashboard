'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { autoConfirmDeclarativeEdges } = require('./graphService');

test('auto-confirms relationships whose evidence is declared by the resource itself', () => {
  const edges = autoConfirmDeclarativeEdges([
    // An Ingress naming its Service, and a selector match: both are facts read from the spec.
    { id: 'a', status: 'suggested', confidence: 1 },
    { id: 'b', status: 'suggested', confidence: 0.95 },
    // Inferred from naming, so still a guess a human should confirm.
    { id: 'c', status: 'suggested', confidence: 0.9 },
    { id: 'd', status: 'suggested', confidence: 0.75 },
  ]);

  assert.deepEqual(edges.map(edge => edge.status), ['automatic', 'automatic', 'suggested', 'suggested']);
});

test('never overrides a decision a human already made', () => {
  const edges = autoConfirmDeclarativeEdges([
    { id: 'a', status: 'rejected', confidence: 1 },
    { id: 'b', status: 'manual', confidence: 1 },
    { id: 'c', status: 'automatic', confidence: 1 },
  ]);

  assert.deepEqual(edges.map(edge => edge.status), ['rejected', 'manual', 'automatic']);
});

test('treats a missing confidence as needing review rather than assuming it is a fact', () => {
  const edges = autoConfirmDeclarativeEdges([{ id: 'a', status: 'suggested' }]);
  assert.equal(edges[0].status, 'suggested');
});
