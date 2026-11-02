'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');
const { createTaskJournal, countTaskWork, timeTaskWork, parseTaskHeader, normalizePath, UNTRACKED } = require('./taskJournal');

async function withServer(journal, mount, fn) {
  const app = express();
  app.use(express.json());
  app.use('/api/observability', journal.middleware);
  mount(app);
  const server = app.listen(0);
  try {
    await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
  }
}

// 'finish' fires after the client may already have its response.
const settle = () => new Promise(resolve => setImmediate(resolve));

test('parseTaskHeader accepts key;runId and marks anything else untracked', () => {
  assert.deepEqual(parseTaskHeader('review.confirm-all;r-1a2b'), { task: 'review.confirm-all', runId: 'r-1a2b' });
  assert.deepEqual(parseTaskHeader('app.load'), { task: 'app.load', runId: null });
  assert.deepEqual(parseTaskHeader('app.load;not valid!'), { task: 'app.load', runId: null });
  assert.deepEqual(parseTaskHeader(undefined), { task: UNTRACKED, runId: null });
  assert.deepEqual(parseTaskHeader('<script>'), { task: UNTRACKED, runId: null });
  assert.deepEqual(parseTaskHeader(`${'a'.repeat(81)};r1`), { task: UNTRACKED, runId: null });
});

test('normalizePath replaces the ids that follow known collections', () => {
  assert.equal(normalizePath('/api/observability/aws/applications/app-1/edges/e-9'), '/api/observability/aws/applications/:id/edges/:id');
  assert.equal(normalizePath('/api/kua-apps/applications/app-1/registry?x=arn:aws:1'), '/api/kua-apps/applications/:id/registry');
});

test('a request is journaled with its route pattern, task, application and counters', async () => {
  const journal = createTaskJournal();
  await withServer(journal, app => {
    app.post('/api/observability/aws/applications/:applicationId/edges', (_req, res) => {
      countTaskWork('reconciles');
      countTaskWork('awsCalls', 2);
      timeTaskWork('topologyAnalysisMs', () => {});
      res.status(201).json({ ok: true });
    });
  }, async base => {
    const response = await fetch(`${base}/api/observability/aws/applications/app-1/edges`, {
      method: 'POST',
      headers: { 'X-KUA-Task': 'review.confirm-dependencies;run-1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceResourceId: 'arn:aws:lambda:secret' }),
    });
    assert.equal(response.status, 201);
    await settle();
  });
  const [entry] = journal.list().entries;
  assert.equal(entry.route, '/api/observability/aws/applications/:applicationId/edges');
  assert.equal(entry.method, 'POST');
  assert.equal(entry.status, 201);
  assert.equal(entry.aborted, false);
  assert.equal(entry.applicationId, 'app-1');
  assert.equal(entry.task, 'review.confirm-dependencies');
  assert.equal(entry.runId, 'run-1');
  assert.equal(entry.reconciles, 1);
  assert.equal(entry.awsCalls, 2);
  assert.ok(Number.isInteger(entry.durationMs));
  assert.doesNotMatch(JSON.stringify(entry), /arn:aws/);
});

test('work started by a request is attributed to it, and only to it', async () => {
  const journal = createTaskJournal();
  await withServer(journal, app => {
    app.get('/api/observability/aws/applications/:applicationId/topology', async (req, res) => {
      await new Promise(resolve => setTimeout(resolve, req.params.applicationId === 'slow' ? 20 : 0));
      countTaskWork('logHistoryReads');
      if (req.params.applicationId === 'slow') countTaskWork('logHistoryReads');
      res.json({});
    });
  }, async base => {
    await Promise.all(['slow', 'fast'].map(id => fetch(`${base}/api/observability/aws/applications/${id}/topology`, { headers: { 'X-KUA-Task': 'app.load' } })));
    await settle();
  });
  const byApplication = Object.fromEntries(journal.list().entries.map(entry => [entry.applicationId, entry.logHistoryReads]));
  assert.deepEqual(byApplication, { slow: 2, fast: 1 });
});

test('counting outside a journaled request is a no-op', () => {
  assert.doesNotThrow(() => countTaskWork('reconciles'));
  assert.equal(timeTaskWork('topologyAnalysisMs', () => 42), 42);
});

test('requests without a task header are listed as untracked', async () => {
  const journal = createTaskJournal();
  await withServer(journal, app => {
    app.get('/api/observability/aws/usage', (_req, res) => res.json({}));
  }, async base => {
    await fetch(`${base}/api/observability/aws/usage`);
    await settle();
  });
  const { entries, summary } = journal.list();
  assert.equal(entries[0].task, UNTRACKED);
  assert.equal(entries[0].applicationId, null);
  assert.equal(summary.untracked, 1);
});

test('the journal keeps only the newest entries', async () => {
  const journal = createTaskJournal({ capacity: 3 });
  await withServer(journal, app => {
    app.get('/api/observability/aws/applications/:applicationId', (_req, res) => res.json({}));
  }, async base => {
    for (let index = 1; index <= 5; index += 1) await fetch(`${base}/api/observability/aws/applications/app-${index}`);
    await settle();
  });
  const { entries, capacity } = journal.list();
  assert.equal(capacity, 3);
  assert.deepEqual(entries.map(entry => entry.applicationId), ['app-3', 'app-4', 'app-5']);
});

test('list filters by application, since and limit, and summarizes per task and route', async () => {
  let clock = Date.parse('2026-11-02T10:00:00Z');
  const journal = createTaskJournal({ now: () => clock });
  await withServer(journal, app => {
    app.get('/api/observability/aws/applications/:applicationId/registry', (_req, res) => {
      countTaskWork('reconciles');
      res.json({});
    });
  }, async base => {
    for (const [id, task] of [['a', 'app.registry'], ['a', 'app.registry'], ['b', 'app.registry'], ['a', 'app.load']]) {
      clock += 1000;
      await fetch(`${base}/api/observability/aws/applications/${id}/registry`, { headers: { 'X-KUA-Task': task } });
    }
    await settle();
  });

  const forA = journal.list({ applicationId: 'a' });
  assert.equal(forA.entries.length, 3);
  assert.equal(forA.summary.reconciles, 3);
  const registry = forA.summary.byTask.find(group => group.key === 'app.registry');
  assert.equal(registry.requests, 2);
  assert.equal(registry.reconciles, 2);
  assert.ok(registry.p50Ms <= registry.p95Ms);
  assert.equal(forA.summary.byRoute[0].key, 'GET /api/observability/aws/applications/:applicationId/registry');

  assert.equal(journal.list({ since: '2026-11-02T10:00:02Z' }).entries.length, 2);
  assert.equal(journal.list({ since: String(Date.parse('2026-11-02T10:00:03Z')) }).entries.length, 1);
  assert.deepEqual(journal.list({ limit: '1' }).entries.map(entry => entry.task), ['app.load']);
  journal.clear();
  assert.equal(journal.list().entries.length, 0);
});

test('a request the client abandons is journaled as aborted', async () => {
  const journal = createTaskJournal();
  let release;
  await withServer(journal, app => {
    app.get('/api/observability/aws/applications/:applicationId/overview', async (_req, res) => {
      await new Promise(resolve => { release = resolve; });
      res.json({});
    });
  }, async base => {
    const controller = new AbortController();
    const pending = fetch(`${base}/api/observability/aws/applications/app-1/overview`, { signal: controller.signal }).catch(() => null);
    while (!release) await new Promise(resolve => setTimeout(resolve, 5));
    controller.abort();
    await pending;
    await new Promise(resolve => setTimeout(resolve, 20));
    release();
    await settle();
  });
  const [entry] = journal.list().entries;
  assert.equal(entry.aborted, true);
  assert.equal(entry.status, null);
});
