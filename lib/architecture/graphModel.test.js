'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { normalizeGraph } = require('./graphModel');

test('normalizes legacy Kubernetes nodes from their native kind', () => {
  const graph = normalizeGraph({
    nodes: [
      { id: 'kube:deployment', provider: 'kubernetes', resourceType: 'kubernetes', kind: 'Deployment', name: 'api' },
      { id: 'kube:service', provider: 'kubernetes', resourceType: 'kubernetes', kind: 'Service', name: 'api' },
      { id: 'aws:resource', provider: 'aws', resourceType: 'kubernetes', kind: 'legacy-value', name: 'legacy' },
    ],
    edges: [],
  }, 'project:test');

  assert.equal(graph.nodes[0].resourceType, 'deployment');
  assert.equal(graph.nodes[1].resourceType, 'service');
  assert.equal(graph.nodes[2].resourceType, 'kubernetes');
});
