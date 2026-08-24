'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { ArchitectureDatabase } = require('./database');
const { ArchitectureGraphService, applyGraphOperation, diffGraphs } = require('./graphService');

function graph() {
  return {
    schemaVersion: 1,
    projectId: 'project-a',
    scopes: [],
    sources: [],
    nodes: [
      { id: 'node:api', name: 'API' },
      { id: 'node:worker', name: 'Worker' },
    ],
    edges: [{
      id: 'edge:api-worker', sourceNodeId: 'node:api', targetNodeId: 'node:worker',
      status: 'manual', confidence: 1,
    }],
    groups: [{ id: 'group:app', name: 'Application', nodeIds: ['node:api', 'node:worker'] }],
    layout: {
      'node:api': { x: 10, y: 20, groupId: 'group:app' },
      'node:worker': { x: 200, y: 20, groupId: 'group:app' },
    },
  };
}

test('removing a node cascades through edges, layout and groups without mutating input', () => {
  const original = graph();
  const next = applyGraphOperation(original, { type: 'node.remove', subjectId: 'node:worker' });

  assert.deepEqual(next.nodes.map(node => node.id), ['node:api']);
  assert.deepEqual(next.edges, []);
  assert.equal(next.layout['node:worker'], undefined);
  assert.deepEqual(next.groups[0].nodeIds, ['node:api']);
  assert.equal(original.nodes.length, 2);
  assert.equal(original.edges.length, 1);
});

test('diff reports entity and layout changes independent of object key order', () => {
  const before = graph();
  const after = applyGraphOperation(before, {
    type: 'node.upsert',
    value: { name: 'Public API', id: 'node:api' },
  });
  const positioned = applyGraphOperation(after, {
    type: 'layout.set',
    value: { 'node:api': { y: 20, x: 40, groupId: 'group:app' } },
  });
  const diff = diffGraphs(before, positioned);

  assert.equal(diff.changeCount, 2);
  assert.equal(diff.collections.nodes.updated[0].after.name, 'Public API');
  assert.equal(diff.layout.updated[0].after.x, 40);
});

test('reviews inferred edges without discarding confidence or evidence', () => {
  const inferred = graph();
  inferred.edges[0] = {
    ...inferred.edges[0], status: 'suggested', confidence: 0.7,
    evidence: [{ type: 'cloudformation_reference', intrinsic: 'Ref' }],
  };
  const accepted = applyGraphOperation(inferred, {
    type: 'edge.review', subjectId: 'edge:api-worker', value: { decision: 'accept' },
  });
  assert.equal(accepted.edges[0].status, 'manual');
  assert.equal(accepted.edges[0].confidence, 0.7);
  assert.equal(accepted.edges[0].evidence[0].intrinsic, 'Ref');

  const rejected = applyGraphOperation(inferred, {
    type: 'edge.review', subjectId: 'edge:api-worker', value: { decision: 'reject' },
  });
  assert.equal(rejected.edges[0].status, 'rejected');
});

test('service records operations and reverts through a new immutable snapshot', () => {
  const database = new ArchitectureDatabase({
    filePath: ':memory:',
    now: () => Date.UTC(2026, 7, 24, 15),
  });
  try {
    const service = new ArchitectureGraphService({ database });
    const project = database.createProject({ profileId: 'local:dev', name: 'orders' });
    service.applyOperation(project.id, {
      type: 'node.upsert', value: { id: 'node:api', name: 'Orders API', manual: true },
    }, { expectedRevision: 0, author: 'local:dev', reason: 'Initial design' });
    const baseline = database.createSnapshot(project.id, { name: 'Baseline' });
    service.applyOperation(project.id, {
      type: 'node.upsert', value: { id: 'node:api', name: 'Public Orders API' },
    }, { expectedRevision: 1, author: 'local:dev' });

    const comparison = service.diffSnapshot(project.id, baseline.id);
    assert.equal(comparison.currentRevision, 2);
    assert.equal(comparison.diff.changeCount, 1);
    assert.equal(comparison.diff.collections.nodes.updated[0].before.name, 'Orders API');

    const reverted = service.revertSnapshot(project.id, baseline.id, {
      expectedRevision: 2, author: 'local:dev', reason: 'Restore baseline',
    });
    assert.equal(reverted.graph.revision, 3);
    assert.equal(reverted.graph.document.nodes[0].name, 'Orders API');
    assert.equal(reverted.snapshot.version, 2);
    assert.equal(reverted.snapshot.sourceRevision, 3);
    assert.deepEqual(database.listChanges(project.id).map(change => change.type), [
      'snapshot.revert', 'node.upsert', 'node.upsert',
    ]);
  } finally {
    database.close();
  }
});