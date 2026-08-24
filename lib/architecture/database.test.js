'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { ArchitectureDatabase } = require('./database');
const { stableNodeId } = require('./graphModel');

function fixture() {
  const database = new ArchitectureDatabase({
    filePath: ':memory:',
    now: () => Date.UTC(2026, 7, 24, 12),
  });
  return { database, close: () => database.close() };
}

test('stores an editable graph while keeping snapshots immutable', () => {
  const subject = fixture();
  try {
    const project = subject.database.createProject({
      profileId: 'local:dev',
      name: 'orders-platform',
      description: 'Multi-region orders architecture',
    });
    const lambdaId = stableNodeId({
      provider: 'aws', accountId: '123456789012', region: 'us-east-1',
      resourceType: 'lambda', nativeId: 'orders-handler',
    });
    const queueId = stableNodeId({
      provider: 'aws', accountId: '123456789012', region: 'us-east-1',
      resourceType: 'sqs', nativeId: 'orders-queue',
    });
    const saved = subject.database.saveGraph(project.id, {
      projectId: project.id,
      nodes: [
        { id: lambdaId, provider: 'aws', resourceType: 'lambda', name: 'orders-handler' },
        { id: queueId, provider: 'aws', resourceType: 'sqs', name: 'orders-queue' },
      ],
      edges: [{
        id: 'orders-consumer', sourceNodeId: queueId, targetNodeId: lambdaId,
        relationType: 'consumed_by', status: 'automatic', confidence: 0.96,
        evidence: [{ type: 'lambda_event_source_mapping', source: 'aws-api' }],
      }],
      layout: { [lambdaId]: { x: 420, y: 180 } },
    }, { expectedRevision: 0 });
    const snapshot = subject.database.createSnapshot(project.id, { name: 'Initial discovery' });

    saved.document.nodes.push({ id: 'manual:api', name: 'Public API', manual: true });
    subject.database.saveGraph(project.id, saved.document, { expectedRevision: 1 });

    assert.equal(subject.database.health().schemaVersion, 1);
    assert.equal(subject.database.getGraph(project.id).revision, 2);
    assert.equal(subject.database.getGraph(project.id).document.nodes.length, 3);
    assert.equal(subject.database.getSnapshot(project.id, snapshot.id).document.nodes.length, 2);
    assert.equal(subject.database.listSnapshots(project.id)[0].version, 1);
  } finally {
    subject.close();
  }
});

test('rejects stale revisions and edges that reference unknown nodes', () => {
  const subject = fixture();
  try {
    const project = subject.database.createProject({ profileId: 'local:dev', name: 'payments' });
    assert.throws(() => subject.database.saveGraph(project.id, {
      projectId: project.id,
      nodes: [{ id: 'node:a', name: 'A' }],
      edges: [{ id: 'edge:a-b', sourceNodeId: 'node:a', targetNodeId: 'node:b' }],
    }, { expectedRevision: 0 }), /unknown node/);
    subject.database.saveGraph(project.id, { projectId: project.id }, { expectedRevision: 0 });
    assert.throws(
      () => subject.database.saveGraph(project.id, { projectId: project.id }, { expectedRevision: 0 }),
      /revision conflict/,
    );
  } finally {
    subject.close();
  }
});

test('reports corrupt stored graph documents without returning partial data', () => {
  const subject = fixture();
  try {
    const project = subject.database.createProject({ profileId: 'local:dev', name: 'catalog' });
    subject.database.db.prepare(`
      UPDATE architecture_graphs SET document_json = ? WHERE project_id = ?
    `).run('{invalid-json', project.id);

    assert.throws(
      () => subject.database.getGraph(project.id),
      error => error.statusCode === 500 && error.message === 'Stored architecture graph is invalid',
    );
  } finally {
    subject.close();
  }
});