'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createVercelLogsBroker } = require('./vercelLogsBroker');

const resolveVercelAuth = async () => ({ token: 'tok-1', teamId: 'team-1' });

function fakeStream() {
  const stream = new EventEmitter();
  stream.destroy = () => { stream.destroyed = true; };
  return stream;
}

function fakeUpstream(stream, overrides = {}) {
  return { ok: true, status: 200, body: {}, json: async () => ({}), ...overrides };
}

test('opens the exact same upstream deployment-events endpoint the existing SSE route hits', async () => {
  let capturedUrl, capturedHeaders;
  const stream = fakeStream();
  const fetchImpl = async (url, options) => { capturedUrl = url; capturedHeaders = options.headers; return fakeUpstream(); };
  const broker = createVercelLogsBroker({ resolveVercelAuth, fetchImpl, ReadableFromWeb: () => stream });
  await broker.streamDeploymentLogs({ profileId: 'p1', deploymentId: 'dpl_123' }, {});

  assert.match(capturedUrl, /\/v3\/deployments\/dpl_123\/events/);
  assert.match(capturedUrl, /direction=forward&follow=1/);
  assert.match(capturedUrl, /teamId=team-1/);
  assert.equal(capturedHeaders.Authorization, 'Bearer tok-1');
});

test('parses SSE frames the same way VercelDeploymentLogs.vue already does (text, payload.text, or raw JSON)', async () => {
  const stream = fakeStream();
  const entries = [];
  const fetchImpl = async () => fakeUpstream();
  const broker = createVercelLogsBroker({ resolveVercelAuth, fetchImpl, ReadableFromWeb: () => stream });
  await broker.streamDeploymentLogs({ profileId: 'p1', deploymentId: 'dpl_123' }, { onEntry: e => entries.push(e) });

  stream.emit('data', Buffer.from(`data: ${JSON.stringify({ type: 'stdout', text: 'hello world' })}\n\n`));
  stream.emit('data', Buffer.from(`data: ${JSON.stringify({ type: 'stdout', payload: { text: 'from payload' } })}\n\n`));
  stream.emit('data', Buffer.from(`data: ${JSON.stringify({ type: 'deployment-state', payload: { readyState: 'READY' } })}\n\n`));

  assert.deepEqual(entries, ['hello world', 'from payload', '{"readyState":"READY"}']);
});

test('handles a frame split across multiple chunks', async () => {
  const stream = fakeStream();
  const entries = [];
  const broker = createVercelLogsBroker({ resolveVercelAuth, fetchImpl: async () => fakeUpstream(), ReadableFromWeb: () => stream });
  await broker.streamDeploymentLogs({ profileId: 'p1', deploymentId: 'dpl_123' }, { onEntry: e => entries.push(e) });

  const full = `data: ${JSON.stringify({ text: 'split line' })}\n\n`
  stream.emit('data', Buffer.from(full.slice(0, 10)))
  stream.emit('data', Buffer.from(full.slice(10)))

  assert.deepEqual(entries, ['split line']);
});

test('falls back to the raw frame text when it is not valid JSON, same as the frontend fallback', async () => {
  const stream = fakeStream();
  const entries = [];
  const broker = createVercelLogsBroker({ resolveVercelAuth, fetchImpl: async () => fakeUpstream(), ReadableFromWeb: () => stream });
  await broker.streamDeploymentLogs({ profileId: 'p1', deploymentId: 'dpl_123' }, { onEntry: e => entries.push(e) });

  stream.emit('data', Buffer.from('data: not json at all\n\n'));
  assert.deepEqual(entries, ['not json at all']);
});

test('stop() destroys the upstream stream', async () => {
  const stream = fakeStream();
  const broker = createVercelLogsBroker({ resolveVercelAuth, fetchImpl: async () => fakeUpstream(), ReadableFromWeb: () => stream });
  const handle = await broker.streamDeploymentLogs({ profileId: 'p1', deploymentId: 'dpl_123' }, {});
  handle.stop();
  assert.equal(stream.destroyed, true);
});

test('calls onEnd/onError when the upstream stream ends or errors', async () => {
  const stream = fakeStream();
  let ended = false, errored = null;
  const broker = createVercelLogsBroker({ resolveVercelAuth, fetchImpl: async () => fakeUpstream(), ReadableFromWeb: () => stream });
  await broker.streamDeploymentLogs({ profileId: 'p1', deploymentId: 'dpl_123' }, { onEnd: () => { ended = true }, onError: err => { errored = err } });

  stream.emit('end');
  assert.equal(ended, true);
  stream.emit('error', new Error('boom'));
  assert.equal(errored.message, 'boom');
});

test('a failed upstream request rejects without ever attaching stream listeners', async () => {
  const broker = createVercelLogsBroker({
    resolveVercelAuth,
    fetchImpl: async () => ({ ok: false, status: 403, statusText: 'Forbidden', json: async () => ({ error: { message: 'Not authorized' } }) }),
  });
  await assert.rejects(
    broker.streamDeploymentLogs({ profileId: 'p1', deploymentId: 'dpl_123' }, {}),
    /Not authorized/,
  );
});

test('an invalid profile rejects before any request is made', async () => {
  let called = false;
  const broker = createVercelLogsBroker({
    resolveVercelAuth: async () => { throw new Error('Credential profile not found'); },
    fetchImpl: async () => { called = true; return fakeUpstream(); },
  });
  await assert.rejects(
    broker.streamDeploymentLogs({ profileId: 'missing', deploymentId: 'dpl_123' }, {}),
    /Credential profile not found/,
  );
  assert.equal(called, false);
});
