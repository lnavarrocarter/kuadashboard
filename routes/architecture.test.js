'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const express = require('express');
const { ArchitectureDatabase } = require('../lib/architecture/database');
const { createArchitectureRouter } = require('./architecture');

async function fixture() {
  const database = new ArchitectureDatabase({ filePath: ':memory:' });
  const auditEvents = [];
  const app = express();
  app.use(express.json());
  app.use('/api/architecture', createArchitectureRouter({
    database,
    auditLog: { log(event) { auditEvents.push(event); } },
  }));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/architecture`;

  async function request(relativePath, { profile = 'local:dev', method = 'GET', body } = {}) {
    const response = await fetch(`${baseUrl}${relativePath}`, {
      method,
      headers: {
        'X-Profile-Id': profile,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }

  return {
    auditEvents,
    request,
    async close() {
      await new Promise(resolve => server.close(resolve));
      database.close();
    },
  };
}

test('API isolates architecture projects and snapshots by profile', async () => {
  const subject = await fixture();
  try {
    const created = await subject.request('/projects', {
      method: 'POST',
      body: { name: 'orders-platform', description: 'Orders architecture' },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.profileId, 'local:dev');

    const hidden = await subject.request(`/projects/${created.body.id}/graph`, { profile: 'local:other' });
    assert.equal(hidden.status, 404);

    const graph = await subject.request(`/projects/${created.body.id}/graph`, {
      method: 'PUT',
      body: {
        expectedRevision: 0,
        document: {
          projectId: created.body.id,
          nodes: [{ id: 'manual:gateway', name: 'Public API', manual: true }],
        },
      },
    });
    assert.equal(graph.status, 200);
    assert.equal(graph.body.revision, 1);

    const snapshot = await subject.request(`/projects/${created.body.id}/snapshots`, {
      method: 'POST', body: { name: 'Initial design' },
    });
    assert.equal(snapshot.status, 201);
    assert.equal(snapshot.body.document.nodes[0].name, 'Public API');
    assert.equal(subject.auditEvents.every(event => event.category === 'architecture'), true);
  } finally {
    await subject.close();
  }
});

test('API reports revision conflicts without overwriting the graph', async () => {
  const subject = await fixture();
  try {
    const created = await subject.request('/projects', { method: 'POST', body: { name: 'payments' } });
    await subject.request(`/projects/${created.body.id}/graph`, {
      method: 'PUT', body: { expectedRevision: 0, document: { projectId: created.body.id } },
    });
    const conflict = await subject.request(`/projects/${created.body.id}/graph`, {
      method: 'PUT', body: { expectedRevision: 0, document: { projectId: created.body.id } },
    });
    assert.equal(conflict.status, 409);
    assert.match(conflict.body.error, /revision conflict/);
  } finally {
    await subject.close();
  }
});

test('API applies typed operations and exposes diff, revert and change history', async () => {
  const subject = await fixture();
  try {
    const created = await subject.request('/projects', { method: 'POST', body: { name: 'checkout' } });
    const projectId = created.body.id;
    const added = await subject.request(`/projects/${projectId}/operations`, {
      method: 'POST',
      body: {
        expectedRevision: 0,
        reason: 'Initial component',
        operation: { type: 'node.upsert', value: { id: 'manual:api', name: 'Checkout API', manual: true } },
      },
    });
    assert.equal(added.status, 200);
    assert.equal(added.body.revision, 1);
    const baseline = await subject.request(`/projects/${projectId}/snapshots`, {
      method: 'POST', body: { name: 'Baseline' },
    });
    await subject.request(`/projects/${projectId}/operations`, {
      method: 'POST',
      body: {
        expectedRevision: 1,
        operation: { type: 'layout.set', value: { 'manual:api': { x: 120, y: 80 } } },
      },
    });

    const diff = await subject.request(`/projects/${projectId}/snapshots/${baseline.body.id}/diff`);
    assert.equal(diff.status, 200);
    assert.equal(diff.body.diff.changeCount, 1);
    const reverted = await subject.request(`/projects/${projectId}/snapshots/${baseline.body.id}/revert`, {
      method: 'POST', body: { expectedRevision: 2, reason: 'Undo layout experiment' },
    });
    assert.equal(reverted.status, 201);
    assert.equal(reverted.body.graph.revision, 3);
    assert.deepEqual(reverted.body.graph.document.layout, {});

    const changes = await subject.request(`/projects/${projectId}/changes`);
    assert.deepEqual(changes.body.map(change => change.type), [
      'snapshot.revert', 'layout.set', 'node.upsert',
    ]);
    assert.equal(changes.body[2].author, 'local:dev');
  } finally {
    await subject.close();
  }
});

test('API requires an expected revision for typed graph mutations', async () => {
  const subject = await fixture();
  try {
    const created = await subject.request('/projects', { method: 'POST', body: { name: 'guarded' } });
    const result = await subject.request(`/projects/${created.body.id}/operations`, {
      method: 'POST',
      body: { operation: { type: 'node.upsert', value: { id: 'manual:api', name: 'API' } } },
    });
    assert.equal(result.status, 400);
    assert.equal(result.body.error, 'expectedRevision must be a non-negative integer');
  } finally {
    await subject.close();
  }
});