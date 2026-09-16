'use strict';

// Wraps the same upstream SSE call the existing GET /deployments/:id/logs route makes
// (routes/vercel.js), but parses the frames server-side instead of piping raw bytes to a
// browser EventSource — the line-extraction mirrors VercelDeploymentLogs.vue's already
// working `entry.text || entry.payload?.text || JSON.stringify(...)` logic exactly, so
// this isn't a fresh guess at Vercel's event schema.

function createVercelLogsBroker({ resolveVercelAuth, fetchImpl, ReadableFromWeb } = {}) {
  resolveVercelAuth ||= require('../routes/vercel').resolveVercelAuth;
  const { VERCEL_ENDPOINTS, withTeam } = require('../routes/vercel');
  fetchImpl ||= fetch;
  ReadableFromWeb ||= require('stream').Readable.fromWeb;

  function extractText(entry) {
    return entry.text || entry.payload?.text || JSON.stringify(entry.payload || entry);
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

  return { streamDeploymentLogs };
}

module.exports = { createVercelLogsBroker };
