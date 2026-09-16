'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createGcpLogsBroker } = require('./gcpLogsBroker');

const authCtx = { projectId: 'proj-1' };
const resolveGcpAuth = async () => authCtx;

test('fetchEntries passes the same filter shape as the existing Cloud Run logs route', async () => {
  let capturedUrl, capturedAuthCtx, capturedMethod, capturedBody;
  const gcpFetch = async (url, ctx, method, body) => {
    capturedUrl = url; capturedAuthCtx = ctx; capturedMethod = method; capturedBody = body;
    return { entries: [] };
  };
  const broker = createGcpLogsBroker({ resolveGcpAuth, gcpFetch });
  await broker.fetchEntries({ profileId: 'p1', project: 'proj-1', region: 'us-central1', service: 'my-svc', sinceTimestamp: '2026-01-01T00:00:00Z' });

  assert.equal(capturedUrl, 'https://logging.googleapis.com/v2/entries:list');
  assert.equal(capturedAuthCtx, authCtx);
  assert.equal(capturedMethod, 'POST');
  assert.equal(capturedBody.resourceNames[0], 'projects/proj-1');
  assert.match(capturedBody.filter, /resource\.type="cloud_run_revision"/);
  assert.match(capturedBody.filter, /resource\.labels\.service_name="my-svc"/);
  assert.match(capturedBody.filter, /resource\.labels\.location="us-central1"/);
  assert.match(capturedBody.filter, /timestamp>"2026-01-01T00:00:00Z"/);
});

test('normalizes entries and advances the cursor to the last entry timestamp', async () => {
  const gcpFetch = async () => ({
    entries: [
      { timestamp: '2026-01-01T00:00:01Z', severity: 'ERROR', textPayload: 'boom' },
      { timestamp: '2026-01-01T00:00:02Z', jsonPayload: { msg: 'ok' } },
    ],
  });
  const broker = createGcpLogsBroker({ resolveGcpAuth, gcpFetch });
  const { entries, nextSince } = await broker.fetchEntries({ profileId: 'p1', project: 'proj-1', region: 'us-central1', service: 'svc', sinceTimestamp: 't0' });

  assert.deepEqual(entries[0], { timestamp: '2026-01-01T00:00:01Z', severity: 'ERROR', message: 'boom' });
  assert.equal(entries[1].message, '{"msg":"ok"}');
  assert.equal(nextSince, '2026-01-01T00:00:02Z');
});

test('keeps the same cursor when there are no new entries', async () => {
  const broker = createGcpLogsBroker({ resolveGcpAuth, gcpFetch: async () => ({ entries: [] }) });
  const { entries, nextSince } = await broker.fetchEntries({ profileId: 'p1', project: 'proj-1', region: 'us-central1', service: 'svc', sinceTimestamp: 't0' });
  assert.deepEqual(entries, []);
  assert.equal(nextSince, 't0');
});

test('falls back to the resolved profile project when none is supplied', async () => {
  let capturedBody;
  const gcpFetch = async (_url, _ctx, _method, body) => { capturedBody = body; return { entries: [] }; };
  const broker = createGcpLogsBroker({ resolveGcpAuth, gcpFetch });
  await broker.fetchEntries({ profileId: 'p1', project: '', region: 'us-central1', service: 'svc', sinceTimestamp: 't0' });
  assert.equal(capturedBody.resourceNames[0], 'projects/proj-1');
});

test('rejects when no project can be resolved, without ever calling gcpFetch', async () => {
  let called = false;
  const broker = createGcpLogsBroker({ resolveGcpAuth: async () => ({}), gcpFetch: async () => { called = true; return { entries: [] }; } });
  await assert.rejects(
    broker.fetchEntries({ profileId: 'p1', project: '', region: 'us-central1', service: 'svc', sinceTimestamp: 't0' }),
    /GCP project is required/,
  );
  assert.equal(called, false);
});

test('a permission-denied error from gcpFetch propagates cleanly', async () => {
  const denied = Object.assign(new Error('The caller does not have permission'), { $metadata: { httpStatusCode: 403 } });
  const broker = createGcpLogsBroker({ resolveGcpAuth, gcpFetch: async () => { throw denied; } });
  await assert.rejects(
    broker.fetchEntries({ profileId: 'p1', project: 'proj-1', region: 'us-central1', service: 'svc', sinceTimestamp: 't0' }),
    /permission/,
  );
});

test('an invalid profile rejects before any Cloud Logging call is made', async () => {
  let called = false;
  const broker = createGcpLogsBroker({
    resolveGcpAuth: async () => { throw new Error('Credential profile not found'); },
    gcpFetch: async () => { called = true; return { entries: [] }; },
  });
  await assert.rejects(
    broker.fetchEntries({ profileId: 'missing', project: 'proj-1', region: 'us-central1', service: 'svc', sinceTimestamp: 't0' }),
    /Credential profile not found/,
  );
  assert.equal(called, false);
});
