'use strict';

const MAX_RUNTIME_LOG_BYTES = 2 * 1024 * 1024;
const MAX_RUNTIME_LOG_EVENTS = 5000;

// Wraps the same upstream SSE call the existing GET /deployments/:id/logs route makes
// (routes/vercel.js), but parses the frames server-side instead of piping raw bytes to a
// browser EventSource — the line-extraction mirrors VercelDeploymentLogs.vue's already
// working `entry.text || entry.payload?.text || JSON.stringify(...)` logic exactly, so
// this isn't a fresh guess at Vercel's event schema.

function createVercelLogsBroker({ resolveVercelAuth, vercelFetch, fetchImpl, ReadableFromWeb, maxRuntimeLogBytes = MAX_RUNTIME_LOG_BYTES } = {}) {
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
    const deploymentQuery = new URLSearchParams({ projectId, target: 'production', limit: '1' });
    if (teamId) deploymentQuery.set('teamId', teamId);
    const deployments = await vercelFetch(`/v7/deployments?${deploymentQuery}`, token);
    const deploymentId = deployments?.deployments?.[0]?.uid;
    if (!deploymentId) return { events: [], deploymentId: null, truncated: false };

    let qs = `/v1/projects/${encodeURIComponent(projectId)}/deployments/${encodeURIComponent(deploymentId)}/runtime-logs`;
    if (teamId) qs += `?teamId=${encodeURIComponent(teamId)}`;
    const upstream = await fetchImpl(`https://api.vercel.com${qs}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/stream+json' },
    });
    if (!upstream.ok) {
      const body = await upstream.text().catch(() => '');
      throw Object.assign(new Error(`Vercel runtime logs (${upstream.status}): ${body || upstream.statusText}`), {
        status: upstream.status,
        retryAfter: Number(upstream.headers?.get?.('retry-after')) || null,
        $metadata: { httpStatusCode: upstream.status },
      });
    }

    const { text, truncated } = await readBoundedBody(upstream, maxRuntimeLogBytes, ReadableFromWeb);
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
    return { events, deploymentId, truncated: truncated || lines.length > MAX_RUNTIME_LOG_EVENTS };
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

async function readBoundedBody(response, maxBytes, ReadableFromWeb) {
  if (!response.body) return { text: '', truncated: false };
  const stream = ReadableFromWeb ? ReadableFromWeb(response.body) : response.body;
  const decoder = new TextDecoder();
  let text = '';
  let bytesRead = 0;
  let truncated = false;
  for await (const chunk of stream) {
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
  if (truncated) text = text.slice(0, text.lastIndexOf('\n') + 1);
  return { text, truncated };
}

module.exports = { createVercelLogsBroker, MAX_RUNTIME_LOG_BYTES, MAX_RUNTIME_LOG_EVENTS };
