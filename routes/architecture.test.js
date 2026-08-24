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