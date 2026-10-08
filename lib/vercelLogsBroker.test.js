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

function runtimeBroker({ body = '', response = {}, maxRuntimeLogBytes, runtimeLogTimeoutMs, stream } = {}) {
  const calls = [];
  const broker = createVercelLogsBroker({
    resolveVercelAuth,
    vercelFetch: async path => { calls.push(path); return { deployments: [{ uid: 'dpl_123' }] }; },
    fetchImpl: async (url, options) => {
      calls.push([url, options]);
      return { ok: true, status: 200, body: stream ? stream(options.signal) : (async function* () { yield Buffer.from(body); })(), ...response };
    },
    ReadableFromWeb: value => value,
    maxRuntimeLogBytes,
    runtimeLogTimeoutMs,
  });
  return { broker, calls };
}

test('runtimeLogs reads normalized rows from the latest production deployment, not build events', async () => {
  const fixture = [
    JSON.stringify({ rowId: 'row-1', timestampInMs: '1767225601000', level: 'error', message: 'boom', source: 'serverless' }),
    JSON.stringify({ rowId: 'old', timestampInMs: '1767225599000', level: 'info', message: 'old' }),
  ].join('\n') + '\n';
  const { broker, calls } = runtimeBroker({ body: fixture });
  const result = await broker.runtimeLogs({ profileId: 'p1', projectId: 'project-1', startTime: 1767225600000, endTime: 1767225602000 });

  assert.equal(calls[0], '/v7/deployments?projectId=project-1&target=production&state=READY&limit=1&teamId=team-1');
  assert.equal(calls[1][0], 'https://api.vercel.com/v1/projects/project-1/deployments/dpl_123/runtime-logs?teamId=team-1');
  assert.equal(calls[1][1].headers.Accept, 'application/stream+json');
  assert.deepEqual(result.events, [{ timestamp: 1767225601000, eventId: 'row-1', logStreamName: 'serverless', message: 'error boom' }]);
  assert.equal(result.deploymentId, 'dpl_123');
  assert.equal(result.truncated, false);
});

test('runtimeLogs preserves Vercel rate-limit metadata', async () => {
  const { broker } = runtimeBroker({ response: {
    ok: false, status: 429, statusText: 'Too Many Requests',
    headers: { get: () => '60' }, text: async () => 'rate limited',
  } });
  await assert.rejects(broker.runtimeLogs({ profileId: 'p1', projectId: 'project-1' }), error => error.status === 429 && error.retryAfter === 60);
});

test('runtimeLogs bounds stream reads and reports truncation', async () => {
  const first = JSON.stringify({ rowId: 'first', timestampInMs: 10, message: 'one' });
  const second = JSON.stringify({ rowId: 'second', timestampInMs: 11, message: 'two' });
  const { broker } = runtimeBroker({ body: `${first}\n${second}\n`, maxRuntimeLogBytes: Buffer.byteLength(first) + 1 });
  const result = await broker.runtimeLogs({ profileId: 'p1', projectId: 'project-1' });
  assert.deepEqual(result.events.map(event => event.eventId), ['first']);
  assert.equal(result.truncated, true);
});

test('runtimeLogs stops a stream that stays open and keeps the lines read as a sample', async () => {
  const line = JSON.stringify({ rowId: 'live-1', timestampInMs: 10, level: 'info', message: 'still running' });
  // Sends one line and a partial one, then never ends (a live tail).
  const stream = () => (async function* () {
    yield Buffer.from(`${line}\n{"rowId":"partial"`);
    await new Promise(() => {});
  })();
  const { broker } = runtimeBroker({ stream, runtimeLogTimeoutMs: 30 });
  const started = Date.now();
  const result = await broker.runtimeLogs({ profileId: 'p1', projectId: 'project-1' });
  assert.ok(Date.now() - started < 2000);
  assert.deepEqual(result.events.map(event => event.eventId), ['live-1']);
  assert.equal(result.timedOut, true);
  assert.equal(result.truncated, false);
});

test('runtimeLogs reports a timeout when Vercel does not answer at all', async () => {
  const broker = createVercelLogsBroker({
    resolveVercelAuth,
    vercelFetch: async () => ({ deployments: [{ uid: 'dpl_123' }] }),
    fetchImpl: (url, options) => new Promise((_, reject) => {
      options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }),
    ReadableFromWeb: value => value,
    runtimeLogTimeoutMs: 20,
  });
  await assert.rejects(broker.runtimeLogs({ profileId: 'p1', projectId: 'project-1' }), error => error.status === 504 && /did not answer/.test(error.message));
});
