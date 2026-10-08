'use strict';

const MAX_RUNTIME_LOG_BYTES = 2 * 1024 * 1024;
const MAX_RUNTIME_LOG_EVENTS = 5000;
// The runtime-logs endpoint streams (application/stream+json) and can stay open
// while new logs arrive: a read is a bounded sample, never an open-ended wait.
const RUNTIME_LOG_TIMEOUT_MS = 20 * 1000;

// Wraps the same upstream SSE call the existing GET /deployments/:id/logs route makes
// (routes/vercel.js), but parses the frames server-side instead of piping raw bytes to a
// browser EventSource — the line-extraction mirrors VercelDeploymentLogs.vue's already
// working `entry.text || entry.payload?.text || JSON.stringify(...)` logic exactly, so
// this isn't a fresh guess at Vercel's event schema.

function createVercelLogsBroker({
  resolveVercelAuth, vercelFetch, fetchImpl, ReadableFromWeb,
  maxRuntimeLogBytes = MAX_RUNTIME_LOG_BYTES, runtimeLogTimeoutMs = RUNTIME_LOG_TIMEOUT_MS,
} = {}) {
  resolveVercelAuth ||= require('../routes/vercel').resolveVercelAuth;
  const route = require('../routes/vercel');
  vercelFetch ||= route.vercelFetch;
  const { VERCEL_ENDPOINTS, withTeam } = route;
  fetchImpl ||= fetch;
  ReadableFromWeb ||= require('stream').Readable.fromWeb;

  function extractText(entry) {
    return entry.text || entry.payload?.text || JSON.stringify(entry.payload || entry);
  }

  async function runtimeLogs({ profileId, projectId, startTime = -Infinity, endTime = Infinity }) {
    const { token, teamId } = await resolveVercelAuth(profileId);
    // The latest production deployment that is serving: a failed one has no runtime logs.
    const deploymentQuery = new URLSearchParams({ projectId, target: 'production', state: 'READY', limit: '1' });
    if (teamId) deploymentQuery.set('teamId', teamId);
    const deployments = await vercelFetch(`/v7/deployments?${deploymentQuery}`, token);
    const deploymentId = deployments?.deployments?.[0]?.uid;
    if (!deploymentId) return { events: [], deploymentId: null, truncated: false };

    let qs = `/v1/projects/${encodeURIComponent(projectId)}/deployments/${encodeURIComponent(deploymentId)}/runtime-logs`;
    if (teamId) qs += `?teamId=${encodeURIComponent(teamId)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), runtimeLogTimeoutMs);
    let read;
    try {
      let upstream;
      try {
        upstream = await fetchImpl(`https://api.vercel.com${qs}`, {
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/stream+json' },
          signal: controller.signal,
        });
      } catch (error) {
        if (!controller.signal.aborted) throw error;
        throw Object.assign(new Error(`Vercel runtime logs did not answer in ${Math.round(runtimeLogTimeoutMs / 1000)}s`), {
          status: 504, $metadata: { httpStatusCode: 504 },
        });
      }
      if (!upstream.ok) {
        const body = await upstream.text().catch(() => '');
        throw Object.assign(new Error(`Vercel runtime logs (${upstream.status}): ${body || upstream.statusText}`), {
          status: upstream.status,
          retryAfter: Number(upstream.headers?.get?.('retry-after')) || null,
          $metadata: { httpStatusCode: upstream.status },
        });
      }
      read = await readBoundedBody(upstream, maxRuntimeLogBytes, ReadableFromWeb, controller.signal);
    } finally {
      clearTimeout(timer);
      // Closes the upstream stream when it is still open.
      controller.abort();
    }
    const { text, truncated, timedOut } = read;
    const lines = text.split(/\r?\n/).filter(Boolean);
    const events = [];
    for (const line of lines.slice(0, MAX_RUNTIME_LOG_EVENTS)) {
      let entry;
      try { entry = JSON.parse(line); } catch { continue; }
      const timestamp = Number(entry.timestampInMs);
      if (!Number.isFinite(timestamp) || timestamp < startTime || timestamp >= endTime) continue;
      events.push({
        timestamp, eventId: entry.rowId || '', logStreamName: entry.source || '',
        message: [entry.level, entry.message].filter(Boolean).join(' '),
      });
    }
    return { events, deploymentId, truncated: truncated || lines.length > MAX_RUNTIME_LOG_EVENTS, timedOut };
  }

  async function streamDeploymentLogs({ profileId, deploymentId }, { onEntry, onError, onEnd } = {}) {
    const { token, teamId } = await resolveVercelAuth(profileId);
    let qs = `${VERCEL_ENDPOINTS.deploymentEvents(deploymentId)}?direction=forward&follow=1`;
    qs = withTeam(qs, teamId);

    const upstream = await fetchImpl(`https://api.vercel.com${qs}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
    });
    if (!upstream.ok) {
      const body = await upstream.json().catch(() => ({}));
      throw Object.assign(new Error(body?.error?.message || upstream.statusText), { $metadata: { httpStatusCode: upstream.status } });
    }

    const nodeStream = ReadableFromWeb ? ReadableFromWeb(upstream.body) : upstream.body;
    let buffer = '';

    function handleChunk(chunk) {
      buffer += chunk.toString('utf8');
      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const dataLines = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trim());
        if (!dataLines.length) continue;
        const raw = dataLines.join('\n');
        try {
          onEntry?.(extractText(JSON.parse(raw)))
        } catch (_) {
          onEntry?.(raw);
        }
      }
    }

    nodeStream.on('data', handleChunk);
    nodeStream.on('end', () => onEnd?.());
    nodeStream.on('error', err => onError?.(err));

    return { stop: () => { try { nodeStream.destroy?.(); } catch (_) {} } };
  }

  return { streamDeploymentLogs, runtimeLogs };
}

/**
 * Reads at most `maxBytes` of a streamed body. When `signal` aborts (timeout)
 * it stops and keeps the complete lines read so far: a sample, not an error.
 */
async function readBoundedBody(response, maxBytes, ReadableFromWeb, signal = null) {
  if (!response.body) return { text: '', truncated: false, timedOut: false };
  const stream = ReadableFromWeb ? ReadableFromWeb(response.body) : response.body;
  const iterator = stream[Symbol.asyncIterator]();
  const aborted = new Promise(resolve => {
    if (!signal) return;
    if (signal.aborted) resolve({ aborted: true });
    else signal.addEventListener('abort', () => resolve({ aborted: true }), { once: true });
  });
  const decoder = new TextDecoder();
  let text = '';
  let bytesRead = 0;
  let truncated = false;
  let timedOut = false;
  for (;;) {
    let next;
    try {
      next = await Promise.race([iterator.next(), aborted]);
    } catch (error) {
      // An aborted fetch body rejects instead of ending.
      if (signal?.aborted) { timedOut = true; break; }
      throw error;
    }
    if (next.aborted) {
      timedOut = true;
      iterator.return?.().catch?.(() => {});
      stream.destroy?.();
      break;
    }
    if (next.done) break;
    const chunk = next.value;
    const bytes = Buffer.from(chunk);
    const remaining = maxBytes - bytesRead;
    if (bytes.length > remaining) {
      text += decoder.decode(bytes.subarray(0, remaining), { stream: true });
      truncated = true;
      stream.destroy?.();
      break;
    }
    text += decoder.decode(bytes, { stream: true });
    bytesRead += bytes.length;
  }
  text += decoder.decode();
  // A cut stream can end in the middle of a line.
  if (truncated || timedOut) text = text.slice(0, text.lastIndexOf('\n') + 1);
  return { text, truncated, timedOut };
}

module.exports = { createVercelLogsBroker, MAX_RUNTIME_LOG_BYTES, MAX_RUNTIME_LOG_EVENTS, RUNTIME_LOG_TIMEOUT_MS };
